// 守「接上規則引擎之後真的打得起來」：雙擊開頁、自動連打好幾局，每一局都要打完不卡住，
// 每演完一個事件畫面都要跟事件對得上（導演自己核對，探針讀它的不一致清單），帳要平、主控台要乾淨。
// 前三局疊好牌，保證打到分牌與再分、荷官最後才翻出 Blackjack、分開的 A 補成 Blackjack，之後照常洗牌。
// 大特效（showcase.js）在 40 倍速下也跟著變快：時間有除以 speed、不拖慢整套、播的時候牌局沒有往下演（不疊在一起）。
// 驗不到：動畫好不好看、節奏對不對（看 node tools/shoot.js <前綴> --round 的截圖）；真人按鈕的手感。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');
const { rigInit, deal } = require('./rig_util');
const { FX_WATCH } = require('./fx_util');

const APP = path.join(__dirname, '..', 'app');
const ROUNDS = 8;
const START_TOTAL = 4000;   // 四個座位各 1000
// 「你」交給阿德的打法（帶人性化隨機，但下面這幾手不管隨機怎麼抽都是同一個動作、吃同樣多張牌）：
const SPLIT_ROUND = rigInit([
  // 第 1 局：你 8、8 對荷官 6 照表要分；第一手補 K 停，第二手補到 8 又成對再分（藍圈要跟到第二手）、
  // 補 3 成 11（加倍或要牌都補一張）補 Q 成 21，第三手補 9 停；荷官 16 補 10 爆
  ...deal('8', '8'), 'K', '8', '3', 'Q', '9', '10',
  // 第 2 局：荷官明牌 A、底牌 K。你 5+6 照表要牌補 K 成 21；大家打完荷官才翻出 Blackjack，你平手、同桌三位輸
  '10', '5', '10', '10', 'A', '9', '6', '9', '9', 'K', 'K',
  // 第 3 局：你 A、A 照表分，第一手補 K 是分後 Blackjack（賠 1.5 倍）、第二手補 9；荷官 16 補 10 爆
  ...deal('A', 'A'), 'K', '9', '10',
]);

// 在頁面裡加速連打；卡住的話 stuckMs 後回報打到第幾局（正常 8 局約 7 秒，前三局疊牌的分牌與 Blackjack 動畫多；全套平行跑時會慢一倍）
async function autoplay(browser, appDir, stuckMs = 40000) {
  const r = await withPage(browser, { size: [1280, 720], init: SPLIT_ROUND }, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(`(async () => {
      await BJK.view.stage.dealer.ready;
      BJK.view.anim.speed = 40;
      const d = BJK.view.stage.director;
      ${FX_WATCH}
      // 記下引擎回的事件（只讀不改），斷言疊好的三局真的打出那幾種局面
      const log = [];
      for (const m of ['startRound', 'act', 'finishRound']) {
        const f = d.game[m];
        d.game[m] = (...a) => { const ev = f(...a); log.push(...ev.map(e => [e.type, e.seat, e.hand, e.result].filter(x => x !== undefined).join(':'))); return ev; };
      }
      const timeout = new Promise(res => setTimeout(() => res({ stuck: true, rounds: d.rounds, splits: d.splits, mismatches: d.mismatches, fx: fxReport() }), ${stuckMs}));
      const run = d.autoplay(${ROUNDS}).then(x => ({ stuck: false, ...x, log, fx: fxReport() }));
      return Promise.race([run, timeout]);
    })()`, 60000);
  });
  return { ...r.value, console: r.console, leftover: r.leftover };
}

// 照局切開事件：第 2 局你先輪到、打完才翻牌，荷官 Blackjack，你 21 點平手；第 3 局分 A 補成 Blackjack 賠 1.5 倍
function riggedRoundProblems(log) {
  const rounds = log.join(' ').split('roundEnd').map(x => x.trim().split(' '));
  const r2 = rounds[1] || [], r3 = rounds[2] || [], out = [];
  if (!(r2.indexOf('turn:me:0') >= 0 && r2.indexOf('turn:me:0') < r2.indexOf('reveal') && r2.indexOf('reveal') < r2.indexOf('dealerBlackjack'))) out.push(`第 2 局沒有先輪到你、最後才翻出 Blackjack：${r2.join(' ')}`);
  if (!(r2.includes('settle:me:0:push') && r2.includes('settle:ade:0:lose'))) out.push(`第 2 局結算不對：${r2.join(' ')}`);
  if (!(r3.includes('split:me:0') && r3.includes('blackjack:me:0') && r3.includes('settle:me:0:blackjack') && r3.includes('settle:me:1:win'))) out.push(`第 3 局沒有分 A 補成 Blackjack：${r3.join(' ')}`);
  return out;
}

// 大特效在 40 倍速下：時間有除以 speed（動畫最晚在 2 秒／40 播完）、不拖慢（出現到收掉不到 1 秒）、
// 一次只有一段、播的時候桌上的牌與籌碼沒變（牌局沒有一邊往下演）、播完收乾淨
const FX_MS = { player: 2000, dealer: 2000, double: 2400 };
function fxProblems(fx) {
  const out = [];
  for (const x of fx.log) {
    if (x.end > FX_MS[x.kind] / 40 + 1) out.push(`${x.kind} 的動畫要 ${x.end} ms 才播完，時間沒除以 speed`);
    if (x.life === null || x.life >= 1000) out.push(`${x.kind} 從出現到收掉 ${x.life} ms，40 倍速下太久`);
    if (x.moved || x.table1 !== x.table0) out.push(`${x.kind} 還在畫面上時牌局已經往下演（桌上的牌與籌碼 ${x.table0} → ${x.table1}）`);
  }
  if (fx.maxLive > 1) out.push(`同時有 ${fx.maxLive} 段大特效`);
  if (fx.left || fx.bodyClass.length || fx.bodyVar) out.push(`播完沒收乾淨：${JSON.stringify([fx.left, fx.bodyClass, fx.bodyVar])}`);
  return out;
}

function brokenCopy(file, from, to) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  const target = path.join(tmp, file);
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(text.includes(from), `破壞沒有命中：${file} 裡找不到 ${from}`);
  fs.writeFileSync(target, text.replace(from, to));
  return tmp;
}

for (const browser of availableBrowsers()) {
  test(`${browser}：自動連打 ${ROUNDS} 局（含分牌、再分），每局打完、畫面跟得上事件、帳平、主控台乾淨`, async () => {
    const r = await autoplay(browser, APP);
    const why = JSON.stringify({ stuck: r.stuck, rounds: r.rounds, splits: r.splits, times: r.times, mismatches: r.mismatches, console: r.console });
    assert.strictEqual(r.stuck, false, `卡住了：${why}`);
    assert.strictEqual(r.rounds, ROUNDS, why);
    assert.ok(r.splits >= 3, `疊好牌的第一局應該分兩次、第三局分一次：${why}`);
    assert.deepStrictEqual(riggedRoundProblems(r.log), []);
    assert.deepStrictEqual(r.mismatches, [], `畫面與事件／引擎不一致：${why}`);
    // 第 2 局荷官最後翻出 Blackjack、第 3 局分 A 補成 Blackjack，兩段大特效一定會播到；你加倍的那段看穩健策略這一局加不加倍
    const kinds = r.fx.log.map(x => x.kind);
    assert.ok(kinds.includes('dealer') && kinds.includes('player'), `大特效沒播到：${JSON.stringify(r.fx)}`);
    assert.deepStrictEqual(fxProblems(r.fx), [], JSON.stringify(r.fx));
    const total = r.state.seats.reduce((a, s) => a + s.bankroll, 0);
    assert.strictEqual(total + r.state.house, START_TOTAL + r.state.topUps, `帳不平：${why}`);
    assert.deepStrictEqual(r.console, [], `主控台有訊息：${why}`);
    assert.strictEqual(r.leftover, 0);
  });
}

const DIRECTOR = path.join('js', 'view', 'director.js');
const first = () => availableBrowsers()[0];
async function caught(from, to, pattern) {
  const tmp = brokenCopy(DIRECTOR, from, to);
  try {
    const r = await autoplay(first(), tmp);
    assert.ok(r.mismatches.some(m => pattern.test(m)), `沒抓到：${JSON.stringify(r.mismatches.slice(0, 3))}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('陽性對照：翻底牌的動畫沒把牌翻過來，要抓到「底牌該翻開卻蓋著」', () => caught(
  'rot: { x: 0, y: hole.rotation.y, z: 0 } });\n        hole.rotation.z = 0;',
  'rot: { x: 0, y: hole.rotation.y, z: Math.PI } });', /底牌 畫面蓋著，應該翻開/));

test('陽性對照：輸的籌碼沒收走，要抓到「結算後籌碼還留在桌上」', () => caught(
  'await collect(id, k, rackPoint);', '', /結算後籌碼還留在桌上/));

test('陽性對照：分牌時第二張牌沒移到新的一手，要抓到「畫面與事件的牌對不上」', () => caught(
  'list.splice(e.hand + 1, 0, { cards: [moved], stacks: [] });',
  'list.splice(e.hand + 1, 0, { cards: [], stacks: [] }); list[e.hand].cards.push(moved);', /split 之後 你 的牌 畫面/));

test('陽性對照：分牌沒推出新的一份籌碼，要抓到「新的一手沒有自己的籌碼」', () => caught(
  'await flyChips(e.seat, e.hand + 1, e.amount, railOf(e.seat), 0);', '', /分牌之後新的一手沒有自己的一份籌碼/));

test('陽性對照：藍圈一直停在第一手，輪到第二手時要抓到「藍圈沒有指到那一手」', () => caught(
  'ringTo(e.seat, e.hand);', 'ringTo(e.seat, 0);', /輪到 你 第 2 手時，藍圈沒有指到那一手/));

test('陽性對照：規則改回荷官先偷看，第 2 局要判成沒輪到你就結算', async () => {
  const tmp = brokenCopy(path.join('js', 'core', 'game.js'), 'peek: false,', 'peek: true,');
  try {
    const r = await autoplay(first(), tmp);
    assert.strictEqual(r.stuck, false, '破壞後卡住了，量不到第 2 局');
    assert.ok(riggedRoundProblems(r.log).some(m => /第 2 局沒有先輪到你/.test(m)), JSON.stringify(riggedRoundProblems(r.log)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 大特效的三種壞法各破一次：動畫時間沒除以 speed、收掉的時間沒除以 speed、導演沒等它播完
async function fxCaught(file, from, to, pattern) {
  const tmp = brokenCopy(file, from, to);
  try {
    const r = await autoplay(first(), tmp);
    assert.strictEqual(r.stuck, false, '破壞後卡住了，量不到大特效');
    assert.ok(fxProblems(r.fx).some(p => pattern.test(p)), `沒抓到：${JSON.stringify(fxProblems(r.fx).slice(0, 3))}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const SHOWCASE = path.join('js', 'view', 'showcase.js');

test('陽性對照：大特效的動畫時間沒除以 speed，要判成「時間沒除以 speed」', () => fxCaught(
  SHOWCASE, 'const ms = total / A.speed;', 'const ms = total;', /時間沒除以 speed/));

test('陽性對照：大特效照真實時間等 2 秒才收，要判成 40 倍速下太久', () => fxCaught(
  SHOWCASE, 'await A.wait(total);', 'await new Promise(r => setTimeout(r, total));', /40 倍速下太久/));

test('陽性對照：導演沒等荷官 Blackjack 的大特效播完，要判成牌局一邊往下演', () => fxCaught(
  DIRECTOR, "await FX.showcase('dealer');", "FX.showcase('dealer');", /dealer 還在畫面上時牌局已經往下演/));

test('陽性對照：發牌動畫永遠播不完，要判成卡住而不是一直等', async () => {
  const tmp = brokenCopy(DIRECTOR, 'async deal(e) {\n        const mesh', 'async deal(e) {\n        await new Promise(() => {});\n        const mesh');
  try {
    const r = await autoplay(first(), tmp, 5000);
    assert.strictEqual(r.stuck, true, `沒判成卡住：${JSON.stringify({ rounds: r.rounds })}`);
    assert.strictEqual(r.rounds, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
