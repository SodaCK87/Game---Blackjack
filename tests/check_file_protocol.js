// 守「同事雙擊 app/index.html 就能玩」：file:// 下 three、core、view 都要載得起來、畫得出圖。
// 驗不到：真 GPU 的效能、使用者機器上的瀏覽器版本差異（這裡用的是本機裝的 Edge／Chrome）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, openHeadless, readBjkStatus } = require('./browser_util');

const APP = path.join(__dirname, '..', 'app');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const { BJK_VER } = require('../app/js/core/version.js');
const EXPECTED = { three: PKG.devDependencies.three.split('.')[1], ver: BJK_VER, render: 'ok' };

async function openApp(browser, appDir) {
  const r = await openHeadless(browser, pathToFileURL(path.join(appDir, 'index.html')).href);
  return { ...r, bjk: readBjkStatus(r.dom) };
}

const browsers = availableBrowsers();
test('本機至少有一支瀏覽器可以驗', () => assert.ok(browsers.length > 0, '找不到 Edge 或 Chrome'));

for (const browser of browsers) {
  test(`${browser}：雙擊開 index.html，three r${EXPECTED.three}、core ${BJK_VER} 都載入且畫得出圖`, async () => {
    const r = await openApp(browser, APP);
    assert.deepStrictEqual(r.bjk, EXPECTED, `頁面狀態不對；主控台：\n${r.pageConsole.join('\n')}`);
    assert.deepStrictEqual(r.pageConsole, [], '頁面不該有任何主控台訊息');
    assert.strictEqual(r.leftover, 0, '無頭瀏覽器的進程沒收乾淨');
  });

  // 陽性對照：把 three 改成 type="module" 載入（最可能的「現代化」改法），上一條要分得出來
  test(`${browser}：陽性對照——three 改用 type="module" 載入時，同一套判準要變紅`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
    try {
      fs.cpSync(APP, tmp, { recursive: true });
      const html = path.join(tmp, 'index.html');
      const before = fs.readFileSync(html, 'utf8');
      const after = before.replace('<script src="lib/three.js">', '<script type="module" src="lib/three.js">');
      assert.notStrictEqual(after, before, '破壞沒有命中：index.html 裡找不到 three 的 script 標籤');
      fs.writeFileSync(html, after);
      const r = await openApp(browser, tmp);
      assert.notDeepStrictEqual(r.bjk, EXPECTED, '破壞之後判準仍是綠的，這套判準分辨不出 three 沒載入');
      assert.strictEqual(r.bjk && r.bjk.three, 'missing', `預期 three 沒載入，實際：${JSON.stringify(r.bjk)}`);
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
