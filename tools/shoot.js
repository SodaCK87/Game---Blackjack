// 用無頭 Edge 雙擊開 app/index.html 截圖給人看，輸出在 tools/_shots/（不進版控）
// 用法：node tools/shoot.js [檔名前綴]           桌機 1280×720 與手機 390×844 各一張
//       node tools/shoot.js [檔名前綴] --dealer  荷官五種表情各一張（桌機），外加手機一張
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('../tests/browser_util');

const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };
const LINES = {
  idle: '歡迎光臨，請下注！',
  deal: '發牌囉。',
  surprised: '哇，Blackjack！',
  smile: '恭喜，這局你贏了！',
  sorry: '可惜，這局莊家贏。',
};
const OUT = path.join(__dirname, '_shots');
const args = process.argv.slice(2);
const prefix = args.find(a => !a.startsWith('--')) || 'shot';
const dealerMode = args.includes('--dealer');

const jobs = dealerMode
  ? [...Object.keys(LINES).map(mood => ({ name: `dealer-${mood}`, viewport: DESKTOP, mood })),
     { name: 'dealer-mobile', viewport: PHONE, mood: 'smile' }]
  : [{ name: 'desktop', viewport: DESKTOP }, { name: 'mobile', viewport: PHONE }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = availableBrowsers()[0];
  const url = pathToFileURL(path.join(__dirname, '..', 'app', 'index.html')).href;
  for (const job of jobs) {
    const file = path.join(OUT, `${prefix}-${job.name}.png`);
    const r = await withPage(browser, job.viewport, async page => {
      await page.goto(url);
      await page.evaluate(`(async () => {
        const d = BJK.view.stage.dealer;
        await d.ready;
        ${job.mood ? `d.setMood(${JSON.stringify(job.mood)}); d.say(${JSON.stringify(LINES[job.mood])});` : ''}
      })()`);
      await page.screenshot(file);
    });
    console.log(`✔ ${path.relative(process.cwd(), file)}（${job.viewport.size.join('×')}，${browser}，殘留進程 ${r.leftover}）`);
    for (const line of r.console) console.log(`  主控台：${line}`);
  }
})();
