// 守旗袍那套發牌那張的前景層（v0.26.0）：桌機上荷官伸出來的手和牌原本被籌碼架擋掉，前景層把它們畫在籌碼架前面；
// 只在旗袍造型、橫式畫面的發牌表情畫（直式畫面手和牌本來就在籌碼架上方）。西裝那套（預設）沒有前景層：發牌時不畫、不多 draw call（v0.27.0）。
// 做法：同一格畫好幾次讀 GPU 像素——只畫荷官（整張原圖、不裁下緣，不畫籌碼架、牌桌）、整個場景、整個場景但拿掉前景層——逐像素比。
// 牌與手的位置用原圖像素寫在這裡，跟產生器的多邊形分開量，探針才不會拿產生器自己的答案驗自己。
// 驗不到：好不好看（看 tools/_shots/art-qipao-deal-front-marks.png 與 node tools/shoot.js <前綴> --dealer --qipao）；真手機的 GPU；
// 畫面尺寸只量桌機、橫式手機、直式手機三種，更寬或更扁時籌碼架擋到的位置會移，切線露不露出來沒量。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withPage } = require('./browser_util');
const { APP, DESKTOP, PHONE, PHONE_LANDSCAPE, url, first, copyWith } = require('./ui_util');

const DEALER_JS = path.join('js', 'view', 'dealer.js');
const ART_JS = path.join('js', 'view', 'dealer_art.js');
const [VB_W, VB_H] = fs.readFileSync(path.join(APP, DEALER_JS), 'utf8').match(/VB_W = (\d+), VB_H = (\d+)/).slice(1).map(Number);
const N = 1024;   // 原圖邊長（tests/fixtures/dealer_art_qipao/deal.webp）
// 產生器的多邊形只拿來找切線在哪一列（上緣），以及陽性對照重做一張不羽化的前景層
const FRONT = require('../tools/make_dealer_art').SETS.qipao.front;
const CUT = Math.min(...FRONT.deal.map(p => p[1]));
// 前景層只屬於旗袍那套：量它的都先存好偏好開旗袍；西裝是開頁的預設
const QIPAO = `localStorage.setItem('bjk.prefs.v1', '{"look":"qipao"}');`;

// 牌（原圖像素）：米白邊往內縮 5 像素的四邊形，左上角被手指壓著的那一截也算在內（手指也在前景層裡）
const CARD = [[374, 735], [465, 735], [510, 871], [328, 871]];
// 手的範圍（原圖像素）：前臂、手、拇指、牌，外擴約 10 像素。前景層改到的像素只准落在這裡面
const HAND = [[226, 578], [402, 578], [430, 618], [432, 674], [456, 676], [458, 714], [482, 716], [532, 866], [530, 893], [226, 893]];
const EXPOSED = 0.9;   // 牌露出的比例下限（主線 2026-11-18 定）
const TOL = 10;        // 同一個像素算「一樣」的色差：人只有約 250／255 不透明，後面透過來的差 5 級以內；前景層是有損的，平均再差 2.6

const PROBE = `(async () => {
  const s = BJK.view.stage, d = s.dealer, V = BJK.view, R = s.renderer, gl = R.getContext(), cam = s.camera;
  await d.ready;
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const grab = () => { s.render(); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const calls = () => { R.info.autoReset = false; R.info.reset(); s.render(); const n = R.info.render.calls; R.info.autoReset = true; return n; };
  // 原圖像素 → 畫布像素（readPixels 的座標，y 從下往上）：正方形原圖縮到立牌的高、左右補透明邊，再照 dealer.js 的 local() 與鏡頭投影
  const toPx = ([x, y]) => {
    const sx = x * ${VB_H} / ${N} + (${VB_W} - ${VB_H}) / 2, sy = y * ${VB_H} / ${N}, z = d.zoom;
    const p = new THREE.Vector3((sx / ${VB_W} - 0.5) * V.dealer.W * z, (1 - sy / ${VB_H} * z) * V.dealer.H, 0);
    d.mesh.updateMatrixWorld();
    d.mesh.localToWorld(p).project(cam);
    return [(p.x + 1) / 2 * W, (p.y + 1) / 2 * H];
  };
  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const card = ${JSON.stringify(CARD)}.map(toPx), hand = ${JSON.stringify(HAND)}.map(toPx);
  const diff = (a, b, i) => Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
  // 只留某些東西：其他的先藏起來，畫完放回
  const only = (keep, fn) => {
    const saved = s.scene.children.map(o => [o, o.visible]);
    for (const [o] of saved) o.visible = keep.includes(o);
    try { return fn(); } finally { for (const [o, v] of saved) o.visible = v; }
  };
  const withoutFront = fn => { const parent = d.front.parent; parent.remove(d.front); try { return fn(); } finally { parent.add(d.front); } };

  d.hush();
  d.setMood('deal');
  const empty = only([], grab);                                    // 什麼都不畫：背景
  // 只畫荷官：另放一片貼發牌那張本體、整張原圖不裁下緣的平面（橫式放大時立牌裁到第 853 列，牌畫到第 880 列），
  // 自己照立牌的大小與頂端擺，不借 dealer.js 的幾何
  const z = d.zoom, ref = new THREE.Mesh(new THREE.PlaneGeometry(V.dealer.W * z, V.dealer.H * z).translate(0, V.dealer.H * (1 - z / 2), 0),
    new THREE.MeshBasicMaterial({ map: d.mesh.material.map, transparent: true, depthWrite: false }));
  d.mesh.add(ref);
  d.mesh.material.visible = false;
  const alone = only([d.mesh], () => withoutFront(grab));
  d.mesh.material.visible = true;
  d.mesh.remove(ref);
  ref.geometry.dispose(); ref.material.dispose();
  const full = grab();                                             // 整個場景（有前景層）
  const bare = withoutFront(grab);                                 // 整個場景，拿掉前景層
  // 牌：只畫荷官時畫得到的像素裡，整個場景跟它一樣的比例
  const exposure = scene => {
    let n = 0, shown = 0;
    const xs = card.map(p => p[0]), ys = card.map(p => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !inPoly(card, x + 0.5, y + 0.5)) continue;
        const i = (y * W + x) * 4;
        if (diff(alone, empty, i) <= ${TOL}) continue;
        n++;
        if (diff(scene, alone, i) <= ${TOL}) shown++;
      }
    }
    return { pixels: n, ratio: n ? +(shown / n).toFixed(3) : 0 };
  };
  // 前景層改到的像素：在手的範圍裡、範圍外各幾個；範圍外的最多列幾個出來
  let inside = 0, outside = 0;
  const strays = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, dv = diff(full, bare, i);
    if (dv === 0) continue;
    if (inPoly(hand, x + 0.5, y + 0.5)) inside++; else { outside++; if (strays.length < 5) strays.push([x, H - 1 - y]); }
  }
  // 切線（產生器多邊形的上緣）上下幾列裡明顯改到的像素：切線落在沒被擋的前臂上，改到就是一條看得到的線
  const cutY = H - toPx([300, ${CUT}])[1];
  let seam = 0;
  for (let y = Math.floor(H - cutY - 3); y <= Math.ceil(H - cutY + 2); y++) for (let x = 0; x < W; x++) {
    if (y >= 0 && y < H && inPoly(hand, x + 0.5, y + 0.5) && diff(full, bare, (y * W + x) * 4) > ${TOL}) seam++;
  }
  const deal = { exposure: exposure(full), without: exposure(bare), inside, outside, strays, cutY: Math.round(cutY), seam,
                 visible: d.front.visible, calls: calls(), callsWithout: withoutFront(calls) };

  // 其他四種表情：前景層收起來、draw call 跟拿掉前景層時一樣、畫面逐像素一樣
  const others = {};
  for (const m of Object.keys(V.dealer.MOODS).filter(m => m !== 'deal')) {
    d.setMood(m);
    const a = grab(), b = withoutFront(grab);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) if (diff(a, b, i)) changed++;
    others[m] = { visible: d.front.visible, calls: calls(), callsWithout: withoutFront(calls), changed };
  }
  d.setMood('deal');
  return { look: d.look, size: [W, H], zoom: d.zoom, deal, others };
})()`;

// look：qipao 先存好偏好；art 是開頁的預設（西裝）
async function probe(dir, viewport, look = 'qipao') {
  const r = await withPage(first(), { ...viewport, init: look === 'qipao' ? QIPAO : '' }, async page => {
    await page.goto(url(dir));
    return page.evaluate(PROBE, 60000);
  });
  assert.strictEqual(r.value.look, look, '量法有誤：開的不是要量的造型');
  return { ...r.value, console: r.console };
}

function assertExposed(m) {
  const why = JSON.stringify(m.deal);
  assert.ok(m.deal.exposure.pixels > 500, `量法有誤：牌在畫面上只量到 ${m.deal.exposure.pixels} 個像素：${why}`);
  assert.ok(m.deal.exposure.ratio >= EXPOSED, `發牌時牌只露出 ${m.deal.exposure.ratio}，要 ${EXPOSED} 以上：${why}`);
}
// shown：發牌時前景層該不該開（橫式開、直式不開）
function assertHidden(m, shown = true) {
  for (const [mood, o] of Object.entries(m.others)) {
    const why = `${mood}：${JSON.stringify(o)}`;
    assert.strictEqual(o.visible, false, `${mood} 時前景層還開著：${why}`);
    assert.strictEqual(o.calls, o.callsWithout, `${mood} 時多了 draw call：${why}`);
    assert.strictEqual(o.changed, 0, `${mood} 時前景層改到畫面：${why}`);
  }
  const why = JSON.stringify(m.deal);
  assert.strictEqual(m.deal.visible, shown, shown ? `發牌時前景層沒開：${why}` : `發牌時前景層不該開卻開著：${why}`);
  assert.strictEqual(m.deal.calls, m.deal.callsWithout + (shown ? 1 : 0), `發牌時前景層該多 ${shown ? 1 : 0} 個 draw call：${why}`);
}
function assertOnlyHand(m) {
  const why = JSON.stringify(m.deal);
  assert.strictEqual(m.deal.outside, 0, `前景層蓋到手的範圍以外（籌碼架、牌桌或旗袍）：${why}`);
}
// 切線上下明顯改到的像素最多 2 個（有損壓縮零星的點）；硬切量到 29 個連成一條
function assertNoSeam(m) {
  assert.ok(m.deal.seam <= 2, `前臂上的切線看得到（切線上下 ${m.deal.seam} 個像素差超過 ${TOL}）：${JSON.stringify(m.deal)}`);
}

test(`${first()}・桌機 1280×720：發牌時牌露出九成以上，前景層只改到手的範圍，其他四種表情不畫、不多 draw call`, async t => {
  const m = await probe(APP, DESKTOP);
  t.diagnostic(`牌露出 ${m.deal.exposure.ratio}（拿掉前景層 ${m.deal.without.ratio}，共 ${m.deal.exposure.pixels} 像素）；` +
    `前景層改到手的範圍內 ${m.deal.inside} 像素、範圍外 ${m.deal.outside}；切線在第 ${m.deal.cutY} 列（上下明顯改到 ${m.deal.seam} 像素）；` +
    `draw call 發牌 ${m.deal.calls}（拿掉前景層 ${m.deal.callsWithout}），其他表情 ${Object.values(m.others).map(o => o.calls).join('／')}`);
  assertExposed(m);
  assertHidden(m);
  assertOnlyHand(m);
  assertNoSeam(m);
  assert.ok(m.deal.inside > 0, `量法有誤：前景層什麼都沒改到：${JSON.stringify(m.deal)}`);
  assert.deepStrictEqual(m.console, []);
});

// 橫式手機也放大 1.2 倍、籌碼架一樣擋在手前面；直式手機牌本來就整張露出來，前景層不畫
for (const [name, viewport, shown] of [['橫式手機 844×390', PHONE_LANDSCAPE, true], ['直式手機 390×844', PHONE, false]]) {
  test(`${first()}・${name}：發牌時牌露出九成以上、前景層只改到手的範圍${shown ? '' : '（直式不畫）'}，其他表情不畫`, async t => {
    const m = await probe(APP, viewport);
    t.diagnostic(`牌露出 ${m.deal.exposure.ratio}（拿掉前景層 ${m.deal.without.ratio}，共 ${m.deal.exposure.pixels} 像素）；範圍內 ${m.deal.inside}、範圍外 ${m.deal.outside}；切線在第 ${m.deal.cutY} 列（上下明顯改到 ${m.deal.seam} 像素）`);
    assertExposed(m);
    assertHidden(m, shown);
    assertOnlyHand(m);
    assertNoSeam(m);
  });
}

// 西裝那套（預設）沒有前景層：橫式畫面發牌時也不畫，五種表情的 draw call 都跟拿掉前景層一樣、畫面逐像素一樣
function assertNoFront(m) {
  assertHidden(m, false);
  assert.strictEqual(m.deal.inside + m.deal.outside, 0, `發牌時前景層改到畫面：${JSON.stringify(m.deal)}`);
}
for (const [name, viewport] of [['桌機 1280×720', DESKTOP], ['橫式手機 844×390', PHONE_LANDSCAPE]]) {
  test(`${first()}・${name}：西裝那套發牌時沒有前景層，draw call 不變、畫面不變`, async t => {
    const m = await probe(APP, viewport, 'art');
    t.diagnostic(`draw call 發牌 ${m.deal.calls}（拿掉前景層 ${m.deal.callsWithout}），其他表情 ${Object.values(m.others).map(o => o.calls).join('／')}`);
    assertNoFront(m);
    assert.deepStrictEqual(m.console, []);
  });
}

// ---- 陽性對照：每條判準各配一個破壞，在暫存複本上改 ----
function withCopy(file, from, to, fn) {
  const tmp = copyWith(file, from, to);
  return fn(tmp).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
}

test('陽性對照：西裝那套借旗袍的前景層，要判成西裝發牌時多畫一層', t =>
  withCopy(DEALER_JS, '...painted(ART.sets.suit),', '...painted({ ...ART.sets.suit, front: ART.sets.qipao.front }),', async tmp => {
    const m = await probe(tmp, DESKTOP, 'art');
    t.diagnostic(`西裝發牌 draw call ${m.deal.calls}（拿掉前景層 ${m.deal.callsWithout}）、改到 ${m.deal.inside + m.deal.outside} 像素`);
    assert.throws(() => assertNoFront(m), /前景層不該開卻開著/);
    assert.ok(m.deal.calls === m.deal.callsWithout + 1 && m.deal.inside + m.deal.outside > 0, `破壞後 draw call 或畫面沒變，這條判準分辨不出來：${JSON.stringify(m.deal)}`);
  }));

test('陽性對照：不加前景層，桌機上牌要判成露出不到九成', t => withCopy(DEALER_JS, 'front.visible = !!tex && landscape;', 'front.visible = false;', async tmp => {
  const m = await probe(tmp, DESKTOP);
  t.diagnostic(`牌露出 ${m.deal.exposure.ratio}`);
  assert.throws(() => assertExposed(m), /牌只露出/);
}));

test('陽性對照：前景層照立牌裁下緣，桌機上牌底被切掉一截，要判成露出不到九成', t => withCopy(DEALER_JS, 'function frontPlane(zoom) {', 'function frontPlane(zoom) { return standee(zoom);', async tmp => {
  const m = await probe(tmp, DESKTOP);
  t.diagnostic(`牌露出 ${m.deal.exposure.ratio}`);
  assert.throws(() => assertExposed(m), /牌只露出/);
}));

test('陽性對照：前景層每種表情都開著，要判成其他表情多 draw call、改到畫面', t => withCopy(DEALER_JS, 'const tex = fronts[mood];', 'const tex = fronts.deal;', async tmp => {
  const m = await probe(tmp, DESKTOP);
  assert.throws(() => assertHidden(m), /時前景層還開著/);
  const o = m.others.idle;
  t.diagnostic(`待機 draw call ${o.calls}（拿掉前景層 ${o.callsWithout}）、改到 ${o.changed} 像素`);
  assert.ok(o.calls === o.callsWithout + 1 && o.changed > 0, `破壞後 draw call 或畫面沒變，這條判準分辨不出來：${JSON.stringify(m.others)}`);
}));

// 在頁面裡從發牌那張本體挖一張破壞過的前景層（多邊形是原圖像素，不羽化），換進暫存複本的 dealer_art.js
const cutFront = poly => `(async () => {
  const A = BJK.view.dealerArt, img = new Image();
  img.src = A.sets.qipao.images.deal; await img.decode();
  const [TW, TH] = A.size, k = TH / ${N}, off = (TW - TH) / 2;
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ${JSON.stringify(poly)}.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * k + off, y * k));
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.95);
})()`;
async function withFront(poly, fn) {
  const window = { BJK: { view: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(APP, ART_JS), 'utf8'), { window });
  const broken = (await withPage(first(), DESKTOP, async page => { await page.goto(url(APP)); return page.evaluate(cutFront(poly), 30000); })).value;
  return withCopy(ART_JS, window.BJK.view.dealerArt.sets.qipao.front.deal, broken, fn);
}

test('陽性對照：前景層切成切線以下整片（手、牌加上整個下半身），要判成蓋到手的範圍以外', t =>
  withFront([[0, CUT], [N, CUT], [N, N], [0, N]], async tmp => {
    const m = await probe(tmp, DESKTOP);
    t.diagnostic(`手的範圍外改到 ${m.deal.outside} 像素，例如 ${JSON.stringify(m.deal.strays)}`);
    assert.throws(() => assertOnlyHand(m), /蓋到手的範圍以外/);
  }));

test('陽性對照：同一個多邊形但上緣不羽化，要判成前臂上看得到切線', t =>
  withFront(FRONT.deal, async tmp => {
    const m = await probe(tmp, DESKTOP);
    t.diagnostic(`切線上下明顯改到 ${m.deal.seam} 像素`);
    assert.throws(() => assertNoSeam(m), /切線看得到/);
    assertOnlyHand(m);   // 只差在羽化：範圍判準照樣綠，紅的是切線
  }));
