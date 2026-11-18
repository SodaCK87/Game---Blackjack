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
// 矮的直式（BJK-11）：真手機的網址列吃掉一截，比 PHONE 矮很多
const SHORT_PHONE = { size: [390, 720], mobile: true };
const PHONE_LANDSCAPE = { size: [844, 390], mobile: true };
// 等左邊拉頁的 CSS transition 真的跑完（含收回時延後藏起來那一段）：固定等幾百毫秒不夠，
// 全套平行跑、機器忙時滑到一半就讀到位置（2026-11-16 量到版本號 left -3.5）
const DRAWER_SETTLED = `Promise.all(document.getElementById('drawer').getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))).then(() => true)`;
const url = dir => pathToFileURL(path.join(dir, 'index.html')).href;
// 荷官真的會講的長句（director.js 的樣板填最長的值）與帶刪節號的短句：量泡泡排版、截圖都用這幾句。
// 第一句最長：預設規則（不偷看、21 點算平手、全收）下荷官最後翻出 Blackjack 時講的
const BUBBLE_LINES = [
  '莊家 Blackjack！21 點平手，其餘連加倍、分牌的注一起收。',
  '籌碼輸光了。按「重新開始」補回 1,000 再來一次。',
  '第 1、2、3 手 Blackjack 賠 1.5 倍，4 手合計贏了 2400！',
  '第 2 手：要牌、停牌、加倍，還是分牌？',
  '歡迎回來，籌碼幫你留著了。請下注！',
  'Blackjack 賠 1.5 倍，你贏了 1500！',
  '分牌！每一手照常要牌、停牌。',
  '洗牌中…',
];
// 戰績或籌碼重置的視窗開著時，點畫面上看得到的左上角按鈕、拉頁裡的按鈕與把手，各自落在誰身上：
// 'scrim' 遮罩、'card' 視窗本身（矮的直式手機上視窗會壓到拉頁），否則是點到的元素 id（代表點得到底下的東西）。
// bottom 是畫面底部正中（操作列那一帶）點到的，探針拿那一點去點遮罩
const COVERED = `(() => {
  const what = (x, y) => { const at = document.elementFromPoint(x, y); return !at ? 'none' : at.id === 'scrim' ? 'scrim' : at.closest('.card') ? 'card' : (at.closest('[id]') || at).id || at.tagName; };
  const out = {};
  for (const id of ['soundToggle', 'statsBtn', 'chipResetBtn', 'drawerHandle']) {
    const r = document.getElementById(id).getBoundingClientRect();
    if (r.width && r.right > 0 && r.left < innerWidth) out[id] = what(r.left + r.width / 2, r.top + r.height / 2);
  }
  return { hits: out, bottom: what(innerWidth / 2, innerHeight - 6), point: [innerWidth / 2, innerHeight - 6] };
})()`;
function assertCovered(c, why) {
  const through = Object.entries(c.hits).filter(([, v]) => v !== 'scrim' && v !== 'card').map(([k, v]) => `${k}→${v}`);
  assert.deepStrictEqual(through, [], `視窗開著時點得到底下的按鈕或把手：${why}`);
  // 直式手機上戰績視窗夠高，按鈕與把手全被視窗本身蓋住（都是 card），遮罩在不在改看畫面底部那一點
  assert.strictEqual(c.bottom, 'scrim', `視窗開著時沒有遮罩（點得到底下的東西）：${why}`);
}
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
    assert.ok(b.right - b.left >= 70, `${what} 的「${b.text}」太窄，手指不好按：${why}`);
  }
  const row = [...m.buttons].sort((a, b) => a.left - b.left);
  row.slice(1).forEach((b, i) => assert.ok(b.left - row[i].right >= 8, `${what} 的「${row[i].text}」與「${b.text}」靠太近，會按到隔壁：${why}`));
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

module.exports = { APP, DESKTOP, PHONE, SMALL_PHONE, SHORT_PHONE, PHONE_LANDSCAPE, DRAWER_SETTLED, BUBBLE_LINES, COVERED, assertCovered, url, first, MEASURE_TURN, pairsOverlapping, assertButtonsFit, copyWith, PLAY_UTIL, shownOf, LATE_BJ };
