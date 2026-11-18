// 守直式畫面左邊緣的拉頁（BJK-11）：直式時音效、戰績、籌碼重置、版本號收起來，只露一個把手；把手在牆上緣與桌緣之間、不壓名牌、
// 夠高好按；開頁那一刻就是收起的（不會看到它滑走）；真的點把手拉出來，裡面的三顆鈕點得到、夠大、不壓名牌，版本號看得到；
// 點拉頁外面、再點把手都會收回；戰績視窗開著時遮罩蓋住拉頁，點遮罩關掉戰績、拉頁照舊開著；拉開收回只動 CSS，不重畫牌桌、不開 JS 動畫。橫式畫面沒有把手，三顆鈕排在左上角、版本號在右上角，互不相疊。
// 泡泡不疊到把手、按鈕、版本號在 check_dealer.js；籌碼重置按下去之後的事在 check_chip_reset.js。
// 驗不到：真手機手指點把手的手感、滑出來順不順（看 node tools/shoot.js 的矮直式截圖）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP, DESKTOP, PHONE, SMALL_PHONE, SHORT_PHONE, PHONE_LANDSCAPE, DRAWER_SETTLED, COVERED, assertCovered, url, first, copyWith } = require('./ui_util');
const { availableBrowsers, withPage } = require('./browser_util');
const { BJK_VER } = require('../app/js/core/version.js');

// 開頁那一刻（main.js 第一次排版剛做完）：拉頁該已經在收起的位置，不是正要滑走。
// 光量位置不夠：全套平行跑、機器忙的時候，0.2 秒的滑動在 DOMContentLoaded 之前就滑完了，量到的是收起而判綠（2026-11-16 全套跑出來的假綠）。
// 所以另外從頭記拉頁裡有沒有開始過 transition（transitionrun 不管滑多快都會發）
const AT_LOAD = `window.__drawerRuns = [];
document.addEventListener('transitionrun', e => {
  if (e.target.closest && e.target.closest('#drawer')) window.__drawerRuns.push(e.propertyName);
}, true);
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('soundToggle'), r = el.getBoundingClientRect();
  window.__drawerAtLoad = { soundRight: r.right, visibility: getComputedStyle(el).visibility };
});`;

const STATE = `(() => {
  const $ = id => document.getElementById(id);
  const box = el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, center: [r.left + r.width / 2, r.top + r.height / 2],
             visible: cs.visibility === 'visible' && cs.display !== 'none' && r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight };
  };
  const at = el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
  const hit = el => { const a = at(el); return !!a && el.contains(a); };
  // 版本號不吃點擊（pointer-events: none），中心點拿到的是它底下那一層：是拉頁本身才代表沒被別的東西蓋住
  const verAt = at($('ver'));
  return { open: $('drawer').dataset.open, expanded: $('drawerHandle').getAttribute('aria-expanded'), handle: box($('drawerHandle')),
    sound: { ...box($('soundToggle')), hit: hit($('soundToggle')), pressed: $('soundToggle').getAttribute('aria-pressed') },
    stats: { ...box($('statsBtn')), hit: hit($('statsBtn')) },
    reset: { ...box($('chipResetBtn')), hit: hit($('chipResetBtn')) },
    ver: { ...box($('ver')), text: $('ver').textContent, onTop: !!verAt && $('drawerPanel').contains(verAt) },
    statsOpen: !$('statsPanel').hidden, scrim: !$('scrim').hidden, cover: ${COVERED}, vw: innerWidth, vh: innerHeight };
})()`;

// 等開頁的預演做完再開始數重畫與 requestAnimationFrame（預演本來就會畫一兩格）
const CLOSED = `(async () => {
  const s = BJK.view.stage;
  await s.dealer.ready;
  await new Promise(r => setTimeout(r, 2500));
  window.__renders = 0; window.__rafs = 0;
  { const R = s.renderer, orig = R.render; R.render = function () { window.__renders++; return orig.apply(this, arguments); }; }
  { const raf = window.requestAnimationFrame; window.requestAnimationFrame = function (cb) { window.__rafs++; return raf.call(window, cb); }; }
  const h = document.getElementById('table').clientHeight, wallTop = JSON.parse(document.body.dataset.bjk).scene.wallTop;
  const edge = new THREE.Vector3(0, 0.26, 0).project(s.camera);   // 荷官那條直邊的桌緣
  const tags = [...document.querySelectorAll('#overlay .seat-tag')].filter(el => !el.hidden).map(el => {
    const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  const st = ${STATE};
  return { ...st, atLoad: { ...window.__drawerAtLoad, runs: window.__drawerRuns.slice() }, orient: document.body.dataset.orient, wallY: (1 - wallTop) / 2 * h, edgeY: (1 - edge.y) / 2 * h, tags,
           outside: [innerWidth - 20, (st.handle.top + st.handle.bottom) / 2] };
})()`;

// 照同事的按法真的點（CDP 滑鼠）：拉開、點音效、點外面、點把手拉開再點把手、拉開點戰績、點遮罩關掉戰績
async function drawerRun(dir, viewport, browser = first()) {
  return withPage(browser, { ...viewport, init: AT_LOAD }, async page => {
    await page.goto(url(dir));
    const closed = await page.evaluate(CLOSED, 20000);
    const out = { closed };
    if (!closed.handle.visible) return out;
    const state = () => page.evaluate(STATE);
    const pressAt = async (x, y) => { await page.click(x, y); await page.evaluate(DRAWER_SETTLED); return state(); };
    const press = el => pressAt(...el.center);
    out.open = await press(closed.handle);
    out.afterSound = await press(out.open.sound);
    out.afterOutside = await pressAt(...closed.outside);
    const reopened = await press(out.afterOutside.handle);
    out.afterHandleTwice = await press(reopened.handle);
    const third = await press(out.afterHandleTwice.handle);
    out.afterStats = await press(third.stats);
    out.afterScrim = await pressAt(...out.afterStats.cover.point);
    out.counts = await page.evaluate('({ renders: window.__renders, rafs: window.__rafs })');
    return out;
  });
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const BUTTONS = ['sound', 'stats', 'reset'];

function assertAtLoad(m) {
  const a = m.closed.atLoad;
  assert.ok(a && a.soundRight <= 0 && a.visibility === 'hidden' && a.runs.length === 0, `開頁那一刻拉頁不是收起的（會看到它滑走）：${JSON.stringify(a)}`);
}
function assertCollapsed(m) {
  const c = m.closed, why = JSON.stringify(c);
  assert.deepStrictEqual([...BUTTONS, 'ver'].filter(k => c[k].visible), [], `收起時音效、戰績、籌碼重置或版本號還看得到：${why}`);
  assert.ok(c.handle.visible && Math.abs(c.handle.left) < 0.5, `把手不在左邊緣：${why}`);
  assert.ok(c.handle.bottom - c.handle.top >= 44, `把手不到 44 像素高，手指不好按：${why}`);
  assert.ok(c.handle.right - c.handle.left >= 30, `把手太窄，手指不好按：${why}`);
  assert.ok(c.handle.top >= c.wallY && c.handle.bottom <= c.edgeY, `把手不在牆上緣與桌緣之間（會壓到上方的泡泡或牌桌）：${why}`);
  assert.deepStrictEqual(c.tags.filter(t => overlaps(t, c.handle)).map(t => t.text), [], `把手壓到名牌：${why}`);
}
function assertOpened(m) {
  const o = m.open, why = JSON.stringify(o);
  assert.deepStrictEqual([o.open, o.expanded], ['true', 'true'], `點把手沒有拉開：${why}`);
  for (const k of [...BUTTONS, 'ver']) {
    assert.ok(o[k].visible && o[k].left >= 0 && o[k].top >= 0 && o[k].bottom <= o.vh, `拉開後${k}不在畫面內：${why}`);
  }
  assert.deepStrictEqual(BUTTONS.filter(k => !o[k].hit), [], `拉開後音效、戰績或籌碼重置鈕點不到：${why}`);
  for (const k of BUTTONS) assert.ok(o[k].bottom - o[k].top >= 44 && o[k].right - o[k].left >= 44, `拉開後${k}不到 44 像素見方：${why}`);
  // 名牌不會跟著拉頁動，拿收起時量的比
  assert.deepStrictEqual(m.closed.tags.filter(t => BUTTONS.some(k => overlaps(t, o[k]))).map(t => t.text), [], `拉開後按鈕壓到名牌：${why}`);
  assert.ok(o.ver.onTop && o.ver.text === `v${BJK_VER}`, `拉開後版本號看不到或不是 v${BJK_VER}：${why}`);
  assert.deepStrictEqual([m.afterSound.sound.pressed, m.afterSound.open], ['false', 'true'], `點拉頁裡的音效沒有關掉，或拉頁跟著收了：${JSON.stringify(m.afterSound)}`);
  assert.ok(m.afterStats.statsOpen, `點拉頁裡的戰績沒有打開戰績：${JSON.stringify(m.afterStats)}`);
}
function assertCloses(m) {
  assert.ok(m.afterOutside.open === 'false' && !m.afterOutside.sound.visible, `點拉頁外面沒有收回：${JSON.stringify(m.afterOutside)}`);
  assert.ok(m.afterHandleTwice.open === 'false' && m.afterHandleTwice.expanded === 'false' && !m.afterHandleTwice.sound.visible,
    `再點一次把手沒有收回：${JSON.stringify(m.afterHandleTwice)}`);
}
// 戰績視窗開著時拉頁裡的按鈕與把手都被遮罩蓋住；點遮罩關掉戰績，拉頁照舊開著
function assertStatsScrim(m) {
  const s = m.afterStats, x = m.afterScrim;
  assertCovered(s.cover, JSON.stringify(s.cover));
  assert.ok(s.statsOpen && s.scrim, `打開戰績時沒有遮罩：${JSON.stringify(s)}`);
  assert.ok(!x.statsOpen && !x.scrim && x.open === 'true', `點遮罩沒有關掉戰績，或拉頁跟著收起來了：${JSON.stringify(x)}`);
}
function assertNoRedraw(m) {
  assert.deepStrictEqual(m.counts, { renders: 0, rafs: 0 }, '拉開、收回、點裡面的鈕時重畫了牌桌或開了 JS 動畫');
}
function assertLandscape(m) {
  const c = m.closed, why = JSON.stringify(c);
  assert.ok(!c.handle.visible, `橫式畫面出現了把手：${why}`);
  assert.deepStrictEqual(BUTTONS.filter(k => overlaps(c[k], c.ver)), [], `橫式畫面的鈕疊到版本號：${why}`);
  assert.deepStrictEqual([c.sound, c.stats, c.reset].map(b => [b.visible, b.left, b.top, b.right, b.bottom]), [[true, 8, 6, 48, 46], [true, 56, 6, 96, 46], [true, 104, 6, 144, 46]],
    `橫式畫面的音效、戰績、籌碼重置鈕不在左上角排成一排：${why}`);
  assert.ok(BUTTONS.every(k => c[k].hit), `橫式畫面左上角的鈕點不到：${why}`);
  assert.ok(c.ver.visible && c.ver.top === 6 && Math.abs(c.ver.right - (c.vw - 8)) < 0.5 && c.ver.text === `v${BJK_VER}`, `橫式畫面的版本號不在右上角：${why}`);
}

for (const browser of availableBrowsers()) {
  for (const [name, vp] of [['直式手機', PHONE], ['矮的直式手機', SHORT_PHONE], ['小的直式手機', SMALL_PHONE]]) {
    test(`${browser}：${name}只露左邊的把手；點開後音效、戰績、籌碼重置點得到且不壓名牌、版本號看得到，點外面或再點把手收回，不重畫牌桌`, async () => {
      const r = await drawerRun(APP, vp, browser);
      assert.strictEqual(r.value.closed.orient, 'portrait');
      assertAtLoad(r.value);
      assertCollapsed(r.value);
      assertOpened(r.value);
      assertCloses(r.value);
      assertStatsScrim(r.value);
      assertNoRedraw(r.value);
      assert.deepStrictEqual(r.console, []);
    });
  }
  for (const [name, vp] of [['桌機', DESKTOP], ['橫式手機', PHONE_LANDSCAPE]]) {
    test(`${browser}：${name}沒有把手，音效、戰績、籌碼重置排在左上角，版本號在右上角，互不相疊`, async () => {
      const r = await drawerRun(APP, vp, browser);
      assert.strictEqual(r.value.closed.orient, 'landscape');
      assertLandscape(r.value);
      assert.deepStrictEqual(r.console, []);
    });
  }
}

// 每條判準各配一個破壞，在暫存複本上改，確認那一條真的會紅
const CONTROLS = [
  ['拉頁預設展開，要判成收起時還看得到', 'index.html', '<div id="drawer" data-open="false">', '<div id="drawer" data-open="true">', SHORT_PHONE, assertCollapsed, /收起時/],
  ['把手放到桌緣上，要判成不在牆與桌緣之間', path.join('js', 'view', 'main.js'), '`${Math.round((wallY + edgeY) / 2)}px`', '`${Math.round(edgeY)}px`', SHORT_PHONE, assertCollapsed, /牆上緣與桌緣之間/],
  ['開頁第一次排版照樣播滑動，要判成開頁那一刻不是收起的', path.join('js', 'view', 'main.js'), "drawer.classList.add('still');", '', SHORT_PHONE, assertAtLoad, /開頁那一刻/],
  ['拉開時拉頁仍藏著，要判成點不到', 'style.css', 'visibility: visible;\n  transition-delay: 0s;', 'visibility: hidden;\n  transition-delay: 0s;', SHORT_PHONE, assertOpened, /拉開後/],
  ['拿掉點外面收回，要判成點外面沒有收回', path.join('js', 'view', 'hud.js'),
    "document.addEventListener('pointerdown', e => { if (drawer.dataset.open === 'true' && !inDrawer(e.target)) setDrawer(false); });", '', SHORT_PHONE, assertCloses, /點拉頁外面沒有收回/],
  ['拉頁往下挪到名牌那一帶，要判成拉開後壓到名牌', path.join('js', 'view', 'main.js'), '`${Math.round((wallY + edgeY) / 2)}px`', '`${Math.round((wallY + edgeY) / 2) + 190}px`', SHORT_PHONE, assertOpened, /壓到名牌/],
  ['籌碼重置鈕擺到右上角，要判成橫式疊到版本號', 'style.css', '#chipResetBtn {\n  left: 104px;\n}', '#chipResetBtn {\n  left: auto;\n  right: 8px;\n}', DESKTOP, assertLandscape, /疊到版本號/],
  ['戰績視窗不蓋遮罩，要判成點得到拉頁裡的按鈕', path.join('js', 'view', 'hud.js'),
    'const syncScrim = () => { scrim.hidden = statsPanel.hidden && resetPanel.hidden; };', 'const syncScrim = () => {};', SHORT_PHONE, assertStatsScrim, /點得到底下/],
  ['拉開時用 JS 動畫並重畫牌桌，要判成重畫了', path.join('js', 'view', 'hud.js'),
    "drawer.dataset.open = String(open);", "drawer.dataset.open = String(open); requestAnimationFrame(() => V.stage.render());", SHORT_PHONE, assertNoRedraw, /重畫/],
  ['橫式畫面也收進拉頁，要判成出現把手', path.join('js', 'view', 'main.js'), "const orient = aspect < 1 ? 'portrait' : 'landscape';", "const orient = 'portrait';", DESKTOP, assertLandscape, /把手/],
];
for (const [what, file, from, to, vp, judge, re] of CONTROLS) {
  test(`陽性對照：${what}`, async () => {
    const tmp = copyWith(file, from, to);
    try {
      const r = await drawerRun(tmp, vp);
      assert.throws(() => judge(r.value), re);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
