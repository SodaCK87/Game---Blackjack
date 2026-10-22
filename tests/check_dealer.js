// 守荷官的對白泡泡：桌機與直式手機都要整個在畫面內、不蓋住荷官的臉、而且貼在臉旁邊。
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

// 「泡泡在畫面內」這條沒有陽性對照，2026-10-22 試過兩種都造不出真實的出界：
// 往右出界被瀏覽器擋掉（position: fixed 的泡泡寬度是 auto，會自己縮窄換行）；
// 往上出界要荷官的臉貼近畫面頂端，而實測 6 種尺寸（390×844 到 1280×720）臉的上緣最少還有 78px。
// dealer.js 的夾回是保險，不是現在靠它撐著。
