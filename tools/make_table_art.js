// 把牌桌上的點陣插畫（tests/fixtures/ 底下的 card_art、chip_art、room_art、scene_art、prop_art）縮成貼圖要的大小，
// 寫成 app/js/view/table_art.js（不准手改）。換了原圖、改了這支的任何一行就重跑：node tools/make_table_art.js
// 另外在 tools/_shots/ 留量測對照圖（不進版控）：table-art-marks.png 標籌碼的盤面（橘）、中央空白（青）、取樣邊環（洋紅）與嵌片方位（黃）、
// 牌背中央的圓（青）、大廳的牆線（橘）與構圖中心（青）；scene-art-tiles.png 是佈景五張產出各自平鋪 2×2，看接縫；prop-art-marks.png 是發牌盒原圖拿掉的列（紅）與拼好的那張（青框）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIX = path.join(__dirname, '..', 'tests', 'fixtures');
const DIRS = ['card_art', 'chip_art', 'room_art', 'scene_art', 'prop_art'];
const TARGET = path.join(__dirname, '..', 'app', 'js', 'view', 'table_art.js');
const OUT = path.join(__dirname, '_shots');
const COURTS = ['king_red', 'queen_red', 'jack_red', 'king_black', 'queen_black', 'jack_black'];
const CHIPS = [5, 25, 100, 500, 1000];
// 牌面貼圖 256×358（textures.js 的 CW、CH）。人物框 224×336 是原圖的 2:3，左右留 16、上下留 11 給牌緣。
// 牌在手機上約 55 CSS 像素寬、桌機約 70：畫布密度上限 2、雙指放大到頂也不到 256 個裝置像素，牌面貼圖不必加大
const CARD = [256, 358];
const COURT = [224, 336];
const CHIP = 256;
// 大廳最寬的畫面是 2560 寬的超寬螢幕，但那張是失焦的照片，放大看不出差別；1280 寬檔案小、解碼後少一半記憶體
const LOBBY_W = 1280;
// 大廳的構圖中心（原圖像素的列）：吃角子老虎那一排的中間，2026-11-16 照對照圖手量。桌機那一帶很矮，只看得到中心附近，
// 照亮度算的重心（約 208）落在水晶燈下緣，看到的老虎機只剩上半截
const LOBBY_FOCUS = 300;
const QUALITY = 0.85;

// 佈景五張材質（scene_art）：都會平鋪，產出的大小照畫面上一個重複單位最多佔的裝置像素推（2026-11-18 量，見 docs\版本紀錄.md v0.22.0）。
// region 是原圖可用的範圍：有透明度的三張最外一圈 alpha 只有 193～254，去掉兩像素；fade 是接縫不夠平時交疊的寬度（產出像素）。
// carpet：原圖是同一塊花磚的 2×2，平移 512 的落差跟相鄰像素同一級，原寸裁一塊 512 就是一格（room.js 一格 400/140 單位，平板最多佔 435 裝置像素）；
// felt：只取明暗，原樣 1:1 鋪進絨布畫布（每單位 205 像素，畫面最多 153）；
// leather：扶手一個重複 1.34×1.38 單位（弧長 π·5.12 分 12 段×管的一圈），平板最多 199×218；
// wood：桌身一個重複 2.72×0.7 單位，平板最寬 379、超寬螢幕最高 55，跟原本的畫布一樣 512×128；
// wall：鑲板並排兩塊組成一段 4×1.3 單位（room.js），平板最寬 424、超寬螢幕最高 106。
// quality：暗、起伏小的會被 0.85 壓平，接縫兩邊各自的壓縮誤差反而變成一條線。2026-11-18 量解回來的接縫（P99 是內部的範圍）：
// 木頭 0.85 是 5.1 倍（P99 2.32）、0.95 是 2.64（2.68）、0.98 是 1.55（1.51），只有 1 才穩（1.05，1.2）；絨布 0.85 剛好壓線（1.16，1.16），給 0.9
const SCENE = {
  carpet: { out: [512, 512], scale: 1, region: [2, 2, 1020, 1020], wrap: [1, 1], fade: [64, 64], quality: QUALITY },
  felt: { out: [512, 512], region: [2, 2, 1020, 1020], wrap: [1, 1], fade: [64, 64], gray: true, quality: 0.9 },
  leather: { out: [256, 256], region: [2, 2, 1020, 1020], wrap: [1, 1], fade: [32, 32], quality: 0.95 },
  wood: { out: [512, 128], region: [0, 0, 1536, 1024], wrap: [1, 0], fade: [64, 0], quality: 1 },
  wall: { out: [512, 166], panels: 2, segment: [4, 1.3], quality: 0.95 },
};
const SCENE_NAMES = Object.keys(SCENE);

// 道具（prop_art）：發牌盒三面拼成一張、絨布紋章。
// 發牌盒是 table.js 的 0.66×0.34×0.95 盒子，GPT 只出 3:2，所以拿掉素面皮革的那幾列（欄）湊成那一面的比例，金邊與圖案原樣留著。
// keep 是留下的原圖列（欄）區間，2026-11-19 照原圖手量（金邊在最外 2～12 像素、黑桃 448～563 列、出牌口 639～738 列），
// 拿掉的範圍裡有金色或黑色就擲錯（換了圖要重量），對照圖 tools/_shots/prop-art-marks.png。
// 一面每單位 256 像素：發牌盒在平板上一單位最多約 150 裝置像素（跟絨布同一個距離），拼成 512×256 一張，每塊外圍外推 4 像素擋 mipmap 滲色
const SHOE = {
  box: { x: 0.66, y: 0.34, z: 0.95 }, density: 256, atlas: [512, 256], pad: 4,
  faces: {
    side: { src: 'shoe_side', rows: [[0, 14], [244, 766], [1010, 1024]], at: [4, 4], dims: ['z', 'y'] },
    front: { src: 'shoe_front', rows: [[0, 20], [253, 1024]], at: [4, 99], dims: ['x', 'y'] },
    // 頂面拿側板去掉黑桃的那一段（只剩素面與金邊），拿掉的本來就有圖案，不檢查
    top: { src: 'shoe_side', cols: [[0, 698], [1522, 1536]], at: [259, 4], dims: ['x', 'z'], dropsMotif: true },
  },
};
// 紋章：只取形狀（亮度當不透明度），textures.js 用絨布上金線同一層燙金畫在荷官的牌底下，高 0.78 單位＝絨布畫布約 160 像素，產出 240 高留點餘裕
const EMBLEM_H = 240;

// 原圖與這支的內容一起算雜湊，寫進產出檔；tests/check_table_art.js 拿同一支比對，對不上就是改了沒重跑
function sourceHash({ script = fs.readFileSync(__filename, 'utf8'), dir = FIX } = {}) {
  const h = crypto.createHash('sha256').update(script.replace(/\r\n/g, '\n'));
  for (const d of DIRS) {
    for (const f of fs.readdirSync(path.join(dir, d)).filter(n => n.endsWith('.webp')).sort()) {
      h.update(`${d}/${f}`).update(fs.readFileSync(path.join(dir, d, f)));
    }
  }
  return h.digest('hex').slice(0, 16);
}

// 頁面裡共用：載圖、轉 WebP、量解碼時間
const HELPERS = `
  const load = src => new Promise((ok, bad) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => bad(new Error('原圖載不進來')); img.src = src; });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const lum = (p, o) => 0.2126 * p[o] + 0.7152 * p[o + 1] + 0.0722 * p[o + 2];
  const hex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  async function encode(c, q) {
    const url = c.toDataURL('image/webp', q);
    const back = new Image(); back.src = url;
    const t = performance.now(); await back.decode();
    return { url, decodeMs: +(performance.now() - t).toFixed(1), size: [back.naturalWidth, back.naturalHeight] };
  }`;

// J、Q、K：左右鏡像（原圖的武器、花拿在左上與右下，正好是角標的位置；鏡像後那兩角是素底）再縮成人物框
const courtWork = (src, cfg) => `(async () => {
  ${HELPERS}
  const CFG = ${JSON.stringify(cfg)};
  const img = await load(${JSON.stringify(src)});
  if (img.naturalWidth * 3 !== img.naturalHeight * 2) throw new Error('人物原圖不是 2:3：' + img.naturalWidth + '×' + img.naturalHeight);
  const [w, h] = CFG.court;
  const bmp = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(bmp, 0, 0);
  return encode(c, CFG.quality);
})()`;

// 牌背：整張縮成牌的大小（原圖 2:3、牌 256:358，橫向多拉 7%；裁上下會切掉金框）。量中央那個空圓，程式在裡面寫 21
const backWork = (src, cfg) => `(async () => {
  ${HELPERS}
  const CFG = ${JSON.stringify(cfg)};
  const img = await load(${JSON.stringify(src)});
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = canvas(W, H), fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0);
  const p = fctx.getImageData(0, 0, W, H).data;
  // 從正中央往上下左右走，碰到第一圈金框就是空圓的邊
  const hit = (dx, dy) => { let x = W >> 1, y = H >> 1, n = 0; while (lum(p, (y * W + x) * 4) < 110 && n < W / 2) { x += dx; y += dy; n++; } return [x, y]; };
  const [l] = hit(-1, 0), [r] = hit(1, 0), [, t] = hit(0, -1), [, b] = hit(0, 1);
  const [cw, ch] = CFG.card, kx = cw / W, ky = ch / H;
  const hole = [(l + r) / 2 * kx, (t + b) / 2 * ky, (r - l) / 2 * kx, (b - t) / 2 * ky].map(v => +v.toFixed(1));
  const bmp = await createImageBitmap(img, { resizeWidth: cw, resizeHeight: ch, resizeQuality: 'high' });
  const c = canvas(cw, ch);
  c.getContext('2d').drawImage(bmp, 0, 0);
  return { ...await encode(c, CFG.quality), hole, src: [W, H], holeSrc: [l, t, r, b] };
})()`;

// 籌碼：透明底上的盤面用不透明像素的面積算圓心與半徑（邊上去背留下的零星雜點不影響），裁成正方形、圓外挖空。
// 量中央空白的半徑（面額字的大小跟著它）、邊環上嵌片的方位與寬度與兩種顏色（側面的條紋要跟頂面對齊、同色）
const chipWork = (src, cfg) => `(async () => {
  ${HELPERS}
  const CFG = ${JSON.stringify(cfg)};
  const img = await load(${JSON.stringify(src)});
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = canvas(W, H), fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0);
  const p = fctx.getImageData(0, 0, W, H).data;
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > 128) { n++; sx += x; sy += y; }
  const cx = sx / n, cy = sy / n, R = Math.sqrt(n / Math.PI);
  const at = (r, a) => (Math.round(cy - r * Math.sin(a)) * W + Math.round(cx + r * Math.cos(a))) * 4;
  // 中央的顏色：0.3R 以內的平均
  const mid = [0, 0, 0]; let m = 0;
  for (let y = Math.round(cy - 0.3 * R); y <= cy + 0.3 * R; y++) for (let x = Math.round(cx - 0.3 * R); x <= cx + 0.3 * R; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > (0.3 * R) ** 2) continue;
    const o = (y * W + x) * 4; mid[0] += p[o]; mid[1] += p[o + 1]; mid[2] += p[o + 2]; m++;
  }
  mid.forEach((v, i) => { mid[i] = v / m; });
  // 中央空白：32 個方向往外走，顏色跟中央差超過 60 的地方；取中位數
  const radii = [];
  for (let k = 0; k < 32; k++) {
    const a = k * Math.PI / 16;
    let r = 0.2 * R;
    for (; r < R; r += 1) { const o = at(r, a); if (Math.hypot(p[o] - mid[0], p[o + 1] - mid[1], p[o + 2] - mid[2]) > 60) break; }
    radii.push(r / R);
  }
  const inner = radii.sort((a, b) => a - b)[16];
  // 邊環：0.9R 上取 1440 點，亮度用大津法分兩群：亮的是嵌片
  const N = 1440, ring = [];
  for (let i = 0; i < N; i++) { const a = i * 2 * Math.PI / N, o = at(0.9 * R, a); ring.push({ a, L: lum(p, o), rgb: [p[o], p[o + 1], p[o + 2]] }); }
  let best = -1, cut = 128;
  for (let t = 20; t < 250; t += 2) {
    const lo = ring.filter(s => s.L < t), hi = ring.filter(s => s.L >= t);
    if (!lo.length || !hi.length) continue;
    const ml = lo.reduce((s, q) => s + q.L, 0) / lo.length, mh = hi.reduce((s, q) => s + q.L, 0) / hi.length;
    const v = lo.length * hi.length * (mh - ml) ** 2;
    if (v > best) { best = v; cut = t; }
  }
  const avg = list => [0, 1, 2].map(i => list.reduce((s, q) => s + q.rgb[i], 0) / list.length);
  const insert = ring.filter(s => s.L >= cut), base = ring.filter(s => s.L < cut);
  // 嵌片八片、每 45 度一片：亮的取樣點對 8 倍角做傅立葉，相位就是第一片的方位（數學方向：0＝右、逆時針為正）
  let re = 0, im = 0;
  for (const s of insert) { re += Math.cos(8 * s.a); im += Math.sin(8 * s.a); }
  const phase = ((Math.atan2(im, re) / 8) * 180 / Math.PI + 45) % 45;
  // 裁成正方形縮到 CHIP，圓外挖空（去背的雜點與半透明毛邊）。半徑往內收 0.5%，貼到圓柱頂上邊緣不會露出底色
  const r0 = R * 0.995;
  const bmp = await createImageBitmap(img, cx - r0, cy - r0, 2 * r0, 2 * r0, { resizeWidth: CFG.chip, resizeHeight: CFG.chip, resizeQuality: 'high' });
  const c = canvas(CFG.chip, CFG.chip), ctx = c.getContext('2d');
  ctx.beginPath(); ctx.arc(CFG.chip / 2, CFG.chip / 2, CFG.chip / 2, 0, 2 * Math.PI); ctx.clip();
  ctx.drawImage(bmp, 0, 0);
  return { ...await encode(c, CFG.quality), disc: [cx, cy, R].map(v => +v.toFixed(1)), inner: +inner.toFixed(3),
    center: hex(mid), base: hex(avg(base)), stripe: hex(avg(insert)), phase: +phase.toFixed(1), duty: +(insert.length / N).toFixed(3) };
})()`;

// 大廳：亮的東西（吃角子老虎、水晶燈）只在上半，往下越來越暗、留給木牆板。量每一列的平均亮度，
// 最後一列還亮過門檻的就是「牆線」：牆的上緣對著這裡，再往下的暗處被牆擋住，裁掉只多留一點
const lobbyWork = (src, cfg) => `(async () => {
  ${HELPERS}
  const CFG = ${JSON.stringify(cfg)};
  const img = await load(${JSON.stringify(src)});
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = canvas(W, H), fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0);
  const p = fctx.getImageData(0, 0, W, H).data;
  const rows = [];
  for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x += 2) s += lum(p, (y * W + x) * 4); rows.push(s / Math.ceil(W / 2)); }
  let wall = H - 1;
  while (wall > 0 && rows[wall] < CFG.dark) wall--;
  const focus = CFG.focus;
  const cut = Math.min(H, wall + CFG.below);
  const h = Math.round(CFG.width * cut / W);
  const bmp = await createImageBitmap(img, 0, 0, W, cut, { resizeWidth: CFG.width, resizeHeight: h, resizeQuality: 'high' });
  const c = canvas(CFG.width, h);
  c.getContext('2d').drawImage(bmp, 0, 0);
  const profile = rows.filter((_, y) => y % 40 === 0).map(v => Math.round(v));
  return { ...await encode(c, CFG.quality), src: [W, H], wallSrc: wall, focusSrc: +focus.toFixed(1), cut,
    wall: +(wall / cut).toFixed(4), focus: +(focus / cut).toFixed(4), profile };
})()`;

// 佈景材質：從原圖裁一塊縮到產出大小，量左右（與上下）接回來那條縫的落差；不夠平就多裁一條 fade 寬，
// 把接在最後一欄後面的那條跟開頭那條交疊（亮度起伏照兩條的相關係數補回來，交疊處不會變糊變平）。
// 牆板是一塊鑲板：照一段的比例並排兩塊，橫向多拉的那一點記下來；接回來那條縫就是兩塊鑲板的接合處，跟一段中間那條同一種
const SEAM_JS = `
  const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  // 每一對相鄰的欄（axis 0）或列（axis 1）算平均亮度差，除以內部全部相鄰對的平均：r 是最後一條接回第一條那一對
  // （at 給了就量 at-1 與 at 那一對，牆板中間的接合處），p99 是內部相鄰對的第 99 百分位。r 不超過 p99 就是圖裡本來就有的落差
  function seam(d, W, H, axis, at) {
    const px = (x, y) => L(d, (y * W + x) * 4), n = axis === 0 ? H : W, len = axis === 0 ? W : H;
    const pair = (i, j) => { let s = 0; for (let k = 0; k < n; k++) s += axis === 0 ? Math.abs(px(i, k) - px(j, k)) : Math.abs(px(k, i) - px(k, j)); return s / n; };
    const inner = [];
    for (let i = 1; i < len; i++) inner.push(pair(i - 1, i));
    const mean = inner.reduce((a, b) => a + b, 0) / inner.length, sorted = inner.map(v => v / mean).sort((a, b) => a - b);
    return { r: +((at ? pair(at - 1, at) : pair(len - 1, 0)) / mean).toFixed(2), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(2) };
  }`;

const sceneWork = (src, cfg) => `(async () => {
  ${HELPERS}
  ${SEAM_JS}
  const CFG = ${JSON.stringify(cfg)};
  const img = await load(${JSON.stringify(src)});
  const IW = img.naturalWidth, IH = img.naturalHeight, [W, H] = CFG.out;
  const pixels = async (sx, sy, sw, sh, w, h) => {
    const bmp = await createImageBitmap(img, sx, sy, sw, sh, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  // 編碼完解回來再量一次：有損壓縮會動到邊上的像素，量的要是畫面真正拿到的那一份
  const done = async (d, w, h, extra, measure) => {
    const c = canvas(w, h);
    c.getContext('2d').putImageData(new ImageData(d, w, h), 0, 0);
    const out = await encode(c, CFG.quality), back = await load(out.url);
    const b = canvas(w, h).getContext('2d', { willReadFrequently: true });
    b.drawImage(back, 0, 0);
    return { ...out, src: [IW, IH], ...extra, ...measure(b.getImageData(0, 0, w, h).data) };
  };

  if (CFG.panels) {
    const pw = W / CFG.panels, d = new Uint8ClampedArray(W * H * 4);
    const one = await pixels(0, 0, IW, IH, pw, H);
    for (let y = 0; y < H; y++) for (let p = 0; p < CFG.panels; p++) d.set(one.subarray(y * pw * 4, (y + 1) * pw * 4), (y * W + p * pw) * 4);
    // 一段在世界裡是 segment 寬高，一塊鑲板佔 1/panels 寬；比原圖的寬高比多出來的就是橫向拉的
    const [sw, sh] = CFG.segment, stretch = (sw / CFG.panels / sh) / (IW / IH) - 1;
    return done(d, W, H, { stretch: +(stretch * 100).toFixed(2) }, e => ({ seam: [seam(e, W, H, 0)], joint: seam(e, W, H, 0, pw) }));
  }

  // 倍率：產出加上交疊那一條要塞得進可用範圍（原寸的不縮）
  const [rx, ry, rw, rh] = CFG.region, [fx, fy] = CFG.fade;
  const k = CFG.scale || Math.max((W + fx) / rw, (H + fy) / rh);
  const crop = (w, h) => { const sw = Math.round(w / k), sh = Math.round(h / k); return [rx + Math.round((rw - sw) / 2), ry + Math.round((rh - sh) / 2), sw, sh]; };
  // 先量不處理的：照產出大小裁、縮
  const plain = await pixels(...crop(W, H), W, H);
  const raw = [0, 1].map(a => CFG.wrap[a] ? seam(plain, W, H, a) : null);
  const need = [0, 1].map(a => CFG.wrap[a] && raw[a].r > raw[a].p99);
  let d = plain;
  if (need[0] || need[1]) {
    const gw = W + (need[0] ? fx : 0), gh = H + (need[1] ? fy : 0);
    d = await pixels(...crop(gw, gh), gw, gh);
    let w = gw, h = gh;
    if (need[0]) { d = fade(d, w, h, 0, fx); w -= fx; }
    if (need[1]) { d = fade(d, w, h, 1, fy); h -= fy; }
  }
  let mean = 0;
  if (CFG.gray) {
    // 絨布只取明暗：每個像素換成灰階 128 × 亮度 ÷ 平均亮度，textures.js 用 overlay 疊上去，128 的地方顏色不變
    for (let i = 0; i < d.length; i += 4) mean += L(d, i);
    mean /= d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const g = 128 * L(d, i) / mean; d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255; }
  }
  return done(d, W, H, { scale: +k.toFixed(4), crop: crop(W, H), raw, faded: need, mean: +mean.toFixed(1) },
    e => ({ seam: [0, 1].map(a => CFG.wrap[a] ? seam(e, W, H, a) : null) }));

  // 交疊：輸出少 w 條；前 w 條由「接在最後一條後面的那條 A」漸變到「開頭那條 B」
  function fade(src, w0, h0, axis, w) {
    const N = (axis === 0 ? w0 : h0) - w, ow = axis === 0 ? N : w0, oh = axis === 0 ? h0 : N;
    const at = (x, y) => (y * w0 + x) * 4;
    const pairs = [];
    for (let y = 0; y < (axis === 0 ? h0 : w); y++) for (let x = 0; x < (axis === 0 ? w : w0); x++) {
      pairs.push(axis === 0 ? [at(x + N, y), at(x, y)] : [at(x, y + N), at(x, y)]);
    }
    const mA = [0, 0, 0], mB = [0, 0, 0];
    for (const [a, b] of pairs) for (let c = 0; c < 3; c++) { mA[c] += src[a + c]; mB[c] += src[b + c]; }
    for (let c = 0; c < 3; c++) { mA[c] /= pairs.length; mB[c] /= pairs.length; }
    const lA = L(mA, 0), lB = L(mB, 0);
    let sab = 0, saa = 0, sbb = 0;
    for (const [a, b] of pairs) { const da = L(src, a) - lA, db = L(src, b) - lB; sab += da * db; saa += da * da; sbb += db * db; }
    const rho = sab / Math.sqrt(saa * sbb);
    const out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const i = axis === 0 ? x : y, o = (y * ow + x) * 4, b = at(x, y);
      if (i >= w) { for (let c = 0; c < 4; c++) out[o + c] = src[b + c]; continue; }
      const t = (i + 0.5) / w, a = axis === 0 ? at(x + N, y) : at(x, y + N);
      const gain = 1 / Math.sqrt((1 - t) ** 2 + t ** 2 + 2 * t * (1 - t) * rho);
      for (let c = 0; c < 3; c++) out[o + c] = (1 - t) * mA[c] + t * mB[c] + ((1 - t) * (src[a + c] - mA[c]) + t * (src[b + c] - mB[c])) * gain;
      out[o + 3] = 255;
    }
    return out;
  }
})()`;

// 發牌盒：每一面照 keep 的列與欄把原圖接起來（沒給的那一向整條留著），縮到那一面的大小貼進拼圖，四邊各外推 pad 像素
const shoeWork = (srcs, cfg) => `(async () => {
  ${HELPERS}
  const CFG = ${JSON.stringify(cfg)}, SRCS = ${JSON.stringify(srcs)};
  const imgs = {};
  for (const [k, u] of Object.entries(SRCS)) imgs[k] = await load(u);
  const [AW, AH] = CFG.atlas, atlas = canvas(AW, AH), actx = atlas.getContext('2d');
  const rects = {}, removed = {};
  for (const [name, f] of Object.entries(CFG.faces)) {
    const img = imgs[f.src], W = img.naturalWidth, H = img.naturalHeight;
    const rows = f.rows || [[0, H]], cols = f.cols || [[0, W]];
    const full = canvas(W, H), fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(img, 0, 0);
    const p = fctx.getImageData(0, 0, W, H).data;
    // 拿掉的列（欄）只能是素面：金色（紅比藍多 50 以上）或黑色（三色道加起來不到 40）都算圖案；最外 20 像素的金邊不算
    const motif = (x, y) => { const o = (y * W + x) * 4; return (p[o] > 120 && p[o] - p[o + 2] > 50) || p[o] + p[o + 1] + p[o + 2] < 40; };
    const gaps = list => { const out = []; let at = 0; for (const [a, b] of list) { if (a > at) out.push([at, a]); at = b; } return out; };
    let hit = 0;
    for (const [a, b] of gaps(rows)) for (let y = a; y < b; y++) for (let x = 20; x < W - 20; x++) if (motif(x, y)) hit++;
    for (const [a, b] of gaps(cols)) for (let x = a; x < b; x++) for (let y = 20; y < H - 20; y++) if (motif(x, y)) hit++;
    if (hit && !f.dropsMotif) throw new Error(name + '：拿掉的範圍裡有 ' + hit + ' 個金色或黑色像素，原圖換過就重量 SHOE 的 keep');
    removed[name] = { rows: gaps(rows), cols: gaps(cols) };
    const sw = cols.reduce((s, [a, b]) => s + b - a, 0), sh = rows.reduce((s, [a, b]) => s + b - a, 0);
    const joined = canvas(sw, sh), jctx = joined.getContext('2d');
    let dy = 0;
    for (const [ya, yb] of rows) { let dx = 0; for (const [xa, xb] of cols) { jctx.drawImage(img, xa, ya, xb - xa, yb - ya, dx, dy, xb - xa, yb - ya); dx += xb - xa; } dy += yb - ya; }
    const [du, dv] = f.dims, w = Math.round(CFG.box[du] * CFG.density), h = Math.round(CFG.box[dv] * CFG.density);
    const want = CFG.box[du] / CFG.box[dv], got = sw / sh;
    if (Math.abs(got / want - 1) > 0.01) throw new Error(name + '：接起來是 ' + sw + '×' + sh + '（' + got.toFixed(3) + '），盒子那一面要 ' + want.toFixed(3));
    const bmp = await createImageBitmap(joined, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const [x, y] = f.at, P = CFG.pad;
    actx.drawImage(bmp, x, y);
    // 外推：最外一列（欄）拉寬蓋到 pad 裡，縮小看的 mipmap 不會混進隔壁那一面或空白
    actx.drawImage(atlas, x, y, w, 1, x, y - P, w, P); actx.drawImage(atlas, x, y + h - 1, w, 1, x, y + h, w, P);
    actx.drawImage(atlas, x, y - P, 1, h + 2 * P, x - P, y - P, P, h + 2 * P); actx.drawImage(atlas, x + w - 1, y - P, 1, h + 2 * P, x + w, y - P, P, h + 2 * P);
    rects[name] = [x, y, w, h];
    for (const [k, r] of Object.entries(rects)) if (k !== name && x < r[0] + r[2] + 2 * P && r[0] < x + w + 2 * P && y < r[1] + r[3] + 2 * P && r[1] < y + h + 2 * P) throw new Error(name + ' 跟 ' + k + ' 在拼圖裡疊到了');
    if (x - P < 0 || y - P < 0 || x + w + P > AW || y + h + P > AH) throw new Error(name + ' 超出拼圖');
  }
  return { ...await encode(atlas, CFG.quality), rects, removed };
})()`;

// 紋章：量亮的地方的外框、四周留 2%，亮度當不透明度、顏色一律白（textures.js 再上燙金）
const emblemWork = (src, cfg) => `(async () => {
  ${HELPERS}
  const CFG = ${JSON.stringify(cfg)};
  const img = await load(${JSON.stringify(src)});
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = canvas(W, H), fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0);
  const p = fctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum(p, (y * W + x) * 4) > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const m = Math.round(0.02 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, h = CFG.height, w = Math.round(h * bw / bh);
  const bmp = await createImageBitmap(img, x0, y0, bw, bh, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) { const a = lum(d.data, i); d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a; }
  ctx.putImageData(d, 0, 0);
  return { ...await encode(c, CFG.quality), box: [x0, y0, bw, bh] };
})()`;

// 道具的對照圖：發牌盒兩張原圖縮四分之一、拿掉的列（欄）蓋紅，旁邊是拼好的那張原寸
const propMarksWork = (items, cfg) => `(async () => {
  ${HELPERS}
  const ITEMS = ${JSON.stringify(items)}, k = 0.25;
  const side = await load(ITEMS.side), front = await load(ITEMS.front), atlas = await load(ITEMS.atlas);
  const c = canvas(1536 * k * 2 + 48 + atlas.naturalWidth, Math.max(1024 * k + 32, atlas.naturalHeight + 32)), ctx = c.getContext('2d');
  ctx.fillStyle = '#212C31'; ctx.fillRect(0, 0, c.width, c.height);
  const shade = (img, x0, list) => {
    ctx.drawImage(img, x0, 16, img.naturalWidth * k, img.naturalHeight * k);
    ctx.fillStyle = 'rgba(255,0,0,0.45)';
    for (const r of list) {
      for (const [a, b] of r.rows) ctx.fillRect(x0, 16 + a * k, img.naturalWidth * k, (b - a) * k);
      for (const [a, b] of r.cols) ctx.fillRect(x0 + a * k, 16, (b - a) * k, img.naturalHeight * k);
    }
  };
  shade(side, 16, [ITEMS.removed.side]);
  shade(front, 32 + 1536 * k, [ITEMS.removed.front]);
  ctx.drawImage(atlas, 48 + 1536 * k * 2, 16);
  ctx.strokeStyle = '#00e5e5';
  for (const [x, y, w, h] of Object.values(ITEMS.rects)) ctx.strokeRect(48 + 1536 * k * 2 + x - 0.5, 16 + y - 0.5, w + 1, h + 1);
  return c.toDataURL('image/png');
})()`;

// 佈景五張的產出各自平鋪（牆板橫向接兩段），看接縫用
const tilesWork = items => `(async () => {
  ${HELPERS}
  const ITEMS = ${JSON.stringify(items)};
  const imgs = [];
  for (const it of ITEMS) imgs.push(await load(it.url));
  const gap = 16, rows = imgs.map(i => i.naturalHeight * (i.naturalWidth > 2 * i.naturalHeight ? 1 : 2));
  const c = canvas(Math.max(...imgs.map(i => i.naturalWidth * 2)) + 2 * gap, rows.reduce((s, h) => s + h + gap, gap));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#212C31'; ctx.fillRect(0, 0, c.width, c.height);
  let y = gap;
  imgs.forEach((im, k) => {
    const ny = rows[k] / im.naturalHeight;
    for (let i = 0; i < 2; i++) for (let j = 0; j < ny; j++) ctx.drawImage(im, gap + i * im.naturalWidth, y + j * im.naturalHeight);
    y += rows[k] + gap;
  });
  return c.toDataURL('image/png');
})()`;

// 對照圖：籌碼五張、牌背、大廳各縮一份並排，標上量到的東西
const sheetWork = (items, cfg) => `(async () => {
  ${HELPERS}
  const ITEMS = ${JSON.stringify(items)};
  const S = 300, c = canvas(S * 5, S * 2 + 260), ctx = c.getContext('2d');
  ctx.fillStyle = '#212C31'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.lineWidth = 2;
  const ring = (x, y, r, color) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke(); };
  for (const [i, chip] of ITEMS.chips.entries()) {
    const img = await load(chip.src), [cx, cy, R] = chip.disc, k = (S - 20) / (2 * R), x0 = i * S + 10 - (cx - R) * k, y0 = 10 - (cy - R) * k;
    ctx.drawImage(img, x0, y0, img.naturalWidth * k, img.naturalHeight * k);
    const X = x0 + cx * k, Y = y0 + cy * k;
    ring(X, Y, R * k, '#ff8c00'); ring(X, Y, chip.inner * R * k, '#00e5e5'); ring(X, Y, 0.9 * R * k, '#ff00ff');
    ctx.strokeStyle = '#ffd400';
    for (let j = 0; j < 8; j++) { const a = (chip.phase + j * 45) * Math.PI / 180; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + R * k * Math.cos(a), Y - R * k * Math.sin(a)); ctx.stroke(); }
  }
  const back = await load(ITEMS.back.src);
  const by = S + 10, bw = back.naturalWidth * (S - 20) / back.naturalHeight;
  ctx.drawImage(back, 10, by, bw, S - 20);
  const [l, t, r, b] = ITEMS.back.holeSrc, kb = (S - 20) / back.naturalHeight;
  ctx.strokeStyle = '#00e5e5'; ctx.beginPath(); ctx.ellipse(10 + (l + r) / 2 * kb, by + (t + b) / 2 * kb, (r - l) / 2 * kb, (b - t) / 2 * kb, 0, 0, 2 * Math.PI); ctx.stroke();
  const lobby = await load(ITEMS.lobby.src), lw = S * 4 - 20, kl = lw / lobby.naturalWidth, lx = S + 10, ly = S + 10;
  ctx.drawImage(lobby, lx, ly, lw, lobby.naturalHeight * kl);
  ctx.strokeStyle = '#ff8c00'; ctx.beginPath(); ctx.moveTo(lx, ly + ITEMS.lobby.wallSrc * kl); ctx.lineTo(lx + lw, ly + ITEMS.lobby.wallSrc * kl); ctx.stroke();
  ctx.strokeStyle = '#00e5e5'; ctx.beginPath(); ctx.moveTo(lx, ly + ITEMS.lobby.focusSrc * kl); ctx.lineTo(lx + lw, ly + ITEMS.lobby.focusSrc * kl); ctx.stroke();
  return c.toDataURL('image/png');
})()`;

async function main() {
  const { availableBrowsers, withPage } = require('../tests/browser_util');
  fs.mkdirSync(OUT, { recursive: true });
  const url = file => 'data:image/webp;base64,' + fs.readFileSync(path.join(FIX, file)).toString('base64');
  const b64 = d => Buffer.from(d.split(',')[1], 'base64');
  const cfg = { card: CARD, court: COURT, chip: CHIP, quality: QUALITY };
  const r = await withPage(availableBrowsers()[0], { size: [1280, 720], mobile: false }, async page => {
    const got = { court: {}, chips: {} };
    for (const name of COURTS) got.court[name] = await page.evaluate(courtWork(url(`card_art/${name}.webp`), cfg), 60000);
    got.back = await page.evaluate(backWork(url('card_art/back.webp'), cfg), 60000);
    for (const v of CHIPS) got.chips[v] = await page.evaluate(chipWork(url(`chip_art/chip_${v}.webp`), cfg), 60000);
    got.lobby = await page.evaluate(lobbyWork(url('room_art/lobby.webp'), { ...cfg, width: LOBBY_W, focus: LOBBY_FOCUS, dark: 22, below: 30 }), 60000);
    const sheet = await page.evaluate(sheetWork({
      chips: CHIPS.map(v => ({ src: url(`chip_art/chip_${v}.webp`), disc: got.chips[v].disc, inner: got.chips[v].inner, phase: got.chips[v].phase })),
      back: { src: url('card_art/back.webp'), holeSrc: got.back.holeSrc },
      lobby: { src: url('room_art/lobby.webp'), wallSrc: got.lobby.wallSrc, focusSrc: got.lobby.focusSrc },
    }, cfg), 60000);
    fs.writeFileSync(path.join(OUT, 'table-art-marks.png'), b64(sheet));
    got.scene = {};
    for (const name of SCENE_NAMES) got.scene[name] = await page.evaluate(sceneWork(url(`scene_art/${name}.webp`), SCENE[name]), 120000);
    fs.writeFileSync(path.join(OUT, 'scene-art-tiles.png'), b64(await page.evaluate(tilesWork(SCENE_NAMES.map(n => ({ url: got.scene[n].url }))), 60000)));
    got.shoe = await page.evaluate(shoeWork({ shoe_side: url('prop_art/shoe_side.webp'), shoe_front: url('prop_art/shoe_front.webp') }, { ...SHOE, quality: QUALITY }), 120000);
    got.emblem = await page.evaluate(emblemWork(url('prop_art/emblem.webp'), { height: EMBLEM_H, quality: QUALITY }), 60000);
    fs.writeFileSync(path.join(OUT, 'prop-art-marks.png'), b64(await page.evaluate(propMarksWork({
      side: url('prop_art/shoe_side.webp'), front: url('prop_art/shoe_front.webp'), atlas: got.shoe.url, removed: got.shoe.removed, rects: got.shoe.rects,
    }), 60000)));
    return got;
  });
  for (const line of r.console) console.log(`  主控台：${line}`);
  const got = r.value;

  const kb = d => Math.round(b64(d).length / 1024);
  for (const name of COURTS) console.log(`${name}：${got.court[name].size.join('×')}、WebP ${kb(got.court[name].url)} KB、解碼 ${got.court[name].decodeMs} ms`);
  console.log(`back：${got.back.size.join('×')}、WebP ${kb(got.back.url)} KB；中央空圓（牌面像素）${got.back.hole.join(', ')}`);
  for (const v of CHIPS) {
    const g = got.chips[v];
    console.log(`chip ${v}：盤面 ${g.disc.join(', ')}、中央空白 ${g.inner}R、中央 ${g.center}、底色 ${g.base}、嵌片 ${g.stripe}（第一片 ${g.phase}°、佔 ${g.duty}）；WebP ${kb(g.url)} KB`);
  }
  const L = got.lobby;
  console.log(`lobby：原圖 ${L.src.join('×')}，牆線 ${L.wallSrc}、構圖中心 ${L.focusSrc}，裁到 ${L.cut}；${L.size.join('×')}、WebP ${kb(L.url)} KB；每 40 列的亮度 ${L.profile.join(' ')}`);
  for (const [what, list] of [['人物', COURTS.map(n => got.court[n])], ['籌碼', CHIPS.map(v => got.chips[v])]]) {
    for (const g of list) if (g.size[0] !== list[0].size[0] || g.size[1] !== list[0].size[1]) throw new Error(`${what}的貼圖大小不一致`);
  }
  for (const v of CHIPS) {
    const g = got.chips[v];
    if (g.inner < 0.4 || g.inner > 0.8) throw new Error(`chip ${v}：中央空白量到 ${g.inner}R，量法不適用這張圖`);
    if (g.duty < 0.15 || g.duty > 0.5) throw new Error(`chip ${v}：嵌片佔邊環 ${g.duty}，量法不適用這張圖`);
  }
  const axes = v => v.map((s, a) => (s === null ? null : `${a ? '上下' : '左右'} ${s.r}（內部 P99 ${s.p99}）`)).filter(Boolean).join('、');
  for (const name of SCENE_NAMES) {
    const g = got.scene[name];
    if (SCENE[name].panels) {
      console.log(`${name}：${g.size.join('×')}（鑲板 ${SCENE[name].panels} 塊並排，橫向拉 ${g.stretch}%）、WebP ${kb(g.url)} KB；接回來那條縫 ${g.seam[0].r}、一段中間的接合處 ${g.joint.r}（內部相鄰像素差平均的倍數）`);
      if (Math.abs(g.seam[0].r / g.joint.r - 1) > 0.25) throw new Error(`${name}：接回來那條縫 ${g.seam[0].r} 跟中間的接合處 ${g.joint.r} 不是同一種`);
      continue;
    }
    console.log(`${name}：${g.size.join('×')}、裁原圖 ${g.crop.join(', ')}（倍率 ${g.scale}）、WebP ${kb(g.url)} KB；接縫（內部相鄰像素差平均的倍數）不處理 ${axes(g.raw)} → 產出解回來 ${axes(g.seam)}` +
      `${g.faded.some(Boolean) ? `，交疊 ${g.faded.map((f, a) => (f ? `${a ? '上下' : '左右'} ${SCENE[name].fade[a]}` : '')).filter(Boolean).join('、')}` : '，不必處理'}${SCENE[name].gray ? `；只取明暗，原圖平均亮度 ${g.mean}` : ''}`);
    for (const s of g.seam) if (s !== null && s.r > s.p99) throw new Error(`${name}：產出的接縫 ${s.r} 超過內部相鄰像素差的 P99 ${s.p99}`);
  }
  const S = got.shoe, E = got.emblem;
  console.log(`shoe：${S.size.join('×')}、WebP ${kb(S.url)} KB；${Object.entries(S.rects).map(([k, r]) => `${k} ${r.join(',')}`).join('、')}`);
  console.log(`emblem：原圖外框 ${E.box.join(', ')} → ${E.size.join('×')}、WebP ${kb(E.url)} KB`);
  if (L.wall < 0.8) throw new Error(`大廳的牆線只在裁切高度的 ${L.wall}，門檻 dark 不適用這張圖`);
  if (LOBBY_FOCUS >= L.wallSrc) throw new Error(`大廳的構圖中心 ${LOBBY_FOCUS} 在牆線 ${L.wallSrc} 下面，原圖換過就重量 LOBBY_FOCUS`);

  const chipLine = v => {
    const { url: u, inner, center, base, stripe, phase, duty } = got.chips[v];
    return `        ${v}: { inner: ${inner}, center: '${center}', base: '${base}', stripe: '${stripe}', phase: ${phase}, duty: ${duty}, image: '${u}' },`;
  };
  const sceneLine = n => `      ${n}: { size: ${JSON.stringify(got.scene[n].size)}, image: '${got.scene[n].url}' },`;
  const js = `// 由 tools/make_table_art.js 產生，不准手改：牌面人物、牌背、籌碼頂面、大廳、佈景材質、道具的點陣插畫（WebP，品質 ${QUALITY}）。
// 原圖在 tests/fixtures/card_art、chip_art、room_art、scene_art、prop_art。走 data: URL 是因為 file:// 下外部圖檔上傳 WebGL 會被當成跨來源擋掉（2026-11-07 Edge 實測 SecurityError）。
// source 是原圖與產生器的雜湊：換了原圖或改了產生器卻沒重跑，tests/check_table_art.js 會紅。
// court：J、Q、K 的人物（左右鏡像過），${COURT.join('×')}；back：牌背，${CARD.join('×')}，hole 是中央空圓 [圓心 x, y, 半徑 x, y]（牌面像素）；
// chips：頂面 ${CHIP}×${CHIP}，values 照面額，inner 是中央空白的半徑（盤面半徑的比例），base／stripe 是邊環的底色與嵌片色，phase 是第一片嵌片的方位（度，0＝右、逆時針），duty 是嵌片佔邊環的比例；
// lobby：大廳，wall 是牆線、focus 是構圖中心（都是圖高的比例）；
// scene：佈景材質，都已處理成可平鋪：carpet 地毯一格、felt 絨布的明暗（灰階，128＝不變）、leather 扶手、wood 桌身、wall 牆板一段（鑲板兩塊）；
// props：shoe 發牌盒三面拼成一張，rects 是各面在拼圖裡的 [x, y, 寬, 高]（像素）；emblem 絨布紋章，白色、亮度當不透明度
(function () {
  const BJK = (window.BJK = window.BJK || {});
  const V = (BJK.view = BJK.view || {});
  V.tableArt = {
    source: '${sourceHash()}',
    court: {
      size: ${JSON.stringify(COURT)},
      images: {
${COURTS.map(n => `        ${n}: '${got.court[n].url}',`).join('\n')}
      },
    },
    back: { size: ${JSON.stringify(CARD)}, hole: ${JSON.stringify(got.back.hole)}, image: '${got.back.url}' },
    chips: {
      size: ${CHIP},
      values: {
${CHIPS.map(chipLine).join('\n')}
      },
    },
    lobby: { size: ${JSON.stringify(L.size)}, wall: ${L.wall}, focus: ${L.focus}, image: '${L.url}' },
    scene: {
${SCENE_NAMES.map(sceneLine).join('\n')}
    },
    props: {
      shoe: { size: ${JSON.stringify(S.size)}, rects: ${JSON.stringify(S.rects)}, image: '${S.url}' },
      emblem: { size: ${JSON.stringify(E.size)}, image: '${E.url}' },
    },
  };
})();
`;
  fs.writeFileSync(TARGET, js);
  const scene = SCENE_NAMES.map(n => got.scene[n]);
  console.log(`佈景五張：WebP ${scene.reduce((s, g) => s + kb(g.url), 0)} KB、解碼後 ${(scene.reduce((s, g) => s + g.size[0] * g.size[1] * 4, 0) / 1e6).toFixed(2)} MB、解碼 ${scene.reduce((s, g) => s + g.decodeMs, 0).toFixed(0)} ms`);
  console.log(`道具兩張：WebP ${kb(S.url) + kb(E.url)} KB、解碼後 ${((S.size[0] * S.size[1] + E.size[0] * E.size[1]) * 4 / 1e6).toFixed(2)} MB、解碼 ${(S.decodeMs + E.decodeMs).toFixed(0)} ms`);
  const all = [...COURTS.map(n => got.court[n]), got.back, ...CHIPS.map(v => got.chips[v]), L, ...scene, S, E];
  const bin = all.reduce((s, g) => s + b64(g.url).length, 0);
  const px = all.reduce((s, g) => s + g.size[0] * g.size[1] * 4, 0);
  console.log(`✔ 寫入 ${path.relative(process.cwd(), TARGET)}：${Math.round(Buffer.byteLength(js) / 1024)} KB（WebP 本身 ${Math.round(bin / 1024)} KB）；` +
    `${all.length} 張解碼後 ${(px / 1e6).toFixed(1)} MB、解碼合計 ${all.reduce((s, g) => s + g.decodeMs, 0).toFixed(0)} ms；對照圖在 ${path.relative(process.cwd(), OUT)}\\table-art-marks.png`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { COURTS, CHIPS, CARD, COURT, CHIP, SCENE, SCENE_NAMES, SHOE, EMBLEM_H, FIX, DIRS, TARGET, sourceHash };
