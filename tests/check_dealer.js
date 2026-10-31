// 守荷官：對白泡泡在桌機與直式手機都要整個在畫面內、不蓋住荷官的臉、而且貼在臉旁邊；五種表情都只有兩隻手（BJK-01）；點荷官換造型。
// 驗不到：表情畫得好不好看（看 node tools/shoot.js <前綴> --dealer 的截圖）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };
const PHONE_LANDSCAPE = { size: [844, 390], mobile: true };
const LONG = '這一局荷官的明牌是 A，我先偷看一下底牌，請稍等。';

const SAVED_CLASSIC = `localStorage.setItem('bjk.prefs.v1', '{"look":"classic"}');`;

async function measure(browser, appDir, viewport) {
  const r = await withPage(browser, viewport, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(`(async () => {
      const d = BJK.view.stage.dealer;
      await d.ready;
      d.say(${JSON.stringify(LONG)});
      const b = document.getElementById('bubble').getBoundingClientRect();
      return { bubble: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
               face: d.faceRect(), vw: innerWidth, vh: innerHeight };
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
  assert.deepStrictEqual(m.console, []);
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
  for (const [name, vp] of [['桌機', DESKTOP], ['直式手機', PHONE], ['橫式手機', PHONE_LANDSCAPE]]) {
    test(`${browser}：${name}的長句泡泡在畫面內、貼著荷官的臉但不蓋住`, async () => {
      assertBubble(await measure(browser, APP, vp));
    });
    test(`${browser}：舊版造型在${name}的長句泡泡也一樣`, async () => {
      assertBubble(await measure(browser, APP, { ...vp, init: SAVED_CLASSIC }));
    });
  }
}

const DEALER_JS = path.join('js', 'view', 'dealer.js');

test('陽性對照：拿掉「右邊放不下就放頭頂」，直式手機的泡泡要判成蓋到臉', async () => {
  const tmp = brokenCopy([[DEALER_JS, 'if (face.right + gap + w <= vw - 8) {', 'if (true) {']]);
  try {
    const m = await measure(availableBrowsers()[0], tmp, PHONE);
    assert.ok(overlaps(m.bubble, m.face), `破壞後泡泡仍沒蓋到臉，這條判準沒在分辨：${JSON.stringify(m)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 舉起來的那隻手，原本垂著的袖子就不能再畫（使用者 2026-10-22 回報「多了一隻手臂」）。
// 把每種表情的 SVG 畫到畫布上，讀兩個點的不透明度（SVG 座標）：兩邊垂袖處，舉手那一側要空、另一側要有東西；再數一次手臂有幾組
const RAISED = { idle: 'left', deal: 'right', surprised: 'left', smile: 'right', sorry: 'right' };
const ARMS = (look, lx, rx) => `(async () => {
  await BJK.view.stage.dealer.ready;
  const read = mood => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 560; c.height = 520;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 560, 520);
      const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
      const doc = new DOMParser().parseFromString(BJK.view.dealer.svg(mood, null, '${look}'), 'image/svg+xml');
      ok({ left: alpha(${lx}, 490), right: alpha(${rx}, 490), arms: doc.querySelectorAll('g.arm').length });
    };
    img.onerror = () => fail(new Error(mood + ' 的 SVG 載不起來'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(BJK.view.dealer.svg(mood, null, '${look}'));
  });
  const out = {};
  for (const m of Object.keys(BJK.view.dealer.MOODS)) out[m] = await read(m);
  return out;
})()`;

async function measureArms(appDir, look = 'jojo') {
  const r = await withPage(availableBrowsers()[0], DESKTOP, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    return page.evaluate(look === 'jojo' ? ARMS(look, 118, 446) : ARMS(look, 166, 394));
  });
  return r.value;
}

function assertTwoArms(arms) {
  const why = JSON.stringify(arms);
  assert.deepStrictEqual(Object.keys(arms).sort(), Object.keys(RAISED).sort(), `表情清單跟 RAISED 對不上：${why}`);
  for (const [mood, a] of Object.entries(arms)) {
    for (const side of ['left', 'right']) {
      if (side === RAISED[mood]) assert.strictEqual(a[side], 0, `${mood}：${side} 手舉起來了袖子還垂著，多一隻手：${why}`);
      else assert.strictEqual(a[side], 255, `${mood}：${side} 袖不見了（量法可能讀錯）：${why}`);
    }
    assert.strictEqual(a.arms, 2, `${mood}：畫了 ${a.arms} 組手臂：${why}`);
  }
}

test(`${availableBrowsers()[0]}：五種表情都只有兩隻手，舉起來的那隻手不再另外垂一隻袖子`, async () => {
  assertTwoArms(await measureArms(APP));
});

test('陽性對照：舉手時照樣畫垂著的袖子（不算手臂組數），要判成多一隻手', async () => {
  const tmp = brokenCopy([[DEALER_JS, '${left()}${right()}', `\${left()}\${right()}\${ARM_R.hang().replace('class="arm"', '')}`]]);
  try {
    const arms = await measureArms(tmp);
    assert.throws(() => assertTwoArms(arms), /多一隻手/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：多畫一隻舉起來的手（垂袖處看不出來），要判成手臂組數不對', async () => {
  const tmp = brokenCopy([[DEALER_JS, '${left()}${right()}', '${left()}${right()}${ARM_R.brow()}']]);
  try {
    const arms = await measureArms(tmp);
    assert.throws(() => assertTwoArms(arms), /畫了 3 組手臂/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：垂著的袖子不畫，要判成袖子不見了', async () => {
  const tmp = brokenCopy([[DEALER_JS, 'hang: () => arm([[146, 356], [122, 446], [112, 620]]),', 'hang: () => arm([[146, 356], [122, 400], [112, 420]]),']]);
  try {
    const arms = await measureArms(tmp);
    assert.throws(() => assertTwoArms(arms), /袖不見了/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 舊版造型只有發牌時舉右手（BJK-01 就是出在這一款），表情鍵照 RAISED 的順序讀
function assertClassicArms(arms) {
  const why = JSON.stringify(arms);
  for (const [mood, a] of Object.entries(arms)) {
    assert.strictEqual(a.left, 255, `${mood}：左袖不見了（量法可能讀錯）：${why}`);
    assert.strictEqual(a.right, mood === 'deal' ? 0 : 255, mood === 'deal' ? `發牌時右袖還垂著，多一隻手：${why}` : `${mood}：右袖不見了：${why}`);
  }
}

test('舊版造型：五種表情都只有兩隻手', async () => {
  assertClassicArms(await measureArms(APP, 'classic'));
});

test('陽性對照：舊版發牌時照樣畫垂著的右袖，要判成多一隻手', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'dealer_classic.js'), "${mood === 'deal' ? '' : RIGHT_SLEEVE}", '${RIGHT_SLEEVE}']]);
  try {
    const arms = await measureArms(tmp, 'classic');
    assert.throws(() => assertClassicArms(arms), /多一隻手/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 點荷官換造型。用 CDP 真的點，點到哪個物件由頁面自己的射線判斷
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
    assert.strictEqual(first.look, 'jojo', why);
    assert.strictEqual(second.look, 'classic', `點了沒換：${why}`);
    assert.strictEqual(second.loaded, 5, why);
    assert.strictEqual(second.says, '還是這身穿起來順手。', why);
    assert.deepStrictEqual(second.prefs, { odds: false, look: 'classic' }, why);
    assert.strictEqual(reloaded.look, 'classic', `重新整理後沒記得：${why}`);
    assert.strictEqual(third.look, 'jojo', `換不回來：${why}`);
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
    assert.strictEqual(await missedLook(APP, target), 'jojo');
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

test(`${availableBrowsers()[0]}：大特效的臉跟著目前的造型；播的時候點荷官不換`, async () => {
  const r = await withPage(availableBrowsers()[0], { ...DESKTOP, init: SAVED_CLASSIC }, async page => {
    const at = await open(page, APP);
    await page.evaluate(`BJK.view.fx.showcase('dealer'); true`);
    const classic = await page.evaluate(`!!document.querySelector('.bigfx-face #bjkSkin')`);
    const during = await clickAndWait(page, at.x, at.y, 500);
    return { classic, during: during.look };
  });
  assert.deepStrictEqual(r.value, { classic: true, during: 'classic' });
});

test('陽性對照：大特效不看目前造型，要判成臉不對', async () => {
  const tmp = brokenCopy([[path.join('js', 'view', 'showcase.js'), 'V.dealer.portrait(mood)', "V.dealer.svg(mood, '146 28 290 290', 'jojo')"]]);
  try {
    const r = await withPage(availableBrowsers()[0], { ...DESKTOP, init: SAVED_CLASSIC }, async page => {
      await open(page, tmp);
      await page.evaluate(`BJK.view.fx.showcase('dealer'); true`);
      return page.evaluate(`!!document.querySelector('.bigfx-face #bjkSkin')`);
    });
    assert.strictEqual(r.value, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test(`${availableBrowsers()[0]}：偏好裡的造型是壞值時當成預設，不擲錯`, async () => {
  for (const bad of ['"constructor"', '"xxx"', '123', 'null']) {
    const r = await withPage(availableBrowsers()[0], { ...DESKTOP, init: `localStorage.setItem('bjk.prefs.v1', '{"look":${bad}}');` }, async page => {
      await open(page, APP);
      return lookNow(page);
    });
    assert.strictEqual(r.value.look, 'jojo', bad);
    assert.strictEqual(r.value.loaded, 5, bad);
    assert.deepStrictEqual(r.console, [], bad);
  }
});

// 「泡泡在畫面內」這條沒有陽性對照，2026-10-22 試過兩種都造不出真實的出界：
// 往右出界被瀏覽器擋掉（position: fixed 的泡泡寬度是 auto，會自己縮窄換行）；
// 往上出界要荷官的臉貼近畫面頂端，而實測 6 種尺寸（390×844 到 1280×720）臉的上緣最少還有 78px。
// dealer.js 的夾回是保險，不是現在靠它撐著。
