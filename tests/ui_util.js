// 探針共用：check_ui*.js 三支共用的尺寸、量測片段與判準。原本全在 check_ui.js 一支裡循序跑，
// 單支就是 npm test 的關鍵路徑（2026-10-28 量 312 秒，P-09），切成三支讓 node 平行跑
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers } = require('./browser_util');
const { rigInit } = require('./rig_util');

const APP = path.join(__dirname, '..', 'app');
const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };
const SMALL_PHONE = { size: [360, 640], mobile: true };
const url = dir => pathToFileURL(path.join(dir, 'index.html')).href;
const first = () => availableBrowsers()[0];

// 打到輪到你為止（荷官或你拿 Blackjack 那局不會輪到你，就再打一局），量那一刻的標籤與按鈕
const MEASURE_TURN = `(async () => {
  const s = BJK.view.stage, hud = document.getElementById('hud');
  await s.dealer.ready;
  BJK.view.anim.speed = 40;
  const until = async cond => { for (let i = 0; i < 400 && !cond(); i++) await new Promise(r => setTimeout(r, 25)); return cond(); };
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    s.director.runRound(50);   // 一呼叫就同步切到 busy，所以下面等到 act 或 bet 就是這一局有了結果
    await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet');
    reached = hud.dataset.mode === 'act';
  }
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const labels = [...document.querySelectorAll('#overlay .total, #overlay .seat-tag')].filter(el => !el.hidden)
    .map(el => ({ text: el.textContent, ...rect(el) }));
  // 藏起來的鈕（不能分時的分牌鈕）不算：它的框是 0×0，量了只會誤判跑出操作列
  const buttons = [...document.querySelectorAll('#actBar button')].filter(el => !el.hidden).map(el => ({ text: el.textContent, ...rect(el) }));
  return { reached, labels, buttons, hud: { ...rect(hud), scrollH: hud.scrollHeight, clientH: hud.clientHeight }, vw: innerWidth, vh: innerHeight };
})()`;

const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
function pairsOverlapping(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (overlaps(list[i], list[j])) out.push(`${list[i].text} ↔ ${list[j].text}`);
  }
  return out;
}

function assertButtonsFit(m, what) {
  const why = JSON.stringify(m);
  assert.ok(m.buttons.length > 0, `${what} 沒有按鈕：${why}`);
  assert.ok(m.hud.scrollH <= m.hud.clientH + 1, `${what} 的操作列內容超出固定高度（按鈕換行了）：${why}`);
  const firstTop = m.buttons[0].top;
  for (const b of m.buttons) {
    assert.ok(b.left >= m.hud.left && b.right <= m.hud.right && b.top >= m.hud.top && b.bottom <= m.hud.bottom, `${what} 的「${b.text}」跑出操作列：${why}`);
    assert.ok(Math.abs(b.top - firstTop) < 1, `${what} 的按鈕沒排在同一列：${why}`);
    assert.ok(b.bottom - b.top >= 36, `${what} 的「${b.text}」太矮，手指不好按：${why}`);
  }
  assert.deepStrictEqual(pairsOverlapping(m.buttons), [], `${what} 的按鈕互相重疊`);
}

function copyWith(file, from, to) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  const target = path.join(tmp, file);
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(text.includes(from), `破壞沒有命中：${file} 裡找不到 ${from}`);
  fs.writeFileSync(target, text.replace(from, to));
  return tmp;
}

// 下注 100、發牌，等到輪到你（或這一局發完牌就結束）；click 後先等操作列離開 act，免得同一拍讀到還沒切換的舊狀態
const PLAY_UTIL = `
  await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
  const $ = id => document.getElementById(id), hud = $('hud'), d = BJK.view.stage.director;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 25) await sleep(25); return ok(); };
  const press = async id => { $(id).click(); await until(() => hud.dataset.mode !== 'act', 2000); await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 20000); };
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const buttons = () => Object.fromEntries(['hitBtn', 'standBtn', 'doubleBtn', 'splitBtn'].map(id => [id,
    { shown: !$(id).hidden, disabled: $(id).disabled, odds: $(id).querySelector('.odds').textContent, best: $(id).classList.contains('best') }]));
  // 荷官講過的每一句（後面的會蓋掉前面的，結算時只看得到最後一句）
  const said = [], bubble = $('bubble');
  new MutationObserver(() => said.push(bubble.textContent)).observe(bubble, { childList: true, characterData: true, subtree: true });
  $('clearBet').click(); document.querySelector('[data-chip="100"]').click(); $('dealBtn').click();
  await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 15000);`;
const shownOf = b => Object.fromEntries(Object.entries(b).map(([k, x]) => [k, [x.shown, x.disabled]]));

// 荷官明牌 A、底牌 K（不偷看）：照常輪到你，底牌還蓋著；你 5+6 按加倍補 K 成 21，大家打完荷官才翻出 Blackjack，
// 21 點平手退回加倍後的注（籌碼回到 1,000），同桌三位 19 點輸
const LATE_BJ = rigInit(['10', '5', '10', '10', 'A', '9', '6', '9', '9', 'K', 'K']);

module.exports = { APP, DESKTOP, PHONE, SMALL_PHONE, url, first, MEASURE_TURN, pairsOverlapping, assertButtonsFit, copyWith, PLAY_UTIL, shownOf, LATE_BJ };
