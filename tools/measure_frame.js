// 量一格畫面有多貴：draw call、render 到 GPU 畫完的時間、解析度拉到 4 倍時的時間（看填充率）、開頁到荷官就緒的時間。
// 用法：node tools/measure_frame.js                  量目前的 app\
//       node tools/measure_frame.js <另一份根目錄>   兩份交替各量 4 次，環境雜訊才分得開（根目錄底下要有 app\）
// 想拿上一版比：git archive HEAD app | tar -x -C <暫存>
// 機器與 GPU 都是這一台的，數字只能跟同一台比。draw call 的上限由 tests\check_power.js 守，這支只印數字
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('../tests/browser_util');
const { rigInit, deal } = require('../tests/rig_util');

const PHONE = { size: [390, 844], mobile: true, init: rigInit(deal('10', '6')) };
const ROOTS = [path.join(__dirname, '..'), ...process.argv.slice(2)];
const RUNS = 4;

// three 在 autoReset 時，陰影那一輪畫完才歸零，不關掉就只算到主畫面。readPixels 逼 GPU 畫完才停錶
const MEASURE = `(async () => {
  const s = BJK.view.stage, R = s.renderer, gl = R.getContext();
  await s.dealer.ready;
  const load = Math.round(performance.now());
  await new Promise(r => setTimeout(r, 2500));
  const calls = () => { R.info.autoReset = false; R.info.reset(); s.render(); const c = R.info.render.calls; R.info.autoReset = true; return c; };
  const px = new Uint8Array(4);
  const ms = n => {
    const t = [];
    for (let i = 0; i < n; i++) { const a = performance.now(); s.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    return +t.sort((x, y) => x - y)[n >> 1].toFixed(2);
  };
  const bet = calls();
  ms(20);
  const betMs = ms(80);
  BJK.view.anim.speed = 40;
  s.director.runRound(980);
  const hud = document.getElementById('hud');
  for (let i = 0; i < 400 && hud.dataset.mode !== 'act'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 300));
  const full = calls();
  ms(20);
  const fullMs = ms(80);
  R.setPixelRatio(4);
  R.setSize(innerWidth, innerHeight - hud.offsetHeight, false);
  ms(10);
  return { bet, full, betMs, fullMs, fillMs: ms(40), load, mode: hud.dataset.mode };
})()`;

const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];

(async () => {
  const browser = availableBrowsers()[0], out = ROOTS.map(() => []);
  for (let k = 0; k < RUNS; k++) {
    for (let i = 0; i < ROOTS.length; i++) {
      const r = await withPage(browser, PHONE, async page => {
        await page.goto(pathToFileURL(path.join(ROOTS[i], 'app', 'index.html')).href);
        return page.evaluate(MEASURE, 60000);
      });
      if (r.value.mode !== 'act') throw new Error(`量法有誤：沒有打到輪到你：${JSON.stringify(r.value)}`);
      out[i].push(r.value);
    }
  }
  ROOTS.forEach((root, i) => {
    const pick = key => median(out[i].map(x => x[key]));
    console.log(`${root}（手機 390×844，${RUNS} 次中位數）`);
    console.log(`  draw call：下注 ${pick('bet')}、滿桌 ${pick('full')}`);
    console.log(`  一格：下注 ${pick('betMs')} ms、滿桌 ${pick('fullMs')} ms、4 倍解析度 ${pick('fillMs')} ms`);
    console.log(`  開頁到荷官就緒：${pick('load')} ms`);
  });
})().catch(e => { console.error(e); process.exit(1); });
