// 守荷官對白泡泡的外觀與字型（v0.24.0 深底金框）：
// 對白字型載好之後泡泡照新的字寬重擺（開頁第一句是在字型載好之前擺的）；字型載不起來時退回系統字、牌照樣能玩、主控台只留我們那一行警告；
// 米白字對深底、名牌的字對金底，對比度用算的都 ≥ 4.5；荷官真的會講的長句在五種畫面上：尖角對著臉、名牌與尖角都在畫面內、
// 不蓋臉、不疊看得到的按鈕，標點不落在行首。泡泡本身怎麼避臉（LONG 那句、換表情重擺、拉頁）在 check_dealer.js。
// 驗不到：字好不好看、雙線框與陰影的質感（看 node tools/shoot.js <前綴> --dealer）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withPage } = require('./browser_util');
const { APP, DESKTOP, PHONE, SHORT_PHONE, SMALL_PHONE, PHONE_LANDSCAPE, BUBBLE_LINES, url, first, copyWith } = require('./ui_util');

const DEALER_JS = path.join('js', 'view', 'dealer.js');
const FONT_JS = path.join('lib', 'bubble_font.js');
const MOODS = ['idle', 'deal', 'surprised', 'smile', 'sorry'];
// 不准放行首的標點
const NO_START = '，。、！？：；」』）》〉…—～,.!?:;)';
const MIXED = BUBBLE_LINES[0];
// 換字型前後要量得出差別的一句：一行排得下（寬度跟著字走，不被寬度上限卡住）、有英文（純中文每個字都是 1em，換字型寬度不變）
const SWAP_LINE = '哇，Blackjack！';

const rmrf = dir => fs.rmSync(dir, { recursive: true, force: true });
const snapJs = `
  const d = BJK.view.stage.dealer, b = document.getElementById('bubble'), edge = b.querySelector('.edge'), words = b.querySelector('.bubble-text');
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const ui = () => [...document.querySelectorAll('button, #ver')].map(el => ({ id: el.id || el.textContent, ...rect(el),
    shown: getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().width > 0 && rect(el).right > 0 && rect(el).left < innerWidth })).filter(u => u.shown);
  const snap = () => {
    // 框線上取 600 點，離泡泡最遠的那一點是尖角的尖端
    const br = b.getBoundingClientRect(), M = edge.getScreenCTM(), L = edge.getTotalLength();
    let tip = null, far = -Infinity;
    for (let i = 0; i <= 600; i++) {
      const p = edge.getPointAtLength(L * i / 600), q = new DOMPoint(p.x, p.y).matrixTransform(M);
      const out = Math.max(br.left - q.x, q.x - br.right, br.top - q.y, q.y - br.bottom);
      if (out > far) { far = out; tip = { x: q.x, y: q.y }; }
    }
    // 每一行開頭的字：跟前一個字不在同一列就是新的一行
    const node = words.firstChild, r = document.createRange(), starts = [];
    let lastTop = null;
    for (let k = 0; k < node.length; k++) {
      r.setStart(node, k); r.setEnd(node, k + 1);
      const rs = r.getClientRects();
      if (!rs.length || !node.data[k].trim()) continue;
      if (lastTop === null || rs[0].top > lastTop + 3) starts.push(node.data[k]);
      lastTop = rs[0].top;
    }
    return { text: words.textContent, side: b.dataset.side, bubble: rect(b), frame: rect(edge), plate: rect(b.querySelector('.bubble-plate')),
             tip, far, starts, face: d.faceRect(), ui: ui(), vw: innerWidth, vh: innerHeight };
  };`;

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inView = (r, m) => r.left >= 0 && r.top >= 0 && r.right <= m.vw && r.bottom <= m.vh;
const distTo = (p, r) => Math.hypot(Math.max(0, r.left - p.x, p.x - r.right), Math.max(0, r.top - p.y, p.y - r.bottom));
// 一句話擺好的樣子有哪些不對
function layoutProblems(m) {
  const out = [], what = `${m.side}「${m.text}」`;
  for (const k of ['bubble', 'frame', 'plate']) {
    if (!inView(m[k], m)) out.push(`${what}：${k} 超出畫面 ${JSON.stringify(m[k])}`);
    if (overlaps(m[k], m.face)) out.push(`${what}：${k} 蓋到臉`);
    const hit = m.ui.filter(u => overlaps(m[k], u)).map(u => u.id);
    if (hit.length) out.push(`${what}：${k} 疊到 ${hit.join('、')}`);
  }
  if (m.far < 5) out.push(`${what}：沒有尖角（最遠只凸出 ${m.far.toFixed(1)}）`);
  else if (distTo(m.tip, m.face) > 4) out.push(`${what}：尖角沒對著臉，尖端 ${m.tip.x.toFixed(0)},${m.tip.y.toFixed(0)} 離臉 ${distTo(m.tip, m.face).toFixed(1)}`);
  const bad = m.starts.filter(c => NO_START.includes(c));
  if (bad.length) out.push(`${what}：標點「${bad.join('')}」落在行首`);
  return out;
}

// 每種畫面把長句輪流配五種表情講一遍；表情的頭位置不同，尖角要跟著改
const LAYOUT = `(async () => {${snapJs}
  await d.ready;
  const out = [];
  for (const line of ${JSON.stringify(BUBBLE_LINES)}) for (const mood of ${JSON.stringify(MOODS)}) { d.setMood(mood); d.say(line); out.push({ mood, ...snap() }); }
  return out;
})()`;
const layout = (appDir, vp) => withPage(first(), vp, async page => {
  await page.goto(url(appDir));
  return page.evaluate(LAYOUT, 60000);
});
const VIEWS = [['桌機', DESKTOP], ['直式手機', PHONE], ['矮的直式手機', SHORT_PHONE], ['小的直式手機', SMALL_PHONE], ['橫式手機', PHONE_LANDSCAPE]];

for (const [name, vp] of VIEWS) {
  test(`${first()}：${name}講真的長句，尖角對著臉、名牌與尖角都在畫面內、不蓋臉不疊按鈕，標點不落在行首`, async t => {
    const r = await layout(APP, vp);
    const rows = r.value.filter(m => m.mood === 'idle').map(m => `${m.starts.length} 行「${m.text}」`);
    t.diagnostic(`${vp.size.join('×')}：${rows.join('；')}`);
    assert.deepStrictEqual(r.value.flatMap(layoutProblems), []);
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：尖角一律畫在左緣，矮的直式手機上泡泡在臉左邊時要判成尖角沒對著臉', async () => {
  const tmp = copyWith(DEALER_JS, 'framePath(box.width, box.height, bubble.dataset.side, at, line)', "framePath(box.width, box.height, 'right', at, line)");
  try {
    const problems = (await layout(tmp, SHORT_PHONE)).value.flatMap(layoutProblems);
    assert.ok(problems.some(p => /尖角沒對著臉/.test(p)), problems.slice(0, 3).join('｜'));
  } finally {
    rmrf(tmp);
  }
});

test('陽性對照：擺位時不替名牌留頂端那一截，小的直式手機上要判成名牌超出畫面', async () => {
  const tmp = copyWith(DEALER_JS, 'top = clamp(top, m + lift, vh - h - m);', 'top = clamp(top, m, vh - h - m);');
  try {
    const problems = (await layout(tmp, SMALL_PHONE)).value.flatMap(layoutProblems);
    assert.ok(problems.some(p => /plate 超出畫面/.test(p)), problems.slice(0, 3).join('｜'));
  } finally {
    rmrf(tmp);
  }
});

test('陽性對照：窄泡泡也照寬泡泡只在標點後換行，一段放不下硬斷時要判成標點落在行首', async () => {
  const tmp = copyWith('style.css', '.bubble[data-narrow] {\n  word-break: normal;', '.bubble[data-narrow] {\n  word-break: keep-all;');
  try {
    const problems = [...(await layout(tmp, SHORT_PHONE)).value, ...(await layout(tmp, SMALL_PHONE)).value].flatMap(layoutProblems);
    assert.ok(problems.some(p => /落在行首/.test(p)), problems.slice(0, 3).join('｜'));
  } finally {
    rmrf(tmp);
  }
});

// ---- 字型是非同步載入的 ----
// 把字型卡住：開頁、先講一句（還是系統字）、放行後等字型好了量一次，再叫 placeBubble 量一次；兩次要一樣，泡泡才是照新的字寬擺的。
// 不用固定延遲：全套平行跑時開頁可能超過延遲，字型在量之前就到了（2026-11-18 全套紅過兩次）
const SLOW_FONT = `{ const load = FontFace.prototype.load; let go; const gate = new Promise(r => { go = r; }); window.__releaseFont = () => go(); FontFace.prototype.load = function () { return gate.then(() => load.call(this)); }; }`;
const FONT_SWAP = `(async () => {${snapJs}
  const F = BJK.view.bubbleFont, box = () => ({ bubble: rect(b), frame: rect(edge) });
  const added = () => [...document.fonts].some(f => f.family.replace(/"/g, '') === F.family && f.status === 'loaded');
  const early = added();
  d.say(${JSON.stringify(SWAP_LINE)});
  const fallback = box();
  window.__releaseFont();
  const ok = await F.ready;
  const loaded = box();
  d.placeBubble();
  return { early, ok, after: added(), family: getComputedStyle(words).fontFamily, fallback, loaded, replaced: box() };
})()`;
const fontSwap = (appDir, vp) => withPage(first(), { ...vp, init: SLOW_FONT }, async page => {
  await page.goto(url(appDir));
  return page.evaluate(FONT_SWAP, 30000);
});
const near = (a, b) => ['left', 'right', 'top', 'bottom'].every(k => Math.abs(a[k] - b[k]) < 0.5);
function swapProblems(v) {
  assert.strictEqual(v.early, false, `量法錯：字型沒被拖慢，量不到載好之前：${JSON.stringify(v)}`);
  assert.ok(v.ok && v.after, `字型沒載起來：${JSON.stringify(v)}`);
  assert.ok(!near(v.fallback.bubble, v.replaced.bubble), `量法錯：換字型前後泡泡一樣大，分不出有沒有重擺：${JSON.stringify(v)}`);
  return ['bubble', 'frame'].filter(k => !near(v.loaded[k], v.replaced[k])).map(k => `字型載好後 ${k} 還停在系統字的大小與位置：${JSON.stringify({ loaded: v.loaded[k], replaced: v.replaced[k] })}`);
}

for (const [name, vp] of [['桌機', DESKTOP], ['矮的直式手機', SHORT_PHONE]]) {
  test(`${first()}：${name}字型比第一句晚到時，載好後泡泡與框照新的字寬重擺；字型名排第一`, async () => {
    const r = await fontSwap(APP, vp);
    assert.deepStrictEqual(swapProblems(r.value), []);
    assert.match(r.value.family, /^"?BJK WenKai"?,/);
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：字型載好後不重擺，要判成泡泡與框停在系統字的樣子', async () => {
  const tmp = copyWith(DEALER_JS, 'V.bubbleFont.ready.then(ok => { if (ok) placeBubble(); });', '');
  try {
    for (const vp of [DESKTOP, SHORT_PHONE]) {
      const problems = swapProblems((await fontSwap(tmp, vp)).value);
      assert.ok(problems.some(p => /frame 還停在/.test(p)), `${vp.size}：${problems.join('｜')}`);
    }
  } finally {
    rmrf(tmp);
  }
});

// 子集壞掉（資料前面多塞幾個位元組，瀏覽器解不開）：ready 是 false、泡泡用系統字、牌打得完一局，主控台只多我們那一行警告；
// 瀏覽器自己報的解碼錯誤（OTS parsing error 之類）不是我們印的，列出來不判
const FONT_FAIL = `(async () => {
  const d = BJK.view.stage.dealer;
  const ready = await d.ready.then(() => 'ok', e => 'fail: ' + e.message);
  const font = await BJK.view.bubbleFont.ready.then(v => v, e => 'reject: ' + e.message);
  d.say(${JSON.stringify(MIXED)});
  const b = document.getElementById('bubble'), shown = !b.hidden && b.textContent;
  BJK.view.anim.speed = 40;
  const round = await BJK.view.stage.director.autoplay(1).then(r => r.rounds === 1 ? 'ok' : JSON.stringify(r), e => 'fail: ' + e.message);
  return { ready, font, shown, round, mismatches: BJK.view.stage.director.mismatches,
           loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
})()`;
const CORRUPT = ["url: 'data:font/woff2;base64,", "url: 'data:font/woff2;base64,AAAA"];
async function fontFail(appDir) {
  const r = await withPage(first(), DESKTOP, async page => {
    await page.goto(url(appDir));
    return page.evaluate(FONT_FAIL, 60000);
  });
  const ours = r.console.filter(l => /對白字型載不起來/.test(l));
  const scripts = r.console.filter(l => /^(exception|error):/.test(l) && !/OTS|decode|font/i.test(l));
  // 瀏覽器報解碼錯誤時會把整個 data: URL 印出來，截短才讀得了
  return { ...r.value, ours, scripts, console: r.console.map(l => l.length > 140 ? `${l.slice(0, 100)}…${l.slice(-30)}` : l) };
}

test(`${first()}：子集解不開時退回系統字，牌照樣打得完一局，主控台留一行警告`, async t => {
  const tmp = copyWith(FONT_JS, ...CORRUPT);
  try {
    const v = await fontFail(tmp), why = JSON.stringify(v);
    t.diagnostic(`主控台：${v.console.join('｜')}`);
    assert.strictEqual(v.ready, 'ok', why);
    assert.strictEqual(v.font, false, why);
    assert.strictEqual(v.shown, MIXED, why);
    assert.strictEqual(v.round, 'ok', why);
    assert.deepStrictEqual(v.mismatches, [], why);
    assert.ok(!v.loaded.some(f => /WenKai/.test(f)), why);
    assert.strictEqual(v.ours.length, 1, why);
    assert.match(v.ours[0], /^warning:/, why);
    assert.deepStrictEqual(v.scripts, [], why);
  } finally {
    rmrf(tmp);
  }
});

test('陽性對照：子集解不開又沒接住錯誤，要判成荷官沒就緒、主控台有沒接住的錯', async () => {
  const tmp = copyWith(FONT_JS, ...CORRUPT);
  const js = path.join(tmp, FONT_JS), text = fs.readFileSync(js, 'utf8');
  const from = text.match(/\n\s*\.catch\(e => \{ console\.warn[^\n]*/)[0];
  fs.writeFileSync(js, text.replace(from, ''));
  try {
    const v = await fontFail(tmp);
    assert.notStrictEqual(v.ready, 'ok', JSON.stringify(v));
    assert.strictEqual(v.ours.length, 0, JSON.stringify(v));
  } finally {
    rmrf(tmp);
  }
});

// ---- 對比度：用算的，不用看的。泡泡底是 88% 不透明，背後最亮（純白）與最暗（純黑）兩種都算 ----
const COLORS = `(async () => {${snapJs}
  await d.ready; d.say('歡迎光臨，請下注！');
  const plate = b.querySelector('.bubble-plate');
  return { text: getComputedStyle(words).color, fill: getComputedStyle(edge).fill, fillOpacity: getComputedStyle(edge).fillOpacity,
           plateText: getComputedStyle(plate).color, plateBg: getComputedStyle(plate).backgroundImage };
})()`;
const rgba = s => { const [r, g, b, a = 1] = s.match(/[\d.]+/g).map(Number); return { r, g, b, a }; };
const lum = ({ r, g, b }) => [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
const over = (fg, alpha, bg) => ({ r: fg.r * alpha + bg.r * (1 - alpha), g: fg.g * alpha + bg.g * (1 - alpha), b: fg.b * alpha + bg.b * (1 - alpha) });
function contrasts(c) {
  const fill = rgba(c.fill), alpha = fill.a * Number(c.fillOpacity), text = rgba(c.text);
  const white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 };
  const stops = c.plateBg.match(/rgba?\([^)]+\)/g).map(rgba);
  return {
    bubble: Math.min(contrast(text, over(fill, alpha, white)), contrast(text, over(fill, alpha, black))),
    plate: Math.min(...stops.map(s => contrast(rgba(c.plateText), s))),
  };
}
const colorsOf = async appDir => (await withPage(first(), DESKTOP, async page => { await page.goto(url(appDir)); return page.evaluate(COLORS); })).value;

test(`${first()}：米白字對泡泡深底（背後是白或黑都算）、名牌的字對金底，對比度都 ≥ 4.5`, async t => {
  const c = contrasts(await colorsOf(APP));
  t.diagnostic(`對比度：泡泡 ${c.bubble.toFixed(2)}、名牌 ${c.plate.toFixed(2)}`);
  assert.ok(c.bubble >= 4.5 && c.plate >= 4.5, JSON.stringify(c));
});

test('陽性對照：泡泡底改成 30% 不透明，背後是白的時候要判成對比不夠', async () => {
  const tmp = copyWith('style.css', 'fill: rgba(33, 44, 49, 0.88);', 'fill: rgba(33, 44, 49, 0.3);');
  try {
    const c = contrasts(await colorsOf(tmp));
    assert.ok(c.bubble < 4.5, JSON.stringify(c));
  } finally {
    rmrf(tmp);
  }
});
