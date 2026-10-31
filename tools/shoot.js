// 用無頭 Edge 雙擊開 app/index.html 截圖給人看，輸出在 tools/_shots/（不進版控）
// 用法：node tools/shoot.js [檔名前綴]           桌機 1280×720 與手機 390×844 各一張
//       node tools/shoot.js [檔名前綴] --dealer  荷官五種表情各一張（桌機），外加手機一張
//       node tools/shoot.js [檔名前綴] --round   照正常速度打一局，桌機與手機各截四個時間點
//       以上都可以再加 --classic，改用舊版荷官造型
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('../tests/browser_util');

const init = process.argv.includes('--classic') ? `localStorage.setItem('bjk.prefs.v1', '{"look":"classic"}');` : '';
const DESKTOP = { size: [1280, 720], mobile: false, init };
const PHONE = { size: [390, 844], mobile: true, init };
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
const roundMode = args.includes('--round');

// --round：照正常速度打一局，下注、輪到你、結算、回到下注各截一張（輪到你時按停牌）
async function shootRound(browser, url, viewport, tag) {
  const waitFor = cond => `(async () => {
    const hud = document.getElementById('hud'), bubble = document.getElementById('bubble');
    for (let i = 0; i < 600; i++) { if (${cond}) return true; await new Promise(r => setTimeout(r, 50)); }
    return false;
  })()`;
  return withPage(browser, viewport, async page => {
    await page.goto(url);
    await page.evaluate('BJK.view.stage.dealer.ready');
    const shot = async name => {
      const file = path.join(OUT, `${prefix}-${tag}-${name}.png`);
      await page.screenshot(file);
      console.log(`✔ ${path.relative(process.cwd(), file)}（${viewport.size.join('×')}）`);
    };
    await shot('1bet');
    await page.evaluate('BJK.view.stage.director.runRound(100); true');
    if (await page.evaluate(waitFor("hud.dataset.mode === 'act' || hud.dataset.mode === 'bet'"), 40000)) {
      if (await page.evaluate("document.getElementById('hud').dataset.mode") === 'act') {
        await shot('2turn');
        await page.evaluate("document.getElementById('standBtn').click(); true");
      }
    }
    if (await page.evaluate(waitFor("/贏|可惜|平手|爆牌/.test(bubble.textContent) && !bubble.hidden"), 40000)) {
      await new Promise(r => setTimeout(r, 350));
      await shot('3settle');
    }
    await page.evaluate(waitFor("hud.dataset.mode === 'bet'"), 40000);
    await shot('4next');
  });
}

const jobs = dealerMode
  ? [...Object.keys(LINES).map(mood => ({ name: `dealer-${mood}`, viewport: DESKTOP, mood })),
     { name: 'dealer-mobile', viewport: PHONE, mood: 'smile' }]
  : [{ name: 'desktop', viewport: DESKTOP }, { name: 'mobile', viewport: PHONE }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = availableBrowsers()[0];
  const url = pathToFileURL(path.join(__dirname, '..', 'app', 'index.html')).href;
  if (roundMode) {
    for (const [tag, viewport] of [['desktop', DESKTOP], ['mobile', PHONE]]) {
      const r = await shootRound(browser, url, viewport, tag);
      for (const line of r.console) console.log(`  主控台：${line}`);
    }
    return;
  }
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
