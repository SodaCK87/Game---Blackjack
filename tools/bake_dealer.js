// 把 JOJO 荷官五種表情的 SVG 轉成點陣圖，從色塊形狀推算凹凸，烘焙出體積光、凹處陰影、邊緣反光與金屬高光，
// 寫成 app/js/view/dealer_baked.js。硬光三階的色塊不動，只在上面乘一層明暗；墨線原封不動。
// 改了 dealer.js 的 JOJO 畫法就要重跑：node tools/bake_dealer.js
// 另外在 tools/_shots/bake-<表情>-pair.png 留左原版、右烘焙的對照圖（不進版控）
// 要在手機上開頁時才算也行，但這台桌機一張就要 0.4～2.6 秒，所以預先算好
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('../tests/browser_util');

const MOODS = ['idle', 'deal', 'surprised', 'smile', 'sorry'];
const QUALITY = 0.92;
const OUT = path.join(__dirname, '_shots');
const TARGET = path.join(__dirname, '..', 'app', 'js', 'view', 'dealer_baked.js');
// SVG 原始碼的雜湊（FNV-1a 32 位元），寫進產出檔，測試拿同一支比對
const HASH = `s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }`;

// 在頁面裡跑：回傳對照圖、烘焙圖（PNG 與幾種品質的 WebP）、SVG 雜湊與耗時
const bake = mood => `(async () => {
  const MOOD = ${JSON.stringify(mood)};
  const src = BJK.view.dealer.svg(MOOD, null, 'jojo');
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('SVG 載不進來')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src); });
  const W = img.width, H = img.height, N = W * H;
  const flat = document.createElement('canvas'); flat.width = W; flat.height = H;
  const fctx = flat.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0);
  const t0 = performance.now();
  const px = fctx.getImageData(0, 0, W, H);
  const p = px.data;

  // 精確的距離轉換（Felzenszwalb）：每個像素到最近種子像素的距離
  function edt(seed) {
    const INF = 1e20, g = new Float64Array(N), n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let i = 0; i < N; i++) g[i] = seed[i] ? 0 : INF;
    const pass = len => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    };
    for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; pass(H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
    for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; pass(W); for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]); }
    return g;
  }
  // 可分離的方框模糊，跑兩次近似高斯
  function blur(a, r) {
    const tmp = new Float64Array(N), out = new Float64Array(N);
    const run = (from, to, len, stride, lines, lineStride) => {
      for (let l = 0; l < lines; l++) {
        const base = l * lineStride;
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += from[base + Math.min(len - 1, Math.max(0, i)) * stride];
        for (let i = 0; i < len; i++) {
          to[base + i * stride] = acc / (2 * r + 1);
          acc += from[base + Math.min(len - 1, i + r + 1) * stride] - from[base + Math.max(0, i - r) * stride];
        }
      }
    };
    run(a, tmp, W, 1, H, W); run(tmp, out, H, W, W, 1);
    run(out, tmp, W, 1, H, W); run(tmp, out, H, W, W, 1);
    return out;
  }

  // 墨線：跟墨色 #15131d 很近的像素
  const alpha = new Float64Array(N), ink = new Uint8Array(N), outside = new Uint8Array(N), edge = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    alpha[i] = p[i * 4 + 3] / 255;
    ink[i] = alpha[i] > 0.5 && Math.abs(r - 21) + Math.abs(g - 19) + Math.abs(b - 29) < 36 ? 1 : 0;
    outside[i] = alpha[i] < 0.5 ? 1 : 0;
  }
  // 排線、鬍渣這類短筆觸不算色塊的邊：第一版把它們也當邊，臉和外套鼓成一顆顆泡泡
  const label = new Int32Array(N), stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!ink[s] || label[s]) continue;
    let top = 0, area = 0; stack[top++] = s; label[s] = -1;
    const members = [];
    while (top) {
      const i = stack[--top]; members.push(i); area++;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && ink[j] && !label[j]) { label[j] = -1; stack[top++] = j; }
    }
    const v = area >= 1500 ? 1 : 2;
    for (const i of members) label[i] = v;
  }
  for (let i = 0; i < N; i++) edge[i] = outside[i] || label[i] === 1 ? 1 : 0;
  // 高度：整個人的大圓弧（到外輪廓的距離）＋每個色塊自己鼓起來（到墨線的距離）
  const dSil = edt(outside), dEdge = edt(edge);
  const dome = (d, R) => { const t = Math.min(d / R, 1); return R * Math.sqrt(1 - (1 - t) * (1 - t)); };
  let h = new Float64Array(N);
  for (let i = 0; i < N; i++) h[i] = outside[i] ? 0 : 0.55 * dome(dSil[i], 110) + 0.7 * dome(dEdge[i], 14);
  h = blur(h, 2);
  const wide = blur(h, 12);

  // 光從左上前方來（畫面 y 向下），跟原圖的硬光同方向；反光從右後方補，用外套的青色
  const L = (() => { const v = [-0.55, -0.65, 0.75], m = Math.hypot(...v); return v.map(c => c / m); })();
  const Hh = (() => { const v = [L[0], L[1], L[2] + 1], m = Math.hypot(...v); return v.map(c => c / m); })();
  const RIM = [53, 214, 198], SPEC = [255, 248, 230];
  const out = fctx.createImageData(W, H), q = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2]; q[o + 3] = p[o + 3];
    if (outside[i] && alpha[i] === 0) continue;
    if (ink[i]) continue;
    const hx = (h[i + (x < W - 1 ? 1 : 0)] - h[i - (x > 0 ? 1 : 0)]) / 2;
    const hy = (h[i + (y < H - 1 ? W : 0)] - h[i - (y > 0 ? W : 0)]) / 2;
    let nx = -hx * 1.6, ny = -hy * 1.6, nz = 1;
    const m = Math.hypot(nx, ny, nz); nx /= m; ny /= m; nz /= m;
    const lambert = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const light = 1 + 0.42 * (lambert - L[2]);              // 正對鏡頭的平面維持原色，只有斜面變亮變暗
    const ao = 1 - Math.min(0.38, Math.max(0, wide[i] - h[i]) * 0.045);
    const r = p[o], g = p[o + 1], b = p[o + 2];
    // 高光只給金飾與手套：第一版全身都給，皮膚和外套變成濕亮的塑膠
    const gold = Math.abs(r - 242) + Math.abs(g - 194) + Math.abs(b - 48) < 90;
    const glove = Math.abs(r - 241) + Math.abs(g - 236) + Math.abs(b - 255) < 60;
    const gloss = gold ? 0.75 : glove ? 0.3 : 0;
    const spec = gloss && Math.pow(Math.max(0, nx * Hh[0] + ny * Hh[1] + nz * Hh[2]), gold ? 30 : 40) * gloss;
    const rim = Math.pow(1 - nz, 1.6) * Math.max(0, nx * 0.85 + ny * 0.2) * 0.9;
    const k = light * ao;
    for (let c = 0; c < 3; c++) {
      const base = [r, g, b][c] * k;
      q[o + c] = Math.max(0, Math.min(255, base + RIM[c] * rim + SPEC[c] * spec));
    }
  }
  const baked = document.createElement('canvas'); baked.width = W; baked.height = H;
  baked.getContext('2d').putImageData(out, 0, 0);
  const ms = Math.round(performance.now() - t0);

  // 左右並排給人看，底色用識別色深藍灰
  const pair = document.createElement('canvas'); pair.width = W * 2 + 48; pair.height = H + 32;
  const pc = pair.getContext('2d');
  pc.fillStyle = '#212C31'; pc.fillRect(0, 0, pair.width, pair.height);
  pc.drawImage(flat, 16, 16); pc.drawImage(baked, W + 32, 16);
  const hash = (${HASH})(src);
  return { W, H, ms, hash, pair: pair.toDataURL('image/png'), png: baked.toDataURL('image/png'),
           webp: Object.fromEntries([0.85, 0.92, 1].map(q => [q, baked.toDataURL('image/webp', q)])) };
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = availableBrowsers()[0];
  const url = pathToFileURL(path.join(__dirname, '..', 'app', 'index.html')).href;
  const b64 = d => Buffer.from(d.split(',')[1], 'base64');
  const r = await withPage(browser, { size: [1280, 720], mobile: false }, async page => {
    await page.goto(url);
    const got = {};
    for (const m of MOODS) {
      got[m] = await page.evaluate(bake(m), 60000);
      const g = got[m];
      fs.writeFileSync(path.join(OUT, `bake-${m}-pair.png`), b64(g.pair));
      const kb = d => Math.round(b64(d).length / 1024);
      console.log(`${m}：烘焙 ${g.ms} ms；PNG ${kb(g.png)} KB，WebP ${Object.entries(g.webp).map(([q, d]) => `q${q} ${kb(d)} KB`).join('、')}`);
    }
    return got;
  });
  for (const line of r.console) console.log(`  主控台：${line}`);
  const got = r.value;
  const images = Object.fromEntries(MOODS.map(m => [m, got[m].webp[QUALITY]]));
  const source = Object.fromEntries(MOODS.map(m => [m, got[m].hash]));
  const js = `// 由 tools/bake_dealer.js 產生，不准手改：JOJO 荷官五種表情烘焙過光影的點陣圖（WebP，品質 ${QUALITY}）。
// 走 data: URL 是因為 file:// 下外部圖檔上傳 WebGL 會被當成跨來源擋掉（2026-11-07 Edge 實測 SecurityError）。
// source 是烘焙當時 SVG 的雜湊：dealer.js 的畫改了卻沒重跑烘焙，tests/check_dealer.js 會紅
(function () {
  const V = window.BJK.view;
  V.dealerBaked = {
    hash: ${HASH},
    source: ${JSON.stringify(source)},
    images: {
${MOODS.map(m => `      ${m}: '${images[m]}',`).join('\n')}
    },
  };
})();
`;
  fs.writeFileSync(TARGET, js);
  console.log(`✔ 寫入 ${path.relative(process.cwd(), TARGET)}（${Math.round(Buffer.byteLength(js) / 1024)} KB）；對照圖在 ${path.relative(process.cwd(), OUT)}\\bake-<表情>-pair.png`);
})();
