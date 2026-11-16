// 守插畫貼圖（textures.js 的牌背、籌碼頂面、J／Q／K 的人物、牆後的大廳，圖在 table_art.js）：
// 開頁先畫純色版，插畫解碼完補畫一次、標記重傳，dealer.ready 之後那一格就要是插畫。
// 量的是 GPU 上那一份：同一張貼圖畫進一張離屏的小畫布讀回來，跟 canvas 的平均色比；補畫了卻沒標記重傳，GPU 上還是純色版。
// 另外守籌碼側面的條紋對齊頂面的嵌片、籌碼只在正擺左右 22.5 度內轉（頂面插畫的光從左上打，轉一整圈光就亂了）。
// 驗不到：好不好看、角標在真手機上讀不讀得出來（看 node tools/shoot.js <前綴> --cards 與 --round 的截圖）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withPage } = require('./browser_util');
const { APP, PHONE, url, first, copyWith } = require('./ui_util');
const { rigInit, deal } = require('./rig_util');

const TEXTURES = path.join('js', 'view', 'textures.js');
const CHIPS = path.join('js', 'view', 'chips.js');

const PROBE = `(async () => {
  const s = BJK.view.stage, V = BJK.view, T = V.textures, R = s.renderer, hud = document.getElementById('hud');
  await s.dealer.ready;
  const DENOMS = V.chips.DENOMS;
  const art = { 牌背: T.cardBack(), ...Object.fromEntries(DENOMS.map(v => ['籌碼 ' + v, T.chipAtlas(v)])) };

  // 一、開頁用到的插畫貼圖都在場景裡、而且最新的版本已經傳上 GPU（補畫之後有重畫那一格）
  const used = new Set();
  s.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if (m.map) used.add(m.map); }); });
  const upload = Object.fromEntries(Object.entries({ ...art, 大廳: T.lobby() }).map(([k, t]) => [k,
    { used: used.has(t), version: t.version, gpu: R.properties.get(t).__version }]));
  const lobby = T.lobby().image;

  // 二、canvas 上畫的是插畫：純色版只有幾十種顏色，插畫有好幾百種（每色道取 5 位元）
  const colors = (img, x0, y0, w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    const p = ctx.getImageData(0, 0, w, h).data, seen = new Set();
    for (let i = 0; i < p.length; i += 4) seen.add((p[i] >> 3) << 10 | (p[i + 1] >> 3) << 5 | (p[i + 2] >> 3));
    return seen.size;
  };
  const faces = { 'K♥': T.cardFace('K', 'H'), 'Q♦': T.cardFace('Q', 'D'), 'J♣': T.cardFace('J', 'C'), 'K♠': T.cardFace('K', 'S') };
  const variety = {
    ...Object.fromEntries(Object.entries(art).map(([k, t]) => [k, colors(t.image, 0, 0, 256, 256)])),
    // 人物框正中央那一塊，角標與框線都不在裡面
    ...Object.fromEntries(Object.entries(faces).map(([k, t]) => [k, colors(t.image, 64, 120, 128, 118)])),
  };

  // 三、GPU 上那一份跟 canvas 一樣：貼到一片四邊形畫進 64×64 的離屏畫布讀回來，跟 canvas 比平均色（線性值 0～255）
  const lin = v => { v /= 255; return 255 * (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); };
  const cpuMean = img => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(0, 0, c.width, c.height).data, sum = [0, 0, 0];
    for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += lin(p[i + k]);
    return sum.map(v => v / (p.length / 4));
  };
  const N = 64, rt = new THREE.WebGLRenderTarget(N, N), cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
  cam.position.z = 1;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()), sc = new THREE.Scene();
  sc.add(quad);
  const gpuMean = tex => {
    quad.material.map = tex; quad.material.needsUpdate = true;
    R.setRenderTarget(rt); R.render(sc, cam);
    const px = new Uint8Array(N * N * 4); R.readRenderTargetPixels(rt, 0, 0, N, N, px); R.setRenderTarget(null);
    const sum = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k];
    return sum.map(v => v / (N * N));
  };
  const gpu = Object.fromEntries(Object.entries(art).map(([k, t]) => {
    const a = gpuMean(t), b = cpuMean(t.image);
    return [k, +Math.max(...a.map((v, i) => Math.abs(v - b[i]))).toFixed(2)];
  }));

  // 四、籌碼側面的條紋對齊頂面的嵌片：照圓柱的 UV，頂面邊上那一點往圓心收到 0.9（嵌片那一圈）、側面同一個角度的中段，
  // 各取一圈亮度，比八片嵌片那個頻率的相位（度）。量的是真的模型 UV，不是自己推的角度；
  // 逐點比亮暗會被嵌片的邊卡住（取樣點 9 度一個，嵌片才 20 度寬）
  const g = V.chips.make(5).geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const topAt = new Map(), sides = [];
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(4) + ',' + pos.getZ(i).toFixed(4);
    if (nor.getY(i) > 0.5 && Math.hypot(pos.getX(i), pos.getZ(i)) > V.chips.R * 0.99) topAt.set(key, i);
    else if (Math.abs(nor.getY(i)) < 0.5 && pos.getY(i) > 0 && uv.getX(i) < 1) sides.push([key, i]);
  }
  const atlasH = 256 / T.CHIP_ATLAS.top;
  const phase8 = list => {
    const mean = list.reduce((s, q) => s + q.L, 0) / list.length;
    let re = 0, im = 0;
    for (const q of list) { re += (q.L - mean) * Math.cos(8 * q.a); im += (q.L - mean) * Math.sin(8 * q.a); }
    return Math.atan2(im, re) / 8 * 180 / Math.PI;
  };
  const stripes = {};
  for (const v of DENOMS) {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.canvas.width = 256; ctx.canvas.height = atlasH;
    ctx.drawImage(T.chipAtlas(v).image, 0, 0);
    const L = (x, y) => { const p = ctx.getImageData(Math.min(255, Math.floor(x)), Math.floor(y), 1, 1).data; return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; };
    const top = [], side = [];
    for (const [k, i] of sides.filter(([k]) => topAt.has(k))) {
      const j = topAt.get(k), tx = uv.getX(j) * 256, ty = (1 - uv.getY(j)) * atlasH, a = Math.atan2(pos.getX(i), pos.getZ(i));
      top.push({ a, L: L(128 + 0.9 * (tx - 128), 128 + 0.9 * (ty - 128)) });
      side.push({ a, L: L(uv.getX(i) * 256, atlasH - 16) });
    }
    const d = phase8(top) - phase8(side);
    stripes[v] = { n: top.length, off: +(((d % 45) + 67.5) % 45 - 22.5).toFixed(1) };
  }

  // 五、打到輪到你，桌上每一疊籌碼都在正擺左右 22.5 度內（籌碼架併成一個網格，不算）
  V.anim.speed = 40;
  s.director.runRound(980);
  for (let i = 0; i < 400 && hud.dataset.mode !== 'act'; i++) await new Promise(r => setTimeout(r, 25));
  const rots = [];
  s.scene.traverse(o => { if (o.userData.kind === 'chip' && !o.userData.count) rots.push(o.rotation.y); });
  const swing = Math.max(...rots.map(r => Math.abs(r - Math.PI / 2)));

  return { mode: hud.dataset.mode, upload, lobby: lobby ? [lobby.naturalWidth, lobby.naturalHeight] : null, lobbySize: V.tableArt.lobby.size,
    variety, gpu, stripes, chips: rots.length, swing: +(swing * 180 / Math.PI).toFixed(2) };
})()`;

// 插畫解碼得快的話，開頁建牌桌時就已經好了、直接畫插畫，補畫那條路根本沒走到（陽性對照會時紅時不紅）。
// 所以每張圖的 decode() 晚 400 毫秒才回：牌桌一定先畫純色版，量的一定是補畫之後的那一份。產品檔一個字都不改
const SLOW_DECODE = `(() => {
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () { return decode.call(this).then(() => new Promise(r => setTimeout(r, 400))); };
})();`;

async function probe(dir) {
  const r = await withPage(first(), { ...PHONE, init: SLOW_DECODE + rigInit(deal('10', '6')) }, async page => {
    await page.goto(url(dir));
    return page.evaluate(PROBE, 40000);
  });
  return { ...r.value, console: r.console };
}

const MIN_COLORS = 300, GPU_TOL = 3;
function assertUploaded(m) {
  const why = JSON.stringify(m);
  assert.deepStrictEqual(m.lobby, m.lobbySize, `大廳那張圖沒貼上：${why}`);
  for (const [k, u] of Object.entries(m.upload)) {
    assert.ok(u.used, `量法有誤：${k} 的貼圖不在場景裡：${why}`);
    assert.strictEqual(u.gpu, u.version, `${k} 補畫之後沒有重畫，畫面上還是純色版：${why}`);
  }
}
function assertArt(m) {
  for (const [k, n] of Object.entries(m.variety)) assert.ok(n >= MIN_COLORS, `${k} 只有 ${n} 種顏色，畫的是純色版不是插畫：${JSON.stringify(m.variety)}`);
}
function assertGpu(m) {
  for (const [k, d] of Object.entries(m.gpu)) assert.ok(d <= GPU_TOL, `${k} 在 GPU 上的那一份跟 canvas 差 ${d}，補畫之後 GPU 上（或縮小看的 mipmap）還是純色版：${JSON.stringify(m.gpu)}`);
}
function assertStripes(m) {
  for (const [v, s] of Object.entries(m.stripes)) {
    assert.ok(s.n >= 40, `量法有誤：籌碼 ${v} 只配到 ${s.n} 組頂面與側面的點：${JSON.stringify(m.stripes)}`);
    // 半格是 22.5 度；錯開 5 度以內看不出來
    assert.ok(Math.abs(s.off) <= 5, `籌碼 ${v} 的側面條紋跟頂面的嵌片錯開 ${s.off} 度：${JSON.stringify(m.stripes)}`);
  }
}
function assertSwing(m) {
  assert.strictEqual(m.mode, 'act', `量法有誤：沒有打到輪到你：${JSON.stringify(m)}`);
  assert.ok(m.chips >= 4, `量法有誤：桌上只有 ${m.chips} 片籌碼`);
  assert.ok(m.swing <= 22.5 + 1e-6, `有籌碼轉了 ${m.swing} 度，頂面插畫的光會從別的方向來：${JSON.stringify(m)}`);
}

test(`${first()}：開頁那一格的牌背、籌碼、大廳就是插畫，GPU 上的跟 canvas 一樣；人物牌畫的是插畫；籌碼側面對齊頂面、只在小角度內轉`, async t => {
  const m = await probe(APP);
  t.diagnostic(`顏色數 ${JSON.stringify(m.variety)}；GPU 與 canvas 差 ${JSON.stringify(m.gpu)}；條紋錯開 ${JSON.stringify(m.stripes)}；籌碼 ${m.chips} 片、最大轉角 ${m.swing} 度`);
  assertUploaded(m);
  assertArt(m);
  assertGpu(m);
  assertStripes(m);
  assertSwing(m);
  assert.deepStrictEqual(m.console, []);
});

function withCopy(file, from, to, fn) {
  const tmp = copyWith(file, from, to);
  return fn(tmp).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
}

test('陽性對照：插畫解碼完不補畫，要判成純色版、大廳沒貼上', () => withCopy(TEXTURES, 'later.splice(0).forEach(fn => fn());', '', async tmp => {
  const m = await probe(tmp);
  assert.throws(() => assertArt(m), /純色版不是插畫/);
  assert.throws(() => assertUploaded(m), /大廳那張圖沒貼上/);
}));

test('陽性對照：補畫了不標記重傳，要判成 GPU 上的跟 canvas 對不上', () => withCopy(TEXTURES, 'draw(ctx); t.dispose(); t.needsUpdate = true;', 'draw(ctx);', async tmp => {
  const m = await probe(tmp);
  assertArt(m);
  assert.throws(() => assertGpu(m), /GPU 上（或縮小看的 mipmap）還是純色版/);
}));

test('陽性對照：重傳前不 dispose（原地重傳），要判成縮小看的 mipmap 還是純色版', () => withCopy(TEXTURES, 'draw(ctx); t.dispose(); t.needsUpdate = true;', 'draw(ctx); t.needsUpdate = true;', async tmp => {
  const m = await probe(tmp);
  assertArt(m);
  assertUploaded(m);
  assert.throws(() => assertGpu(m), /GPU 上（或縮小看的 mipmap）還是純色版/);
}));

test('陽性對照：荷官與插畫都好了不重畫那一格，要判成畫面上還是純色版', () => withCopy(path.join('js', 'view', 'dealer.js'),
  'material.needsUpdate = true;\n        onChange();', 'material.needsUpdate = true;', async tmp => {
    const m = await probe(tmp);
    assert.throws(() => assertUploaded(m), /補畫之後沒有重畫/);
  }));

test('陽性對照：側面條紋轉半格（22.5 度），要判成跟頂面的嵌片錯開', () => withCopy(TEXTURES, 'const x = (C.phase + i * 45) / 360', 'const x = (C.phase + 22.5 + i * 45) / 360', async tmp => {
  const m = await probe(tmp);
  assert.throws(() => assertStripes(m), /側面條紋跟頂面的嵌片錯開/);
}));

test('陽性對照：籌碼轉一整圈，要判成光從別的方向來', () => withCopy(CHIPS, 'rot: UPRIGHT + (rng() - 0.5) * 2 * SWING', 'rot: rng() * Math.PI * 2', async tmp => {
  const m = await probe(tmp);
  assert.throws(() => assertSwing(m), /頂面插畫的光會從別的方向來/);
}));
