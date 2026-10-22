// 上線後驗網站：用無頭 Edge／Chrome 開 GitHub Pages 的網址，桌機與手機各打兩局，確認線上跑的就是本機這一版。
// 不在 npm test 裡：要連網、要等 Pages 部署完。推上 main、workflow 跑完之後跑一次。
// 用法：node tools/check_live.js [網址]（預設 README 寫的那個）
// 守的是本機雙擊驗不到的事：Pages 是 Linux 主機、路徑分大小寫，本機 file:// 不分，檔名大小寫打錯只有線上會壞
const path = require('path');
const { availableBrowsers, withPage } = require('../tests/browser_util');
const { BJK_VER } = require('../app/js/core/version.js');

const URL = process.argv[2] || 'https://sodack87.github.io/Game---Blackjack/';
const VIEWPORTS = { 桌機: { size: [1280, 720], mobile: false }, 手機: { size: [390, 844], mobile: true } };

const PLAY = `(async () => {
  const s = BJK.view.stage;
  await s.dealer.ready;
  BJK.view.anim.speed = 40;
  await s.director.autoplay(2);
  const st = JSON.parse(document.body.dataset.bjk);
  return { ver: st.ver, render: st.render, core: st.core, fit: st.scene.fit, dealer: st.dealer,
           rounds: s.director.rounds, mismatches: s.director.mismatches.length };
})()`;

(async () => {
  let bad = 0;
  for (const browser of availableBrowsers()) {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      let r;
      try {
        r = await withPage(browser, vp, async page => {
          await page.goto(URL);
          return page.evaluate(PLAY, 60000);
        });
      } catch (e) {
        r = { value: null, console: [e.message], leftover: -1 };
      }
      const v = r.value || {};
      const problems = [];
      if (v.ver !== BJK_VER) problems.push(`線上版本 ${v.ver}，本機 ${BJK_VER}（部署還沒跑完或沒推上去）`);
      if (v.render !== 'ok' || v.core !== 'ok') problems.push(`載入失敗：render ${v.render}、core ${v.core}`);
      if (v.fit !== true) problems.push('框景沒框進畫面');
      if (!v.dealer || v.dealer.loaded !== 5) problems.push(`荷官表情沒全載入：${JSON.stringify(v.dealer)}`);
      if (!(v.rounds >= 2)) problems.push(`只打了 ${v.rounds} 局`);
      if (v.mismatches) problems.push(`畫面與引擎對不上 ${v.mismatches} 次`);
      if (r.console.length) problems.push(`主控台：${r.console.join('｜')}`);
      if (r.leftover !== 0) problems.push(`無頭瀏覽器殘留 ${r.leftover} 個`);
      console.log(`${problems.length ? '✖' : '✔'} ${browser}・${name}：${problems.length ? problems.join('；') : `v${v.ver}，打了 ${v.rounds} 局，沒有錯誤`}`);
      bad += problems.length ? 1 : 0;
    }
  }
  console.log(bad ? `${bad} 組沒過：${URL}` : `全部通過：${URL}`);
  process.exitCode = bad ? 1 : 0;
})();
