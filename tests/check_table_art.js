// 守牌桌插畫的產出檔（app/js/view/table_art.js，由 tools/make_table_art.js 產生）：跟原圖與產生器同步；
// J／Q／K 紅黑各一張、每種面額的籌碼都有圖、佈景五張材質與道具兩張（發牌盒拼圖、絨布紋章）都在；每張的大小是貼圖要的（人物 2:3、牌背跟牌面畫布一樣大、籌碼正方形、
// 牆板一段是 room.js 牆的 4:1.3）。佈景材質接得起來（平鋪看不出接縫）要解碼才量得到，在 check_textures.js。
// 純讀檔，CI 也跑。畫面上貼得對不對、補畫有沒有傳上 GPU，在 check_textures.js 開瀏覽器量；大廳照畫面裁得對不對在 check_room.js。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ART_TOOL = require('../tools/make_table_art');

const VIEW = path.join(__dirname, '..', 'app', 'js', 'view');

function loadArt() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(ART_TOOL.TARGET, 'utf8'), { window });
  return window.BJK.view.tableArt;
}
// WebP 檔頭記的畫布大小：有透明度的有損圖是 VP8X，不透明的有損圖是 VP8，無損是 VP8L
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('不是 WebP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1]; }
  throw new Error(`認不得的 WebP：${kind}`);
}
const decode = url => Buffer.from(url.split(',')[1], 'base64');
// 牌面畫布（textures.js 的 CW、CH）與籌碼面額（chips.js 的 DENOMS）以 app 為準，產生器跟著它們
const [CW, CH] = fs.readFileSync(path.join(VIEW, 'textures.js'), 'utf8').match(/const CW = (\d+), CH = (\d+);/).slice(1).map(Number);
// 牆一段的寬高（room.js：牆 WALL_W 寬、貼圖重複 WALL_W / 4 次、高 WALL_H）
const TABLE = fs.readFileSync(path.join(VIEW, 'table.js'), 'utf8');
const ROOM = fs.readFileSync(path.join(VIEW, 'room.js'), 'utf8');
const WALL_H = Number(ROOM.match(/WALL_H = ([\d.]+)/)[1]), SEGMENT_W = Number(ROOM.match(/panel\.repeat\.set\(WALL_W \/ ([\d.]+), 1\)/)[1]);
const DENOMS = JSON.parse(fs.readFileSync(path.join(VIEW, 'chips.js'), 'utf8').match(/const DENOMS = (\[[\d, ]+\]);/)[1]);

// images：{ 名稱: WebP 位元組 }；回傳不合的地方
function sizeProblems(art, images) {
  const out = [];
  const want = {
    ...Object.fromEntries(ART_TOOL.COURTS.map(n => [n, art.court.size])),
    back: [CW, CH],
    ...Object.fromEntries(DENOMS.map(v => [`chip_${v}`, [art.chips.size, art.chips.size]])),
    lobby: art.lobby.size,
    ...Object.fromEntries(ART_TOOL.SCENE_NAMES.map(n => [`scene_${n}`, ART_TOOL.SCENE[n].out])),
    prop_shoe: ART_TOOL.SHOE.atlas,
    prop_emblem: art.props.emblem.size,
  };
  for (const [name, size] of Object.entries(want)) {
    if (!images[name]) { out.push(`少了 ${name}`); continue; }
    const got = webpSize(images[name]);
    if (got[0] !== size[0] || got[1] !== size[1]) out.push(`${name} 是 ${got.join('×')}，要 ${size.join('×')}`);
  }
  const [ww, wh] = art.scene.wall.size;
  if (Math.abs(ww / wh / (SEGMENT_W / WALL_H) - 1) > 0.01) out.push(`牆板 ${ww}×${wh} 不是 room.js 一段的 ${SEGMENT_W}:${WALL_H}`);
  if (art.court.size[0] * 3 !== art.court.size[1] * 2) out.push(`人物框 ${art.court.size.join('×')} 不是原圖的 2:3`);
  // 發牌盒每一面在拼圖裡的寬高比要是 table.js 盒子那一面的比例（差 2% 以內）；紋章高是產生器定的
  const box = TABLE.match(/new THREE\.BoxGeometry\(([\d.]+), ([\d.]+), ([\d.]+)\), shoeUV/).slice(1).map(Number);
  const dim = { x: box[0], y: box[1], z: box[2] };
  for (const [k, f] of Object.entries(ART_TOOL.SHOE.faces)) {
    const r = art.props.shoe.rects[k], want = dim[f.dims[0]] / dim[f.dims[1]];
    if (!r || Math.abs(r[2] / r[3] / want - 1) > 0.02) out.push(`發牌盒 ${k} 在拼圖裡是 ${r && r.slice(2).join('×')}，盒子那一面要 ${want.toFixed(3)}`);
  }
  if (art.props.emblem.size[1] !== ART_TOOL.EMBLEM_H) out.push(`紋章高 ${art.props.emblem.size[1]}，要 ${ART_TOOL.EMBLEM_H}`);
  return out;
}
const artImages = art => ({
  ...Object.fromEntries(Object.entries(art.court.images).map(([n, u]) => [n, decode(u)])),
  back: decode(art.back.image),
  ...Object.fromEntries(Object.entries(art.chips.values).map(([v, c]) => [`chip_${v}`, decode(c.image)])),
  lobby: decode(art.lobby.image),
  ...Object.fromEntries(Object.entries(art.scene).map(([n, c]) => [`scene_${n}`, decode(c.image)])),
  ...Object.fromEntries(Object.entries(art.props).map(([n, c]) => [`prop_${n}`, decode(c.image)])),
});

test('table_art.js 跟原圖與產生器同步', () => {
  assert.strictEqual(loadArt().source, ART_TOOL.sourceHash(), '換了 tests/fixtures/ 的 card_art、chip_art、room_art、scene_art、prop_art 或改了 tools/make_table_art.js，就重跑 node tools/make_table_art.js');
});

test('陽性對照：換一張原圖、改產生器的品質，都要判成過期', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-table-art-'));
  try {
    for (const d of ART_TOOL.DIRS) fs.cpSync(path.join(ART_TOOL.FIX, d), path.join(tmp, d), { recursive: true });
    fs.copyFileSync(path.join(ART_TOOL.FIX, 'chip_art', 'chip_5.webp'), path.join(tmp, 'chip_art', 'chip_25.webp'));
    assert.notStrictEqual(ART_TOOL.sourceHash({ dir: tmp }), loadArt().source);
    const script = fs.readFileSync(require.resolve('../tools/make_table_art'), 'utf8');
    assert.ok(script.includes('const QUALITY = '), '破壞沒有命中');
    assert.notStrictEqual(ART_TOOL.sourceHash({ script: script.replace('const QUALITY = ', 'const QUALITY = 0.5 || ') }), loadArt().source);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('J／Q／K 紅黑各一張、每種面額的籌碼都有圖、佈景五張與道具兩張都在，大小都是貼圖要的；大廳的構圖中心在牆線上面', () => {
  const art = loadArt();
  assert.deepStrictEqual(Object.keys(art.court.images), ART_TOOL.COURTS);
  assert.deepStrictEqual(Object.keys(art.scene), ['carpet', 'felt', 'leather', 'wood', 'wall']);
  assert.deepStrictEqual(Object.keys(art.props), ['shoe', 'emblem']);
  assert.deepStrictEqual(Object.keys(art.chips.values).map(Number).sort((a, b) => a - b), [...DENOMS].sort((a, b) => a - b));
  assert.deepStrictEqual(sizeProblems(art, artImages(art)), []);
  const { wall, focus } = art.lobby;
  assert.ok(focus > 0 && focus < wall && wall <= 1, `大廳的構圖中心 ${focus}、牆線 ${wall}`);
});

test('陽性對照：拿原圖量大小，要判成每一張都不合；牆板不是一段的比例，要判出來', () => {
  const art = loadArt();
  const read = (d, f) => fs.readFileSync(path.join(ART_TOOL.FIX, d, f));
  const src = {
    ...Object.fromEntries(ART_TOOL.COURTS.map(n => [n, read('card_art', `${n}.webp`)])),
    back: read('card_art', 'back.webp'),
    ...Object.fromEntries(DENOMS.map(v => [`chip_${v}`, read('chip_art', `chip_${v}.webp`)])),
    lobby: read('room_art', 'lobby.webp'),
    ...Object.fromEntries(ART_TOOL.SCENE_NAMES.map(n => [`scene_${n}`, read('scene_art', `${n}.webp`)])),
    prop_shoe: read('prop_art', 'shoe_side.webp'),
    prop_emblem: read('prop_art', 'emblem.webp'),
  };
  // 先確認量法：原圖讀得出 1024×1536，紅是因為大小、不是檔頭讀錯
  assert.deepStrictEqual(webpSize(src.king_red), [1024, 1536]);
  assert.strictEqual(sizeProblems(art, src).length, ART_TOOL.COURTS.length + 1 + DENOMS.length + 1 + ART_TOOL.SCENE_NAMES.length + 2);
  // 牆板照舊的 1024×320 比例（3.2:1）畫，要判成不是一段的比例
  const flat = { ...art, scene: { ...art.scene, wall: { ...art.scene.wall, size: [512, 160] } } };
  assert.ok(sizeProblems(flat, artImages(art)).some(p => p.includes('不是 room.js 一段')));
  // 發牌盒的側面照 3:2 原圖整張貼（沒拿掉素面那幾列），要判成不是盒子那一面的比例
  const raw = { ...art, props: { ...art.props, shoe: { ...art.props.shoe, rects: { ...art.props.shoe.rects, side: [4, 4, 243, 162] } } } };
  assert.ok(sizeProblems(raw, artImages(art)).some(p => p.includes('發牌盒 side')));
});
