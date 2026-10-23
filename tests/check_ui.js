// 守介面：輪到你時桌上的標籤互不重疊也不跑出畫面、手機的牌桌夠大、操作列的按鈕都在列內不換行、
// 籌碼重新整理後還在、籌碼輸光能一鍵重置。
// 驗不到：真手機（這裡是 CDP 模擬的尺寸）、真人手指點不點得準。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };
const SMALL_PHONE = { size: [360, 640], mobile: true };
const url = dir => pathToFileURL(path.join(dir, 'index.html')).href;

// 打到輪到你為止（荷官或你拿 Blackjack 那局不會輪到你，就再打一局），量那一刻的標籤與按鈕
const MEASURE_TURN = `(async () => {
  const s = BJK.view.stage, hud = document.getElementById('hud');
  await s.dealer.ready;
  BJK.view.anim.speed = 40;
  const until = async cond => { for (let i = 0; i < 400 && !cond(); i++) await new Promise(r => setTimeout(r, 25)); return cond(); };
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    s.director.runRound(50);   // 一呼叫就同步切到 busy，所以下面等到 act 或 bet 就是這一局有了結果
    await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet');
    reached = hud.dataset.mode === 'act';
  }
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const labels = [...document.querySelectorAll('#overlay .total, #overlay .seat-tag')].filter(el => !el.hidden)
    .map(el => ({ text: el.textContent, ...rect(el) }));
  // 藏起來的鈕（不能分時的分牌鈕）不算：它的框是 0×0，量了只會誤判跑出操作列
  const buttons = [...document.querySelectorAll('#actBar button')].filter(el => !el.hidden).map(el => ({ text: el.textContent, ...rect(el) }));
  return { reached, labels, buttons, hud: { ...rect(hud), scrollH: hud.scrollHeight, clientH: hud.clientHeight }, vw: innerWidth, vh: innerHeight };
})()`;

// seatSpan：最左與最右兩個下注圈的中心在畫面上相距幾成畫面寬，量牌桌放得多大
const MEASURE_BET = `(async () => {
  const s = BJK.view.stage;
  await s.dealer.ready;
  const hud = document.getElementById('hud');
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const x = seat => seat.circle.clone().project(s.camera).x;
  const seats = s.table.seats;
  return { mode: hud.dataset.mode, seatSpan: (x(seats[seats.length - 1]) - x(seats[0])) / 2,
           buttons: [...document.querySelectorAll('#betBar button')].map(el => ({ text: el.textContent, ...rect(el) })),
           hud: { ...rect(hud), scrollH: hud.scrollHeight, clientH: hud.clientHeight }, vw: innerWidth, vh: innerHeight };
})()`;

const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
function pairsOverlapping(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (overlaps(list[i], list[j])) out.push(`${list[i].text} ↔ ${list[j].text}`);
  }
  return out;
}

function assertButtonsFit(m, what) {
  const why = JSON.stringify(m);
  assert.ok(m.buttons.length > 0, `${what} 沒有按鈕：${why}`);
  assert.ok(m.hud.scrollH <= m.hud.clientH + 1, `${what} 的操作列內容超出固定高度（按鈕換行了）：${why}`);
  const firstTop = m.buttons[0].top;
  for (const b of m.buttons) {
    assert.ok(b.left >= m.hud.left && b.right <= m.hud.right && b.top >= m.hud.top && b.bottom <= m.hud.bottom, `${what} 的「${b.text}」跑出操作列：${why}`);
    assert.ok(Math.abs(b.top - firstTop) < 1, `${what} 的按鈕沒排在同一列：${why}`);
    assert.ok(b.bottom - b.top >= 36, `${what} 的「${b.text}」太矮，手指不好按：${why}`);
  }
  assert.deepStrictEqual(pairsOverlapping(m.buttons), [], `${what} 的按鈕互相重疊`);
}

// 標籤有沒有整個落在畫布裡（畫布底＝操作列頂）
function labelsOutOfView(m) {
  return m.labels.filter(l => l.left < 0 || l.right > m.vw || l.top < 0 || l.bottom > m.hud.top).map(l => l.text);
}

// 2026-10-22 量到直式手機改框景前約 0.45、改後約 0.65（小手機 0.43 → 0.61），門檻取中間
const PHONE_SEAT_SPAN = 0.55;

function copyWith(file, from, to) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  const target = path.join(tmp, file);
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(text.includes(from), `破壞沒有命中：${file} 裡找不到 ${from}`);
  fs.writeFileSync(target, text.replace(from, to));
  return tmp;
}

for (const browser of availableBrowsers()) {
  for (const [name, vp] of [['桌機', DESKTOP], ['手機', PHONE], ['小手機', SMALL_PHONE]]) {
    test(`${browser}：${name}輪到你時，桌上的標籤互不重疊、都在畫面內，動作按鈕排成一列`, async () => {
      const r = await withPage(browser, vp, page => page.goto(url(APP)).then(() => page.evaluate(MEASURE_TURN, 30000)));
      const m = r.value;
      assert.ok(m.reached, '打了 6 局都沒輪到你');
      assert.ok(m.labels.length >= 6, `標籤太少，量不出東西：${JSON.stringify(m.labels)}`);
      assert.deepStrictEqual(pairsOverlapping(m.labels), [], `標籤重疊：${JSON.stringify(m.labels)}`);
      assert.deepStrictEqual(labelsOutOfView(m), [], `標籤跑出畫面：${JSON.stringify(m.labels)}`);
      assertButtonsFit(m, '動作列');
      assert.deepStrictEqual(r.console, []);
    });

    test(`${browser}：${name}下注列六顆按鈕排成一列、都在操作列內${vp.mobile ? '，牌桌放大到最外兩個下注圈相距過半畫面' : ''}`, async t => {
      const r = await withPage(browser, vp, page => page.goto(url(APP)).then(() => page.evaluate(MEASURE_BET)));
      assert.strictEqual(r.value.mode, 'bet');
      assertButtonsFit(r.value, '下注列');
      t.diagnostic(`最外兩個下注圈相距 ${(r.value.seatSpan * 100).toFixed(0)}% 畫面寬`);
      if (vp.mobile) assert.ok(r.value.seatSpan >= PHONE_SEAT_SPAN, `牌桌太小：${r.value.seatSpan}`);
    });
  }

  test(`${browser}：籌碼存在瀏覽器裡，重新整理後還是同一個數字`, async () => {
    const r = await withPage(browser, DESKTOP, async page => {
      await page.goto(url(APP));
      const before = await page.evaluate(`(async () => {
        await BJK.view.stage.dealer.ready;
        BJK.view.anim.speed = 40;
        const d = BJK.view.stage.director;
        // 平手的局籌碼不變，要打到數字真的變了才量得出有沒有存
        for (let i = 0; i < 10; i++) { await d.autoplay(1); if (d.game.state().seats.find(s => s.id === 'me').bankroll !== 1000) break; }
        return d.game.state().seats.map(s => s.bankroll);
      })()`, 40000);
      await page.goto(url(APP));
      const after = await page.evaluate(`(async () => { await BJK.view.stage.dealer.ready;
        return { banks: BJK.view.stage.director.game.state().seats.map(s => s.bankroll), shown: document.getElementById('bank').textContent,
                 said: document.getElementById('bubble').textContent }; })()`);
      return { before, after };
    });
    const { before, after } = r.value;
    assert.notStrictEqual(before[1], 1000, '打了 10 局玩家籌碼都沒變，量不出有沒有存');
    assert.deepStrictEqual(after.banks, before, '重新整理後四個座位的籌碼對不上');
    assert.strictEqual(after.shown, before[1].toLocaleString('en-US'));
    assert.match(after.said, /歡迎回來/);
    assert.deepStrictEqual(r.console, []);
  });

  test(`${browser}：存檔壞掉時當新玩家開局，不擲錯`, async () => {
    const r = await withPage(browser, DESKTOP, async page => {
      await page.goto(url(APP));
      await page.evaluate(`localStorage.setItem('bjk.save.v1', '{壞掉的 json'); true`);
      await page.goto(url(APP));
      return page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; return BJK.view.stage.director.game.state().seats.map(s => s.bankroll); })()`);
    });
    assert.deepStrictEqual(r.value, [1000, 1000, 1000, 1000]);
    assert.deepStrictEqual(r.console, []);
  });

  test(`${browser}：籌碼輸光時只剩「重新開始」，按下去補回 1,000`, async () => {
    const r = await withPage(browser, PHONE, async page => {
      await page.goto(url(APP));
      await page.evaluate(`localStorage.setItem('bjk.save.v1', JSON.stringify({ v: 1, bankrolls: { me: 5 } })); true`);
      await page.goto(url(APP));
      return page.evaluate(`(async () => {
        await BJK.view.stage.dealer.ready;
        const hud = document.getElementById('hud'), btn = document.getElementById('resetBtn');
        const visible = id => !document.getElementById(id).hidden;
        const broke = { mode: hud.dataset.mode, reset: visible('brokeBar'), bet: visible('betBar'), bank: document.getElementById('bank').textContent };
        const r = btn.getBoundingClientRect();
        broke.inView = r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        btn.click();
        return { broke, after: { mode: hud.dataset.mode, bank: document.getElementById('bank').textContent, bet: visible('betBar'),
                                 saved: JSON.parse(localStorage.getItem('bjk.save.v1')).bankrolls.me } };
      })()`);
    });
    const { broke, after } = r.value;
    assert.deepStrictEqual(broke, { mode: 'broke', reset: true, bet: false, bank: '5', inView: true });
    assert.deepStrictEqual(after, { mode: 'bet', bank: '1,000', bet: true, saved: 1000 });
    assert.deepStrictEqual(r.console, []);
  });
}

const first = () => availableBrowsers()[0];

// 輪到你時讀勝率提示：按鈕上的字、算的時候用了幾張牌、桌上翻開的有幾張；再按開關看藏不藏得起來
const ODDS_TURN = MEASURE_TURN.replace(/const rect = el =>[\s\S]*$/, `
  const cards = []; s.scene.traverse(o => { if (o.userData.kind === 'card') cards.push(o); });
  const odds = id => { const b = document.getElementById(id); const sm = b.querySelector('.odds');
    return { text: sm.textContent, shown: !b.hidden && getComputedStyle(sm).display !== 'none', hidden: b.hidden, disabled: b.disabled, title: b.title,
             best: b.classList.contains('best'), badge: getComputedStyle(b, '::after').display !== 'none' && getComputedStyle(b, '::after').content === '"建議"' }; };
  const all = () => ({ hit: odds('hitBtn'), stand: odds('standBtn'), double: odds('doubleBtn'), split: odds('splitBtn') });
  const on = all();
  document.getElementById('oddsToggle').click();
  const off = all();
  return { reached, on, off, seenCount: s.director.lastOdds && s.director.lastOdds.seenCount,
           calcBest: s.director.lastOdds && s.director.lastOdds.result.best,
           faceUp: cards.filter(m => m.rotation.z === 0).length, onTable: cards.length,
           toggleText: document.getElementById('oddsToggle').textContent,
           pref: JSON.parse(localStorage.getItem('bjk.prefs.v1') || 'null') };
})()`);

test(`${first()}：輪到你時每個動作標出勝率，只用翻開的牌算；開關關掉就藏起來、重新整理後還記得`, async () => {
  const r = await withPage(first(), PHONE, async page => {
    await page.goto(url(APP));
    const m = await page.evaluate(ODDS_TURN, 30000);
    await page.goto(url(APP));
    const after = await page.evaluate(`(async () => { await BJK.view.stage.dealer.ready;
      const t = document.getElementById('oddsToggle'); return { pressed: t.getAttribute('aria-pressed'), text: t.textContent }; })()`);
    return { m, after };
  });
  const { m, after } = r.value;
  const why = JSON.stringify(m);
  assert.ok(m.reached, '打了 6 局都沒輪到你');
  for (const k of ['hit', 'stand']) {
    assert.match(m.on[k].text, /^勝 \d{1,3}%・平 \d{1,3}%$/, `${k} 沒標勝率與平手：${why}`);
    assert.ok(m.on[k].shown, why);
    assert.match(m.on[k].title, /^勝 \d+%・平 \d+%・輸 \d+%$/, why);
  }
  if (m.on.double.disabled) assert.strictEqual(m.on.double.text, '', why);
  else assert.match(m.on.double.text, /^勝 \d{1,3}%・平 \d{1,3}%$/, why);
  // 分牌鈕不能分時藏起來、不標勝率；能分時跟其他鈕一樣標
  assert.strictEqual(m.on.split.hidden, m.on.split.disabled, why);
  if (m.on.split.hidden) assert.strictEqual(m.on.split.text, '', why);
  else assert.match(m.on.split.text, /^勝 \d{1,3}%・平 \d{1,3}%$/, why);
  // 建議：剛好一顆、就是計算結果挑的那顆、看得到「建議」小牌；關掉提示後小牌也藏起來
  const marked = ['hit', 'stand', 'double', 'split'].filter(k => m.on[k].best);
  assert.deepStrictEqual(marked, [m.calcBest], `標建議的按鈕不對：${why}`);
  assert.ok(m.on[m.calcBest].badge, `看不到「建議」小牌：${why}`);
  assert.ok(!m.off[m.calcBest].badge, `關掉提示後「建議」還在：${why}`);
  assert.strictEqual(m.seenCount, m.faceUp, `算勝率用的牌數不等於桌上翻開的牌數：${why}`);
  assert.strictEqual(m.faceUp, m.onTable - 1, `輪到你時桌上應該只有荷官底牌蓋著：${why}`);
  assert.ok(['hit', 'stand', 'double', 'split'].every(k => !m.off[k].shown), `關掉之後還看得到：${why}`);
  assert.strictEqual(m.toggleText, '勝率提示：關');
  assert.deepStrictEqual(m.pref, { odds: false });
  assert.deepStrictEqual(after, { pressed: 'false', text: '勝率提示：關' });
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：按鈕沒標建議時，要抓到「標建議的按鈕不對」', async () => {
  const tmp = copyWith(path.join('js', 'view', 'hud.js'), "$(id).classList.toggle('best', !!(r && o.best === key));", '');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(ODDS_TURN, 30000)));
    const marked = ['hit', 'stand', 'double', 'split'].filter(k => r.value.on[k].best);
    assert.notDeepStrictEqual(marked, [r.value.calcBest], JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：把荷官底牌也算進勝率，要抓到「用的牌比翻開的多」', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'),
    'const seen = [...faceUp(dealerCards),', 'const seen = [...dealerCards.map(m => m.userData),');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(ODDS_TURN, 30000)));
    assert.strictEqual(r.value.seenCount, r.value.faceUp + 1, JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 牌局撞不撞出重疊要看運氣（AI 加了隨機之後，原本「打 4 次總會撞到一次」的對照就失手過），
// 所以讓位本身另外用一組故意疊在同一點的標籤直接驗，對照也做在這上面
const STACKED_LABELS = `(async () => {
  await BJK.view.stage.dealer.ready;
  const overlay = document.getElementById('overlay');
  const els = ['21', '18', '11／21', '小虎 1,000'].map((t, i) => {
    const el = document.createElement('div');
    el.className = i === 3 ? 'seat-tag' : 'total';
    el.textContent = t;
    el.style.left = (200 + i * 6) + 'px';
    el.style.top = '400px';
    overlay.appendChild(el);
    return el;
  });
  BJK.view.declutter(els);
  const out = els.map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  els.forEach(el => el.remove());
  return out;
})()`;

test(`${availableBrowsers()[0]}：四個疊在同一點的標籤，讓位之後互不重疊、全部只往上移`, async () => {
  const r = await withPage(first(), SMALL_PHONE, page => page.goto(url(APP)).then(() => page.evaluate(STACKED_LABELS)));
  assert.deepStrictEqual(pairsOverlapping(r.value), [], JSON.stringify(r.value));
  assert.ok(r.value.every(l => l.bottom <= 400 + 30), `有標籤被往下推：${JSON.stringify(r.value)}`);
});

test('陽性對照：讓位只算不移，疊在同一點的標籤要判成重疊', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), 'items[i].dy -= me.bottom - below.top + 2;', 'break;');
  try {
    const r = await withPage(first(), SMALL_PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(STACKED_LABELS)));
    assert.ok(pairsOverlapping(r.value).length > 0, '破壞後仍判成不重疊，這條判準沒在分辨');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉手機的按鈕縮窄，下注列要判成換行超出', async () => {
  const tmp = copyWith('style.css', '@media (max-width: 480px) {', '@media (max-width: 1px) {');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_BET)));
    assert.throws(() => assertButtonsFit(r.value, '下注列'), /換行|同一列|跑出/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：手機改回框整張桌子，牌桌要判成太小', async () => {
  const tmp = copyWith(path.join('js', 'view', 'main.js'), 'const pts = aspect < 1', 'const pts = false');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_BET)));
    assert.ok(r.value.seatSpan < PHONE_SEAT_SPAN, `破壞後最外兩個下注圈仍相距 ${r.value.seatSpan}，這條判準沒在分辨`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉名牌夾回畫面，手機上邊座位的名牌要判成跑出畫面', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), '      FX.keepInView(el);\n', '');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_TURN, 30000)));
    assert.ok(labelsOutOfView(r.value).length > 0, `破壞後標籤仍判成都在畫面內：${JSON.stringify(r.value.labels)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉存檔，重新整理後籌碼要判成回到 1,000', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, bankrolls }));", '');
  try {
    const r = await withPage(first(), DESKTOP, async page => {
      await page.goto(url(tmp));
      await page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40; const d = BJK.view.stage.director;
        for (let i = 0; i < 10; i++) { await d.autoplay(1); if (d.game.state().seats.find(s => s.id === 'me').bankroll !== 1000) break; } })()`, 40000);
      await page.goto(url(tmp));
      return page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; return BJK.view.stage.director.game.state().seats[1].bankroll; })()`);
    });
    assert.strictEqual(r.value, 1000);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// BJK-02：照同事的按法打一局（清除、+500、發牌、輪到你就一直要牌），輸到剩 15 之後再按發牌。
// 牌局種子拿 Date.now()，凍結成 1 才每次都是同一副牌；種子 1 這一局玩家會爆牌輸掉 500
const LOSE_TO_15 = { ...DESKTOP, init: 'Date.now = () => 1;' };
const BET_AFTER_LOSS = `(async () => {
  await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
  const $ = id => document.getElementById(id), hud = $('hud');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 50) await sleep(50); return ok(); };
  $('clearBet').click(); document.querySelector('[data-chip="500"]').click(); $('dealBtn').click();
  for (let i = 0; i < 40; i++) {
    await until(() => hud.dataset.mode !== 'busy', 15000);
    if (hud.dataset.mode !== 'act') break;
    $('hitBtn').click();
    await until(() => hud.dataset.mode !== 'act', 2000);
  }
  const before = { mode: hud.dataset.mode, bank: $('bank').textContent, bet: $('bet').textContent };
  if (before.bank !== '15') return { before };
  $('dealBtn').click();
  const started = await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 8000);
  return { before, started, mode: hud.dataset.mode };
})()`;
async function betAfterLoss(dir) {
  return withPage(first(), LOSE_TO_15, async page => {
    await page.goto(url(dir));
    await page.evaluate(`localStorage.setItem('bjk.save.v1', JSON.stringify({ v: 1, bankrolls: { me: 515 } })); true`);
    await page.goto(url(dir));
    return page.evaluate(BET_AFTER_LOSS, 60000);
  });
}

test(`${first()}：籌碼剩 15、上一注 500 時，預填的注對齊成 10，按發牌照常開局（BJK-02）`, async () => {
  const r = await betAfterLoss(APP);
  assert.strictEqual(r.value.before.bank, '15', `前置不成立，這副牌沒有輸到剩 15（牌局吃亂數的順序改過就換種子）：${JSON.stringify(r.value)}`);
  assert.deepStrictEqual(r.value.before, { mode: 'bet', bank: '15', bet: '10' });
  assert.ok(r.value.started, `按發牌後 8 秒還停在 ${r.value.mode}`);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：預填的注改回不取整，剩 15 時按發牌要判成卡住', async () => {
  const tmp = copyWith(path.join('js', 'view', 'hud.js'), 'BJK.game.prefillBet(lastBet, bankroll, { minBet, maxBet, step })',
    'Math.min(lastBet, bankroll, maxBet) >= minBet ? Math.min(lastBet, bankroll, maxBet) : 0');
  try {
    const r = await betAfterLoss(tmp);
    assert.deepStrictEqual(r.value.before, { mode: 'bet', bank: '15', bet: '15' });
    assert.strictEqual(r.value.started, false);
    assert.ok(r.console.some(l => /不是 10 的倍數/.test(l)), `主控台沒有引擎擲錯的訊息：${JSON.stringify(r.console)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- 分牌（v0.10.0）：疊好牌（rig_util.js）才每次都打得到 ----
const { rigInit, deal, splitInto } = require('./rig_util');
// 下注 100、發牌，等到輪到你；click 後先等操作列離開 act，免得同一拍讀到還沒切換的舊狀態
const PLAY_UTIL = `
  await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
  const $ = id => document.getElementById(id), hud = $('hud'), d = BJK.view.stage.director;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 25) await sleep(25); return ok(); };
  const press = async id => { $(id).click(); await until(() => hud.dataset.mode !== 'act', 2000); await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 20000); };
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const buttons = () => Object.fromEntries(['hitBtn', 'standBtn', 'doubleBtn', 'splitBtn'].map(id => [id,
    { shown: !$(id).hidden, disabled: $(id).disabled, odds: $(id).querySelector('.odds').textContent, best: $(id).classList.contains('best') }]));
  $('clearBet').click(); document.querySelector('[data-chip="100"]').click(); $('dealBtn').click();
  await until(() => hud.dataset.mode === 'act', 15000);`;

// 你拿 8、8 對荷官 6（16 點）：按分牌 → 第一手又補到 8，只剩「停牌」「分牌」→ 再按分牌 → 三手補 K、3、9，荷官補 10 爆牌
const SPLIT_CLICK = rigInit([...deal('8', '8'), '8', 'K', '3', '9', '10']);
const CLICK_SPLIT = `(async () => {${PLAY_UTIL}
  const first = buttons();
  await press('splitBtn');
  const again = { mode: hud.dataset.mode, buttons: buttons(), hands: d.hands('me').length, bubble: $('bubble').textContent };
  if (again.mode === 'act') await press('splitBtn');
  await until(() => hud.dataset.mode === 'bet', 20000);
  return { first, again, end: { mode: hud.dataset.mode, bank: $('bank').textContent, splits: d.splits, mismatches: d.mismatches, bubble: $('bubble').textContent } };
})()`;
const clickSplit = dir => withPage(first(), { ...PHONE, init: SPLIT_CLICK }, page => page.goto(url(dir)).then(() => page.evaluate(CLICK_SPLIT, 60000)));

test(`${first()}：按「分牌」真的分成兩手；又成對時只剩停牌與分牌，再按分成三手，三手逐手結算`, async () => {
  const r = await clickSplit(APP);
  const { first: f, again, end } = r.value, why = JSON.stringify(r.value);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(f).map(([k, b]) => [k, [b.shown, b.disabled]])),
    { hitBtn: [true, false], standBtn: [true, false], doubleBtn: [true, true], splitBtn: [true, false] }, `16 點的一對：加倍反灰、分牌可按：${why}`);
  assert.match(f.splitBtn.odds, /^勝 \d{1,3}%・平 \d{1,3}%$/, why);
  assert.ok(f.splitBtn.best, `8+8 對 6 該建議分牌：${why}`);
  assert.strictEqual(again.mode, 'act', why);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(again.buttons).map(([k, b]) => [k, b.shown])),
    { hitBtn: false, standBtn: true, doubleBtn: false, splitBtn: true }, `又成對時只該有停牌與分牌：${why}`);
  assert.strictEqual(again.hands, 2, why);
  assert.match(again.bubble, /又是一對/, why);
  assert.deepStrictEqual(end, { mode: 'bet', bank: '1,300', splits: 2, mismatches: [], bubble: '3 手合計贏了 300！' }, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：分牌鈕接成停牌，按下去要判成沒分', async () => {
  const tmp = copyWith(path.join('js', 'view', 'hud.js'), "['splitBtn', 'split']", "['splitBtn', 'stand']");
  try {
    const r = await clickSplit(tmp);
    assert.notStrictEqual(r.value.again.mode, 'act', JSON.stringify(r.value));
    assert.strictEqual(r.value.end.splits, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 5+5 對 6：點數 10 能加倍、又是一對能分，四顆鈕全出現而且都標勝率——動作列最擠的時候
const FOUR = rigInit(deal('5', '5'));
const FOUR_BUTTONS = `(async () => {${PLAY_UTIL}
  return { buttons: [...document.querySelectorAll('#actBar button')].filter(el => !el.hidden).map(el => ({ text: el.textContent, ...box(el) })),
           hud: { ...box(hud), scrollH: hud.scrollHeight, clientH: hud.clientHeight } };
})()`;
const fourButtons = (browser, vp, dir) => withPage(browser, { ...vp, init: FOUR }, page => page.goto(url(dir)).then(() => page.evaluate(FOUR_BUTTONS, 30000)));
for (const browser of availableBrowsers()) {
  for (const [name, vp] of [['手機', PHONE], ['小手機', SMALL_PHONE]]) {
    test(`${browser}：${name}上能分牌又能加倍時，四顆動作鈕都標勝率、排在同一列不超出操作列`, async () => {
      const r = await fourButtons(browser, vp, APP), m = r.value;
      assert.deepStrictEqual(m.buttons.map(b => b.text.slice(0, 2)), ['要牌', '停牌', '加倍', '分牌'], JSON.stringify(m));
      for (const b of m.buttons) assert.match(b.text, /勝 \d{1,3}%・平 \d{1,3}%$/, JSON.stringify(m));
      assertButtonsFit(m, '四顆的動作列');
      assert.deepStrictEqual(r.console, []);
    });
  }
}

test('陽性對照：手機上勝率不拆兩行，四顆動作鈕要判成換行超出', async () => {
  const tmp = copyWith('style.css', '#actBar .odds span {\n    display: block;', '#actBar .odds span {\n    display: inline;');
  try {
    const r = await fourButtons(first(), SMALL_PHONE, tmp);
    assert.throws(() => assertButtonsFit(r.value, '四顆的動作列'), /換行|同一列|跑出/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 一個座位分成很多手：停在最後一手又成對、問你再分或停的那一刻（畫面靜止），量每一手的牌（四個角投影成四邊形）、
// 籌碼（外接盒投影）、點數標籤，跟其他手、其他座位、荷官的牌與名牌兩兩比，不准重疊、不准跑出牌桌畫布
const MANY_HANDS = n => `(async () => {${PLAY_UTIL}
  for (let i = 0; i < ${n} - 1 && hud.dataset.mode === 'act'; i++) await press('splitBtn');
  const s = BJK.view.stage, c = $('table');
  const proj = v => { const p = v.clone().project(s.camera); return [(p.x + 1) / 2 * c.clientWidth, (1 - p.y) / 2 * c.clientHeight]; };
  const rectPoly = (l, t, r, b) => [[l, t], [r, t], [r, b], [l, b]];
  const quad = m => { const g = m.geometry.parameters; m.updateMatrixWorld();
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => proj(new THREE.Vector3(a * g.width / 2, g.height / 2, b * g.depth / 2).applyMatrix4(m.matrixWorld))); };
  // 籌碼疊照真的圓柱量：底面與頂面各取 16 點投影後取凸包。世界軸向的外接盒在籌碼轉了角度時會胖到 1.4 倍，量出假重疊
  const hull = pts => { pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), half = list => {
      const out = []; for (const p of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } return out.slice(0, -1); };
    return half(pts).concat(half(pts.slice().reverse())); };
  const outline = st => { const p = st.getWorldPosition(new THREE.Vector3()), r = BJK.view.chips.R * st.scale.x, h = st.children.length * BJK.view.chips.H * st.scale.x, pts = [];
    for (let i = 0; i < 16; i++) { const a = i / 8 * Math.PI; for (const y of [0, h]) pts.push(proj(new THREE.Vector3(p.x + r * Math.cos(a), p.y + y, p.z + r * Math.sin(a)))); }
    return hull(pts); };
  const dom = el => { const r = el.getBoundingClientRect(); return rectPoly(r.left, r.top, r.right, r.bottom); };
  const ids = ['tiger', 'me', 'ade', 'mei'];
  const mine = new Set(ids.flatMap(id => d.hands(id).flatMap(h => h.cards)));
  const handLabels = new Set(ids.flatMap(id => d.labels(id)));
  const dealerCards = []; s.scene.traverse(o => { if (o.userData.kind === 'card' && !mine.has(o)) dealerCards.push(quad(o)); });
  return {
    mode: hud.dataset.mode, vw: c.clientWidth, vh: c.clientHeight,
    seats: ids.map(id => ({ id, hands: d.hands(id).map((h, k) => ({ cards: h.cards.map(quad), chips: h.stacks.map(outline),
      label: d.labels(id)[k] && !d.labels(id)[k].hidden ? dom(d.labels(id)[k]) : null })) })),
    others: [...[...document.querySelectorAll('#overlay .total, #overlay .seat-tag')].filter(el => !el.hidden && !handLabels.has(el)).map(dom), ...dealerCards],
  };
})()`;

// 兩個凸多邊形有沒有重疊（分離軸定理）；只碰到邊、重疊不到 0.5px 的不算
function polysOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2, len = Math.hypot(nx, ny) || 1;
      const pa = a.map(p => (p[0] * nx + p[1] * ny) / len), pb = b.map(p => (p[0] * nx + p[1] * ny) / len);
      if (Math.max(...pa) <= Math.min(...pb) + 0.5 || Math.max(...pb) <= Math.min(...pa) + 0.5) return false;
    }
  }
  return true;
}
// 你的每一手對所有其他手（自己的與別人的）、荷官的牌與名牌：牌、籌碼、標籤兩兩都不准重疊；自己這一手的牌與標籤之間不比
function layoutProblems(m) {
  const out = [];
  const items = m.seats.flatMap(s => s.hands.map((h, k) => ({ who: `${s.id} 第 ${k + 1} 手`, seat: s.id, k, parts: { 牌: h.cards, 籌碼: h.chips, 標籤: h.label ? [h.label] : [] } })));
  const hits = (pa, pb) => pa.some(p => pb.some(q => polysOverlap(p, q)));
  for (const a of items.filter(x => x.seat === 'me')) {
    for (const b of items) {
      if (a === b || (b.seat === 'me' && b.k < a.k)) continue;
      for (const [na, pa] of Object.entries(a.parts)) for (const [nb, pb] of Object.entries(b.parts)) if (hits(pa, pb)) out.push(`${a.who}的${na}壓到${b.who}的${nb}`);
    }
    for (const [na, pa] of Object.entries(a.parts)) {
      if (hits(pa, m.others)) out.push(`${a.who}的${na}壓到荷官的牌、荷官點數或名牌`);
      if (pa.flat().some(([x, y]) => x < 0 || x > m.vw || y < 0 || y > m.vh)) out.push(`${a.who}的${na}跑出牌桌畫面`);
    }
  }
  return [...new Set(out)];
}
const manyHands = (vp, n, dir) => withPage(first(), { ...vp, init: rigInit(splitInto(n)) }, page => page.goto(url(dir)).then(() => page.evaluate(MANY_HANDS(n), 90000)));

for (const [name, vp, n] of [['桌機', DESKTOP, 8], ['手機', PHONE, 8], ['小手機', SMALL_PHONE, 8], ['手機', PHONE, 6]]) {
  test(`${first()}：${name}上你分成 ${n} 手時，每一手的牌、籌碼、點數標籤互不重疊，也不壓到別的座位、不跑出畫面`, async () => {
    const r = await manyHands(vp, n, APP), m = r.value;
    const me = m.seats.find(s => s.id === 'me');
    assert.strictEqual(m.mode, 'act', '沒停在最後一手又成對的那一刻');
    assert.strictEqual(me.hands.length, n);
    assert.ok(me.hands.every(h => h.cards.length === 2 && h.chips.length === 1 && h.label), `每一手都該有兩張牌、一疊籌碼、一個標籤：${JSON.stringify(me.hands.map(h => [h.cards.length, h.chips.length, !!h.label]))}`);
    assert.deepStrictEqual(layoutProblems(m), []);
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：好幾手全擺在同一個位置，要判成牌與標籤互相壓住', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), 'return { row, rows, x: (col - (inRow - 1) / 2) * cw, cw, s };', 'return { row, rows, x: 0, cw, s };');
  try {
    const r = await manyHands(PHONE, 8, tmp);
    const problems = layoutProblems(r.value);
    assert.ok(problems.some(p => /me 第 \d 手的牌壓到me 第 \d 手的牌/.test(p)), `沒抓到：${problems.slice(0, 3).join('｜')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：外排的籌碼擠到裡排籌碼的位置，要判成籌碼互相壓住', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), 'chipR = R_HAND - 0.1 + 1.185 * a.s;', 'chipR = R_HAND - 0.1 + 0.7 * a.s;');
  try {
    const problems = layoutProblems((await manyHands(PHONE, 8, tmp)).value);
    assert.ok(problems.some(p => /的籌碼壓到me 第 \d 手的籌碼/.test(p)), `沒抓到：${problems.slice(0, 3).join('｜')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 盤點 D-04：角落的版本號；BJK-03：載不起來時畫面要說原因，不能只剩暗底與「籌碼 0」
const { BJK_VER } = require('../app/js/core/version.js');
const SCREEN = `(() => {
  const v = document.getElementById('ver').getBoundingClientRect();
  return { text: document.body.innerText, ver: { left: v.left, right: v.right, top: v.top, bottom: v.bottom },
           vw: innerWidth, vh: innerHeight, hud: getComputedStyle(document.getElementById('hud')).display };
})()`;
// 沒有 WebGL 的電腦（關掉硬體加速、部分遠端桌面）：getContext 拿 webgl 回 null，2D 照常
const NO_WEBGL = `{ const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : get.call(this, type, ...rest); }; }`;
// 線上檔名大小寫打錯、或複製資料夾時少了一支，都是某支 view 的 script 載不到
const DROPPED = path.join('js', 'view', 'table.js');
function copyWithout(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, file));
  return tmp;
}
const screenOf = (browser, vp, dir) => withPage(browser, vp, page => page.goto(url(dir)).then(() => page.evaluate(SCREEN)));
function assertFatal(m, why) {
  assert.ok(m.text.includes('載不起來') && m.text.includes(`v${BJK_VER}`), `畫面沒有說載不起來或沒帶版本號：${why}`);
  assert.strictEqual(m.hud, 'none', `載不起來時操作列還在，同事會以為按了會動：${why}`);
}

for (const browser of availableBrowsers()) {
  test(`${browser}：桌機與手機的畫面角落都看得到版本號，正常載入時不出現「載不起來」`, async () => {
    for (const vp of [DESKTOP, PHONE]) {
      const r = await screenOf(browser, vp, APP), m = r.value, why = `${vp.size.join('×')}：${JSON.stringify(m.ver)}`;
      assert.ok(m.text.includes(`v${BJK_VER}`), `畫面上找不到 v${BJK_VER}：${why}`);
      assert.ok(m.ver.left >= 0 && m.ver.right <= m.vw && m.ver.top >= 0 && m.ver.bottom <= m.vh, `版本號跑出畫面：${why}`);
      assert.ok(!m.text.includes('載不起來'), `正常載入卻出現載不起來：${why}`);
      assert.deepStrictEqual(r.console, []);
    }
  });

  test(`${browser}：沒有 WebGL 時，畫面說載不起來、帶版本號與原因（BJK-03）`, async () => {
    const r = await screenOf(browser, { ...DESKTOP, init: NO_WEBGL }, APP);
    assertFatal(r.value, r.value.text);
    assert.match(r.value.text, /WebGL/);
    assert.ok(r.console.some(l => l.includes('載不起來')), `主控台沒記：${JSON.stringify(r.console)}`);
  });

  test(`${browser}：少一支 view 的檔時，手機畫面說載不起來、帶版本號（BJK-03）`, async () => {
    const tmp = copyWithout(DROPPED);
    try {
      const r = await screenOf(browser, PHONE, tmp);
      assertFatal(r.value, r.value.text);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('陽性對照：拿掉角落版本號那行，要判成畫面上找不到版本號', async () => {
  const tmp = copyWith(path.join('js', 'view', 'main.js'), "if (ver) document.getElementById('ver').textContent = `v${ver}`;", '');
  try {
    const r = await screenOf(first(), DESKTOP, tmp);
    assert.ok(!r.value.text.includes(`v${BJK_VER}`), r.value.text);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉顯示訊息那段，沒有 WebGL 與少一支檔都要判成畫面沒說明', async () => {
  const tmp = copyWith(path.join('js', 'view', 'main.js'), 'if (failed) showFatal(', 'if (false) showFatal(');
  try {
    const noGl = await screenOf(first(), { ...DESKTOP, init: NO_WEBGL }, tmp);
    assert.throws(() => assertFatal(noGl.value, noGl.value.text), /載不起來/);
    fs.rmSync(path.join(tmp, DROPPED));
    const dropped = await screenOf(first(), PHONE, tmp);
    assert.throws(() => assertFatal(dropped.value, dropped.value.text), /載不起來/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
