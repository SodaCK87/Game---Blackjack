// 用無頭 Edge 雙擊開 app/index.html 截圖給人看，輸出在 tools/_shots/（不進版控）
// 用法：node tools/shoot.js [檔名前綴]           桌機 1280×720 與手機 390×844 各一張，外加矮的直式手機 390×720 拉頁收起、拉開各一張
//       node tools/shoot.js [檔名前綴] --dealer  荷官五種表情各一張（桌機），外加手機一張；
//                                                再加最長那句對白在桌機、390×844、390×720、360×640 各一張（dealer-long-*）
//       node tools/shoot.js [檔名前綴] --round   照正常速度打一局，桌機與手機各截四個時間點
//       node tools/shoot.js [檔名前綴] --cards   J、Q、K 與牌背、籌碼的貼圖原寸排一張，中間一排縮成手機上一張牌的大小
//       node tools/shoot.js [檔名前綴] --reset   籌碼重置的確認視窗開著（桌機、矮的直式手機各一張）、按下重置之後各一張，
//                                                 外加矮的直式手機戰績視窗開著一張（兩種視窗都蓋遮罩）
//       以上都可以再加 --classic，改用舊版荷官造型
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('../tests/browser_util');
const { DRAWER_SETTLED, BUBBLE_LINES } = require('../tests/ui_util');

const init = process.argv.includes('--classic') ? `localStorage.setItem('bjk.prefs.v1', '{"look":"classic"}');` : '';
const DESKTOP = { size: [1280, 720], mobile: false, init };
const PHONE = { size: [390, 844], mobile: true, init };
// 矮的直式（BJK-11）：真手機網址列吃掉一截
const SHORT_PHONE = { size: [390, 720], mobile: true, init };
const SMALL_PHONE = { size: [360, 640], mobile: true, init };
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
const cardsMode = args.includes('--cards');
const resetMode = args.includes('--reset');

// --cards：直接拿 textures.js 畫好的畫布排成一張。中間那排照手機上一張牌約 55 CSS 像素、畫布密度 2 縮成 110 寬；
// 那是 canvas 縮圖不是 GPU 取樣，只拿來看角標讀不讀得出來
const CARD_SHEET = `(async () => {
  await BJK.view.stage.dealer.ready;
  const T = BJK.view.textures, list = [['K', 'H'], ['Q', 'D'], ['J', 'H'], ['K', 'S'], ['Q', 'C'], ['J', 'S'], ['A', 'S'], ['10', 'D']];
  const faces = list.map(([r, s]) => T.cardFace(r, s).image), back = T.cardBack().image;
  const chips = BJK.view.chips.DENOMS.map(v => T.chipAtlas(v).image);
  const gap = 12, small = 110, smallH = Math.round(small * 358 / 256), c = document.createElement('canvas');
  c.width = gap + (256 + gap) * list.length;
  c.height = gap * 4 + 358 + smallH + 358;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b6e4f'; ctx.fillRect(0, 0, c.width, c.height);
  faces.forEach((f, i) => ctx.drawImage(f, gap + i * (256 + gap), gap));
  const y2 = gap * 2 + 358;
  [...faces, back].forEach((f, i) => ctx.drawImage(f, gap + i * (small + gap), y2, small, smallH));
  const y3 = y2 + smallH + gap;
  ctx.drawImage(back, gap, y3);
  chips.forEach((f, i) => ctx.drawImage(f, gap + (i + 1) * (256 + gap), y3));
  return c.toDataURL('image/png');
})()`;

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

// --reset：存檔先寫成 2,350，按出確認視窗；ok 再按「重置」
const RICH = `${init} localStorage.setItem('bjk.save.v1', '{"v":1,"bankrolls":{"me":2350}}');`;
const jobs = dealerMode
  ? [...Object.keys(LINES).map(mood => ({ name: `dealer-${mood}`, viewport: DESKTOP, mood })),
     { name: 'dealer-mobile', viewport: PHONE, mood: 'smile' },
     ...Object.entries({ desktop: DESKTOP, mobile: PHONE, short: SHORT_PHONE, small: SMALL_PHONE })
       .map(([tag, viewport]) => ({ name: `dealer-long-${tag}`, viewport, mood: 'surprised', line: BUBBLE_LINES[0] }))]
  : resetMode
    ? [{ name: 'confirm-desktop', viewport: { ...DESKTOP, init: RICH }, confirm: true },
       { name: 'confirm-short', viewport: { ...SHORT_PHONE, init: RICH }, open: true, confirm: true },
       { name: 'confirm-desktop-done', viewport: { ...DESKTOP, init: RICH }, confirm: true, ok: true },
       { name: 'confirm-short-done', viewport: { ...SHORT_PHONE, init: RICH }, open: true, confirm: true, ok: true },
       { name: 'stats-short', viewport: { ...SHORT_PHONE, init: RICH }, open: true, stats: true }]
    : [{ name: 'desktop', viewport: DESKTOP }, { name: 'mobile', viewport: PHONE },
       { name: 'short', viewport: SHORT_PHONE }, { name: 'short-open', viewport: SHORT_PHONE, open: true }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = availableBrowsers()[0];
  const url = pathToFileURL(path.join(__dirname, '..', 'app', 'index.html')).href;
  if (cardsMode) {
    const file = path.join(OUT, `${prefix}-cards.png`);
    const r = await withPage(browser, DESKTOP, async page => {
      await page.goto(url);
      fs.writeFileSync(file, Buffer.from((await page.evaluate(CARD_SHEET)).split(',')[1], 'base64'));
    });
    console.log(`✔ ${path.relative(process.cwd(), file)}`);
    for (const line of r.console) console.log(`  主控台：${line}`);
    return;
  }
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
        ${job.mood ? `d.setMood(${JSON.stringify(job.mood)}); d.say(${JSON.stringify(job.line || LINES[job.mood])});` : ''}
      })()`);
      // 真的點一下（左邊的把手、籌碼重置鈕、確認視窗的重置），等拉頁的 CSS transition 跑完
      const press = async id => {
        await page.click(...await page.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`));
        await page.evaluate(DRAWER_SETTLED);
      };
      if (job.open) await press('drawerHandle');
      if (job.stats) await press('statsBtn');
      if (job.confirm) await press('chipResetBtn');
      if (job.ok) await press('chipResetOk');
      // 遮罩淡入 0.15 秒，等它播完再截，不然截到半透明的一半
      if (job.stats || job.confirm) await page.evaluate('Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))).then(() => true)');
      await page.screenshot(file);
    });
    console.log(`✔ ${path.relative(process.cwd(), file)}（${job.viewport.size.join('×')}，${browser}，殘留進程 ${r.leftover}）`);
    for (const line of r.console) console.log(`  主控台：${line}`);
  }
})();
