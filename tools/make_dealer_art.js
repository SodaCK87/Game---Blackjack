// 把荷官的點陣插畫（tests/fixtures/dealer_art/<表情>.webp，1024×1024、背景透明、腰到臀部之間被底邊截掉）
// 縮成立牌的比例（560:520，左右補透明邊），寫成 app/js/view/dealer_art.js（不准手改）。
// 換了原圖、改了這支的任何一行就重跑：node tools/make_dealer_art.js
// 另外在 tools/_shots/art-<表情>-marks.png 留量測對照圖（不進版控）：橘框是找到的臉、青框是對白泡泡避開的頭、
// 洋紅框是五官、黃框是大特寫的裁切
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'tests', 'fixtures', 'dealer_art');
const TARGET = path.join(__dirname, '..', 'app', 'js', 'view', 'dealer_art.js');
const OUT = path.join(__dirname, '_shots');
const MOODS = ['idle', 'deal', 'surprised', 'smile', 'sorry'];
const VB = [560, 520];          // 立牌座標，跟 dealer.js 的 VB_W、VB_H 一樣
// 貼圖像素：直式手機上立牌約 690×640 個裝置像素（390 寬、畫布密度上限 2），840×780 夠用還留一點給大特寫。
// 舊版 JOJO 烘焙圖是 1120×1040，五張解碼後約 23 MB；這個尺寸約 13 MB
const TEX = [840, 780];
const QUALITY = 0.85;
// 五官在原圖的位置（原圖像素 [左, 上, 右, 下]：眉毛上緣到下唇、兩眼外側），2026-11-18 照 10 像素格線逐張量，
// 對照圖上洋紅框要框住眉眼嘴。大特寫的大字不准壓到這一塊（tests/check_ui_text.js 的 BJK-04）
const FEATURES = {
  idle: [430, 188, 602, 320],
  deal: [430, 193, 602, 324],
  surprised: [438, 173, 600, 334],
  smile: [418, 184, 575, 327],
  sorry: [435, 217, 600, 345],
};
// 大特寫裁一塊正方形（原圖像素），以五官為中心；五張用同一個大小，換表情時臉在圈裡一樣大。
// 邊長取五官平均寬的 2.07 倍，臉在圈裡跟 v0.20.0 的西裝荷官一樣大（那時 480 對五官平均寬 232）
const CROP = 344;

// 原圖與這支的內容一起算雜湊，寫進產出檔；tests/check_dealer.js 拿同一支比對，對不上就是改了沒重跑
function sourceHash({ script = fs.readFileSync(__filename, 'utf8'), dir = SRC } = {}) {
  const h = crypto.createHash('sha256').update(script.replace(/\r\n/g, '\n'));
  for (const m of MOODS) h.update(m).update(fs.readFileSync(path.join(dir, `${m}.webp`)));
  return h.digest('hex').slice(0, 16);
}

// 在頁面裡跑：找臉、量頭頂、縮圖、畫對照圖
const work = (dataUrl, cfg) => `(async () => {
  const CFG = ${JSON.stringify(cfg)};
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('原圖載不進來')); img.src = ${JSON.stringify(dataUrl)}; });
  const N = img.naturalWidth;
  if (img.naturalHeight !== N) throw new Error('原圖不是正方形：' + N + '×' + img.naturalHeight);
  const t0 = performance.now();
  const full = document.createElement('canvas'); full.width = N; full.height = N;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0);
  const p = fctx.getImageData(0, 0, N, N).data;

  // 臉：亮、偏橘的皮膚色，隔一格取樣，取五官框裡佔最多的那一塊連通區域。不取整張最大的一塊：
  // 露肩、露手臂的造型（2026-11-18 旗袍荷官）最大塊是手臂。舉到臉旁的手被輪廓線隔開，連不進來
  const [ex0, ey0, ex1, ey1] = CFG.features;
  const h = N >> 1, skin = new Uint8Array(h * h), seen = new Uint8Array(h * h), stack = new Int32Array(h * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
    const o = (y * 2 * N + x * 2) * 4, r = p[o], g = p[o + 1], b = p[o + 2];
    skin[y * h + x] = p[o + 3] > 200 && r > 215 && g > 150 && g < 228 && b > 100 && b < 200 && r - b > 45 && r - g > 15 ? 1 : 0;
  }
  let face = null;
  for (let s = 0; s < h * h; s++) {
    if (!skin[s] || seen[s]) continue;
    let top = 0, area = 0, inF = 0, x0 = h, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top], x = i % h, y = (i - x) / h;
      area++;
      if (x * 2 >= ex0 && x * 2 < ex1 && y * 2 >= ey0 && y * 2 < ey1) inF++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < h - 1 ? i + 1 : -1, i - h, i + h]) {
        if (j >= 0 && j < h * h && skin[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
      }
    }
    if (!face || inF > face.inF) face = { area: area * 4, inF, box: [x0 * 2, y0 * 2, x1 * 2 + 1, y1 * 2 + 1] };
  }
  face.cover = +(face.inF * 4 / ((ex1 - ex0) * (ey1 - ey0))).toFixed(3);
  // 頭：臉加五官的外框（側臉時遠側的眼睛被頭髮圍住，皮膚色量不到），頂端拉到頭髮的頂：
  // 那幾欄由上往下，第一列有一成以上不透明的就是（零星翹起的髮絲不算）
  const fx0 = Math.min(face.box[0], CFG.features[0]), fx1 = Math.max(face.box[2], CFG.features[2]);
  let hairTop = 0;
  for (let y = 0; y < N; y++) {
    let n = 0;
    for (let x = fx0; x <= fx1; x++) if (p[(y * N + x) * 4 + 3] > 128) n++;
    if (n >= (fx1 - fx0) * 0.1) { hairTop = y; break; }
  }
  const measureMs = Math.round(performance.now() - t0);

  // 縮成正方形貼在立牌比例的畫布正中央，左右是透明邊
  const [TW, TH] = CFG.tex;
  const bmp = await createImageBitmap(img, { resizeWidth: TH, resizeHeight: TH, resizeQuality: 'high' });
  const tex = document.createElement('canvas'); tex.width = TW; tex.height = TH;
  tex.getContext('2d').drawImage(bmp, (TW - TH) / 2, 0);
  const webp = tex.toDataURL('image/webp', CFG.quality);
  const back = new Image();
  const d0 = performance.now();
  back.src = webp;
  await back.decode();
  const decodeMs = Math.round(performance.now() - d0);

  // 對照圖：原圖縮一半，底色用識別色深藍灰
  const head = [fx0, hairTop, fx1, Math.max(face.box[3], CFG.features[3])];
  const sheet = document.createElement('canvas'); sheet.width = N / 2; sheet.height = N / 2;
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#212C31'; sc.fillRect(0, 0, N / 2, N / 2);
  sc.drawImage(img, 0, 0, N / 2, N / 2);
  sc.lineWidth = 3;
  for (const [b, color] of [[face.box, '#ff8c00'], [head, '#00e5e5'], [CFG.features, '#ff00ff'], [CFG.crop, '#ffd400']]) {
    sc.strokeStyle = color;
    sc.strokeRect(b[0] / 2, b[1] / 2, (b[2] - b[0]) / 2, (b[3] - b[1]) / 2);
  }
  return { N, face, head, webp, measureMs, decodeMs, size: [back.naturalWidth, back.naturalHeight], sheet: sheet.toDataURL('image/png') };
})()`;

const inside = (a, b, pad) => a[0] >= b[0] - pad && a[1] >= b[1] - pad && a[2] <= b[2] + pad && a[3] <= b[3] + pad;

async function main() {
  const { availableBrowsers, withPage } = require('../tests/browser_util');
  fs.mkdirSync(OUT, { recursive: true });
  const b64 = d => Buffer.from(d.split(',')[1], 'base64');
  const r = await withPage(availableBrowsers()[0], { size: [1280, 720], mobile: false }, async page => {
    const got = {};
    for (const m of MOODS) {
      const f = FEATURES[m], cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
      const crop = [cx - CROP / 2, cy - CROP / 2, cx + CROP / 2, cy + CROP / 2].map(Math.round);
      const src = 'data:image/webp;base64,' + fs.readFileSync(path.join(SRC, `${m}.webp`)).toString('base64');
      got[m] = { ...await page.evaluate(work(src, { tex: TEX, quality: QUALITY, features: f, crop }), 60000), crop };
      fs.writeFileSync(path.join(OUT, `art-${m}-marks.png`), b64(got[m].sheet));
    }
    return got;
  });
  for (const line of r.console) console.log(`  主控台：${line}`);
  const got = r.value;

  // 原圖像素 → 立牌座標：正方形縮到立牌的高，左右各補 (寬 − 高) / 2
  const marks = {};
  for (const m of MOODS) {
    const g = got[m], k = VB[1] / g.N, off = (VB[0] - VB[1]) / 2;
    const to = ([x0, y0, x1, y1]) => [x0 * k + off, y0 * k, x1 * k + off, y1 * k].map(v => +v.toFixed(1));
    if (!inside(FEATURES[m], g.face.box, 60)) throw new Error(`${m}：五官 ${FEATURES[m]} 不在找到的臉 ${g.face.box} 裡，原圖換過就重量 FEATURES`);
    if (g.face.cover < 0.4) throw new Error(`${m}：找到的臉只佔五官框的 ${g.face.cover}，皮膚色的門檻可能不適用這張圖，或 FEATURES 沒框在臉上`);
    const c = to(g.crop);
    marks[m] = { head: to(g.head), face: to(FEATURES[m]), crop: [c[0], c[1], +(c[2] - c[0]).toFixed(1)] };
    const kb = Math.round(b64(g.webp).length / 1024);
    console.log(`${m}：臉 ${g.face.box.join(',')}（佔五官框 ${g.face.cover}）、頭頂 ${g.head[1]}（原圖像素）；貼圖 ${g.size.join('×')}、WebP ${kb} KB；量測 ${g.measureMs} ms、解碼 ${g.decodeMs} ms`);
  }

  const js = `// 由 tools/make_dealer_art.js 產生，不准手改：荷官五種表情的點陣插畫（WebP，${TEX.join('×')}，品質 ${QUALITY}）。
// 原圖在 tests/fixtures/dealer_art/。走 data: URL 是因為 file:// 下外部圖檔上傳 WebGL 會被當成跨來源擋掉（2026-11-07 Edge 實測 SecurityError）。
// source 是原圖與產生器的雜湊：換了原圖或改了產生器卻沒重跑，tests/check_dealer.js 會紅。
// marks 是立牌座標（${VB.join('×')}）：head＝臉加頭髮 [左, 上, 右, 下]，對白泡泡避開它；face＝五官；crop＝大特寫 [左, 上, 邊長]
(function () {
  const V = window.BJK.view;
  V.dealerArt = {
    source: '${sourceHash()}',
    size: ${JSON.stringify(TEX)},
    marks: {
${MOODS.map(m => `      ${m}: ${JSON.stringify(marks[m])},`).join('\n')}
    },
    images: {
${MOODS.map(m => `      ${m}: '${got[m].webp}',`).join('\n')}
    },
  };
})();
`;
  fs.writeFileSync(TARGET, js);
  const bin = MOODS.reduce((s, m) => s + b64(got[m].webp).length, 0);
  console.log(`✔ 寫入 ${path.relative(process.cwd(), TARGET)}：${Math.round(Buffer.byteLength(js) / 1024)} KB（WebP 本身 ${Math.round(bin / 1024)} KB）；` +
    `五張解碼後 ${(TEX[0] * TEX[1] * 4 * MOODS.length / 1e6).toFixed(1)} MB；對照圖在 ${path.relative(process.cwd(), OUT)}\\art-<表情>-marks.png`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { MOODS, TEX, SRC, TARGET, sourceHash };
