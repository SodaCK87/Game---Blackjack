// 守「同事雙擊 app/index.html 就能玩」：file:// 下 three、core、view 都要載得起來、畫得出圖，
// 而且桌機與手機尺寸都要把整張牌桌框進畫面。
// 驗不到：真 GPU 的效能、真手機（這裡是 CDP 模擬的手機尺寸）、使用者電腦上的瀏覽器版本差異。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const { BJK_VER } = require('../app/js/core/version.js');
const THREE_REV = PKG.devDependencies.three.split('.')[1];
const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };

async function openApp(browser, appDir, viewport) {
  const r = await withPage(browser, viewport, async page => {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    // 荷官貼圖非同步載入，等它載完（或載入失敗）再讀狀態；three 沒載入時 stage 不存在，直接讀
    const raw = await page.evaluate(`(async () => {
      try { await BJK.view.stage.dealer.ready; } catch (e) {}
      return document.body.dataset.bjk || null;
    })()`);
    return raw ? JSON.parse(raw) : null;
  });
  return { bjk: r.value, console: r.console, leftover: r.leftover };
}

function assertHealthy(r, viewport) {
  const why = `頁面狀態：${JSON.stringify(r.bjk)}\n主控台：\n${r.console.join('\n')}`;
  assert.ok(r.bjk, `頁面沒有寫出狀態\n${why}`);
  assert.deepStrictEqual([r.bjk.three, r.bjk.ver, r.bjk.render, r.bjk.core], [THREE_REV, BJK_VER, 'ok', 'ok'], why);
  // 先確認量法：頁面真的拿到要模擬的尺寸，否則後面的框景判斷沒有意義
  assert.deepStrictEqual(r.bjk.scene.viewport, viewport.size, `頁面拿到的視窗尺寸不對\n${why}`);
  assert.strictEqual(r.bjk.scene.seats, 5, why);
  assert.ok(r.bjk.scene.chips > 0, `籌碼架上沒有籌碼\n${why}`);
  assert.strictEqual(r.bjk.scene.fit, true, `牌桌（手機是玩牌的範圍）與荷官沒有整個框進畫面\n${why}`);
  assert.deepStrictEqual(r.bjk.dealer, { loaded: 5, mood: 'idle' }, `荷官五種表情沒有全部載入\n${why}`);
  assert.deepStrictEqual(r.console, [], '頁面不該有任何主控台訊息');
  assert.strictEqual(r.leftover, 0, '無頭瀏覽器的進程沒收乾淨');
}

// 在暫存複本上改一個檔，回傳複本路徑；替換沒命中就直接紅，免得「破壞沒生效」被當成對照通過
function brokenCopy(file, from, to) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  const target = path.join(tmp, file);
  const before = fs.readFileSync(target, 'utf8');
  const after = before.replace(from, to);
  assert.notStrictEqual(after, before, `破壞沒有命中：${file} 裡找不到 ${from}`);
  fs.writeFileSync(target, after);
  return tmp;
}

const browsers = availableBrowsers();
test('本機至少有一支瀏覽器可以驗', () => assert.ok(browsers.length > 0, '找不到 Edge 或 Chrome'));

for (const browser of browsers) {
  test(`${browser}：桌機尺寸雙擊開 index.html，載入、繪圖、框景都正常`, async () => {
    assertHealthy(await openApp(browser, APP, DESKTOP), DESKTOP);
  });

  // 手機直式只框玩牌用得到的範圍（桌子左右兩端刻意超出畫面），fit 量的是那個範圍
  test(`${browser}：手機直式尺寸（390×844）也把玩牌的範圍與荷官框進畫面`, async () => {
    assertHealthy(await openApp(browser, APP, PHONE), PHONE);
  });

  // 陽性對照一：把 three 改成 type="module" 載入（最可能的「現代化」改法）
  test(`${browser}：陽性對照——three 改用 type="module" 載入時要分得出來`, async () => {
    const tmp = brokenCopy('index.html', '<script src="lib/three.js">', '<script type="module" src="lib/three.js">');
    try {
      const r = await openApp(browser, tmp, DESKTOP);
      assert.strictEqual(r.bjk && r.bjk.three, 'missing', `預期 three 沒載入，實際：${JSON.stringify(r.bjk)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // 陽性對照三：core 的載入順序排錯（game.js 搶在 hand.js 前面），要當場紅而不是到第一次發牌才壞
  test(`${browser}：陽性對照——core 載入順序排錯時要分得出來`, async () => {
    const order = ['hand', 'shoe', 'strategy', 'odds', 'game'].map(n => `<script src="js/core/${n}.js"></script>`);
    const tmp = brokenCopy('index.html', order.join('\n'), [order[4], ...order.slice(0, 4)].join('\n'));
    try {
      const r = await openApp(browser, tmp, DESKTOP);
      assert.match(String(r.bjk && r.bjk.core), /^fail/, `預期 core 失敗，實際：${JSON.stringify(r.bjk)}`);
      assert.ok(r.console.some(l => /載入順序錯/.test(l)), `主控台該有載入順序錯的訊息：\n${r.console.join('\n')}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // 陽性對照二：拿掉自動框景，手機尺寸下牌桌會被切掉，fit 要變 false
  test(`${browser}：陽性對照——拿掉自動框景時，手機尺寸要判成沒框進畫面`, async () => {
    const tmp = brokenCopy(path.join('js', 'view', 'main.js'), 'fitCamera(camera, pts, target, dir);', '');
    try {
      const r = await openApp(browser, tmp, PHONE);
      assert.strictEqual(r.bjk && r.bjk.render, 'ok', `破壞後頁面應該照樣畫得出來：${JSON.stringify(r.bjk)}`);
      assert.strictEqual(r.bjk.scene.fit, false, '拿掉框景後仍判成框進畫面，這條判準分辨不出牌桌被切掉');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// 只認 <script> 標籤裡的 type=module：index.html 的註解本身就提到這個字串（第一版就被它咬成假紅）
function scanForEsm(root) {
  const bad = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== path.join(root, 'lib')) walk(p); continue; }
      const text = fs.readFileSync(p, 'utf8');
      if (e.name.endsWith('.html') && /<script\b[^>]*\btype\s*=\s*["']?module/i.test(text)) bad.push(`${path.relative(root, p)}：type=module`);
      if (e.name.endsWith('.js') && /^\s*(import|export)\s/m.test(text)) bad.push(`${path.relative(root, p)}：import／export`);
    }
  })(root);
  return bad;
}

test('app 底下沒有 ES module 寫法（還沒接進 index.html 的檔也要擋）', () => {
  assert.deepStrictEqual(scanForEsm(APP), []);
});

test('陽性對照：掃描抓得到 module 標籤與 import，且不被只是提到它的註解咬到', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-scan-'));
  try {
    fs.writeFileSync(path.join(tmp, 'a.html'), '<script type="module" src="x.js"></script>');
    fs.writeFileSync(path.join(tmp, 'b.js'), "import * as T from './t.js';\n");
    fs.writeFileSync(path.join(tmp, 'c.html'), '<!-- 不准用 type="module" --><script src="x.js"></script>');
    assert.deepStrictEqual(scanForEsm(tmp).sort(), ['a.html：type=module', 'b.js：import／export']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
