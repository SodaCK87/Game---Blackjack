// 守打局時的按鈕流程：照同事的按法真的按下去（下注、發牌、要牌、分牌、加倍），疊好牌才每次都打得到那個局面——
// BJK-02 剩 15 時按發牌、8＋8 分開後照一般的手打、分 A、荷官最後才翻 Blackjack、下注沒有上限、四顆動作鈕、分成 6／8 手的版面。
// 驗不到：真手機、真人手指點不點得準。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP, DESKTOP, PHONE, SMALL_PHONE, url, first, assertButtonsFit, copyWith, PLAY_UTIL, shownOf, LATE_BJ } = require('./ui_util');
const { availableBrowsers, withPage } = require('./browser_util');

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

// ---- 分牌（v0.10.0 起；v0.11.0 起 A 以外分完照一般的手打）、荷官最後才翻 Blackjack、下注沒有上限：疊好牌（rig_util.js）才每次都打得到 ----
const { rigInit, deal, splitInto } = require('./rig_util');

// 你拿 8、8 對荷官 6（16 點）：按分牌 → 第一手補 3 成 11，要牌、停牌、加倍都能按 → 按要牌補 5 成 16 → 按停牌 →
// 第二手補到 8 又成對 → 再按分牌 → 第二手補 K、第三手補 9 都按停牌，荷官補 10 爆牌，三手都贏
const SPLIT_HIT = rigInit([...deal('8', '8'), '3', '5', '8', 'K', '9', '10']);
const CLICK_SPLIT = `(async () => {${PLAY_UTIL}
  const snap = () => ({ mode: hud.dataset.mode, buttons: buttons(), cards: d.hands('me').map(h => h.cards.length), bubble: bubble.textContent });
  const first = buttons();
  await press('splitBtn');
  const split = snap();
  if (split.mode === 'act' && split.buttons.hitBtn.shown) await press('hitBtn');
  const hit = snap();
  if (hit.mode === 'act') await press('standBtn');
  const again = snap();
  if (again.mode === 'act' && again.buttons.splitBtn.shown) await press('splitBtn');
  for (let i = 0; i < 4 && hud.dataset.mode === 'act'; i++) await press('standBtn');
  await until(() => hud.dataset.mode === 'bet', 20000);
  return { first, split, hit, again, end: { mode: hud.dataset.mode, bank: $('bank').textContent, splits: d.splits, mismatches: d.mismatches, bubble: bubble.textContent } };
})()`;
const clickSplit = dir => withPage(first(), { ...PHONE, init: SPLIT_HIT }, page => page.goto(url(dir)).then(() => page.evaluate(CLICK_SPLIT, 60000)));

test(`${first()}：分開的 8 照一般的手打：按「分牌」後第一手能要牌、加倍，按「要牌」真的補一張；第二手又成對能再分，三手逐手結算`, async () => {
  const r = await clickSplit(APP);
  const { first: f, split, hit, again, end } = r.value, why = JSON.stringify(r.value);
  assert.deepStrictEqual(shownOf(f), { hitBtn: [true, false], standBtn: [true, false], doubleBtn: [true, true], splitBtn: [true, false] }, `16 點的一對：加倍反灰、分牌可按：${why}`);
  assert.match(f.splitBtn.odds, /^勝 \d{1,3}%・平 \d{1,3}%$/, why);
  assert.ok(f.splitBtn.best, `8+8 對 6 該建議分牌：${why}`);
  // 分完第一手補 3 是 11 點：要牌、停牌、加倍都能按，分牌鈕收起來；荷官問的是第 1 手
  assert.strictEqual(split.mode, 'act', `分完沒輪到第一手：${why}`);
  assert.deepStrictEqual(shownOf(split.buttons), { hitBtn: [true, false], standBtn: [true, false], doubleBtn: [true, false], splitBtn: [false, true] }, `分出來的 8+3 該能要牌、加倍：${why}`);
  assert.deepStrictEqual(split.cards, [2, 1], why);
  assert.strictEqual(split.bubble, '第 1 手：要牌、停牌，還是加倍？', why);
  // 按要牌：第一手多一張（8+3+5＝16），還是輪到它，加倍反灰
  assert.deepStrictEqual([hit.mode, hit.cards, shownOf(hit.buttons).doubleBtn], ['act', [3, 1], [true, true]], `按要牌沒有補到第一手：${why}`);
  // 第二手補到 8 又成對：要牌、停牌、分牌都在
  assert.deepStrictEqual([again.mode, again.cards], ['act', [3, 2]], why);
  assert.deepStrictEqual(shownOf(again.buttons), { hitBtn: [true, false], standBtn: [true, false], doubleBtn: [true, true], splitBtn: [true, false] }, why);
  assert.deepStrictEqual(end, { mode: 'bet', bank: '1,300', splits: 2, mismatches: [], bubble: '3 手合計贏了 300！' }, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：規則改回分完每手只補一張（v0.10），按分牌後要判成第一手不能要牌', async () => {
  const tmp = copyWith(path.join('js', 'core', 'game.js'), 'splitOneCard: false,', 'splitOneCard: true,');
  try {
    const r = await clickSplit(tmp), why = JSON.stringify(r.value);
    assert.ok(r.value.split.mode !== 'act' || !r.value.split.buttons.hitBtn.shown, why);
    assert.notDeepStrictEqual(r.value.hit.cards, [3, 1], why);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：分牌鈕接成停牌，按下去要判成沒分', async () => {
  const tmp = copyWith(path.join('js', 'view', 'hud.js'), "['splitBtn', 'split']", "['splitBtn', 'stand']");
  try {
    const r = await clickSplit(tmp);
    assert.notStrictEqual(r.value.split.mode, 'act', JSON.stringify(r.value));
    assert.strictEqual(r.value.end.splits, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 你拿 A、A 對荷官 6：按分牌 → 第一手補到 A 又成對，只剩停牌與分牌 → 再按分牌 → 第一手補 K 是分後 Blackjack、
// 第二手補 9、第三手補 7，分開的 A 各補一張就停；荷官補 10 爆牌：Blackjack 賠 1.5 倍、另外兩手各贏 1 倍
const ACES = rigInit([...deal('A', 'A'), 'A', 'K', '9', '7', '10']);
const CLICK_ACES = `(async () => {${PLAY_UTIL}
  await press('splitBtn');
  const again = { mode: hud.dataset.mode, buttons: buttons(), cards: d.hands('me').map(h => h.cards.length), bubble: bubble.textContent };
  if (again.mode === 'act') await press('splitBtn');
  await until(() => hud.dataset.mode === 'bet', 20000);
  return { again, said, end: { mode: hud.dataset.mode, bank: $('bank').textContent, splits: d.splits, mismatches: d.mismatches, bubble: bubble.textContent } };
})()`;
const clickAces = dir => withPage(first(), { ...PHONE, init: ACES }, page => page.goto(url(dir)).then(() => page.evaluate(CLICK_ACES, 60000)));

test(`${first()}：分開的 A 各補一張就停、補到 A 只剩停牌與分牌；分後 A＋K 是 Blackjack，荷官講賠 1.5 倍、帳對`, async () => {
  const r = await clickAces(APP);
  const { again, said, end } = r.value, why = JSON.stringify(r.value);
  assert.strictEqual(again.mode, 'act', why);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(again.buttons).map(([k, b]) => [k, b.shown])),
    { hitBtn: false, standBtn: true, doubleBtn: false, splitBtn: true }, `A 又補到 A 只該有停牌與分牌：${why}`);
  assert.deepStrictEqual(again.cards, [2, 1], why);
  assert.match(again.bubble, /又是一對/, why);
  assert.ok(said.includes('第 1 手 Blackjack！'), `補到 K 時沒說是 Blackjack：${why}`);
  assert.ok(said.includes('第 1 手 Blackjack 賠 1.5 倍，贏 150！'), `結算那一手沒說賠 1.5 倍：${why}`);
  assert.deepStrictEqual(end, { mode: 'bet', bank: '1,350', splits: 2, mismatches: [], bubble: '第 1 手 Blackjack 賠 1.5 倍，3 手合計贏了 350！' }, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：合計時沒點名 Blackjack 的那一手，要判成對白不對', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "const bjNote = bjs.length ? `第 ${bjs.join('、')} 手 Blackjack 賠 1.5 倍，` : '';", "const bjNote = '';");
  try {
    const r = await clickAces(tmp);
    assert.strictEqual(r.value.end.bubble, '3 手合計贏了 350！', JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 荷官明牌 A、底牌 K（不偷看）：照常輪到你，底牌還蓋著；你 5+6 按加倍補 K 成 21，大家打完荷官才翻出 Blackjack，
// 21 點平手退回加倍後的注（籌碼回到 1,000），同桌三位 19 點輸
const DEALER_BJ_LAST = `(async () => {${PLAY_UTIL}
  const cards = () => { const out = []; BJK.view.stage.scene.traverse(o => { if (o.userData.kind === 'card') out.push(o); }); return out; };
  const turn = { mode: hud.dataset.mode, buttons: buttons(), faceDown: cards().filter(m => m.rotation.z !== 0).length };
  if (turn.mode === 'act') $('doubleBtn').click();
  await until(() => hud.dataset.mode === 'bet', 30000);
  return { turn, said, end: { bank: $('bank').textContent, mismatches: d.mismatches, bubble: bubble.textContent } };
})()`;
const dealerBjLast = dir => withPage(first(), { ...DESKTOP, init: LATE_BJ }, page => page.goto(url(dir)).then(() => page.evaluate(DEALER_BJ_LAST, 60000)));

test(`${first()}：荷官明牌 A 時照常輪到你（底牌蓋著），打完才翻出 Blackjack；你加倍補到 21 點平手退回`, async () => {
  const r = await dealerBjLast(APP);
  const { turn, said, end } = r.value, why = JSON.stringify(r.value);
  assert.strictEqual(turn.mode, 'act', `荷官明牌 A 就提前結算了：${why}`);
  assert.strictEqual(turn.faceDown, 1, why);
  assert.deepStrictEqual(shownOf(turn.buttons).doubleBtn, [true, false], why);
  const reveal = said.indexOf('翻開底牌。'), bj = said.indexOf('莊家 Blackjack！21 點平手，其餘連加倍、分牌的注一起收。');
  assert.ok(reveal >= 0 && bj > reveal, `翻開底牌之後才講莊家 Blackjack：${why}`);
  assert.deepStrictEqual(end, { bank: '1,000', mismatches: [], bubble: '平手，退回賭注。' }, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：規則改回荷官先偷看，要判成沒輪到你就結算', async () => {
  const tmp = copyWith(path.join('js', 'core', 'game.js'), 'peek: false,', 'peek: true,');
  try {
    const r = await dealerBjLast(tmp);
    assert.notStrictEqual(r.value.turn.mode, 'act', JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 下注沒有上限（v0.11.0）：籌碼 5,000 時 +500 按三下是 1,500；一路按到 5,000（全部籌碼）後 +10、+500 都反灰，發牌照常開局
const BIG_BET = `(async () => {
  await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
  const $ = id => document.getElementById(id), hud = $('hud'), d = BJK.view.stage.director;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 25) await sleep(25); return ok(); };
  const chip = v => document.querySelector('[data-chip="' + v + '"]');
  $('clearBet').click();
  for (let i = 0; i < 3; i++) chip(500).click();
  const three = { bet: $('bet').textContent, plus500: !chip(500).disabled };
  for (let i = 0; i < 7; i++) chip(500).click();
  const all = { bet: $('bet').textContent, plus10: !chip(10).disabled, plus500: !chip(500).disabled };
  $('dealBtn').click();
  const started = await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 20000);
  return { three, all, started, onTable: d.game.state().seats.find(s => s.id === 'me').totalBet };
})()`;
const bigBet = dir => withPage(first(), DESKTOP, async page => {
  await page.goto(url(dir));
  await page.evaluate(`localStorage.setItem('bjk.save.v1', JSON.stringify({ v: 1, bankrolls: { me: 5000 } })); true`);
  await page.goto(url(dir));
  return page.evaluate(BIG_BET, 40000);
});

test(`${first()}：下注沒有上限：籌碼 5,000 時能押 1,500，也能押上全部 5,000，發牌照常開局`, async () => {
  const r = await bigBet(APP), why = JSON.stringify(r.value);
  assert.deepStrictEqual(r.value.three, { bet: '1,500', plus500: true }, why);
  assert.deepStrictEqual(r.value.all, { bet: '5,000', plus10: false, plus500: false }, why);
  assert.deepStrictEqual([r.value.started, r.value.onTable], [true, 5000], why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：上限改回 1,000，要判成押不到 1,500', async () => {
  const tmp = copyWith(path.join('js', 'core', 'game.js'), 'maxBet: Infinity,', 'maxBet: 1000,');
  try {
    const r = await bigBet(tmp);
    assert.strictEqual(r.value.three.bet, '1,000', JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 籌碼鈕超過能押的就押到全部（v0.13.1）：新玩家籌碼 1,000、開局已填 10，六顆籌碼鈕都按得下去；
// 按 +1000 變 1,000、籌碼鈕全部反灰；清除後按 +2000 也是 1,000；發牌照常開局
const ALL_IN = `(async () => {
  await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
  const $ = id => document.getElementById(id), hud = $('hud'), d = BJK.view.stage.director;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 25) await sleep(25); return ok(); };
  const chip = v => document.querySelector('[data-chip="' + v + '"]');
  const enabled = () => [...document.querySelectorAll('[data-chip]')].filter(b => !b.disabled).map(b => b.dataset.chip);
  const start = { bet: $('bet').textContent, enabled: enabled() };
  chip(1000).click();
  const thousand = { bet: $('bet').textContent, enabled: enabled() };
  $('clearBet').click();
  chip(2000).click();
  const two = $('bet').textContent;
  $('dealBtn').click();
  const started = await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 20000);
  return { start, thousand, two, started, onTable: d.game.state().seats.find(s => s.id === 'me').totalBet };
})()`;
const allIn = dir => withPage(first(), PHONE, page => page.goto(url(dir)).then(() => page.evaluate(ALL_IN, 40000)));

test(`${first()}：籌碼 1,000、已填 10 時按 +1000 押到全部 1,000；+2000 也一樣，發牌照常開局`, async () => {
  const r = await allIn(APP), why = JSON.stringify(r.value);
  assert.deepStrictEqual(r.value.start, { bet: '10', enabled: ['10', '50', '100', '500', '1000', '2000'] }, why);
  assert.deepStrictEqual(r.value.thousand, { bet: '1,000', enabled: [] }, why);
  assert.deepStrictEqual([r.value.two, r.value.started, r.value.onTable], ['1,000', true, 1000], why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：籌碼鈕改回超過就反灰，要判成 +1000 按不下去', async () => {
  const tmp = copyWith(path.join('js', 'core', 'game.js'), 'return Math.max(bet, Math.min(bet + chip, most));', 'return bet + chip <= most ? bet + chip : bet;');
  try {
    const r = await allIn(tmp);
    assert.deepStrictEqual(r.value.start.enabled, ['10', '50', '100', '500'], JSON.stringify(r.value));
    assert.strictEqual(r.value.thousand.bet, '10');
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

// 動作鈕平分整排之後，勝率不拆兩行也擠得進去（會自己折行），所以改用不肯縮的按鈕逼它排不下
test('陽性對照：動作鈕不肯縮，四顆排不進一排，要判成換行超出', async () => {
  const tmp = copyWith('style.css', '  flex: 1 1 0;\n  max-width: 170px;\n', '  flex: none;\n  width: 100px;\n');
  try {
    const r = await fourButtons(first(), SMALL_PHONE, tmp);
    assert.throws(() => assertButtonsFit(r.value, '四顆的動作列'), /換行|同一列|跑出/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const [name, from, to, expect] of [
  ['手機上動作鈕的間距改回 4px，要判成靠太近', '#actBar {\n    gap: 10px;', '#actBar {\n    gap: 4px;', /靠太近/],
  ['動作鈕改回照字寬、不平分整排，要判成太窄', '  flex: 1 1 0;\n  max-width: 170px;\n', '', /太窄/],
]) {
  test(`陽性對照：${name}`, async () => {
    const tmp = copyWith('style.css', from, to);
    try {
      const r = await fourButtons(first(), PHONE, tmp);
      assert.throws(() => assertButtonsFit(r.value, '四顆的動作列'), expect);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// 一個座位分成很多手：停在最後一手又成對、問你要牌、停牌或再分的那一刻（畫面靜止），量每一手的牌（四個角投影成四邊形）、
// 籌碼（外接盒投影）、點數標籤，跟其他手、其他座位、荷官的牌與名牌兩兩比，不准重疊、不准跑出牌桌畫布
const MANY_HANDS = n => `(async () => {${PLAY_UTIL}
  for (let i = 0; i < ${n} - 1 && hud.dataset.mode === 'act'; i++) await press('splitBtn');
  // 分出來的手照一般的手打：前 n−1 手逐一按停牌，最後一手補到 8 又成對時停下來
  for (let i = 0; i < ${n} - 1 && hud.dataset.mode === 'act'; i++) await press('standBtn');
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

// BJK-08：上一局押 100，這一局清除後按兩下 +100 改押 200，發牌後操作列的「下注」要是 200（v0.11.1～v0.12.1 疊上上一局顯示 300）。
// 兩局你都拿 10＋7 停牌、荷官 16 補 10 爆，一定會輪到你，第一局贏 100
const TWO_BETS = rigInit([...deal('10', '7'), '10', ...deal('10', '7')]);
const CLICK_TWO_BETS = `(async () => {${PLAY_UTIL}
  const before = { mode: hud.dataset.mode, bet: $('bet').textContent };
  await press('standBtn');
  const chip = document.querySelector('[data-chip="100"]');
  $('clearBet').click(); chip.click(); chip.click();
  const ready = { mode: hud.dataset.mode, bet: $('bet').textContent };
  $('dealBtn').click();
  await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 15000);
  return { before, ready, after: { mode: hud.dataset.mode, bank: $('bank').textContent, bet: $('bet').textContent }, mismatches: d.mismatches };
})()`;
const clickTwoBets = dir => withPage(first(), { ...DESKTOP, init: TWO_BETS }, page => page.goto(url(dir)).then(() => page.evaluate(CLICK_TWO_BETS, 60000)));

test(`${first()}：上一局押 100、這一局改押 200，發牌後「下注」顯示 200，不疊上上一局（BJK-08）`, async () => {
  const r = await clickTwoBets(APP);
  assert.deepStrictEqual(r.value, {
    before: { mode: 'act', bet: '100' },
    ready: { mode: 'bet', bet: '200' },
    after: { mode: 'act', bank: '900', bet: '200' },
    mismatches: [],
  });
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：局與局之間照讀引擎留著的上一局注，第二局發牌後要判成「下注」顯示 300', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), 'money.onTable = onTableOf(st);', "money.onTable = st.seats.find(s => s.id === 'me').totalBet;");
  try {
    const r = await clickTwoBets(tmp);
    assert.deepStrictEqual(r.value.after, { mode: 'act', bank: '900', bet: '300' });
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
