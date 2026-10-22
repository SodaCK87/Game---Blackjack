// 守佈景（room.js）：各種螢幕比例下，荷官背後的牆上方都留得出一帶大廳光點、光點都在牆後面，
// 而且背景整體明顯比牌桌暗（使用者 2026-10-22 要求壓暗、不要花）。
// 驗不到：好不好看、像不像拉斯維加斯、花紋會不會太花（看 node tools/shoot.js <前綴> 的截圖）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const VIEWPORTS = {
  桌機: { size: [1280, 720], mobile: false },
  直式手機: { size: [390, 844], mobile: true },
  橫式手機: { size: [844, 390], mobile: true },
  平板: { size: [768, 1024], mobile: true },
  超寬螢幕: { size: [2560, 1080], mobile: false },
};

// 讀畫素要跟 render 在同一段同步程式裡，畫布還沒交出去之前內容才在
const MEASURE = `(async () => {
  const s = BJK.view.stage, V = BJK.view;
  await s.dealer.ready;
  const wallTop = JSON.parse(document.body.dataset.bjk).scene.wallTop;
  const gl = s.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const grab = () => { s.render(); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const lum = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const mean = (px, x0, x1, r0, r1) => {
    let sum = 0, n = 0;
    for (let r = Math.max(0, r0); r < Math.min(H, r1); r++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) { sum += lum(px, (r * W + x) * 4); n++; }
    return n ? sum / n : null;
  };
  const toPx = p => { const v = p.clone().project(s.camera); return { x: (v.x + 1) / 2 * W, row: (v.y + 1) / 2 * H, ndc: v }; };
  const wallRow = Math.ceil((wallTop + 1) / 2 * H);

  // 絨布：五塊避開籌碼架、牌盒與字的地方
  const full = grab();
  const felt = [[-2.5, 1.0], [2.5, 1.0], [0, 2.6], [-1, 4.3], [1, 4.3]].map(([x, z]) => {
    const p = toPx(new THREE.Vector3(x, 0.001, z));
    return mean(full, Math.round(p.x) - 4, Math.round(p.x) + 5, Math.round(p.row) - 4, Math.round(p.row) + 5);
  });

  // 只留佈景與燈光再畫一次：荷官的頭在手機上會蓋過牆上緣，不能算進背景
  const hidden = s.scene.children.filter(o => o !== s.room.group && !o.isLight && o.visible);
  hidden.forEach(o => { o.visible = false; });
  const bare = grab();
  hidden.forEach(o => { o.visible = true; });
  s.render();

  const bokeh = [];
  s.room.group.traverse(o => { if (o.userData.kind === 'bokeh' && o.visible) bokeh.push(o); });
  const shown = bokeh.filter(o => { const v = o.position.clone().project(s.camera); return Math.abs(v.x) <= 1 && v.y <= 1 && v.y > wallTop; });
  return {
    wallTop, bandFrac: (1 - wallTop) / 2,
    feltLum: felt.reduce((a, b) => a + b, 0) / felt.length,
    bandLum: mean(bare, 0, W, wallRow + 2, H),
    lowerLum: mean(bare, 0, W, 0, wallRow - 2),
    bokehShown: shown.length, bokehTotal: bokeh.length,
    frontMostZ: Math.max(...bokeh.map(o => o.position.z)), wallZ: V.room.WALL_Z,
  };
})()`;

async function measure(browser, appDir, viewport) {
  const r = await withPage(browser, viewport, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(MEASURE);
  });
  return { ...r.value, console: r.console, leftover: r.leftover };
}

function assertRoom(m, what) {
  const why = `${what}：${JSON.stringify(m)}`;
  assert.deepStrictEqual(m.console, [], why);
  assert.ok(m.bandFrac >= 0.1, `牆上緣以上留給大廳的不到畫面一成：${why}`);
  assert.ok(m.bokehShown >= 30, `看得到的光點太少：${why}`);
  assert.ok(m.frontMostZ < m.wallZ, `有光點跑到牆前面：${why}`);
  // 2026-10-22 量到背景約是絨布的兩到三成亮；門檻抓四成，再亮就是在跟牌桌搶眼
  assert.ok(m.bandLum < 0.4 * m.feltLum && m.lowerLum < 0.4 * m.feltLum, `背景太亮，跟牌桌搶眼：${why}`);
  assert.strictEqual(m.leftover, 0, why);
}

// edits：[[檔案, 原字串, 換成], …]，在暫存複本上改；沒命中就直接紅
function brokenCopy(edits) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  for (const [file, from, to] of edits) {
    const target = path.join(tmp, file);
    const text = fs.readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `破壞沒有命中：${file} 裡找不到 ${from}`);
    fs.writeFileSync(target, text.replace(from, to));
  }
  return tmp;
}

const first = availableBrowsers()[0];
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${first}・${name}：牆上方留得出大廳光點、光點都在牆後、背景不到牌桌的四成亮`, async t => {
    const m = await measure(first, APP, viewport);
    t.diagnostic(`牆上緣 ${(m.bandFrac * 100).toFixed(0)}% 畫面；光點 ${m.bokehShown}/${m.bokehTotal}；亮度 大廳 ${m.bandLum.toFixed(1)}、牆與地毯 ${m.lowerLum.toFixed(1)}、絨布 ${m.feltLum.toFixed(1)}`);
    assertRoom(m, name);
  });
}

const ROOM = path.join('js', 'view', 'room.js');
const CONTROLS = [
  ['光點擺到牆前面', VIEWPORTS.桌機, [[ROOM, 'WALL_Z - 3 - (i % 7) * 2', 'WALL_Z + 6 - (i % 7) * 2']], /光點跑到牆前面/],
  ['大廳底色調亮', VIEWPORTS.直式手機, [[ROOM, 'const VOID = 0x0d1215;', 'const VOID = 0x5a6468;']], /背景太亮/],
  ['牆加高到擋住大廳', VIEWPORTS.桌機, [[ROOM, 'WALL_H = 1.3', 'WALL_H = 6']], /留給大廳的不到畫面一成/],
];
for (const [name, viewport, edits, expect] of CONTROLS) {
  test(`陽性對照：${name}，要被抓到`, async () => {
    const tmp = brokenCopy(edits);
    try {
      const m = await measure(first, tmp, viewport);
      assert.throws(() => assertRoom(m, name), expect);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
