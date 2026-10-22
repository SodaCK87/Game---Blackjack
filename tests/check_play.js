// 守「接上規則引擎之後真的打得起來」：雙擊開頁、自動連打好幾局，每一局都要打完不卡住，
// 每演完一個事件畫面都要跟事件對得上（導演自己核對，探針讀它的不一致清單），帳要平、主控台要乾淨。
// 驗不到：動畫好不好看、節奏對不對（看 node tools/shoot.js <前綴> --round 的截圖）；真人按鈕的手感。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const ROUNDS = 8;
const START_TOTAL = 4000;   // 四個座位各 1000

// 在頁面裡加速連打；卡住的話 stuckMs 後回報打到第幾局（正常 8 局約 4 秒）
async function autoplay(browser, appDir, stuckMs = 25000) {
  const r = await withPage(browser, { size: [1280, 720] }, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(`(async () => {
      await BJK.view.stage.dealer.ready;
      BJK.view.anim.speed = 40;
      const d = BJK.view.stage.director;
      const timeout = new Promise(res => setTimeout(() => res({ stuck: true, rounds: d.rounds, mismatches: d.mismatches }), ${stuckMs}));
      const run = d.autoplay(${ROUNDS}).then(x => ({ stuck: false, ...x }));
      return Promise.race([run, timeout]);
    })()`, 40000);
  });
  return { ...r.value, console: r.console, leftover: r.leftover };
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
  test(`${browser}：自動連打 ${ROUNDS} 局，每局打完、畫面跟得上事件、帳平、主控台乾淨`, async () => {
    const r = await autoplay(browser, APP);
    const why = JSON.stringify({ stuck: r.stuck, rounds: r.rounds, times: r.times, mismatches: r.mismatches, console: r.console });
    assert.strictEqual(r.stuck, false, `卡住了：${why}`);
    assert.strictEqual(r.rounds, ROUNDS, why);
    assert.deepStrictEqual(r.mismatches, [], `畫面與事件／引擎不一致：${why}`);
    const total = r.state.seats.reduce((a, s) => a + s.bankroll, 0);
    assert.strictEqual(total + r.state.house, START_TOTAL + r.state.topUps, `帳不平：${why}`);
    assert.deepStrictEqual(r.console, [], `主控台有訊息：${why}`);
    assert.strictEqual(r.leftover, 0);
  });
}

const DIRECTOR = path.join('js', 'view', 'director.js');
const first = () => availableBrowsers()[0];

test('陽性對照：翻底牌的動畫沒把牌翻過來，要抓到「底牌該翻開卻蓋著」', async () => {
  const tmp = brokenCopy(DIRECTOR,
    'rot: { x: 0, y: hole.rotation.y, z: 0 } });\n        hole.rotation.z = 0;',
    'rot: { x: 0, y: hole.rotation.y, z: Math.PI } });');
  try {
    const r = await autoplay(first(), tmp);
    assert.ok(r.mismatches.some(m => /底牌 畫面蓋著，應該翻開/.test(m)), `沒抓到：${JSON.stringify(r.mismatches.slice(0, 3))}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：輸的籌碼沒收走，要抓到「結算後籌碼還留在桌上」', async () => {
  const tmp = brokenCopy(DIRECTOR, 'await collect(id, rackPoint);', '');
  try {
    const r = await autoplay(first(), tmp);
    assert.ok(r.mismatches.some(m => /結算後籌碼還留在桌上/.test(m)), `沒抓到：${JSON.stringify(r.mismatches.slice(0, 3))}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：發牌動畫永遠播不完，要判成卡住而不是一直等', async () => {
  const tmp = brokenCopy(DIRECTOR, 'await FX.arc(mesh, slot(e.to, k), {', 'await new Promise(() => {}); await FX.arc(mesh, slot(e.to, k), {');
  try {
    const r = await autoplay(first(), tmp, 5000);
    assert.strictEqual(r.stuck, true, `沒判成卡住：${JSON.stringify({ rounds: r.rounds })}`);
    assert.strictEqual(r.rounds, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
