// 把兩套荷官的點陣插畫（tests/fixtures/<套的資料夾>/<表情>.webp，正方形、背景透明、下半身被底邊截掉）
// 縮成立牌的比例（560:520，左右補透明邊），兩套一起寫進 app/js/view/dealer_art.js（不准手改）。
// 換了任何一套的原圖、改了這支的任何一行就重跑：node tools/make_dealer_art.js
// 另外在 tools/_shots/art-<套>-<表情>-marks.png 留量測對照圖（不進版控）：橘框是找到的臉、青框是對白泡泡避開的頭、
// 洋紅框是五官、黃框是大特寫的裁切；有前景層的那張另留 art-<套>-<表情>-front-marks.png，洋紅線是前景層的多邊形（右邊放大、多邊形外壓暗）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures');
const TARGET = path.join(__dirname, '..', 'app', 'js', 'view', 'dealer_art.js');
const OUT = path.join(__dirname, '_shots');
const MOODS = ['idle', 'deal', 'surprised', 'smile', 'sorry'];
const VB = [560, 520];          // 立牌座標，跟 dealer.js 的 VB_W、VB_H 一樣
// 貼圖像素：直式手機上立牌約 690×640 個裝置像素（390 寬、畫布密度上限 2），840×780 夠用還留一點給大特寫。
// 舊版 JOJO 烘焙圖是 1120×1040，五張解碼後約 23 MB；這個尺寸約 13 MB。兩套同一個大小：解析度照畫面推，跟原圖大小無關
const TEX = [840, 780];
const QUALITY = 0.85;

// 每套的手量數值。features：五官在原圖的位置（原圖像素 [左, 上, 右, 下]：眉毛上緣到下唇、兩眼外側），對照圖上洋紅框要框住眉眼嘴，
// 大特寫的大字不准壓到這一塊（tests/check_ui_text.js 的 BJK-04）。crop：大特寫裁的正方形邊長（原圖像素），以五官為中心、五張一樣大。
// pick：臉取哪一塊皮膚色連通區域。front：前景層的多邊形（原圖像素），只有量了的表情才有
const SETS = {
  // 西裝男荷官（v0.20.0，1254×1254、腰部以下被底邊截掉）：數值照 945ceea^ 的版本原樣搬回來
  suit: {
    dir: 'dealer_art',
    // 2026-11-16 照 50 像素格線逐張量；這套每種表情的頭擺的位置都不同（驚訝偏右、遺憾偏低）
    features: {
      idle: [640, 170, 830, 390],
      deal: [700, 320, 945, 520],
      surprised: [685, 285, 935, 525],
      smile: [555, 195, 790, 395],
      sorry: [460, 415, 700, 640],
    },
    crop: 480,
    // 整張最大的一塊：沒露肩、沒露手臂，脖子、手被陰影線切開，手套是白的不算
    pick: 'largest',
    front: {},
  },
  // 旗袍女荷官（v0.23.0，1024×1024、腰到臀部之間被底邊截掉）
  qipao: {
    dir: 'dealer_art_qipao',
    // 2026-11-18 照 10 像素格線逐張量
    features: {
      idle: [430, 188, 602, 320],
      deal: [430, 193, 602, 324],
      surprised: [438, 173, 600, 334],
      smile: [418, 184, 575, 327],
      sorry: [435, 217, 600, 345],
    },
    // 五官平均寬（166）的 2.07 倍，臉在圈裡跟西裝那套一樣大（480 對五官平均寬 232）
    crop: 344,
    // 五官框裡佔最多的那一塊：露肩、露手臂，整張最大的一塊是手臂。舉到臉旁的手被輪廓線隔開，連不進來
    pick: 'features',
    // 桌機上發牌那張伸出來的手和牌被籌碼架擋掉（v0.23.0 第 4.4 條），把手臂、手、牌從本體挖出來另貼一層、畫在籌碼架前面。
    // 2026-11-18 手量：上緣橫切前臂（第 590 列，桌機與橫式手機籌碼架只擋到約第 730 列以下，切線看不到），
    // 右緣沿手指外緣、拇指、牌的米白邊外 3 像素（牌外是黑旗袍），下緣切在牌底的黑描邊下（第 883 列起是旗袍）；左邊是透明背景。
    // 身體不挖：挖了整個上半身會蓋住籌碼架。西裝那套沒做：使用者只要旗袍有（2026-11-18）
    front: {
      deal: [[236, 590], [392, 590], [412, 615], [419, 640], [421, 684], [446, 686], [448, 724], [466, 726], [471, 728], [472, 732],
             [520, 870], [519, 877], [516, 883], [236, 883]],
    },
  },
};
const SET_NAMES = Object.keys(SETS);
const srcOf = name => path.join(FIXTURES, SETS[name].dir);
// 前景層從本體解碼後的像素挖出來再壓一次。2026-11-18 量：無損 278 KB，0.95 只要 17 KB、跟本體平均差 2.6（255 級）；
// 原圖的人本來就只有 250 上下的不透明度，無損也做不到逐像素一樣（平均差 0.8）。差到平均 5 以上就是挖錯位置或挖錯圖
const FRONT_QUALITY = 0.95;
const FRONT_MAX_MEAN_DIFF = 5;
// 上緣（橫切前臂那一刀）往下羽化這麼多原圖像素：硬切的話，有損壓縮在透明與不透明的交界起漣漪，
// 桌機上量到切線那一列差到 32 級（255 級），在沒被擋的前臂上是一條看得到的線
const FRONT_FEATHER = 24;

// 兩套原圖與這支的內容一起算雜湊，寫進產出檔；tests/check_dealer_art.js 拿同一支比對，對不上就是改了沒重跑。
// dirs：{ 套: 資料夾 }，測試拿暫存複本換掉某一套
function sourceHash({ script = fs.readFileSync(__filename, 'utf8'), dirs = {} } = {}) {
  const h = crypto.createHash('sha256').update(script.replace(/\r\n/g, '\n'));
  for (const s of SET_NAMES) for (const m of MOODS) h.update(`${s}/${m}`).update(fs.readFileSync(path.join(dirs[s] || srcOf(s), `${m}.webp`)));
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

  // 臉：亮、偏橘的皮膚色，隔一格取樣的連通區域；取哪一塊照套給的 pick（largest＝整張最大，features＝五官框裡佔最多）
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
    const better = !face || (CFG.pick === 'largest' ? area * 4 > face.area : inF > face.inF);
    if (better) face = { area: area * 4, inF, box: [x0 * 2, y0 * 2, x1 * 2 + 1, y1 * 2 + 1] };
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

  // 前景層：從解碼回來的本體挖（不是從原圖），疊上去跟本體同一份像素
  let front = null;
  if (CFG.front) {
    const k = TH / N, off = (TW - TH) / 2;
    const path = (ctx, f, fresh = true) => { if (fresh) ctx.beginPath(); CFG.front.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](...f(x, y))); ctx.closePath(); };
    const fc = document.createElement('canvas'); fc.width = TW; fc.height = TH;
    const fx = fc.getContext('2d', { willReadFrequently: true });
    path(fx, (x, y) => [x * k + off, y * k]);
    fx.clip();
    fx.drawImage(back, 0, 0);
    const top = Math.min(...CFG.front.map(p => p[1])) * k, fade = fx.createLinearGradient(0, top, 0, top + CFG.feather * k);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
    fx.globalCompositeOperation = 'destination-in';
    fx.fillStyle = fade;
    fx.fillRect(0, 0, TW, TH);
    const url = fc.toDataURL('image/webp', CFG.frontQuality);
    // 自檢：解回來在多邊形裡完全不透明的像素，要跟本體一模一樣
    const fb = new Image(); fb.src = url; await fb.decode();
    const rd = src => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0); return x.getImageData(0, 0, TW, TH).data; };
    const a = rd(fb), b = rd(back);
    let solid = 0, same = 0, shown = 0, worst = 0, sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3]) shown++;
      if (a[i + 3] >= 240 && b[i + 3] >= 240) {
        solid++;
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
        if (d <= 2) same++;
        worst = Math.max(worst, d); sum += d;
      }
    }
    // 對照圖：左邊原圖縮一半畫多邊形，右邊多邊形那一塊放大 1.5 倍、多邊形外壓暗，看切線有沒有切到牌或手指
    const [bx0, by0, bx1, by1] = [Math.min(...CFG.front.map(p => p[0])) - 24, Math.min(...CFG.front.map(p => p[1])) - 24,
                                   Math.max(...CFG.front.map(p => p[0])) + 24, Math.max(...CFG.front.map(p => p[1])) + 24];
    const z = 1.5, pw = Math.round((bx1 - bx0) * z), ph = Math.round((by1 - by0) * z);
    const fm = document.createElement('canvas'); fm.width = N / 2 + pw; fm.height = Math.max(N / 2, ph);
    const mc = fm.getContext('2d');
    mc.fillStyle = '#212C31'; mc.fillRect(0, 0, fm.width, fm.height);
    mc.drawImage(img, 0, 0, N / 2, N / 2);
    mc.drawImage(img, bx0, by0, bx1 - bx0, by1 - by0, N / 2, 0, pw, ph);
    mc.save();
    mc.beginPath(); mc.rect(N / 2, 0, pw, ph);
    path(mc, (x, y) => [N / 2 + (x - bx0) * z, (y - by0) * z], false);
    mc.fillStyle = 'rgba(33, 44, 49, 0.7)'; mc.fill('evenodd');
    mc.restore();
    mc.lineWidth = 2; mc.strokeStyle = '#ff00ff';
    path(mc, (x, y) => [x / 2, y / 2]); mc.stroke();
    path(mc, (x, y) => [N / 2 + (x - bx0) * z, (y - by0) * z]); mc.stroke();
    front = { url, solid, same, shown, worst, mean: +(sum / solid).toFixed(2), sheet: fm.toDataURL('image/png') };
  }

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
  return { N, face, head, webp, front, measureMs, decodeMs, size: [back.naturalWidth, back.naturalHeight], sheet: sheet.toDataURL('image/png') };
})()`;

const inside = (a, b, pad) => a[0] >= b[0] - pad && a[1] >= b[1] - pad && a[2] <= b[2] + pad && a[3] <= b[3] + pad;

async function main() {
  const { availableBrowsers, withPage } = require('../tests/browser_util');
  fs.mkdirSync(OUT, { recursive: true });
  const b64 = d => Buffer.from(d.split(',')[1], 'base64');
  const r = await withPage(availableBrowsers()[0], { size: [1280, 720], mobile: false }, async page => {
    const got = {};
    for (const s of SET_NAMES) {
      const set = SETS[s];
      got[s] = {};
      for (const m of MOODS) {
        const f = set.features[m], cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
        const crop = [cx - set.crop / 2, cy - set.crop / 2, cx + set.crop / 2, cy + set.crop / 2].map(Math.round);
        const src = 'data:image/webp;base64,' + fs.readFileSync(path.join(srcOf(s), `${m}.webp`)).toString('base64');
        const cfg = { tex: TEX, quality: QUALITY, features: f, crop, pick: set.pick, front: set.front[m], frontQuality: FRONT_QUALITY, feather: FRONT_FEATHER };
        const g = got[s][m] = { ...await page.evaluate(work(src, cfg), 60000), crop };
        fs.writeFileSync(path.join(OUT, `art-${s}-${m}-marks.png`), b64(g.sheet));
        if (g.front) fs.writeFileSync(path.join(OUT, `art-${s}-${m}-front-marks.png`), b64(g.front.sheet));
      }
    }
    return got;
  });
  for (const line of r.console) console.log(`  主控台：${line}`);
  const got = r.value;

  // 原圖像素 → 立牌座標：正方形縮到立牌的高，左右各補 (寬 − 高) / 2
  const marks = {};
  for (const s of SET_NAMES) {
    const set = SETS[s];
    marks[s] = {};
    for (const m of MOODS) {
      const g = got[s][m], k = VB[1] / g.N, off = (VB[0] - VB[1]) / 2, f = set.features[m], tag = `${s}／${m}`;
      const to = ([x0, y0, x1, y1]) => [x0 * k + off, y0 * k, x1 * k + off, y1 * k].map(v => +v.toFixed(1));
      if (!inside(f, g.face.box, 60)) throw new Error(`${tag}：五官 ${f} 不在找到的臉 ${g.face.box} 裡，原圖換過就重量 features`);
      if (set.pick === 'largest' && g.face.area < g.N * g.N * 0.02) throw new Error(`${tag}：找到的臉只有 ${g.face.area} 像素，皮膚色的門檻可能不適用這張圖`);
      if (set.pick === 'features' && g.face.cover < 0.4) throw new Error(`${tag}：找到的臉只佔五官框的 ${g.face.cover}，皮膚色的門檻可能不適用這張圖，或 features 沒框在臉上`);
      const c = to(g.crop);
      marks[s][m] = { head: to(g.head), face: to(f), crop: [c[0], c[1], +(c[2] - c[0]).toFixed(1)] };
      const kb = Math.round(b64(g.webp).length / 1024);
      console.log(`${tag}：原圖 ${g.N}×${g.N}，臉 ${g.face.box.join(',')}（佔五官框 ${g.face.cover}）、頭頂 ${g.head[1]}（原圖像素）；貼圖 ${g.size.join('×')}、WebP ${kb} KB；量測 ${g.measureMs} ms、解碼 ${g.decodeMs} ms`);
      if (g.front) {
        const { solid, same, shown, worst, mean } = g.front;
        if (!solid || mean > FRONT_MAX_MEAN_DIFF) throw new Error(`${tag}：前景層跟本體平均差 ${mean}（${solid} 個不透明像素），疊上去會看到切線，多邊形或座標換算有誤`);
        console.log(`  前景層：WebP ${Math.round(b64(g.front.url).length / 1024)} KB（品質 ${FRONT_QUALITY}），看得到的 ${shown} 像素（佔貼圖 ${(shown / TEX[0] / TEX[1] * 100).toFixed(1)}%）；不透明的 ${solid} 像素跟本體差 2 以內的 ${same} 個，最大差 ${worst}、平均 ${mean}`);
      }
    }
  }

  const setJs = s => `      ${s}: {
        marks: {
${MOODS.map(m => `          ${m}: ${JSON.stringify(marks[s][m])},`).join('\n')}
        },
        images: {
${MOODS.map(m => `          ${m}: '${got[s][m].webp}',`).join('\n')}
        },
        front: {
${MOODS.filter(m => got[s][m].front).map(m => `          ${m}: '${got[s][m].front.url}',`).join('\n')}
        },
      },`;
  const js = `// 由 tools/make_dealer_art.js 產生，不准手改：兩套荷官（${SET_NAMES.join('、')}）五種表情的點陣插畫（WebP，${TEX.join('×')}，品質 ${QUALITY}）。
// 原圖在 ${SET_NAMES.map(s => `tests/fixtures/${SETS[s].dir}/`).join('、')}。走 data: URL 是因為 file:// 下外部圖檔上傳 WebGL 會被當成跨來源擋掉（2026-11-07 Edge 實測 SecurityError）。
// source 是兩套原圖與產生器的雜湊：換了原圖或改了產生器卻沒重跑，tests/check_dealer_art.js 會紅。
// marks 是立牌座標（${VB.join('×')}）：head＝臉加頭髮 [左, 上, 右, 下]，對白泡泡避開它；face＝五官；crop＝大特寫 [左, 上, 邊長]
// front 是前景層（同大小、其餘透明，品質 ${FRONT_QUALITY}）：只有量了多邊形的表情才有，dealer.js 畫在籌碼架前面
(function () {
  const V = window.BJK.view;
  V.dealerArt = {
    source: '${sourceHash()}',
    size: ${JSON.stringify(TEX)},
    sets: {
${SET_NAMES.map(setJs).join('\n')}
    },
  };
})();
`;
  fs.writeFileSync(TARGET, js);
  for (const s of SET_NAMES) {
    const bin = MOODS.reduce((n, m) => n + b64(got[s][m].webp).length + (got[s][m].front ? b64(got[s][m].front.url).length : 0), 0);
    const count = MOODS.length + Object.keys(SETS[s].front).length;
    console.log(`${s}：WebP ${Math.round(bin / 1024)} KB；五張${count > MOODS.length ? '加前景層' : ''}解碼後 ${(TEX[0] * TEX[1] * 4 * count / 1e6).toFixed(1)} MB（同時只解碼一套）`);
  }
  console.log(`✔ 寫入 ${path.relative(process.cwd(), TARGET)}：${Math.round(Buffer.byteLength(js) / 1024)} KB；對照圖在 ${path.relative(process.cwd(), OUT)}\\art-<套>-<表情>-marks.png`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { MOODS, TEX, SETS, SET_NAMES, srcOf, TARGET, sourceHash };
