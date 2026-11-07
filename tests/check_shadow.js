// 守牌與籌碼底下的軟影子貼片（v0.19.0）：牌旁邊、籌碼旁邊的絨布要被壓暗，牌面本身不能被自己的影子蓋到。
// 做法：打到輪到你，同一格畫兩次（影子貼片開、關），讀同一個像素比亮度。每個點都先用射線確認鏡頭看到的第一個東西
// 是那張牌或絨布，免得量到被別張牌或籌碼擋住的地方。
// 驗不到：真手機 GPU 的深度精度（這台只有 Radeon 內顯）；影子好不好看，那要看 tools\shoot.js 的截圖。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withPage } = require('./browser_util');
const { APP, DESKTOP, PHONE, url, first, copyWith } = require('./ui_util');
const { rigInit, deal } = require('./rig_util');

const CARDS = path.join('js', 'view', 'cards.js');
const CHIPS = path.join('js', 'view', 'chips.js');

const PROBE = `(async () => {
  const s = BJK.view.stage, V = BJK.view, hud = document.getElementById('hud'), R = s.renderer, gl = R.getContext(), cam = s.camera;
  await s.dealer.ready;
  V.anim.speed = 40;
  s.director.runRound(100);
  for (let i = 0; i < 400 && hud.dataset.mode !== 'act'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 300));
  const cards = [], shadows = [];
  s.scene.traverse(o => { if (o.userData.kind === 'card') cards.push(o); if (o.userData.kind === 'shadow') shadows.push(o); });
  const felt = s.table.group.children.find(o => o.geometry && o.geometry.type === 'CircleGeometry');
  const ray = new THREE.Raycaster(), px = new Uint8Array(4), wp = new THREE.Vector3();
  // 先對齊到像素中心再打射線：桌機上一疊籌碼才十幾個像素寬，射線打到絨布、四捨五入後讀到的卻是籌碼邊
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const firstHit = p => {
    const ndc = p.clone().project(cam);
    ndc.x = (Math.floor((ndc.x + 1) / 2 * W) + 0.5) / W * 2 - 1;
    ndc.y = (Math.floor((ndc.y + 1) / 2 * H) + 0.5) / H * 2 - 1;
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
    const hit = ray.intersectObjects(s.scene.children, true).find(h => h.object.isMesh && h.object.visible && h.object.userData.kind !== 'shadow');
    return { ndc, object: hit && hit.object };
  };
  // 一手牌最上面那張（附近沒有比它高的牌）：它的牌面上不該有任何影子，別張牌的影子也落不上去。
  // 蓋著的牌（荷官底牌）照設計沒有影子貼片（背面朝鏡頭被剔除），只量它的牌背沒被蓋到
  const top = cards.filter(c => {
    const p = c.getWorldPosition(new THREE.Vector3());
    return !cards.some(o => o !== c && o.getWorldPosition(wp).y > p.y && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.9);
  });
  const faces = [], beside = [];
  const pad = V.cards.W * V.textures.CARD_SHADOW;
  for (const c of top) {
    const f = firstHit(c.localToWorld(new THREE.Vector3(0, V.cards.T / 2, 0)));
    if (f.object === c) faces.push({ what: (c.rotation.z === 0 ? '' : '蓋著的') + c.userData.rank + c.userData.suit, ndc: f.ndc });
    if (c.rotation.z !== 0) continue;
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // 取影子貼片那一層的點、不取絨布上的點：貼片比絨布高一張牌，斜看時兩者錯開，量到的會是影子更外圍的淡處
      const sh = c.children.find(o => o.userData.kind === 'shadow');
      const p = (sh || c).localToWorld(new THREE.Vector3(x * (V.cards.W / 2 + pad * 0.4), 0, z * (V.cards.H / 2 + pad * 0.4)));
      const b = firstHit(p);
      if (b.object === felt) beside.push({ what: '牌 ' + c.userData.rank + c.userData.suit + '@' + x + ',' + z, ndc: b.ndc });
    }
  }
  // 籌碼：鏡頭的左右方向往外量，前後會被那疊籌碼自己擋住
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
  for (const sh of shadows.filter(o => o.parent.userData.kind === 'chip')) {
    const base = sh.getWorldPosition(new THREE.Vector3()), r = V.chips.R * sh.parent.parent.scale.x * (1 + V.textures.CHIP_SHADOW * 0.4);
    for (const k of [1, -1]) {
      const b = firstHit(base.clone().addScaledVector(side, k * r));
      if (b.object === felt) beside.push({ what: '籌碼 ' + sh.parent.userData.value, ndc: b.ndc });
    }
  }
  const sample = list => {
    s.render();
    return list.map(({ ndc }) => {
      gl.readPixels(Math.floor((ndc.x + 1) / 2 * W), Math.floor((ndc.y + 1) / 2 * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[0] + px[1] + px[2];
    });
  };
  const pts = [...faces, ...beside];
  const on = sample(pts);
  shadows.forEach(o => { o.visible = false; });
  const off = sample(pts);
  shadows.forEach(o => { o.visible = true; });
  const diff = i => off[i] - on[i];   // 正的＝開了影子變暗
  return {
    mode: hud.dataset.mode, shadows: shadows.length,
    faces: faces.map((f, i) => ({ what: f.what, darker: diff(i) })),
    beside: beside.map((b, i) => ({ what: b.what, darker: diff(faces.length + i), off: off[faces.length + i] })),
  };
})()`;

async function probe(dir, viewport) {
  const r = await withPage(first(), { ...viewport, init: rigInit(deal('10', '6')) }, async page => {
    await page.goto(url(dir));
    return page.evaluate(PROBE, 40000);
  });
  return r.value;
}

// 三個顏色加總差 6 以內算沒變（同一格畫兩次，只有影子開關不同，實測沒變的點差 0）；壓暗至少 10
function assertFaces(m) {
  const why = JSON.stringify(m);
  assert.strictEqual(m.mode, 'act', `量法有誤：沒有打到輪到你：${why}`);
  assert.ok(m.faces.length >= 4, `量法有誤：看得到牌面的最上層牌只有 ${m.faces.length} 張：${why}`);
  const dark = m.faces.filter(f => Math.abs(f.darker) > 6);
  assert.deepStrictEqual(dark, [], `影子蓋到牌面上（牌整張變灰）：${why}`);
}
function assertBeside(m, kind) {
  const why = JSON.stringify(m);
  const list = m.beside.filter(b => b.what.startsWith(kind));
  assert.ok(list.length >= (kind === '牌' ? 4 : 1), `量法有誤：${kind}旁邊看得到的絨布點只有 ${list.length} 個：${why}`);
  const pale = list.filter(b => b.darker < 10);
  assert.deepStrictEqual(pale, [], `${kind}旁邊的絨布沒有變暗（影子貼片沒畫出來）：${why}`);
}

for (const [name, viewport] of [['手機', PHONE], ['桌機', DESKTOP]]) {
  test(`${first()}・${name}：牌與籌碼旁邊的絨布有影子，牌面不被影子蓋到`, async t => {
    const m = await probe(APP, viewport);
    t.diagnostic(`牌面 ${m.faces.map(f => `${f.what}:${f.darker}`).join(' ')}；旁邊 ${m.beside.map(b => `${b.what}:${b.darker}/${b.off}`).join(' ')}`);
    assertFaces(m);
    assertBeside(m, '牌');
    assertBeside(m, '籌碼');
  });
}

function withCopy(file, from, to, fn) {
  const tmp = copyWith(file, from, to);
  return fn(tmp).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
}

// 2026-11-07 第一版就是這樣：polygonOffset 帶 factor，桌機斜看時影子穿到牌面上
test('陽性對照：影子的 polygonOffset 加上 factor，要判成影子蓋到牌面', () => withCopy(CARDS, 'polygonOffset: true, polygonOffsetUnits: -4,',
  'polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,', async tmp => {
    const m = await probe(tmp, DESKTOP);
    assert.throws(() => assertFaces(m), /蓋到牌面/);
  }));

test('陽性對照：牌不掛影子貼片，要判成牌旁邊沒變暗', () => withCopy(CARDS, '    mesh.add(shadow);', '', async tmp => {
  const m = await probe(tmp, PHONE);
  assert.throws(() => assertBeside(m, '牌'), /牌旁邊的絨布沒有變暗/);
}));

// 第一版的籌碼影子放在籌碼底面再往下 1 毫米，等於埋在絨布底下（2026-11-07 截圖看不到）
test('陽性對照：籌碼的影子埋到絨布底下，要判成籌碼旁邊沒變暗', () => withCopy(CHIPS, 'shadow.position.y = -H / 2 + 0.002;',
  'shadow.position.y = -H / 2 - 0.001;', async tmp => {
    const m = await probe(tmp, PHONE);
    assert.throws(() => assertBeside(m, '籌碼'), /籌碼旁邊的絨布沒有變暗/);
  }));
