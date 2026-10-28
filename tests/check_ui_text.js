// 守畫面上的字：勝率提示只用翻開的牌、疊在一起的標籤會讓位、角落的版本號與載不起來的說明（BJK-03）、
// 大特效的大字不蓋臉（BJK-04）、分 A 兩手 Blackjack 只播一次（BJK-05）、荷官的表情與籌碼數字跟著結算動畫走。
// 驗不到：真手機、字好不好讀（對比）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { APP, DESKTOP, PHONE, SMALL_PHONE, url, first, MEASURE_TURN, pairsOverlapping, copyWith, PLAY_UTIL, LATE_BJ } = require('./ui_util');
const { availableBrowsers, withPage } = require('./browser_util');
const { rigInit, deal } = require('./rig_util');

// 輪到你時讀勝率提示：按鈕上的字、算的時候用了幾張牌、桌上翻開的有幾張；再按開關看藏不藏得起來
const ODDS_TURN = MEASURE_TURN.replace(/const rect = el =>[\s\S]*$/, `
  const cards = []; s.scene.traverse(o => { if (o.userData.kind === 'card') cards.push(o); });
  const odds = id => { const b = document.getElementById(id); const sm = b.querySelector('.odds');
    return { text: sm.textContent, shown: !b.hidden && getComputedStyle(sm).display !== 'none' && getComputedStyle(sm).visibility !== 'hidden', hidden: b.hidden, disabled: b.disabled, title: b.title,
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

// 勝率提示關掉：按鈕跟開著時一樣大，原本的小字藏起來，動作名放大塞滿。開、關各量一次外框；
// 大字是 .big::before 生出來的，量不到字框，改用 canvas 照它算出來的字型量寬度
const ODDS_OFF = `(async () => {${PLAY_UTIL}
  const ctx = document.createElement('canvas').getContext('2d');
  const read = () => [...document.querySelectorAll('#actBar button')].filter(el => !el.hidden).map(el => {
    const r = el.getBoundingClientRect(), big = el.querySelector('.big'), b = big.getBoundingClientRect(), pre = getComputedStyle(big, '::before');
    ctx.font = pre.fontSize + ' ' + pre.fontFamily;
    return { id: el.id, disabled: el.disabled, w: r.width, h: r.height, cw: el.clientWidth, ch: el.clientHeight,
             font: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color, odds: getComputedStyle(el.querySelector('.odds')).visibility,
             big: { shown: getComputedStyle(big).display !== 'none', text: pre.content, label: big.dataset.label, w: b.width, h: b.height,
                    font: parseFloat(pre.fontSize), textW: ctx.measureText(big.dataset.label).width } };
  });
  const on = read();
  $('oddsToggle').click();
  return { on, off: read() };
})()`;
function oddsOffProblems({ on, off }) {
  const out = [];
  off.forEach((b, i) => {
    const a = on[i], big = b.big;
    if (Math.abs(a.w - b.w) > 0.5 || Math.abs(a.h - b.h) > 0.5) out.push(`${b.id} 關掉後大小變了：${a.w}×${a.h} → ${b.w}×${b.h}`);
    if (a.big.shown) out.push(`${b.id} 開著時就疊了大字`);
    if (b.color !== 'rgba(0, 0, 0, 0)' || b.odds !== 'hidden') out.push(`${b.id} 關掉後原本的小字還看得到`);
    if (!big.shown || big.text !== `"${big.label}"`) out.push(`${b.id} 關掉後沒有大字：${big.text}`);
    if (Math.abs(big.w - b.cw) > 0.5 || Math.abs(big.h - b.ch) > 0.5) out.push(`${b.id} 的大字層沒蓋滿按鈕內框`);
    if (big.textW > b.cw || big.font > b.ch) out.push(`${b.id} 的大字 ${big.font}px（寬 ${big.textW}）塞不進 ${b.cw}×${b.ch}`);
    if (big.font < (b.disabled ? 1 : 1.5) * b.font) out.push(`${b.id} 的大字 ${big.font}px，原本 ${b.font}px`);
  });
  return out;
}
// 桌機四顆都標勝率（最擠）；手機 10＋7 的加倍反灰、沒有勝率，是最窄的一顆
const oddsOff = (vp, cards, dir) => withPage(first(), { ...vp, init: rigInit(cards) }, page => page.goto(url(dir)).then(() => page.evaluate(ODDS_OFF, 30000)));
for (const [name, vp, cards] of [['桌機', DESKTOP, deal('5', '5')], ['手機', PHONE, deal('10', '7')]]) {
  test(`${first()}：${name}上關掉勝率提示，動作鈕跟開著時一樣大，動作名放大塞滿`, async () => {
    const r = await oddsOff(vp, cards, APP);
    assert.strictEqual(r.value.off.length, name === '桌機' ? 4 : 3, JSON.stringify(r.value));
    assert.deepStrictEqual(oddsOffProblems(r.value), [], JSON.stringify(r.value.off));
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：關掉時勝率改回不佔位、大字不放大，要判成按鈕縮小、字沒變大', async () => {
  const tmp = copyWith('style.css', '#hud[data-odds="off"] #actBar .odds {\n  visibility: hidden;', '#hud[data-odds="off"] #actBar .odds {\n  display: none;');
  fs.writeFileSync(path.join(tmp, 'style.css'), fs.readFileSync(path.join(tmp, 'style.css'), 'utf8').replace('font-size: min(43cqw, 60cqh);', ''));
  try {
    const problems = oddsOffProblems((await oddsOff(PHONE, deal('10', '7'), tmp)).value);
    assert.ok(problems.some(p => /關掉後大小變了/.test(p)), problems.join('｜'));
    assert.ok(problems.some(p => /hitBtn 的大字 20px，原本 14px/.test(p)), problems.join('｜'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

// ---- v0.11.1 起：大字不蓋荷官的臉、分 A 兩手 Blackjack 大特效只播一次、荷官 Blackjack 用微笑、籌碼數字跟著結算動畫走 ----
// 對白每換一句就記下當時的表情與籌碼數字
const WATCH = `
  const seen = [];
  new MutationObserver(() => seen.push({ t: bubble.textContent, mood: BJK.view.stage.dealer.mood, bank: $('bank').textContent }))
    .observe(bubble, { childList: true, characterData: true, subtree: true });
  const at = text => seen.find(x => x.t.startsWith(text));`;

// BJK-04 的用意是大字不蓋住荷官的臉。v0.12.0 起拿 Blackjack 改播大特效（showcase.js），特效本身就有荷官的大特寫，所以兩張臉都量：
// 大特寫裡的五官（dealer.js 的 g.face：眉毛、眼睛、鼻子到嘴，表情都在這裡）與畫面上原本荷官的臉（faceRect()）。
// 大標落定（39%）到播完，每 3% 暫停一次：大標與副標看得到的字（fx_util 的 inkQuad）不准碰到任一張臉，也不准跑出畫面。
// 大頭框的下緣、下巴與脖子讓大標壓著，那是定案的樣子
const { FX_SEEK, FX_INK, quadHitsRect } = require('./fx_util');
const LANDSCAPE = { size: [844, 390], mobile: true };
const FX_FACE = `(async () => {
  const dl = BJK.view.stage.dealer; await dl.ready;
  ${FX_SEEK}${FX_INK}
  const rect = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  const frames = [];
  for (const kind of ['player', 'dealer']) {
    BJK.view.anim.speed = 0.05;
    BJK.view.fx.showcase(kind);
    const el = document.querySelector('.bigfx');
    for (let i = 39; i <= 99; i += 3) {
      await seek(i / 100, 40000);
      frames.push({ kind, f: i / 100, features: rect(el.querySelector('.bigfx-face .face').getBoundingClientRect()), face: dl.faceRect(),
        ink: [...el.querySelectorAll('.bigfx-ink')].map(e => ({ text: e.textContent, quad: inkQuad(e), box: rect(e.getBoundingClientRect()) })) });
    }
    el.remove();
  }
  return { frames, vw: innerWidth, vh: innerHeight };
})()`;
function faceProblems(m) {
  const out = [];
  for (const fr of m.frames) {
    for (const t of fr.ink) {
      const at = `${fr.kind} ${Math.round(fr.f * 100)}% 的「${t.text}」`;
      // 量法自檢：算出來的字要落在元素自己的框裡，不然是 inkQuad 算錯了
      if (t.quad.some(([x, y]) => x < t.box.left - 2 || x > t.box.right + 2 || y < t.box.top - 2 || y > t.box.bottom + 2)) out.push(`${at}量法有誤：字跑出自己的框`);
      if (quadHitsRect(t.quad, fr.features)) out.push(`${at}壓到大特寫的五官`);
      if (quadHitsRect(t.quad, fr.face)) out.push(`${at}壓到畫面上荷官的臉`);
      if (t.quad.some(([x, y]) => x < 0 || x > m.vw || y < 0 || y > m.vh)) out.push(`${at}跑出畫面`);
    }
  }
  return [...new Set(out)];
}
const fxFace = (vp, dir) => withPage(first(), vp, page => page.goto(url(dir)).then(() => page.evaluate(FX_FACE, 30000)));

test(`${first()}：Blackjack 大特效的大字，在桌機、直式與橫式手機上都不壓到大特寫裡荷官的五官與畫面上荷官的臉，也還在畫面內（BJK-04）`, async () => {
  for (const vp of [DESKTOP, PHONE, LANDSCAPE]) {
    const r = await fxFace(vp, APP), problems = faceProblems(r.value);
    assert.strictEqual(r.value.frames.length, 42, `量到的格數不對：${vp.size.join('×')}`);
    assert.deepStrictEqual(problems, [], `${vp.size.join('×')}：${problems.slice(0, 4).join('｜')}`);
    assert.deepStrictEqual(r.console, []);
  }
});

test('陽性對照：大標放回大特寫正中央，手機上要判成壓到五官與荷官的臉', async () => {
  const tmp = copyWith(path.join('js', 'view', 'showcase.js'), 'top: calc(40% + ${FACE} / 2 - 0.25em)', 'top: calc(40% - 0.5em)');
  try {
    const problems = faceProblems((await fxFace(PHONE, tmp)).value);
    assert.ok(problems.some(p => /壓到大特寫的五官/.test(p)) && problems.some(p => /壓到畫面上荷官的臉/.test(p)), problems.slice(0, 4).join('｜'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 你拿 A、A 按分牌，兩手都補到 K：兩手都是 Blackjack，荷官補 10 爆牌。數大特效出現幾次（.bigfx 加進頁面幾次）
const TWO_BJ = rigInit([...deal('A', 'A'), 'K', 'K', '10']);
const TWO_BJ_PLAY = `(async () => {${PLAY_UTIL}
  const shows = [];
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('bigfx')) shows.push(n.dataset.kind); })))
    .observe(document.body, { childList: true });
  if (hud.dataset.mode === 'act') await press('splitBtn');
  await until(() => hud.dataset.mode === 'bet', 30000);
  return { shows, said, end: { bank: $('bank').textContent, mismatches: d.mismatches } };
})()`;
const twoBj = dir => withPage(first(), { ...PHONE, init: TWO_BJ }, page => page.goto(url(dir)).then(() => page.evaluate(TWO_BJ_PLAY, 60000)));

test(`${first()}：分 A 兩手都是 Blackjack 時，大特效只播一次，兩手都還是有對白、帳對（BJK-05）`, async () => {
  const r = await twoBj(APP), why = JSON.stringify(r.value);
  assert.deepStrictEqual(r.value.shows, ['player'], why);
  assert.ok(r.value.said.includes('第 1 手 Blackjack！') && r.value.said.includes('第 2 手 Blackjack！'), why);
  assert.deepStrictEqual(r.value.end, { bank: '1,300', mismatches: [] }, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：拿掉「同一局只播一次」，要判成大特效播了兩次', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), 'if (showcaseShown) await A.wait(500);', 'if (false) await A.wait(500);');
  try {
    const r = await twoBj(tmp);
    assert.deepStrictEqual(r.value.shows, ['player', 'player'], JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 荷官最後翻出 Blackjack（同 LATE_BJ：你 5+6 加倍補 K 成 21 點平手）：講「莊家 Blackjack」時是微笑
const DEALER_BJ_MOOD = `(async () => {${PLAY_UTIL}${WATCH}
  if (hud.dataset.mode === 'act') $('doubleBtn').click();
  await until(() => hud.dataset.mode === 'bet', 30000);
  return { bj: at('莊家 Blackjack'), seen };
})()`;
const dealerBjMood = dir => withPage(first(), { ...DESKTOP, init: LATE_BJ }, page => page.goto(url(dir)).then(() => page.evaluate(DEALER_BJ_MOOD, 60000)));

test(`${first()}：荷官翻出 Blackjack 時是微笑，不是驚訝`, async () => {
  const r = await dealerBjMood(APP), why = JSON.stringify(r.value);
  assert.ok(r.value.bj, `沒講莊家 Blackjack：${why}`);
  assert.strictEqual(r.value.bj.mood, 'smile', why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：荷官 Blackjack 改回驚訝臉，要判成表情不對', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "say('smile', `莊家 Blackjack！", "say('surprised', `莊家 Blackjack！");
  try {
    const r = await dealerBjMood(tmp);
    assert.strictEqual(r.value.bj.mood, 'surprised', JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 你拿 10、10 停牌，荷官 6+10 補 K 爆牌：翻底牌時籌碼還是押注後的 900，結算完才變 1,100
const WIN_LATE = rigInit([...deal('10', '10'), 'K']);
const BANK_TIMING = `(async () => {${PLAY_UTIL}${WATCH}
  if (hud.dataset.mode === 'act') await press('standBtn');
  await until(() => hud.dataset.mode === 'bet', 30000);
  return { reveal: at('翻開底牌'), bust: at('我爆牌了'), end: { bank: $('bank').textContent, mismatches: d.mismatches }, seen };
})()`;
const bankTiming = dir => withPage(first(), { ...PHONE, init: WIN_LATE }, page => page.goto(url(dir)).then(() => page.evaluate(BANK_TIMING, 60000)));

test(`${first()}：荷官翻牌、爆牌時籌碼還是押注後的數字，結算動畫演完才加上贏的`, async () => {
  const r = await bankTiming(APP), why = JSON.stringify(r.value);
  assert.strictEqual(r.value.reveal && r.value.reveal.bank, '900', why);
  assert.strictEqual(r.value.bust && r.value.bust.bank, '900', why);
  assert.deepStrictEqual(r.value.end, { bank: '1,100', mismatches: [] }, why);
  assert.deepStrictEqual(r.console, []);
});

// 翻牌那一句講出來時標籤還沒更新，所以壞掉的樣子是在荷官爆牌那一句就已經是結算後的數字
test('陽性對照：籌碼數字改回直接讀引擎，要判成荷官還沒結算就已經是結算後的數字', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "hud.setBank(money.bank.get('me'), money.onTable);",
    "hud.setBank(game.state().seats.find(s => s.id === 'me').bankroll, money.onTable);");
  try {
    const r = await bankTiming(tmp);
    assert.strictEqual(r.value.bust.bank, '1,100', JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
