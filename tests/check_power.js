// 守手機節電的前提（使用者 2026-10-22 選靜態、2026-10-31 要精緻度時再次定為前提）：畫面沒動就不重畫；
// 每一格的 draw call 在預算內；120Hz 手機上補間不超過約 60 格；手機上陰影貼圖寫的像素不比畫面本身多。
// 驗不到：真手機的耗電瓦數（這台只有 Radeon 內顯，CDP 模擬尺寸不換 GPU）；真手機的發熱與降頻。
// 貼圖要多少記憶體、一格要畫幾毫秒只印不判：那些數字隨機器變，記在 docs\perf-baseline.md。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withPage } = require('./browser_util');
const { APP, DESKTOP, PHONE, url, first, copyWith } = require('./ui_util');
const { rigInit, deal } = require('./rig_util');

// 第一格之後的預算。2026-10-31 量到 v0.13.1 下注畫面 783、滿桌 1,100 左右（籌碼架一片畫 3 次、光點 206 顆各 1 次，陰影再一輪）
const BET_BUDGET = 80, FULL_BUDGET = 260;
const MAIN = path.join('js', 'view', 'main.js');
const TABLE = path.join('js', 'view', 'table.js');
const ANIM = path.join('js', 'view', 'anim.js');

const SETTLED = `
  const s = BJK.view.stage;
  await s.dealer.ready;
  await new Promise(r => setTimeout(r, 2500));   // 等開頁的預演做完`;
const COUNT_RENDERS = `
  let renders = 0;
  { const R = s.renderer, orig = R.render; R.render = function () { renders++; return orig.apply(this, arguments); }; }`;
// three 在 autoReset 時，陰影那一輪畫完才歸零，不關掉就只算到主畫面
const CALLS = `(() => {
  const R = s.renderer;
  R.info.autoReset = false; R.info.reset(); s.render();
  const out = { calls: R.info.render.calls, tris: R.info.render.triangles };
  R.info.autoReset = true;
  return out;
})()`;
const WATCH_IDLE = `(async () => {
  renders = 0;
  let frames = 0, live = true;
  (function tick() { frames++; if (live) requestAnimationFrame(tick); })();
  await new Promise(r => setTimeout(r, 1500));
  live = false;
  return { renders, frames };
})()`;

// 下注畫面與輪到你的畫面各看 1.5 秒；滿桌用押 980（9 片籌碼）算最壞的情況
const MEASURE = `(async () => {
  ${SETTLED}
  ${COUNT_RENDERS}
  const betIdle = await ${WATCH_IDLE};
  const bet = ${CALLS};
  BJK.view.anim.speed = 40;
  s.director.runRound(980);
  const hud = document.getElementById('hud');
  for (let i = 0; i < 400 && hud.dataset.mode !== 'act'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 300));
  const turnIdle = await ${WATCH_IDLE};
  const full = ${CALLS};
  let lamp; s.scene.traverse(o => { if (o.isSpotLight) lamp = o; });
  const gl = s.renderer.getContext(), map = lamp.shadow.map;
  const size = o => (o.image ? (o.image.width || 0) * (o.image.height || 0) : 0);
  return { betIdle, turnIdle, bet, full, mode: hud.dataset.mode,
    screenPx: gl.drawingBufferWidth * gl.drawingBufferHeight, shadowPx: map.width * map.height,
    textures: s.renderer.info.memory.textures };
})()`;

async function measure(dir, viewport) {
  const r = await withPage(first(), { ...viewport, init: rigInit(deal('10', '6')) }, async page => {
    await page.goto(url(dir));
    return page.evaluate(MEASURE, 40000);
  });
  return { ...r.value, console: r.console };
}

function assertIdle(m) {
  const why = JSON.stringify(m);
  for (const [name, w] of [['下注畫面', m.betIdle], ['輪到你的畫面', m.turnIdle]]) {
    assert.ok(w.frames >= 30, `量法有誤：1.5 秒只跑了 ${w.frames} 格：${why}`);
    assert.strictEqual(w.renders, 0, `${name}沒有東西在動也重畫了 ${w.renders} 次：${why}`);
  }
}
function assertBudget(m) {
  const why = JSON.stringify(m);
  assert.strictEqual(m.mode, 'act', `量法有誤：沒有打到輪到你：${why}`);
  assert.ok(m.bet.calls <= BET_BUDGET, `下注畫面一格 ${m.bet.calls} 個 draw call，預算 ${BET_BUDGET}：${why}`);
  assert.ok(m.full.calls <= FULL_BUDGET, `滿桌一格 ${m.full.calls} 個 draw call，預算 ${FULL_BUDGET}：${why}`);
}
function assertShadow(m) {
  assert.ok(m.shadowPx <= 1.2 * m.screenPx, `陰影貼圖一格寫 ${m.shadowPx} 像素，比畫面本身的 ${m.screenPx} 還多：${JSON.stringify(m)}`);
}

for (const [name, viewport] of [['手機', PHONE], ['桌機', DESKTOP]]) {
  test(`${first()}・${name}：沒有東西在動就不重畫、每格 draw call 在預算內`, async t => {
    const m = await measure(APP, viewport);
    t.diagnostic(`下注 ${m.bet.calls} 個、${m.bet.tris} 三角形；滿桌 ${m.full.calls} 個、${m.full.tris} 三角形；貼圖 ${m.textures} 張；陰影 ${m.shadowPx} 像素、畫面 ${m.screenPx} 像素`);
    assertIdle(m);
    assertBudget(m);
    assert.deepStrictEqual(m.console, []);
    if (viewport === PHONE) assertShadow(m);
  });
}

// 模擬 120Hz 手機：rAF 每 8.33 毫秒來一次。setTimeout 在這台最快約 11.6 毫秒一次，比門檻慢就量不到，
// 所以用 MessageChannel 來回問時間。真的 rAF 那一輪守的是上限不會把一般螢幕也砍半
const HZ = fast => `(async () => {
  ${SETTLED}
  ${COUNT_RENDERS}
  let raf = 0, live = true;
  ${fast ? `let queue = [], last = performance.now();
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    const now = performance.now();
    if (now - last >= 8.33) { last = now; const run = queue; queue = []; run.forEach(cb => { raf++; cb(now); }); }
    if (live) ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
  window.requestAnimationFrame = cb => { queue.push(cb); return 1; };` : ''}
  await BJK.view.anim.tween(1000, () => {});
  live = false;
  return { renders, raf };
})()`;
async function hz(dir, fast) {
  const r = await withPage(first(), PHONE, async page => {
    await page.goto(url(dir));
    return page.evaluate(HZ(fast), 20000);
  });
  return r.value;
}
function assertCap(r) {
  assert.ok(r.raf >= 100, `量法有誤：模擬的 rAF 一秒只有 ${r.raf} 次：${JSON.stringify(r)}`);
  assert.ok(r.renders <= 75, `120Hz 螢幕上 1 秒的補間重畫了 ${r.renders} 次：${JSON.stringify(r)}`);
}

test(`${first()}：120Hz 手機上補間一秒重畫不超過約 60 次，一般螢幕不被砍半`, async t => {
  const fast = await hz(APP, true), normal = await hz(APP, false);
  t.diagnostic(`120Hz 模擬 ${fast.raf} 次 rAF、重畫 ${fast.renders} 次；一般 rAF 重畫 ${normal.renders} 次`);
  assertCap(fast);
  assert.ok(normal.renders >= 45, `一般螢幕 1 秒的補間只畫了 ${normal.renders} 次，動畫會變卡：${JSON.stringify(normal)}`);
});

function withCopy(file, from, to, fn) {
  const tmp = copyWith(file, from, to);
  return fn(tmp).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
}

test('陽性對照：開一條一直重畫的迴圈，要判成沒動也重畫', () => withCopy(MAIN, 'V.anim.setRender(render);',
  'V.anim.setRender(render); (function loop() { render(); requestAnimationFrame(loop); })();', async tmp => {
    const m = await measure(tmp, PHONE);
    assert.throws(() => assertIdle(m), /沒有東西在動也重畫/);
  }));

test('陽性對照：籌碼架多放 100 片各自一個物件的籌碼，要超過預算', () => withCopy(TABLE, 'rack.position.set(0, 0, 0.42);',
  'for (let i = 0; i < 100; i++) { const c = V.chips.make(5); c.position.set(0, 0.2, 0); rack.add(c); } rack.position.set(0, 0, 0.42);', async tmp => {
    const m = await measure(tmp, PHONE);
    assert.throws(() => assertBudget(m), /draw call，預算/);
  }));

test('陽性對照：拿掉更新率上限，要判成 120Hz 上重畫太多次', () => withCopy(ANIM, 'if (now - lastDraw < MIN_GAP) { kick(); return; }', '', async tmp => {
  const r = await hz(tmp, true);
  assert.throws(() => assertCap(r), /120Hz 螢幕上/);
}));

test('陽性對照：手機的陰影貼圖改回 2048，要判成比畫面還多', () => withCopy(MAIN, 'Math.min(window.innerWidth, window.innerHeight) < 700 ? 1024 : 2048', '2048', async tmp => {
  const m = await measure(tmp, PHONE);
  assert.throws(() => assertShadow(m), /比畫面本身/);
}));
