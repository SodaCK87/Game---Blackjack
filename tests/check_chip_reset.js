// 守籌碼重置鈕（橫式在左上角、直式在左邊的拉頁裡），全部用 CDP 真的點、真的按鍵：
// 按下去先跳確認視窗，底下蓋一層遮罩（開頁時不在、不閃），按鈕與把手點不到；取消、Esc、點遮罩都不動籌碼、
// 焦點回到原按鈕、直式時拉頁留著，開關視窗與遮罩不重畫牌桌；
// 按重置後玩家籌碼回到 1,000（多於、少於、輸光都一樣），存檔立刻寫、重新整理後還是 1,000，下注歸零，荷官笑著講一句，
// 畫面與引擎對得上；戰績與 AI 的籌碼不動。牌局進行中按鈕反灰，點了也不跳視窗。
// core 的 setBankroll 在 check_game.js；拉開後點得到、不壓名牌、橫式不疊版本號在 check_drawer.js；不疊對白泡泡在 check_dealer.js。
// 驗不到：真手機手指點按鈕（這裡是 CDP 模擬的滑鼠）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP, DESKTOP, PHONE, SHORT_PHONE, PHONE_LANDSCAPE, DRAWER_SETTLED, COVERED, assertCovered, url, first, copyWith } = require('./ui_util');
const { withPage } = require('./browser_util');
const { rigInit, deal } = require('./rig_util');

const HUD = path.join('js', 'view', 'hud.js');
const DIRECTOR = path.join('js', 'view', 'director.js');
const GAME = path.join('js', 'core', 'game.js');
const AI = { tiger: 700, ade: 1500, mei: 300 };
const STATS = { v: 1, rounds: 7, hands: 8, wins: 4, losses: 3, pushes: 1, blackjacks: 1, busts: 2, doubles: 1, splits: 1,
  net: 350, streak: 2, bestStreak: 3, peak: 2500, decisions: 6, basic: 5 };
const LINE = '籌碼重置好了，從 1,000 重新開始！';

// 只在這個分頁第一次載入時寫存檔：init 每次載入都會跑，不擋的話重新整理就又被蓋回去，量不到存檔有沒有寫
// 遮罩從開頁起播過幾次淡入、開頁那一刻是不是 display: none：開頁就閃一層遮罩的話這裡會記到
const SCRIM_WATCH = `window.__scrimRuns = 0;
document.addEventListener('animationstart', e => { if (e.target.id === 'scrim') window.__scrimRuns++; }, true);
document.addEventListener('DOMContentLoaded', () => { window.__scrimAtLoad = getComputedStyle(document.getElementById('scrim')).display; });`;
const seed = me => `${SCRIM_WATCH}
if (!sessionStorage.getItem('bjk.probe.seeded')) {
  sessionStorage.setItem('bjk.probe.seeded', '1');
  localStorage.setItem('bjk.save.v1', ${JSON.stringify(JSON.stringify({ v: 1, bankrolls: { ...AI, me } }))});
  localStorage.setItem('bjk.stats.v1', ${JSON.stringify(JSON.stringify(STATS))});
}`;

// 等開頁的預演做完再開始數重畫與 requestAnimationFrame（預演本來就會畫一兩格）
const READY = `(async () => {
  const s = BJK.view.stage;
  await s.dealer.ready;
  await new Promise(r => setTimeout(r, 2500));
  window.__renders = 0; window.__rafs = 0;
  { const R = s.renderer, orig = R.render; R.render = function () { window.__renders++; return orig.apply(this, arguments); }; }
  { const raf = window.requestAnimationFrame; window.requestAnimationFrame = function (cb) { window.__rafs++; return raf.call(window, cb); }; }
  return true;
})()`;
const STATE = `(() => {
  const $ = id => document.getElementById(id), d = BJK.view.stage.director, st = d.game.state(), btn = $('chipResetBtn');
  const r = btn.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return 'bad'; } };
  return { orient: document.body.dataset.orient, mode: $('hud').dataset.mode, panel: !$('chipResetPanel').hidden,
    text: $('chipResetText').textContent, focus: document.activeElement ? document.activeElement.id : '',
    drawer: $('drawer').dataset.open, disabled: btn.disabled, hit: !!at && btn.contains(at),
    bank: $('bank').textContent, bet: $('bet').textContent, bubble: $('bubble').hidden ? '' : $('bubble').textContent,
    mood: BJK.view.stage.dealer.mood, engine: Object.fromEntries(st.seats.map(s => [s.id, s.bankroll])),
    tags: [...document.querySelectorAll('#overlay .seat-tag')].filter(el => !el.hidden).map(el => el.textContent).sort(),
    saved: (read('bjk.save.v1') || {}).bankrolls, stats: d.stats, statsSaved: read('bjk.stats.v1'),
    mismatches: d.mismatches, renders: window.__renders, rafs: window.__rafs,
    scrim: !$('scrim').hidden, cover: ${COVERED}, scrimRuns: window.__scrimRuns, scrimAtLoad: window.__scrimAtLoad };
})()`;
const CENTER = sel => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`;

function pager(page) {
  const state = () => page.evaluate(STATE);
  const pressAt = async (x, y) => {
    await page.click(x, y);
    await page.evaluate(DRAWER_SETTLED);
    return state();
  };
  const press = async sel => pressAt(...await page.evaluate(CENTER(sel)));
  return { state, press, pressAt };
}

// 先疊一點注（輸光時沒有下注列），直式先拉開拉頁；按重置 → 取消、再按 → Esc、再按 → 點遮罩、再按 → 重置；最後重新整理一次
async function resetRun(dir, viewport, me) {
  return withPage(first(), { ...viewport, init: seed(me) }, async page => {
    await page.goto(url(dir));
    await page.evaluate(READY, 20000);
    const { state, press, pressAt } = pager(page);
    const out = { me, start: await state() };
    if (out.start.mode === 'bet') out.start = await press('[data-chip="500"]');
    if (out.start.orient === 'portrait') out.start = await press('#drawerHandle');
    out.opened = await press('#chipResetBtn');
    out.cancelled = await press('#chipResetCancel');
    out.reopened = await press('#chipResetBtn');
    await page.key('Escape', 27);
    await page.evaluate(DRAWER_SETTLED);
    out.escaped = await state();
    out.covering = await press('#chipResetBtn');
    out.scrimmed = await pressAt(...out.covering.cover.point);
    out.confirming = await press('#chipResetBtn');
    out.done = await press('#chipResetOk');
    await page.goto(url(dir));
    out.reloaded = await page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; return ${STATE}; })()`);
    return out;
  });
}

// 牌局中：按發牌後（busy）與輪到你（act）各點一次籌碼重置鈕（直式先拉開拉頁），按停牌打完再看一次
async function midRoundRun(dir, viewport) {
  return withPage(first(), { ...viewport, init: rigInit(deal('10', '6')) }, async page => {
    await page.goto(url(dir));
    await page.evaluate('BJK.view.stage.dealer.ready');
    const { state, press } = pager(page);
    const until = mode => page.evaluate(`(async () => { for (let i = 0; i < 800 && document.getElementById('hud').dataset.mode !== '${mode}'; i++) await new Promise(r => setTimeout(r, 25)); return true; })()`, 30000);
    const out = { bet: await state() };
    out.busy = await press('#dealBtn');
    if (out.busy.orient === 'portrait') out.busy = await press('#drawerHandle');
    out.busyClick = await press('#chipResetBtn');
    await until('act');
    if (out.busy.orient === 'portrait' && (await state()).drawer !== 'true') await press('#drawerHandle');
    out.act = await state();
    out.actClick = await press('#chipResetBtn');
    await press('#standBtn');
    await until('bet');
    out.after = await state();
    return out;
  });
}

const fmt = n => n.toLocaleString('en-US');

function assertConfirmFirst(m) {
  const o = m.opened, why = JSON.stringify(o);
  assert.ok(m.start.hit, `籌碼重置鈕點不到：${JSON.stringify(m.start)}`);
  assert.ok(o.panel && o.bank === m.start.bank && o.engine.me === m.me, `按籌碼重置沒有先跳確認視窗，或還沒確認就動了籌碼：${why}`);
  assert.strictEqual(o.text, `籌碼會回到 1,000（現在 ${fmt(m.me)}）`, `確認視窗的內文不對：${why}`);
  assert.strictEqual(o.focus, 'chipResetCancel', `確認視窗打開時焦點不在「取消」：${why}`);
}
function assertCancel(m) {
  for (const [what, s] of [['按取消', m.cancelled], ['按 Esc', m.escaped]]) {
    const why = JSON.stringify(s);
    assert.ok(!s.panel, `${what}沒有關掉確認視窗：${why}`);
    assert.ok(s.engine.me === m.me && s.bank === m.start.bank && s.saved.me === m.me, `${what}之後籌碼被動到了：${why}`);
    if (s.orient === 'portrait') assert.strictEqual(s.drawer, 'true', `${what}之後拉頁跟著收起來了：${why}`);
    assert.strictEqual(s.focus, 'chipResetBtn', `${what}之後焦點沒回到籌碼重置鈕：${why}`);
  }
  assert.ok(m.reopened.panel, `取消之後再按一次沒有跳確認視窗：${JSON.stringify(m.reopened)}`);
}
// 遮罩：開頁時不在、也沒播過淡入；視窗開著時蓋住底下的按鈕與把手；點遮罩等同取消（籌碼不變、焦點回原按鈕、拉頁照舊開著）
function assertScrim(m) {
  const s = m.start, c = m.covering, x = m.scrimmed;
  assert.ok(s.scrimAtLoad === 'none' && s.scrimRuns === 0 && !s.scrim, `開頁時遮罩不是收起的，或播過淡入（開頁會閃一層）：${JSON.stringify(s)}`);
  assert.ok(c.panel && c.scrim, `量法有誤：確認視窗沒打開：${JSON.stringify(c)}`);
  assertCovered(c.cover, JSON.stringify(c.cover));
  assert.ok(!m.cancelled.scrim && !m.escaped.scrim, `取消或 Esc 之後遮罩還在：${JSON.stringify(m.escaped)}`);
  const why = JSON.stringify(x);
  assert.ok(!x.panel && !x.scrim, `點遮罩沒有關掉確認視窗：${why}`);
  assert.ok(x.engine.me === m.me && x.bank === m.start.bank && x.saved.me === m.me, `點遮罩之後籌碼被動到了：${why}`);
  if (x.orient === 'portrait') assert.strictEqual(x.drawer, 'true', `點遮罩之後拉頁跟著收起來了：${why}`);
  assert.strictEqual(x.focus, 'chipResetBtn', `點遮罩之後焦點沒回到籌碼重置鈕：${why}`);
}
function assertNoRedraw(m) {
  const e = m.scrimmed;
  assert.deepStrictEqual([e.renders, e.rafs], [0, 0], `開關確認視窗與遮罩重畫了牌桌或開了 JS 動畫：${JSON.stringify(e)}`);
  assert.ok(m.done.renders <= 1 && m.done.rafs === 0, `按重置之後重畫超過一次（荷官換表情只該畫一格）：${JSON.stringify(m.done)}`);
}
function assertReset(m) {
  const d = m.done, why = JSON.stringify(d);
  assert.ok(!d.panel, `按重置沒有關掉確認視窗：${why}`);
  assert.ok(d.engine.me === 1000 && d.bank === '1,000', `重置後籌碼不是 1,000：${why}`);
  assert.strictEqual(d.saved.me, 1000, `重置後存檔沒有立刻寫成 1,000：${why}`);
  assert.ok(m.reloaded.engine.me === 1000 && m.reloaded.bank === '1,000', `重新整理後籌碼不是 1,000：${JSON.stringify(m.reloaded)}`);
  assert.ok(d.bet === '0' && d.mode === 'bet', `重置後下注沒歸零，或沒回到下注：${why}`);
  assert.ok(d.bubble === LINE && d.mood === 'smile', `重置後荷官沒有笑著講「${LINE}」：${why}`);
  assert.deepStrictEqual(d.mismatches, [], `重置後畫面與引擎不一致：${why}`);
  if (d.orient === 'portrait') assert.ok(d.drawer === 'false' && d.focus === 'drawerHandle', `直式重置後拉頁沒收起、焦點沒回到把手：${why}`);
  else assert.strictEqual(d.focus, 'chipResetBtn', `重置後焦點沒回到籌碼重置鈕：${why}`);
}
function assertOthersKept(m) {
  const d = m.done, why = JSON.stringify(d);
  assert.deepStrictEqual(m.start.stats, STATS, `量法有誤：開頁讀到的戰績不是寫進去的那份：${JSON.stringify(m.start)}`);
  for (const [what, s] of [['重置後', d.stats], ['重置後的存檔', d.statsSaved], ['重新整理後', m.reloaded.stats]]) {
    assert.deepStrictEqual(s, STATS, `${what}戰績被動到了：${why}`);
  }
  const ai = s => Object.fromEntries(Object.keys(AI).map(id => [id, s[id]]));
  assert.deepStrictEqual([ai(d.engine), ai(d.saved), d.tags], [AI, AI, m.start.tags], `重置時動到了 AI 的籌碼：${why}`);
}
function assertDisabledMidRound(m) {
  const why = JSON.stringify(m);
  assert.ok(m.bet.mode === 'bet' && !m.bet.disabled, `下注階段籌碼重置鈕反灰了：${why}`);
  assert.ok(m.busy.mode === 'busy' && m.act.mode === 'act', `量法有誤：沒有打到發牌中與輪到你：${why}`);
  assert.ok(m.busy.hit && m.act.hit, `量法有誤：點的位置不是籌碼重置鈕：${why}`);
  assert.ok(m.busy.disabled && m.act.disabled, `牌局進行中籌碼重置鈕沒有反灰：${why}`);
  assert.ok(!m.busyClick.panel && !m.actClick.panel && m.actClick.engine.me === m.busy.engine.me, `牌局進行中點籌碼重置鈕跳出了確認視窗或動了籌碼：${why}`);
  assert.ok(m.after.mode === 'bet' && !m.after.disabled, `打完回到下注，籌碼重置鈕沒有恢復：${why}`);
}
const assertAll = m => [assertConfirmFirst, assertCancel, assertScrim, assertNoRedraw, assertReset, assertOthersKept].forEach(f => f(m));

for (const [name, vp, me] of [['桌機・籌碼 2,350（多於 1,000）', DESKTOP, 2350], ['矮的直式手機・籌碼 430（少於 1,000）', SHORT_PHONE, 430],
  ['直式手機・籌碼 2,350', PHONE, 2350], ['橫式手機・輸光（0）', PHONE_LANDSCAPE, 0]]) {
  test(`${first()}：${name}，先確認，取消、Esc、點遮罩都不動籌碼，遮罩蓋住底下的按鈕；按重置回到 1,000、存檔立刻寫、下注歸零，戰績與 AI 不動`, async () => {
    const r = await resetRun(APP, vp, me);
    assert.strictEqual(r.value.start.mode, me ? 'bet' : 'broke', '量法有誤：開頁不在預期的階段');
    assertAll(r.value);
    assert.deepStrictEqual(r.console, []);
  });
}
for (const [name, vp] of [['桌機', DESKTOP], ['矮的直式手機', SHORT_PHONE]]) {
  test(`${first()}：${name}牌局進行中籌碼重置鈕反灰、點了不跳視窗，打完恢復`, async () => {
    const r = await midRoundRun(APP, vp);
    assertDisabledMidRound(r.value);
    assert.deepStrictEqual(r.console, []);
  });
}

// 每條判準各配一個破壞，在暫存複本上改，確認那一條真的會紅
const asReset = (vp, me) => dir => resetRun(dir, vp, me);
const CONTROLS = [
  ['不跳確認直接重置', HUD, "resetBtn.addEventListener('click', () => (resetPanel.hidden ? openReset() : cancelReset()));",
    "resetBtn.addEventListener('click', () => { bet = 0; refresh(); onResetChips(); });", asReset(DESKTOP, 2350), assertConfirmFirst, /沒有先跳確認視窗/],
  ['重置時順便清戰績', DIRECTOR, "await play(game.setBankroll('me', START));", "stats = BJK.stats.empty(START); await play(game.setBankroll('me', START));",
    asReset(DESKTOP, 2350), assertOthersKept, /戰績被動到了/],
  ['重置時 AI 也回到 1,000', DIRECTOR, "await play(game.setBankroll('me', START));", "await play(SEATS.flatMap(s => game.setBankroll(s.id, START)));",
    asReset(DESKTOP, 2350), assertOthersKept, /AI 的籌碼/],
  ['只補不扣（多於 1,000 沒降回）', GAME, 's.bankroll = amount;\n      topUps += delta;', 's.bankroll = Math.max(s.bankroll, amount);\n      topUps += delta;',
    asReset(DESKTOP, 2350), assertReset, /不是 1,000/],
  ['按取消也照樣重置', HUD, "function cancelReset() {\n      resetPanel.hidden = true;", "function cancelReset() {\n      resetPanel.hidden = true; onResetChips();",
    asReset(DESKTOP, 2350), assertCancel, /籌碼被動到了/],
  ['Esc 關不掉確認視窗', HUD, '      if (!resetPanel.hidden) cancelReset();\n      else if', '      if (!resetPanel.hidden) return;\n      if', asReset(SHORT_PHONE, 2350), assertCancel, /按 Esc沒有關掉/],
  ['Esc 連拉頁一起收起來', HUD, '      else setDrawer(false);', '      setDrawer(false);', asReset(SHORT_PHONE, 2350), assertCancel, /拉頁跟著收起來/],
  ['取消後焦點沒回到原按鈕', HUD, '      syncScrim();\n      resetBtn.focus();', '      syncScrim();', asReset(DESKTOP, 2350), assertCancel, /焦點沒回到/],
  ['拿掉遮罩', 'style.css', '#scrim {\n  position: fixed;', '#scrim {\n  display: none !important;\n  position: fixed;', asReset(SHORT_PHONE, 2350), assertScrim, /點得到底下/],
  ['點遮罩照樣重置', HUD, "scrim.addEventListener('click', () => (resetPanel.hidden ? closeStats() : cancelReset()));",
    "scrim.addEventListener('click', () => { if (resetPanel.hidden) closeStats(); else { cancelReset(); bet = 0; refresh(); onResetChips(); } });",
    asReset(DESKTOP, 2350), assertScrim, /點遮罩之後籌碼被動到了/],
  ['遮罩藏起來時沒拿掉 display，開頁就播淡入', 'style.css', '#scrim[hidden] {\n  display: none;\n}', '#scrim[hidden] {\n  display: block;\n  opacity: 0;\n  pointer-events: none;\n}',
    asReset(DESKTOP, 2350), assertScrim, /開頁時遮罩不是收起的/],
  ['重置後沒立刻存檔', DIRECTOR, "await play(game.setBankroll('me', START));\n      enterBetting();",
    "await play(game.setBankroll('me', START));\n      syncMoney(); updateLabels(); hud.mode('bet');", asReset(DESKTOP, 2350), assertReset, /存檔沒有立刻寫/],
  ['重置後下注沒歸零', HUD, '      bet = 0;\n      lastBet = 0;\n', '', asReset(DESKTOP, 2350), assertReset, /下注沒歸零/],
  ['開確認視窗時重畫牌桌', HUD, "      resetPanel.hidden = false;\n", "      resetPanel.hidden = false; V.stage.render();\n", asReset(DESKTOP, 2350), assertNoRedraw, /重畫了牌桌/],
  ['牌局中沒反灰', HUD, 'resetBtn.disabled = !canResetChips();', 'resetBtn.disabled = false;', dir => midRoundRun(dir, DESKTOP), assertDisabledMidRound, /沒有反灰/],
];
for (const [what, file, from, to, run, judge, re] of CONTROLS) {
  test(`陽性對照：${what}`, async () => {
    const tmp = copyWith(file, from, to);
    try {
      const r = await run(tmp);
      assert.throws(() => judge(r.value), re);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
