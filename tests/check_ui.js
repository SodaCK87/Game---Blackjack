// 守介面：輪到你時桌上的標籤互不重疊、操作列的按鈕都在列內不換行、籌碼重新整理後還在、籌碼輸光能一鍵重置。
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
  const buttons = [...document.querySelectorAll('#actBar button')].map(el => ({ text: el.textContent, ...rect(el) }));
  return { reached, labels, buttons, hud: { ...rect(hud), scrollH: hud.scrollHeight, clientH: hud.clientHeight }, vw: innerWidth, vh: innerHeight };
})()`;

const MEASURE_BET = `(async () => {
  await BJK.view.stage.dealer.ready;
  const hud = document.getElementById('hud');
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  return { mode: hud.dataset.mode, buttons: [...document.querySelectorAll('#betBar button')].map(el => ({ text: el.textContent, ...rect(el) })),
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
    test(`${browser}：${name}輪到你時，桌上的標籤互不重疊、動作按鈕排成一列`, async () => {
      const r = await withPage(browser, vp, page => page.goto(url(APP)).then(() => page.evaluate(MEASURE_TURN, 30000)));
      const m = r.value;
      assert.ok(m.reached, '打了 6 局都沒輪到你');
      assert.ok(m.labels.length >= 6, `標籤太少，量不出東西：${JSON.stringify(m.labels)}`);
      assert.deepStrictEqual(pairsOverlapping(m.labels), [], `標籤重疊：${JSON.stringify(m.labels)}`);
      assertButtonsFit(m, '動作列');
      assert.deepStrictEqual(r.console, []);
    });

    test(`${browser}：${name}下注列六顆按鈕排成一列、都在操作列內`, async () => {
      const r = await withPage(browser, vp, page => page.goto(url(APP)).then(() => page.evaluate(MEASURE_BET)));
      assert.strictEqual(r.value.mode, 'bet');
      assertButtonsFit(r.value, '下注列');
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
    return { text: sm.textContent, shown: getComputedStyle(sm).display !== 'none', disabled: b.disabled, title: b.title,
             best: b.classList.contains('best'), badge: getComputedStyle(b, '::after').display !== 'none' && getComputedStyle(b, '::after').content === '"建議"' }; };
  const on = { hit: odds('hitBtn'), stand: odds('standBtn'), double: odds('doubleBtn') };
  document.getElementById('oddsToggle').click();
  const off = { hit: odds('hitBtn'), stand: odds('standBtn'), double: odds('doubleBtn') };
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
  // 建議：剛好一顆、就是計算結果挑的那顆、看得到「建議」小牌；關掉提示後小牌也藏起來
  const marked = ['hit', 'stand', 'double'].filter(k => m.on[k].best);
  assert.deepStrictEqual(marked, [m.calcBest], `標建議的按鈕不對：${why}`);
  assert.ok(m.on[m.calcBest].badge, `看不到「建議」小牌：${why}`);
  assert.ok(!m.off[m.calcBest].badge, `關掉提示後「建議」還在：${why}`);
  assert.strictEqual(m.seenCount, m.faceUp, `算勝率用的牌數不等於桌上翻開的牌數：${why}`);
  assert.strictEqual(m.faceUp, m.onTable - 1, `輪到你時桌上應該只有荷官底牌蓋著：${why}`);
  assert.ok(['hit', 'stand', 'double'].every(k => !m.off[k].shown), `關掉之後還看得到：${why}`);
  assert.strictEqual(m.toggleText, '勝率提示：關');
  assert.deepStrictEqual(m.pref, { odds: false });
  assert.deepStrictEqual(after, { pressed: 'false', text: '勝率提示：關' });
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：按鈕沒標建議時，要抓到「標建議的按鈕不對」', async () => {
  const tmp = copyWith(path.join('js', 'view', 'hud.js'), "$(id).classList.toggle('best', !!(r && o.best === key));", '');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(ODDS_TURN, 30000)));
    const marked = ['hit', 'stand', 'double'].filter(k => r.value.on[k].best);
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
