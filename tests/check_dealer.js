// 守荷官：預設造型的點陣插畫每種表情立牌貼的是自己那張、臉框量在臉上（產出檔本身由 check_dealer_art.js 守）；
// 對白泡泡在桌機與直式手機（含矮的直式，BJK-11）都要整個在畫面內、不蓋住荷官的臉、而且貼在臉旁邊，講到一半換表情也一樣，
// 也不跟看得到的按鈕、拉頁把手、版本號疊在一起；凸出泡泡的名牌與尖角也一樣（泡泡的外觀與字型在 check_bubble.js）；
// 舊版造型五種表情都只有兩隻手（BJK-01）；點荷官換造型；大特寫跟著造型；橫式畫面插畫荷官放大 1.2 倍而框景不變。
// 驗不到：插畫好不好看、裁得好不好（看 node tools/shoot.js <前綴> --dealer 與 tools/_shots/art-<表情>-marks.png）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };
const PHONE_LANDSCAPE = { size: [844, 390], mobile: true };
// 矮的直式（BJK-11）：真手機網址列吃掉一截，頭頂離畫面頂放不下一行字
const SHORT_PHONE = { size: [390, 720], mobile: true };
const SMALL_PHONE = { size: [360, 640], mobile: true };
const LONG = '這一局荷官的明牌是 A，我先偷看一下底牌，請稍等。';
const SHORT = '發牌囉。';
const MOODS = ['idle', 'deal', 'surprised', 'smile', 'sorry'];

const SAVED_CLASSIC = `localStorage.setItem('bjk.prefs.v1', '{"look":"classic"}');`;
const DEALER_JS = path.join('js', 'view', 'dealer.js');
const ART_JS = path.join('js', 'view', 'dealer_art.js');
const VB_W = Number(fs.readFileSync(path.join(APP, DEALER_JS), 'utf8').match(/VB_W = (\d+)/)[1]);

function loadArt() {
  const window = { BJK: { view: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(APP, ART_JS), 'utf8'), { window });
  return window.BJK.view.dealerArt;
}

// ---- 對白泡泡 ----
// 畫面上看得到的每一顆按鈕與版本號（不寫死是哪幾顆：之後多的按鈕一樣要讓）：收在拉頁裡（看不到、或在畫面外）、藏起來的不算
const UI = `[...document.querySelectorAll('button, #ver')].map(el => {
  const r = el.getBoundingClientRect();
  return { id: el.id || el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
           shown: getComputedStyle(el).visibility === 'visible' && r.width > 0 && r.right > 0 && r.left < innerWidth };
}).filter(u => u.shown)`;
// 泡泡本體以外凸出去的部分：壓在框線上的名牌、框線（含尖角）
const PARTS = `(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const b = document.getElementById('bubble');
  return { plate: box(b.querySelector('.bubble-plate')), frame: box(b.querySelector('.bubble-frame .edge')) };
})()`;
async function measure(browser, appDir, viewport) {
  const r = await withPage(browser, viewport, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(`(async () => {
      const d = BJK.view.stage.dealer;
      await d.ready;
      d.say(${JSON.stringify(LONG)});
      const b = document.getElementById('bubble').getBoundingClientRect();
      return { bubble: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, parts: ${PARTS},
               face: d.faceRect(), vw: innerWidth, vh: innerHeight, ui: ${UI} };
    })()`);
  });
  return { ...r.value, console: r.console };
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
function gap(a, b) {
  const dx = Math.max(0, b.left - a.right, a.left - b.right);
  const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return Math.hypot(dx, dy);
}

function assertBubble(m) {
  const why = JSON.stringify(m);
  assert.ok(m.bubble.right - m.bubble.left > 50, `泡泡沒有顯示出來：${why}`);
  assert.ok(m.bubble.left >= 0 && m.bubble.top >= 0 && m.bubble.right <= m.vw && m.bubble.bottom <= m.vh, `泡泡超出畫面：${why}`);
  assert.ok(!overlaps(m.bubble, m.face), `泡泡蓋到荷官的臉：${why}`);
  assert.ok(gap(m.bubble, m.face) < 40, `泡泡離荷官的臉太遠，看不出是誰在講話：${why}`);
  assert.deepStrictEqual(m.ui.filter(u => overlaps(m.bubble, u)).map(u => u.id), [], `泡泡跟按鈕、把手或版本號疊在一起：${why}`);
  // 名牌與尖角凸出泡泡本體，一樣要在畫面內、不蓋臉、不疊按鈕
  for (const [k, r] of Object.entries(m.parts)) {
    assert.ok(r.left >= 0 && r.top >= 0 && r.right <= m.vw && r.bottom <= m.vh, `泡泡的 ${k} 超出畫面：${why}`);
    assert.ok(!overlaps(r, m.face), `泡泡的 ${k} 蓋到荷官的臉：${why}`);
    assert.deepStrictEqual(m.ui.filter(u => overlaps(r, u)).map(u => u.id), [], `泡泡的 ${k} 跟按鈕、把手或版本號疊在一起：${why}`);
  }
  if (m.console) assert.deepStrictEqual(m.console, []);
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

for (const browser of availableBrowsers()) {
  for (const [name, vp] of [['桌機', DESKTOP], ['直式手機', PHONE], ['矮的直式手機', SHORT_PHONE], ['小的直式手機', SMALL_PHONE], ['橫式手機', PHONE_LANDSCAPE]]) {
    test(`${browser}：${name}的長句泡泡在畫面內、貼著荷官的臉但不蓋住`, async () => {
      assertBubble(await measure(browser, APP, vp));
    });
    test(`${browser}：舊版造型在${name}的長句泡泡也一樣`, async () => {
      assertBubble(await measure(browser, APP, { ...vp, init: SAVED_CLASSIC }));
    });
  }
}

test('陽性對照：拿掉「右邊放不下就放頭頂」，直式手機的泡泡要判成蓋到臉', async () => {
  const tmp = brokenCopy([[DEALER_JS, 'if (face.right + gap + w <= vw - m) {', 'if (true) {']]);
  try {
    const m = await measure(availableBrowsers()[0], tmp, PHONE);
    assert.ok(overlaps(m.bubble, m.face), `破壞後泡泡仍沒蓋到臉，這條判準沒在分辨：${JSON.stringify(m)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 插畫每種表情的頭框各自量（v0.20.0 的西裝荷官驚訝偏右、遺憾偏低）：五種表情各講一次長句、一次短句；再在遺憾時講、講到一半換成發牌
const EACH_MOOD = `(async () => {
  const d = BJK.view.stage.dealer;
  await d.ready;
  const box = () => { const b = document.getElementById('bubble').getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const snap = () => ({ bubble: box(), parts: ${PARTS}, face: d.faceRect(), vw: innerWidth, vh: innerHeight, ui: ${UI} });
  const out = {};
  for (const m of Object.keys(BJK.view.dealer.MOODS)) {
    d.setMood(m);
    d.say(${JSON.stringify(LONG)}); out[m] = snap();
    d.say(${JSON.stringify(SHORT)}); out[m + '・短句'] = snap();
  }
  d.setMood('sorry'); d.say(${JSON.stringify(LONG)}); d.setMood('deal');
  out['遺憾講到一半換成發牌'] = snap();
  return out;
})()`;
const eachMood = (appDir, vp) => withPage(availableBrowsers()[0], vp, async page => {
  await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
  return page.evaluate(EACH_MOOD);
});

for (const [name, vp] of [['桌機', DESKTOP], ['直式手機', PHONE], ['矮的直式手機', SHORT_PHONE], ['小的直式手機', SMALL_PHONE]]) {
  test(`${availableBrowsers()[0]}：${name}五種表情、長句短句的泡泡都不蓋臉、不疊到按鈕，講到一半換表情也跟著讓開`, async () => {
    const r = await eachMood(APP, vp);
    assert.strictEqual(Object.keys(r.value).length, 11);
    for (const [k, m] of Object.entries(r.value)) assert.doesNotThrow(() => assertBubble(m), `${k}：${JSON.stringify(m)}`);
    assert.deepStrictEqual(r.console, []);
  });
}

// BJK-11 的兩半：頭頂放不下時夾回頂端（v0.21.0 的做法）會蓋到臉；按鈕與版本號留在上方兩個角落（v0.21.0 的版面）會跟泡泡疊在一起
test('陽性對照：頭頂放不下時照舊夾回畫面頂端，矮的直式手機上要判成蓋到臉', async () => {
  const tmp = brokenCopy([[DEALER_JS, '} else if (face.top - gap - h >= m + lift) {', '} else if (true) {']]);
  try {
    const r = (await eachMood(tmp, SHORT_PHONE)).value;
    assert.ok(Object.values(r).some(m => overlaps(m.bubble, m.face)), `破壞後泡泡仍沒蓋到臉，這條判準沒在分辨：${JSON.stringify(r)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：直式畫面不收拉頁、按鈕與版本號留在上方兩個角落，矮的直式手機上要判成疊到泡泡', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'main.js'), "const orient = aspect < 1 ? 'portrait' : 'landscape';", "const orient = 'landscape';"]]);
  try {
    const r = (await eachMood(tmp, SHORT_PHONE)).value;
    const hits = Object.values(r).flatMap(m => m.ui.filter(u => overlaps(m.bubble, u)).map(u => u.id));
    assert.ok(hits.includes('soundToggle') || hits.includes('statsBtn'), `破壞後泡泡仍沒疊到按鈕：${JSON.stringify(r)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 旗袍荷官（v0.23.0）五種表情的頭只差幾個像素，不重擺也蓋不到。複本裡把發牌的頭框搬到遺憾那顆頭的右邊一個頭寬（遺憾時泡泡擺的地方），
// 當成換表情頭會移動的插畫；同一份搬過的複本照常重擺時不准蓋到，紅才是因為沒重擺
test('陽性對照：換表情時泡泡不重擺，桌機上要判成遺憾換成發牌時蓋到臉', async () => {
  const art = loadArt(), deal = art.marks.deal, [x0, y0, x1, y1] = art.marks.sorry.head;
  const line = marks => `      deal: ${JSON.stringify(marks)},`;
  const moved = [ART_JS, line(deal), line({ ...deal, head: [x1, y0, +(2 * x1 - x0).toFixed(1), y1] })];
  const ok = brokenCopy([moved]);
  const tmp = brokenCopy([moved, [DEALER_JS, '        onChange();\n      }\n      placeBubble();\n', '        onChange();\n      }\n']]);
  try {
    const good = (await eachMood(ok, DESKTOP)).value['遺憾講到一半換成發牌'];
    assert.ok(!overlaps(good.bubble, good.face), `照常重擺也蓋到，搬頭框的量法有誤：${JSON.stringify(good)}`);
    const m = (await eachMood(tmp, DESKTOP)).value['遺憾講到一半換成發牌'];
    assert.ok(overlaps(m.bubble, m.face), JSON.stringify(m));
  } finally {
    fs.rmSync(ok, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- 插畫的貼圖與臉框 ----
// 立牌每種表情貼的是自己那張；量產出檔記的五官框：要落在人身上（側臉的框會帶到一點臉外的背景）、而且有一定比例是膚色（框跟畫出來的臉對得上）
const ART_TEX = `(async () => {
  const d = BJK.view.stage.dealer, A = BJK.view.dealerArt;
  await d.ready;
  const out = { look: d.look, loaded: d.loaded, standee: {}, face: {} };
  for (const m of Object.keys(BJK.view.dealer.MOODS)) {
    d.setMood(m);
    const img = d.mesh.material.map.image;
    out.standee[m] = img.src === A.images[m] && img.naturalWidth === A.size[0] && img.naturalHeight === A.size[1];
    const c = document.createElement('canvas'); c.width = A.size[0]; c.height = A.size[1];
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const k = A.size[0] / ${VB_W}, [x0, y0, x1, y1] = A.marks[m].face.map(v => Math.round(v * k));
    const p = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let opaque = 0, skin = 0;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (p[i + 3] > 200) opaque++;
      if (p[i + 3] > 200 && r > 215 && g > 150 && g < 228 && b > 100 && b < 200 && r - b > 45 && r - g > 15) skin++;
    }
    const [hx0, hy0, hx1, hy1] = A.marks[m].head, [fx0, fy0, fx1, fy1] = A.marks[m].face;
    out.face[m] = { opaque: +(opaque / (p.length / 4)).toFixed(3), skin: +(skin / (p.length / 4)).toFixed(3),
                    inHead: fx0 >= hx0 && fy0 >= hy0 && fx1 <= hx1 && fy1 <= hy1 };
  }
  return out;
})()`;
const artTex = appDir => withPage(availableBrowsers()[0], DESKTOP, async page => {
  await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
  return page.evaluate(ART_TEX);
});
function faceMarkProblems(face) {
  return Object.entries(face).filter(([, f]) => !(f.opaque >= 0.9 && f.skin >= 0.3 && f.inHead)).map(([m, f]) => `${m}：${JSON.stringify(f)}`);
}

test(`${availableBrowsers()[0]}：預設是插畫，五張都載入，每種表情立牌貼自己那張，五官框量在臉上`, async t => {
  const r = await artTex(APP), why = JSON.stringify(r.value);
  t.diagnostic(`五官框：${JSON.stringify(r.value.face)}`);
  assert.strictEqual(r.value.look, 'art', why);
  assert.strictEqual(r.value.loaded, 5, why);
  assert.deepStrictEqual(r.value.standee, Object.fromEntries(MOODS.map(m => [m, true])), why);
  assert.deepStrictEqual(faceMarkProblems(r.value.face), []);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：五種表情都貼待機那張，要判成貼錯圖', async () => {
  const tmp = brokenCopy([[DEALER_JS, 'src: mood => ART.images[mood],', 'src: () => ART.images.idle,']]);
  try {
    const s = (await artTex(tmp)).value.standee;
    assert.deepStrictEqual(Object.keys(s).filter(m => !s[m]), ['deal', 'surprised', 'smile', 'sorry']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 旗袍荷官（v0.23.0）五種表情的頭擺在差不多的位置，換成別張的框量不出錯；改把框搬到頭框頂端的頭髮上：
// 框還在頭裡、也不透明，只剩膚色量得出不對
test('陽性對照：待機的五官框搬到頭頂的頭髮上，要判成框不在臉上', async () => {
  const idle = loadArt().marks.idle, [x0, y0, x1, y1] = idle.face, top = idle.head[1];
  const line = marks => `      idle: ${JSON.stringify(marks)},`;
  const tmp = brokenCopy([[ART_JS, line(idle), line({ ...idle, face: [x0, top, x1, +(top + y1 - y0).toFixed(1)] })]]);
  try {
    const face = (await artTex(tmp)).value.face;
    assert.ok(faceMarkProblems(face).some(p => p.startsWith('idle：')), JSON.stringify(face.idle));
    assert.ok(face.idle.inHead && face.idle.skin < 0.3, `要紅在膚色不夠，不是框跑出頭外：${JSON.stringify(face.idle)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- 舊版造型的手臂（BJK-01 就是出在這一款）----
// 把每種表情的 SVG 畫到畫布上，讀兩邊垂袖處（SVG 座標）的不透明度：只有發牌時舉右手，右袖處要空
const ARMS = `(async () => {
  await BJK.view.stage.dealer.ready;
  const read = mood => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 560; c.height = 520;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 560, 520);
      const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
      ok({ left: alpha(166, 490), right: alpha(394, 490) });
    };
    img.onerror = () => fail(new Error(mood + ' 的 SVG 載不起來'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(BJK.view.dealer.classicSvg(mood));
  });
  const out = {};
  for (const m of Object.keys(BJK.view.dealer.MOODS)) out[m] = await read(m);
  return out;
})()`;

async function measureArms(appDir) {
  const r = await withPage(availableBrowsers()[0], DESKTOP, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(ARMS);
  });
  return r.value;
}

function assertClassicArms(arms) {
  const why = JSON.stringify(arms);
  assert.deepStrictEqual(Object.keys(arms), MOODS, `表情清單對不上：${why}`);
  for (const [mood, a] of Object.entries(arms)) {
    assert.strictEqual(a.left, 255, `${mood}：左袖不見了（量法可能讀錯）：${why}`);
    assert.strictEqual(a.right, mood === 'deal' ? 0 : 255, mood === 'deal' ? `發牌時右袖還垂著，多一隻手：${why}` : `${mood}：右袖不見了：${why}`);
  }
}

// ---- 橫式畫面放大插畫荷官（v0.21.0，使用者 2026-11-16 要 1.2 倍、裁掉下半身）----
// 臉框在畫面上的高度，跟同一頁關掉放大（setLandscape(false)）時比；鏡頭位置跟「插畫不放大」的複本比，框景不准因此變
const ZOOM = `(async () => {
  const s = BJK.view.stage, d = s.dealer; await d.ready;
  const h = () => { const f = d.faceRect(); return f.bottom - f.top; };
  const zoomed = h();
  d.setLandscape(false);
  const plain = h();
  return { ratio: +(zoomed / plain).toFixed(3), face: Math.round(zoomed), cam: s.camera.position.toArray() };
})()`;
const zoomOf = (appDir, vp) => withPage(availableBrowsers()[0], vp, async page => {
  await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
  return page.evaluate(ZOOM);
});
const NO_ZOOM = [path.join('js', 'view', 'dealer.js'), 'zoom: 1.2,', 'zoom: 1,'];
function assertZoom(desk, phone) {
  const why = JSON.stringify({ desk, phone });
  assert.ok(Math.abs(desk.ratio - 1.2) < 0.02, `桌機的荷官沒放大 1.2 倍：${why}`);
  assert.strictEqual(phone.ratio, 1, `直式手機的荷官也被放大了：${why}`);
}
const sameCam = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test(`${availableBrowsers()[0]}：桌機的插畫荷官放大 1.2 倍、鏡頭框景跟不放大時一樣，直式手機不放大`, async t => {
  const tmp = brokenCopy([NO_ZOOM]);
  try {
    const desk = (await zoomOf(APP, DESKTOP)).value, phone = (await zoomOf(APP, PHONE)).value, plain = (await zoomOf(tmp, DESKTOP)).value;
    t.diagnostic(`桌機待機頭頂到下巴 ${desk.face} 像素（${desk.ratio} 倍）；直式手機 ${phone.ratio} 倍`);
    assertZoom(desk, phone);
    assert.ok(sameCam(desk.cam, plain.cam), `放大後鏡頭換了位置，整桌會變小：${JSON.stringify({ desk: desk.cam, plain: plain.cam })}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：排版時不告訴荷官畫面是橫的，要判成桌機沒放大', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'main.js'), 'dealer.setLandscape(aspect >= 1);', 'dealer.setLandscape(false);']]);
  try {
    const desk = (await zoomOf(tmp, DESKTOP)).value, phone = (await zoomOf(tmp, PHONE)).value;
    assert.throws(() => assertZoom(desk, phone), /桌機的荷官沒放大/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：改用整個立牌放大 1.2 倍，要判成鏡頭換了位置', async () => {
  const plainDir = brokenCopy([NO_ZOOM]);
  const tmp = brokenCopy([NO_ZOOM, [path.join('js', 'view', 'main.js'), 'dealer.mesh.scale.setScalar(aspect < 1 ? 2.2 : 1);', 'dealer.mesh.scale.setScalar(aspect < 1 ? 2.2 : 1.2);']]);
  try {
    const scaled = (await zoomOf(tmp, DESKTOP)).value, plain = (await zoomOf(plainDir, DESKTOP)).value;
    assert.ok(!sameCam(scaled.cam, plain.cam), JSON.stringify({ scaled: scaled.cam, plain: plain.cam }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});

test('舊版造型：五種表情都只有兩隻手', async () => {
  assertClassicArms(await measureArms(APP));
});

test('陽性對照：舊版發牌時照樣畫垂著的右袖，要判成多一隻手', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'dealer_classic.js'), "${mood === 'deal' ? '' : RIGHT_SLEEVE}", '${RIGHT_SLEEVE}']]);
  try {
    const arms = await measureArms(tmp);
    assert.throws(() => assertClassicArms(arms), /多一隻手/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- 點荷官換造型。用 CDP 真的點，點到哪個物件由頁面自己的射線判斷 ----
const open = async (page, appDir) => {
  await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
  return page.evaluate(`(async () => { const d = BJK.view.stage.dealer; await d.ready; const f = d.faceRect();
    return { x: (f.left + f.right) / 2, y: f.top + (f.bottom - f.top) * 0.6 }; })()`);
};
const lookNow = page => page.evaluate(`({ look: BJK.view.stage.dealer.look, loaded: BJK.view.stage.dealer.loaded,
  says: document.getElementById('bubble').textContent, prefs: JSON.parse(localStorage.getItem('bjk.prefs.v1') || '{}') })`);
// 換造型要等五張圖解碼，輪詢到變了為止；等不到就回最後看到的
const clickAndWait = async (page, x, y, ms = 3000) => {
  const before = (await lookNow(page)).look;
  await page.click(x, y);
  for (let t = 0; t < ms; t += 30) {
    await page.evaluate('new Promise(r => setTimeout(r, 30))');
    const now = await lookNow(page);
    if (now.look !== before) return now;
  }
  return lookNow(page);
};

for (const [name, vp] of [['桌機', DESKTOP], ['直式手機', PHONE]]) {
  test(`${availableBrowsers()[0]}：${name}點荷官換造型，再點換回來，重新整理後記得，勝率與音效開關不受影響`, async () => {
    const r = await withPage(availableBrowsers()[0], { ...vp, init: `if (!localStorage.getItem('bjk.prefs.v1')) localStorage.setItem('bjk.prefs.v1', '{"odds":false}');` }, async page => {
      const at = await open(page, APP);
      const first = await lookNow(page);
      const second = await clickAndWait(page, at.x, at.y);
      await open(page, APP);
      const reloaded = await lookNow(page);
      const at2 = await open(page, APP);
      const third = await clickAndWait(page, at2.x, at2.y);
      return { first, second, reloaded, third };
    });
    const { first, second, reloaded, third } = r.value, why = JSON.stringify(r.value);
    assert.strictEqual(first.look, 'art', why);
    assert.strictEqual(second.look, 'classic', `點了沒換：${why}`);
    assert.strictEqual(second.loaded, 5, why);
    assert.strictEqual(second.says, '還是這身穿起來順手。', why);
    assert.deepStrictEqual(second.prefs, { odds: false, look: 'classic' }, why);
    assert.strictEqual(reloaded.look, 'classic', `重新整理後沒記得：${why}`);
    assert.strictEqual(third.look, 'art', `換不回來：${why}`);
    assert.strictEqual(third.says, '這身才夠氣勢。', why);
    assert.deepStrictEqual(r.console, []);
  });
}

// 桌機 1280×720：輪到立牌但不是人的地方（透明處、桌子擋住的地方）
const MISSES = { '立牌的透明處': [545, 140], '籌碼架': [640, 285], '牌桌': [640, 400], '牆': [300, 130] };

async function missedLook(appDir, target) {
  const r = await withPage(availableBrowsers()[0], DESKTOP, async page => {
    await open(page, appDir);
    return (await clickAndWait(page, ...target, 700)).look;
  });
  return r.value;
}

for (const [name, target] of Object.entries(MISSES)) {
  test(`${availableBrowsers()[0]}：點${name}不會換造型`, async () => {
    assert.strictEqual(await missedLook(APP, target), 'art');
  });
}

test('陽性對照：不看透明度，點立牌的透明處要判成換了', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'main.js'), 'if (!hit || !dealer.opaque(hit.uv)) return false;', 'if (!hit) return false;']]);
  try {
    assert.strictEqual(await missedLook(tmp, MISSES['立牌的透明處']), 'classic');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：不看前面有沒有擋著，點籌碼架要判成換了', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'main.js'), 'return !front || front.distance > hit.distance;', 'return true;']]);
  try {
    assert.strictEqual(await missedLook(tmp, MISSES['籌碼架']), 'classic');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

async function promptAfterSwitch(appDir) {
  const r = await withPage(availableBrowsers()[0], DESKTOP, async page => {
    const at = await open(page, appDir);
    await page.evaluate(`BJK.view.stage.dealer.say('輪到你了：要牌還是停牌？'); true`);
    const during = await clickAndWait(page, at.x, at.y);
    await page.evaluate(`new Promise(r => setTimeout(r, BJK.view.dealer.ASIDE_MS + 200))`);
    return { during: during.says, after: (await lookNow(page)).says };
  });
  return r.value;
}

test(`${availableBrowsers()[0]}：輪到你時換造型，講完那句話要把提示放回來`, async () => {
  const v = await promptAfterSwitch(APP);
  assert.strictEqual(v.during, '還是這身穿起來順手。', JSON.stringify(v));
  assert.strictEqual(v.after, '輪到你了：要牌還是停牌？', JSON.stringify(v));
});

test('陽性對照：講完不放回原本那句，要判成提示不見了', async () => {
  const tmp = brokenCopy([[DEALER_JS, 'else show(beforeAside);', '']]);
  try {
    const v = await promptAfterSwitch(tmp);
    assert.notStrictEqual(v.after, '輪到你了：要牌還是停牌？', JSON.stringify(v));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test(`${availableBrowsers()[0]}：換造型只重畫一次、不開迴圈，滑鼠移到荷官身上變手指游標`, async () => {
  const r = await withPage(availableBrowsers()[0], DESKTOP, async page => {
    const at = await open(page, APP);
    const hover = (x, y) => page.evaluate(`(() => { const c = document.getElementById('table');
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x}, clientY: ${y}, pointerType: 'mouse', bubbles: true })); return c.style.cursor; })()`);
    const on = await hover(at.x, at.y), off = await hover(300, 130);
    const frames = () => page.evaluate('BJK.view.stage.renderer.info.render.frame');
    await page.evaluate('new Promise(r => setTimeout(r, 300))');
    const f0 = await frames();
    await clickAndWait(page, at.x, at.y);
    const f1 = await frames();
    await page.evaluate(`new Promise(r => setTimeout(r, BJK.view.dealer.ASIDE_MS + 300))`);
    return { on, off, drew: f1 - f0, later: (await frames()) - f1 };
  });
  const why = JSON.stringify(r.value);
  assert.strictEqual(r.value.on, 'pointer', why);
  assert.strictEqual(r.value.off, '', why);
  assert.strictEqual(r.value.drew, 1, why);
  assert.strictEqual(r.value.later, 0, why);
});

// ---- 大特寫跟著目前的造型 ----
// 插畫：裁的是立牌那張、表情對（荷官 Blackjack 是微笑），五官框在；舊版：SVG（有 #bjkSkin 漸層）
const FX_LOOK = `(() => {
  BJK.view.fx.showcase('dealer');
  // 開頁後的預演（.bigfx-warm，你拿 Blackjack 那段）可能還在頁面上，只認真的這一段
  const f = document.querySelector('.bigfx[data-kind="dealer"] .bigfx-face'), img = f.querySelector('image');
  return { classic: !!f.querySelector('#bjkSkin'), art: !!img && img.getAttribute('href') === BJK.view.dealerArt.images.smile, face: !!f.querySelector('.face') };
})()`;

test(`${availableBrowsers()[0]}：大特效的臉跟著目前的造型；播的時候點荷官不換`, async () => {
  const art = await withPage(availableBrowsers()[0], DESKTOP, async page => {
    await open(page, APP);
    return page.evaluate(FX_LOOK);
  });
  assert.deepStrictEqual(art.value, { classic: false, art: true, face: true });
  const r = await withPage(availableBrowsers()[0], { ...DESKTOP, init: SAVED_CLASSIC }, async page => {
    const at = await open(page, APP);
    const shown = await page.evaluate(FX_LOOK);
    const during = await clickAndWait(page, at.x, at.y, 500);
    return { ...shown, during: during.look };
  });
  assert.deepStrictEqual(r.value, { classic: true, art: false, face: true, during: 'classic' });
});

test('陽性對照：大特效不看目前造型，要判成臉不對', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'showcase.js'), 'V.dealer.portrait(mood)', "V.dealer.portrait(mood, 'art')"]]);
  try {
    const r = await withPage(availableBrowsers()[0], { ...DESKTOP, init: SAVED_CLASSIC }, async page => {
      await open(page, tmp);
      return page.evaluate(FX_LOOK);
    });
    assert.strictEqual(r.value.classic, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 存著已拿掉的 JOJO 造型（v0.16～v0.19 的預設）或壞值的玩家，一律落回預設、不擲錯
test(`${availableBrowsers()[0]}：偏好裡的造型是舊的 jojo 或壞值時當成預設，不擲錯`, async () => {
  for (const bad of ['"jojo"', '"constructor"', '"xxx"', '123', 'null']) {
    const r = await withPage(availableBrowsers()[0], { ...DESKTOP, init: `localStorage.setItem('bjk.prefs.v1', '{"look":${bad}}');` }, async page => {
      await open(page, APP);
      return lookNow(page);
    });
    assert.strictEqual(r.value.look, 'art', bad);
    assert.strictEqual(r.value.loaded, 5, bad);
    assert.deepStrictEqual(r.console, [], bad);
  }
});

// 「泡泡在畫面內」這條沒有陽性對照，2026-10-22 試過兩種都造不出真實的出界：
// 往右出界被瀏覽器擋掉（position: fixed 的泡泡寬度是 auto，會自己縮窄換行）；
// 往上出界要荷官的臉貼近畫面頂端，而實測 6 種尺寸（390×844 到 1280×720）臉的上緣最少還有 78px。
// dealer.js 的夾回是保險，不是現在靠它撐著。
