// 用無頭 Edge 雙擊開 app/index.html，截桌機與手機兩種尺寸，給人看畫面用。輸出在 tools/_shots/（不進版控）
// 用法：node tools/shoot.js [檔名前綴]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('../tests/browser_util');

const VIEWPORTS = { desktop: { size: [1280, 720], mobile: false }, mobile: { size: [390, 844], mobile: true } };
const OUT = path.join(__dirname, '_shots');
const prefix = process.argv[2] || 'shot';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = availableBrowsers()[0];
  const url = pathToFileURL(path.join(__dirname, '..', 'app', 'index.html')).href;
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const file = path.join(OUT, `${prefix}-${name}.png`);
    const r = await withPage(browser, viewport, async page => {
      await page.goto(url);
      await page.screenshot(file);
    });
    console.log(`✔ ${path.relative(process.cwd(), file)}（${viewport.size.join('×')}，${browser}，殘留進程 ${r.leftover}）`);
    for (const line of r.console) console.log(`  主控台：${line}`);
  }
})();
