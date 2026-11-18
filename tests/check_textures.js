// 守插畫貼圖（textures.js 的牌背、籌碼頂面、J／Q／K 的人物、牆後的大廳、地毯、牆板、桌身木頭、皮革扶手、絨布，圖在 table_art.js）：
// 開頁先畫純色版，插畫解碼完補畫一次、標記重傳，dealer.ready 之後那一格就要是插畫。
// 量的是 GPU 上那一份：同一張貼圖畫進一張離屏的小畫布讀回來，跟 canvas 的平均色比；補畫了卻沒標記重傳，GPU 上還是純色版。
// 另外守籌碼側面的條紋對齊頂面的嵌片、籌碼只在正擺左右 22.5 度內轉（頂面插畫的光從左上打，轉一整圈光就亂了）；
// 佈景五張在畫面上跟解不開插畫時的 canvas 版同一級亮（使用者要佈景壓暗）、絨布還是原本的青綠；佈景插畫平鋪接得起來。
// 驗不到：好不好看、角標在真手機上讀不讀得出來、地毯花紋搶不搶眼（看 node tools/shoot.js <前綴> --cards 與 --round 的截圖）。
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
  const scene = { 地毯: T.carpet(), 牆板: T.woodPanel(), 桌身木頭: T.wood(), 皮革扶手: T.leather(), 絨布: T.felt() };

  // 一、開頁用到的插畫貼圖都在場景裡、而且最新的版本已經傳上 GPU（補畫之後有重畫那一格）
  const used = new Set();
  s.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if (m.map) used.add(m.map); }); });
  const upload = Object.fromEntries(Object.entries({ ...art, ...scene, 大廳: T.lobby() }).map(([k, t]) => [k,
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
  const gpu = Object.fromEntries(Object.entries({ ...art, ...scene }).map(([k, t]) => {
    const a = gpuMean(t), b = cpuMean(t.image);
    return [k, +Math.max(...a.map((v, i) => Math.abs(v - b[i]))).toFixed(2)];
  }));

  // 佈景五張畫的是插畫：貼圖跟插畫（照同樣的位置平鋪）各自減掉 9×9 的平均（漸層、壁燈、明暗這種慢慢變的不算），
  // 剩下的細紋算相關係數。canvas 版的木紋與雜訊跟插畫無關，相關係數在 0 附近
  const highPass = (img, x0, y0, w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    const p = ctx.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = 0.2126 * p[4 * i] + 0.7152 * p[4 * i + 1] + 0.0722 * p[4 * i + 2];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += L[yy * w + xx]; n++; }
      }
      out[y * w + x] = L[y * w + x] - s / n;
    }
    return out;
  };
  const sceneArt = {};
  for (const [n, s] of Object.entries(V.tableArt.scene)) { const img = new Image(); img.src = s.image; await img.decode(); sceneArt[n] = img; }
  // 絨布只量直邊中段那一塊：避開金線、字與押注圈
  // 皮革只量兩道縫線以下（縫線的亮暗比皮紋強得多）
  const region = { 地毯: [0, 0], 牆板: [0, 0], 桌身木頭: [0, 0], 皮革扶手: [0, 112, 256, 144], 絨布: [768, 0, 512, 256] };
  const source = { 地毯: 'carpet', 牆板: 'wall', 桌身木頭: 'wood', 皮革扶手: 'leather', 絨布: 'felt' };
  const likeness = Object.fromEntries(Object.entries(scene).map(([k, t]) => {
    const W = t.image.width, H = t.image.height, [x0, y0, w = W, h = H] = region[k];
    const tiled = document.createElement('canvas'); tiled.width = W; tiled.height = H;
    const tctx = tiled.getContext('2d'); tctx.fillStyle = tctx.createPattern(sceneArt[source[k]], 'repeat'); tctx.fillRect(0, 0, W, H);
    const a = highPass(t.image, x0, y0, w, h), b = highPass(tiled, x0, y0, w, h);
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return [k, +(ab / Math.sqrt(aa * bb)).toFixed(3)];
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
    variety, likeness, gpu, stripes, chips: rots.length, swing: +(swing * 180 / Math.PI).toFixed(2) };
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
// 插畫的細紋跟貼圖的相關係數：補畫了的實測見下面的 diagnostic，canvas 版在 0 附近
const MIN_LIKE = 0.5;
function assertSceneArt(m) {
  for (const [k, r] of Object.entries(m.likeness)) assert.ok(r >= MIN_LIKE, `${k} 的細紋跟插畫的相關係數只有 ${r}，畫的不是插畫：${JSON.stringify(m.likeness)}`);
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

test(`${first()}：開頁那一格的牌背、籌碼、大廳、佈景五張就是插畫，GPU 上的跟 canvas 一樣；人物牌畫的是插畫；籌碼側面對齊頂面、只在小角度內轉`, async t => {
  const m = await probe(APP);
  t.diagnostic(`顏色數 ${JSON.stringify(m.variety)}；佈景跟插畫的相關係數 ${JSON.stringify(m.likeness)}；GPU 與 canvas 差 ${JSON.stringify(m.gpu)}；條紋錯開 ${JSON.stringify(m.stripes)}；籌碼 ${m.chips} 片、最大轉角 ${m.swing} 度`);
  assertUploaded(m);
  assertArt(m);
  assertSceneArt(m);
  assertGpu(m);
  assertStripes(m);
  assertSwing(m);
  assert.deepStrictEqual(m.console, []);
});

function withCopy(file, from, to, fn) {
  const tmp = copyWith(file, from, to);
  return fn(tmp).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
}

test('陽性對照：插畫解碼完不補畫，要判成純色版、佈景不是插畫、大廳沒貼上', () => withCopy(TEXTURES, 'later.splice(0).forEach(fn => fn());', '', async tmp => {
  const m = await probe(tmp);
  assert.throws(() => assertArt(m), /純色版不是插畫/);
  for (const k of Object.keys(m.likeness)) assert.throws(() => assertSceneArt({ likeness: { [k]: m.likeness[k] } }), /畫的不是插畫/, `${k} 沒補畫卻判成插畫：${JSON.stringify(m.likeness)}`);
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

// ---- 佈景五張的亮度：跟解不開插畫時的 canvas 版比 ----
// 只留那一種材質與燈光再畫一次（背景塗洋紅、排除掉），量畫面上的平均亮度（luma）、最亮色道的平均（V）與平均色
const SCENE_LUM = `(async () => {
  const s = BJK.view.stage, T = BJK.view.textures, R = s.renderer;
  await s.dealer.ready;
  const targets = { 地毯: T.carpet(), 牆板: T.woodPanel(), 桌身木頭: T.wood(), 皮革扶手: T.leather(), 絨布: T.felt() };
  const gl = R.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const meshes = [];
  s.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const bg = s.scene.background, out = {};
  for (const [k, t] of Object.entries(targets)) {
    const vis = meshes.map(m => m.visible);
    meshes.forEach(m => { m.visible = [].concat(m.material).some(x => x.map === t); });
    s.scene.background = new THREE.Color(1, 0, 1);
    s.render();
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    meshes.forEach((m, i) => { m.visible = vis[i]; });
    s.scene.background = bg;
    let n = 0, l = 0, v = 0;
    const rgb = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 255) continue;
      n++; l += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; v += Math.max(px[i], px[i + 1], px[i + 2]);
      for (let c = 0; c < 3; c++) rgb[c] += px[i + c];
    }
    out[k] = { n, luma: +(l / n).toFixed(1), v: +(v / n).toFixed(1), rgb: rgb.map(x => Math.round(x / n)) };
  }
  s.render();
  return out;
})()`;
// 佈景插畫一律當成解不開：textures.js 一直是 canvas 版（WebP 解不開的瀏覽器就是這樣）
const NO_SCENE_ART = `(() => {
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    const art = window.BJK && BJK.view && BJK.view.tableArt;
    if (art && Object.values(art.scene).some(s => s.image === this.src)) return Promise.reject(new Error('探針：當成解不開'));
    return decode.call(this);
  };
})();`;
async function sceneLum(dir, init = '') {
  const r = await withPage(first(), { ...PHONE, init }, async page => {
    await page.goto(url(dir));
    return page.evaluate(SCENE_LUM, 40000);
  });
  return { lum: r.value, console: r.console };
}
let plainOnce = null;
const plainLum = () => (plainOnce = plainOnce || sceneLum(APP, NO_SCENE_ART));

// 亮度不比 canvas 版亮 1.25 倍以上（佈景搶牌桌）、最亮那個色道不比它暗兩成以上；絨布每個色道差 10 以內（還是原本的青綠；
// canvas 版的顆粒有一半是白點，把紅色道墊高，2026-11-18 量到插畫版紅色道 20 對 27，綠藍差 0～2）。
// 木頭是深紅：亮度只有 canvas 版的一半多，但紅色道跟 canvas 版的最亮色道一樣亮（照亮度對齊紅色道會整片爆掉）
const LUMA_MAX = 1.25, V_MIN = 0.8, FELT_RGB = 10;
function assertSceneTone(art, plain) {
  const why = JSON.stringify({ 插畫: art, canvas版: plain });
  for (const k of Object.keys(plain)) {
    assert.ok(art[k].n > 1000 && plain[k].n > 1000, `量法有誤：${k} 在畫面上的像素太少：${why}`);
    assert.ok(art[k].luma <= LUMA_MAX * plain[k].luma, `${k} 比 canvas 版亮（${art[k].luma} 對 ${plain[k].luma}），佈景會搶牌桌：${why}`);
    assert.ok(art[k].v >= V_MIN * plain[k].v, `${k} 比 canvas 版暗太多（最亮色道 ${art[k].v} 對 ${plain[k].v}）：${why}`);
  }
}
function assertFeltColor(art, plain) {
  const why = JSON.stringify({ 插畫: art.絨布, canvas版: plain.絨布 });
  const d = art.絨布.rgb.map((c, i) => Math.abs(c - plain.絨布.rgb[i]));
  assert.ok(Math.max(...d) <= FELT_RGB, `絨布的顏色跑掉了（${art.絨布.rgb} 對 canvas 版 ${plain.絨布.rgb}），不是原本的青綠：${why}`);
}
const pick = (o, ...keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

test(`${first()}：佈景五張貼上插畫後，畫面上的亮度跟 canvas 版同一級、絨布還是青綠；插畫解不開時照樣畫得出來`, async t => {
  const [art, plain] = [await sceneLum(APP), await plainLum()];
  t.diagnostic(`插畫 ${JSON.stringify(art.lum)}；canvas 版 ${JSON.stringify(plain.lum)}`);
  assert.deepStrictEqual(art.console, []);
  assert.deepStrictEqual(plain.console, ['warning: 這台瀏覽器解不開插畫（scene_carpet、scene_felt、scene_leather、scene_wood、scene_wall），改用純色']);
  assertSceneTone(art.lum, plain.lum);
  assertFeltColor(art.lum, plain.lum);
});

test('陽性對照：插畫原樣貼上不調亮度，要判成地毯太亮、木頭太暗', () => withCopy(TEXTURES,
  'const TONE = { carpet: 0.75, wall: 1, leather: 2.8, wood: 3.7 };', 'const TONE = { carpet: 1, wall: 1, leather: 1, wood: 1 };', async tmp => {
    const [art, plain] = [await sceneLum(tmp), await plainLum()];
    assert.throws(() => assertSceneTone(art.lum, pick(plain.lum, '地毯')), /地毯 比 canvas 版亮/);
    assert.throws(() => assertSceneTone(art.lum, pick(plain.lum, '桌身木頭')), /桌身木頭 比 canvas 版暗太多/);
  }));

test('陽性對照：絨布插畫直接蓋上去（不是只取明暗），要判成顏色跑掉', () => withCopy(TEXTURES,
  "if (art.scene_felt) ctx.globalCompositeOperation = 'overlay';", '', async tmp => {
    const [art, plain] = [await sceneLum(tmp), await plainLum()];
    assert.throws(() => assertFeltColor(art.lum, plain.lum), /絨布的顏色跑掉了/);
  }));

// ---- 佈景插畫平鋪接得起來 ----
// 每一對相鄰的欄（或列）算平均亮度差：最後一條接回第一條那一對不超過圖裡相鄰對的第 99 百分位，就是圖裡本來就有的落差。
// 牆板是兩塊鑲板並排：接回來那條就是鑲板的接合處，拿一段中間那條接合處比（差 25% 以內）。
// 量產生器的產出（table_art.js 解回來）與畫面上用的貼圖（疊完明暗、縫線、壁燈之後）
const ART_TOOL = require('../tools/make_table_art');
const fixture = n => 'data:image/webp;base64,' + fs.readFileSync(path.join(ART_TOOL.FIX, 'scene_art', `${n}.webp`)).toString('base64');
const RAW = {
  felt: { src: fixture('felt'), crop: [2, 2, 1020, 1020], quality: ART_TOOL.SCENE.felt.quality },
  wood: { src: fixture('wood'), crop: [0, 320, 1536, 384], quality: ART_TOOL.SCENE.wood.quality },
};
const SCENE_SEAMS = `(async () => {
  const V = BJK.view, T = V.textures, S = V.tableArt.scene;
  await V.stage.dealer.ready;
  const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  function seam(d, W, H, axis, at) {
    const px = (x, y) => L(d, (y * W + x) * 4), n = axis === 0 ? H : W, len = axis === 0 ? W : H;
    const pair = (i, j) => { let s = 0; for (let k = 0; k < n; k++) s += axis === 0 ? Math.abs(px(i, k) - px(j, k)) : Math.abs(px(k, i) - px(k, j)); return s / n; };
    const inner = [];
    for (let i = 1; i < len; i++) inner.push(pair(i - 1, i));
    const mean = inner.reduce((a, b) => a + b, 0) / inner.length, sorted = inner.map(v => v / mean).sort((a, b) => a - b);
    return { r: +((at ? pair(at - 1, at) : pair(len - 1, 0)) / mean).toFixed(2), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(2) };
  }
  const load = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  const pixels = (img, w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const AXES = { carpet: [1, 1], felt: [1, 1], leather: [1, 1], wood: [1, 0], wall: [1, 0] };
  const measure = (d, W, H, n, joint) => ({ x: AXES[n][0] ? seam(d, W, H, 0) : null, y: AXES[n][1] ? seam(d, W, H, 1) : null, joint: joint ? seam(d, W, H, 0, joint) : null });
  const out = { art: {}, final: {}, control: {} }, dec = {};
  for (const [n, s] of Object.entries(S)) {
    const [W, H] = s.size, d = pixels(await load(s.image), W, H);
    dec[n] = { d, W, H };
    out.art[n] = measure(d, W, H, n, n === 'wall' && W / 2);
  }
  for (const [n, t] of Object.entries({ carpet: T.carpet(), wall: T.woodPanel(), wood: T.wood(), leather: T.leather() })) {
    const W = t.image.width, H = t.image.height;
    out.final[n] = measure(pixels(t.image, W, H), W, H, n, n === 'wall' && W / 2);
  }
  // 對照一：原圖不處理（不交疊），照產出的大小縮、用同樣的品質壓
  for (const [n, r] of Object.entries(${JSON.stringify(RAW)})) {
    const img = await load(r.src), [W, H] = S[n].size, c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, ...r.crop, 0, 0, W, H);
    out.control['原圖不處理 ' + n] = measure(pixels(await load(c.toDataURL('image/webp', r.quality)), W, H), W, H, n);
  }
  // 對照二：本來就接得起來、產生器沒處理的兩張。地毯是花磚：右半張錯開半張高再接；
  // 皮革是細碎的皮紋，怎麼錯開都像內部，改成原圖帶一點明暗漸層（左邊暗一成、右邊亮一成）直接平鋪
  for (const n of ['carpet']) {
    const { d, W, H } = dec[n], e = new Uint8ClampedArray(d.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sy = x < W / 2 ? y : (y + H / 2) % H;
      for (let c = 0; c < 4; c++) e[(y * W + x) * 4 + c] = d[(sy * W + x) * 4 + c];
    }
    out.control['錯開半張 ' + n] = measure(e, W, H, n);
  }
  {
    const { d, W, H } = dec.leather, e = new Uint8ClampedArray(d.length);
    for (let i = 0; i < d.length; i += 4) { const k = 0.9 + 0.2 * ((i / 4) % W) / (W - 1); for (let c = 0; c < 3; c++) e[i + c] = d[i + c] * k; e[i + 3] = 255; }
    out.control['左右差兩成亮 leather'] = measure(e, W, H, 'leather');
  }
  // 對照三：牆板兩塊沒排滿一段（右邊留 4% 空白）
  {
    const { W, H } = dec.wall, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.drawImage(await load(S.wall.image), 0, 0, Math.round(W * 0.96), H);
    out.control['牆板沒排滿'] = measure(x.getImageData(0, 0, W, H).data, W, H, 'wall', Math.round(W * 0.48));
  }
  return out;
})()`;
async function sceneSeams(dir) {
  const r = await withPage(first(), PHONE, async page => {
    await page.goto(url(dir));
    return page.evaluate(SCENE_SEAMS, 60000);
  });
  return { ...r.value, console: r.console };
}
// list：{ 名稱: measure 的結果 }；回傳接不起來的
function seamProblems(list) {
  const bad = [];
  for (const [n, m] of Object.entries(list)) {
    if (m.joint) { if (Math.abs(m.x.r / m.joint.r - 1) > 0.25) bad.push(`${n} 接回來那條 ${m.x.r} 跟中間的接合處 ${m.joint.r} 不是同一種`); continue; }
    for (const a of ['x', 'y']) if (m[a] && m[a].r > m[a].p99) bad.push(`${n} ${a === 'x' ? '左右' : '上下'}接縫 ${m[a].r} 超過圖裡相鄰像素差的 P99 ${m[a].p99}`);
  }
  return bad;
}

test(`${first()}：佈景插畫（產出與畫面上用的貼圖）平鋪接得起來`, async t => {
  const m = await sceneSeams(APP);
  t.diagnostic(`產出 ${JSON.stringify(m.art)}；貼圖 ${JSON.stringify(m.final)}；對照 ${JSON.stringify(m.control)}`);
  assert.deepStrictEqual(m.console, []);
  assert.deepStrictEqual(seamProblems(m.art), [], JSON.stringify(m.art));
  assert.deepStrictEqual(seamProblems(m.final), [], JSON.stringify(m.final));
  // 陽性對照（同一頁裡做）：不交疊的原圖、錯開半張再接、牆板沒排滿，每一個都要被抓到
  for (const [n, c] of Object.entries(m.control)) assert.ok(seamProblems({ [n]: c }).length > 0, `陽性對照 ${n} 沒被抓到：${JSON.stringify(c)}`);
});

test('陽性對照：壁燈只畫在一段的左端，要判成牆板接回來那條縫多一道亮暗', () => withCopy(TEXTURES, 'for (const x of [0, W]) {', 'for (const x of [0]) {', async tmp => {
  const m = await sceneSeams(tmp);
  assert.deepStrictEqual(seamProblems(m.art), []);
  assert.ok(seamProblems({ wall: m.final.wall }).length > 0, JSON.stringify(m.final.wall));
}));
