// 把牌桌上的點陣插畫（tests/fixtures/ 底下的 card_art、chip_art、room_art）縮成貼圖要的大小，
// 寫成 app/js/view/table_art.js（不准手改）。換了原圖、改了這支的任何一行就重跑：node tools/make_table_art.js
// 另外在 tools/_shots/table-art-marks.png 留量測對照圖（不進版控）：籌碼的盤面（橘）、中央空白（青）、取樣邊環（洋紅）與嵌片方位（黃）、
// 牌背中央的圓（青）、大廳的牆線（橘）與構圖中心（青）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIX = path.join(__dirname, '..', 'tests', 'fixtures');
const DIRS = ['card_art', 'chip_art', 'room_art'];
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
  if (L.wall < 0.8) throw new Error(`大廳的牆線只在裁切高度的 ${L.wall}，門檻 dark 不適用這張圖`);
  if (LOBBY_FOCUS >= L.wallSrc) throw new Error(`大廳的構圖中心 ${LOBBY_FOCUS} 在牆線 ${L.wallSrc} 下面，原圖換過就重量 LOBBY_FOCUS`);

  const chipLine = v => {
    const { url: u, inner, center, base, stripe, phase, duty } = got.chips[v];
    return `        ${v}: { inner: ${inner}, center: '${center}', base: '${base}', stripe: '${stripe}', phase: ${phase}, duty: ${duty}, image: '${u}' },`;
  };
  const js = `// 由 tools/make_table_art.js 產生，不准手改：牌面人物、牌背、籌碼頂面、大廳的點陣插畫（WebP，品質 ${QUALITY}）。
// 原圖在 tests/fixtures/card_art、chip_art、room_art。走 data: URL 是因為 file:// 下外部圖檔上傳 WebGL 會被當成跨來源擋掉（2026-11-07 Edge 實測 SecurityError）。
// source 是原圖與產生器的雜湊：換了原圖或改了產生器卻沒重跑，tests/check_table_art.js 會紅。
// court：J、Q、K 的人物（左右鏡像過），${COURT.join('×')}；back：牌背，${CARD.join('×')}，hole 是中央空圓 [圓心 x, y, 半徑 x, y]（牌面像素）；
// chips：頂面 ${CHIP}×${CHIP}，values 照面額，inner 是中央空白的半徑（盤面半徑的比例），base／stripe 是邊環的底色與嵌片色，phase 是第一片嵌片的方位（度，0＝右、逆時針），duty 是嵌片佔邊環的比例；
// lobby：大廳，wall 是牆線、focus 是構圖中心（都是圖高的比例）
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
  };
})();
`;
  fs.writeFileSync(TARGET, js);
  const all = [...COURTS.map(n => got.court[n]), got.back, ...CHIPS.map(v => got.chips[v]), L];
  const bin = all.reduce((s, g) => s + b64(g.url).length, 0);
  const px = all.reduce((s, g) => s + g.size[0] * g.size[1] * 4, 0);
  console.log(`✔ 寫入 ${path.relative(process.cwd(), TARGET)}：${Math.round(Buffer.byteLength(js) / 1024)} KB（WebP 本身 ${Math.round(bin / 1024)} KB）；` +
    `${all.length} 張解碼後 ${(px / 1e6).toFixed(1)} MB、解碼合計 ${all.reduce((s, g) => s + g.decodeMs, 0).toFixed(0)} ms；對照圖在 ${path.relative(process.cwd(), OUT)}\\table-art-marks.png`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { COURTS, CHIPS, CARD, COURT, CHIP, FIX, DIRS, TARGET, sourceHash };
