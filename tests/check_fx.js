// 守三段大特效（app/js/view/showcase.js）：你拿 Blackjack、荷官翻出 Blackjack、你按「加倍」時各播一次，播完收乾淨、
// 畫面跟事件對得上、主控台乾淨；加倍的特效播完才把加倍那疊籌碼推上桌；少了 showcase.js 時開頁就說載不起來；
// 大標與副標看得到的字對在同一條中線上；加倍那片籌碼一路躺著（不會出現直立的橢圓）；噴出的籌碼翻面時面額字不左右相反；
// 開頁後有看不到的預演；播的期間不重畫被蓋住的 3D 牌桌。
// 大字不蓋住荷官的臉（BJK-04）與同一局只播一次（BJK-05）在 check_ui_text.js；40 倍速連打時不變慢、不疊在一起在 check_play.js。
// 驗不到：好不好看、節奏對不對（照 shots 的格放截圖看），真手機上的效能；預演有沒有真的消掉頓一下（tools/measure_perf.js --only fx）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers, withPage } = require('./browser_util');
const { rigInit, deal } = require('./rig_util');
const { FX_WATCH, FX_SEEK, FX_INK } = require('./fx_util');

const APP = path.join(__dirname, '..', 'app');
const DESKTOP = { size: [1280, 720], mobile: false };
const PHONE = { size: [390, 844], mobile: true };
const url = dir => pathToFileURL(path.join(dir, 'index.html')).href;
const first = () => availableBrowsers()[0];
const SHOWCASE = path.join('js', 'view', 'showcase.js');
const DIRECTOR = path.join('js', 'view', 'director.js');

// edits：[[檔案, 原字串, 換成], …]，在暫存複本上改；沒命中就直接紅，免得「破壞沒生效」被當成對照通過
function copyWith(edits) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-app-'));
  fs.cpSync(APP, tmp, { recursive: true });
  for (const [file, from, to] of edits) {
    const target = path.join(tmp, file);
    const text = fs.readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `破壞沒有命中：${file} 裡找不到 ${from}`);
    fs.writeFileSync(target, text.replace(from, to));
  }
  return tmp;
}
async function withCopy(edits, fn) {
  const tmp = copyWith(edits);
  try {
    return await fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- 觸發：疊好牌真的打一局（40 倍速），像真人一樣按鈕 ----
// 加倍一定要按「加倍」鈕：交給穩健策略的話 11 點對 6 偶爾憑手感不加倍，量不到（原型實測撞過）
const SCENES = {
  player: { rig: deal('A', 'K'), press: null },
  // 你 10＋9 停牌，荷官明牌 A、底牌 K：大家打完才翻出 Blackjack
  dealer: { rig: ['10', '10', '10', '10', 'A', '9', '9', '9', '9', 'K'], press: 'standBtn' },
  // 你 6＋5（11 點）對荷官 6：按加倍補到 10
  double: { rig: [...deal('6', '5'), '10'], press: 'doubleBtn' },
};
const SCENE = press => `(async () => {
  await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
  ${FX_WATCH}
  const $ = id => document.getElementById(id), hud = $('hud'), d = BJK.view.stage.director;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 25) await sleep(25); return ok(); };
  $('clearBet').click(); document.querySelector('[data-chip="100"]').click(); $('dealBtn').click();
  await until(() => hud.dataset.mode === 'act' || hud.dataset.mode === 'bet', 15000);
  const turn = hud.dataset.mode;
  ${press ? `if (turn === 'act') $('${press}').click();` : ''}
  await until(() => hud.dataset.mode === 'bet', 30000);
  return { turn, fx: fxReport(), mismatches: d.mismatches, doubled: d.game.state().seats.find(s => s.id === 'me').hands.some(h => h.doubled) };
})()`;
const scene = (kind, dir) => withPage(first(), { ...DESKTOP, init: rigInit(SCENES[kind].rig) },
  page => page.goto(url(dir)).then(() => page.evaluate(SCENE(SCENES[kind].press), 60000)));

for (const kind of Object.keys(SCENES)) {
  test(`${first()}：${{ player: '你拿 Blackjack', dealer: '荷官最後翻出 Blackjack', double: '你按「加倍」' }[kind]}，播一次大特效，播完收乾淨、畫面跟事件對得上`, async t => {
    const r = await scene(kind, APP), m = r.value, why = JSON.stringify(m);
    t.diagnostic(`40 倍速：出現到收掉 ${m.fx.log.map(x => x.life).join('、')} ms`);
    assert.strictEqual(m.turn, kind === 'player' ? 'bet' : 'act', `前置不成立，疊的牌沒打出這個局面：${why}`);
    assert.deepStrictEqual(m.fx.log.map(x => x.kind), [kind], why);
    assert.deepStrictEqual([m.fx.left, m.fx.bodyClass, m.fx.bodyVar, m.fx.maxLive], [0, [], '', 1], `播完沒收乾淨：${why}`);
    assert.deepStrictEqual(m.mismatches, [], why);
    if (kind === 'double') {
      assert.ok(m.doubled, why);
      // 收掉那一刻桌上只有原注那一疊：加倍那疊要等特效播完才推上桌
      assert.deepStrictEqual(m.fx.log[0].stacks, [1], `加倍那疊籌碼沒等特效播完就上桌：${why}`);
    }
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：拿掉導演裡觸發三段特效的那三行，三局都要判成沒播', () => withCopy([
  [DIRECTOR, "await FX.showcase('player');", ''],
  [DIRECTOR, "await FX.showcase('dealer');", ''],
  [DIRECTOR, 'if (e.seat === \'me\') await FX.doubleDown(e.amount / 2);', ''],
], async tmp => {
  for (const kind of Object.keys(SCENES)) {
    const r = await scene(kind, tmp);
    assert.deepStrictEqual(r.value.fx.log, [], `${kind}：${JSON.stringify(r.value)}`);
  }
}));

test('陽性對照：加倍那疊先推上桌才播特效，要判成沒等特效播完', () => withCopy([[DIRECTOR,
  "if (e.seat === 'me') await FX.doubleDown(e.amount / 2);\n        await flyChips(e.seat, e.hand, e.amount / 2, railOf(e.seat), 1);",
  "await flyChips(e.seat, e.hand, e.amount / 2, railOf(e.seat), 1);\n        if (e.seat === 'me') await FX.doubleDown(e.amount / 2);"]], async tmp => {
  const r = await scene('double', tmp);
  assert.deepStrictEqual(r.value.fx.log.map(x => x.stacks), [[2]], JSON.stringify(r.value));
}));

// ---- 少了 showcase.js（檔名打錯、複製資料夾時漏掉）：開頁就說載不起來，不要等到第一次 Blackjack 才卡在動畫中 ----
const { BJK_VER } = require('../app/js/core/version.js');
const SCREEN = `(() => ({ text: document.body.innerText, hud: getComputedStyle(document.getElementById('hud')).display }))()`;
const withoutShowcase = edits => withCopy(edits, tmp => {
  fs.rmSync(path.join(tmp, SHOWCASE));
  return withPage(first(), DESKTOP, page => page.goto(url(tmp)).then(() => page.evaluate(SCREEN)));
});

test(`${first()}：少了 showcase.js 時，開頁就說載不起來、帶版本號，操作列藏起來`, async () => {
  const r = await withoutShowcase([]);
  assert.ok(r.value.text.includes('載不起來') && r.value.text.includes(`v${BJK_VER}`), r.value.text);
  assert.strictEqual(r.value.hud, 'none', r.value.text);
});

test('陽性對照：拿掉導演開頁時的檢查，少了 showcase.js 要判成畫面沒說明', async () => {
  const r = await withoutShowcase([[DIRECTOR, "if (!FX.showcase || !FX.doubleDown) throw new Error('載入順序錯：showcase.js 要排在 director.js 之前');", '']]);
  assert.ok(!r.value.text.includes('載不起來'), r.value.text);
});

// ---- 字的對齊：大標與副標看得到的字，水平中心差不到 2 px ----
// 元素本身是置中的，但全形「！」字形偏左、右半邊是空白，整行就往左偏（原型修正前量到 9.7–28.5 px）
const ALIGN = `(async () => {
  await BJK.view.stage.dealer.ready;
  ${FX_SEEK}${FX_INK}
  const out = {};
  for (const kind of ['player', 'dealer', 'double']) {
    BJK.view.anim.speed = 0.05;
    const total = (kind === 'double' ? 2400 : 2000) / 0.05;
    if (kind === 'double') BJK.view.fx.doubleDown(100); else BJK.view.fx.showcase(kind);
    const el = document.querySelector('.bigfx');
    await seek(kind === 'double' ? 0.8 : 0.6, total);   // 大標、副標都落定
    const cx = q => (Math.min(...q.map(p => p[0])) + Math.max(...q.map(p => p[0]))) / 2;
    const [title, sub] = [...el.querySelectorAll('.bigfx-ink')].map(e => ({ text: e.textContent, x: cx(inkQuad(e)) }));
    out[kind] = { title, sub, diff: Math.abs(title.x - sub.x) };
    el.remove();
  }
  return out;
})()`;
const align = (vp, dir) => withPage(first(), vp, page => page.goto(url(dir)).then(() => page.evaluate(ALIGN, 30000)));

test(`${first()}：桌機與手機上，三段特效的大標與副標看得到的字對在同一條中線上（差不到 2 px）`, async t => {
  for (const vp of [DESKTOP, PHONE]) {
    const r = await align(vp, APP), why = `${vp.size.join('×')}：${JSON.stringify(r.value)}`;
    t.diagnostic(`${vp.size.join('×')} 中心差 ${['player', 'dealer', 'double'].map(k => `${k} ${r.value[k].diff.toFixed(1)}`).join('、')} px`);
    for (const kind of ['player', 'dealer', 'double']) assert.ok(r.value[kind].diff <= 2, `${kind} 沒對齊：${why}`);
    assert.deepStrictEqual(r.console, []);
  }
});

test('陽性對照：拿掉墨水置中，三段特效都要判成沒對齊', t => withCopy([[SHOWCASE, "el.querySelectorAll('.bigfx-ink').forEach(centerInk);", '']], async tmp => {
  const r = await align(DESKTOP, tmp);
  t.diagnostic(`拿掉後中心差 ${['player', 'dealer', 'double'].map(k => `${k} ${r.value[k].diff.toFixed(1)}`).join('、')} px`);
  for (const kind of ['player', 'dealer', 'double']) assert.ok(r.value[kind].diff > 2, `${kind}：${JSON.stringify(r.value)}`);
}));

// ---- 加倍那片籌碼不直立：從彈出到停下每 1% 暫停量一次籌碼圖的外接框 ----
// 一直躺在斜看的桌面上、或繞水平軸翻，高最多等於寬（正對鏡頭時是圓）；高明顯大於寬就是出現了直立的橢圓（使用者特別指出過不要）
const COIN = `(async () => {
  await BJK.view.stage.dealer.ready;
  ${FX_SEEK}
  BJK.view.anim.speed = 0.1;
  BJK.view.fx.doubleDown(100);
  const samples = [];
  for (let i = 29; i <= 84; i++) {
    await seek(i / 100, 24000);
    const b = document.querySelector('.bigfx .bigfx-coin img').getBoundingClientRect();
    samples.push({ f: i / 100, w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
  }
  return samples;
})()`;
function coinShape(samples) {
  const seen = samples.filter(s => s.w > 2);
  const worst = seen.reduce((a, s) => (s.h / s.w > a.h / a.w ? s : a));
  const last = seen[seen.length - 1];
  return { maxHW: +(worst.h / worst.w).toFixed(2), at: worst.f, finalHW: +(last.h / last.w).toFixed(2), seen: seen.length };
}
const coin = (vp, dir) => withPage(first(), vp, page => page.goto(url(dir)).then(() => page.evaluate(COIN, 30000)));

test(`${first()}：桌機與手機上，加倍那片籌碼從彈出到停下都不直立（外接框高寬比不超過 1.05），最後平躺在桌上`, async t => {
  for (const vp of [DESKTOP, PHONE]) {
    const r = await coin(vp, APP), s = coinShape(r.value), why = `${vp.size.join('×')}：${JSON.stringify(s)}`;
    t.diagnostic(`${vp.size.join('×')} 高寬比最大 ${s.maxHW}（${s.at}）、停下 ${s.finalHW}`);
    assert.ok(s.seen >= 50, `量到的格數太少：${why}`);
    assert.ok(s.maxHW <= 1.05, `出現直立的籌碼：${why}`);
    assert.ok(s.finalHW < 0.6, `停下時沒有平躺：${why}`);
    assert.deepStrictEqual(r.console, []);
  }
});

test('陽性對照：桌面斜看改成繞垂直軸轉（rotateY），要判成直立', t => withCopy([[SHOWCASE, 'transform: `rotateX(${TABLE}deg)', 'transform: `rotateY(${TABLE}deg)']], async tmp => {
  const s = coinShape((await coin(DESKTOP, tmp)).value);
  t.diagnostic(`破壞後高寬比最大 ${s.maxHW}`);
  assert.ok(s.maxHW > 1.05, JSON.stringify(s));
}));

// ---- 噴出的籌碼翻面時，面額字不左右相反：每 1% 暫停量一次每片籌碼的 transform ----
// 行列式小於 0 就是鏡像（字左右相反）；另外要真的有翻（壓扁到不到三成寬），免得拿掉翻面也算過
const MIRROR = `(async () => {
  await BJK.view.stage.dealer.ready;
  ${FX_SEEK}
  BJK.view.anim.speed = 0.05;
  BJK.view.fx.showcase('player');
  let mirrored = 0, seen = 0, minSquash = Infinity;
  for (let i = 16; i <= 99; i++) {
    await seek(i / 100, 40000);
    for (const c of document.querySelectorAll('.bigfx .bigfx-chip')) {
      const cs = getComputedStyle(c);
      if (+cs.opacity < 0.05 || cs.transform === 'none') continue;
      const m = new DOMMatrix(cs.transform);
      seen++;
      if (m.a * m.d - m.b * m.c < -1e-9) mirrored++;
      minSquash = Math.min(minSquash, Math.hypot(m.a, m.b) / Math.hypot(m.c, m.d));
    }
  }
  return { mirrored, seen, minSquash: +minSquash.toFixed(3) };
})()`;
const mirror = dir => withPage(first(), DESKTOP, page => page.goto(url(dir)).then(() => page.evaluate(MIRROR, 30000)));

test(`${first()}：噴出的籌碼翻到背面時面額字照樣是正的（沒有鏡像），而且看得出在翻面`, async t => {
  const r = await mirror(APP), why = JSON.stringify(r.value);
  t.diagnostic(`量了 ${r.value.seen} 片次，鏡像 ${r.value.mirrored}，最扁 ${r.value.minSquash}`);
  assert.ok(r.value.seen > 500, `量到的籌碼太少：${why}`);
  assert.strictEqual(r.value.mirrored, 0, `有籌碼的字左右相反：${why}`);
  assert.ok(r.value.minSquash < 0.3, `籌碼沒在翻面：${why}`);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：翻面改回直接用 cos（會變負的），要判成字左右相反', t => withCopy([[SHOWCASE,
  'Math.abs(Math.cos(t * flips * Math.PI * 2))', 'Math.cos(t * flips * Math.PI * 2)']], async tmp => {
  const r = await mirror(tmp);
  t.diagnostic(`破壞後量了 ${r.value.seen} 片次，鏡像 ${r.value.mirrored}`);
  assert.ok(r.value.mirrored > 0, JSON.stringify(r.value));
}));

// ---- 2026-10-28：開頁後的預演（P-14）、大特效期間不重畫被蓋住的牌桌（P-13） ----
// 預演是開頁閒下來時用幾乎透明的外框把兩段特效各快播一次，第一次作畫要建的東西先建好。這裡守「有預演、看不到、
// 牌桌沒震、播完收掉」；真的消掉長掉格要在沒別的事在跑的機器上量（tools/measure_perf.js --only fx）：
// 全套平行跑時每一格都可能被拖長，放進 npm test 只會隨機紅
const WARM_INIT = `window.__warm = [];
  new MutationObserver(list => { for (const m of list) {
    for (const n of m.addedNodes) if (n.classList && n.classList.contains('bigfx-warm'))
      __warm.push({ cls: n.className, opacity: +getComputedStyle(n).opacity, body: document.body.className, t0: performance.now() });
    for (const n of m.removedNodes) if (n.classList && n.classList.contains('bigfx-warm')) { const x = __warm.find(x => x.t1 === undefined); if (x) x.t1 = performance.now(); }
  } }).observe(document, { childList: true, subtree: true });`;
const WARM = `(async () => {
  await BJK.view.stage.dealer.ready;
  for (let t = 0; t < 8000 && !(__warm.length >= 2 && __warm.every(x => x.t1 !== undefined)); t += 50) await new Promise(r => setTimeout(r, 50));
  return { warm: __warm.map(x => ({ cls: x.cls, opacity: x.opacity, shook: /bigfx-(shake|clack)/.test(x.body), ms: x.t1 === undefined ? null : Math.round(x.t1 - x.t0) })),
           left: document.querySelectorAll('.bigfx-warm, .bigfx').length };
})()`;
const warm = dir => withPage(first(), { ...DESKTOP, init: WARM_INIT }, page => page.goto(url(dir)).then(() => page.evaluate(WARM, 30000)));

test(`${first()}：開頁後把你拿 Blackjack 與加倍兩段各預演一次：看不到（透明度不到 1%）、牌桌不震、播完收掉`, async () => {
  const r = await warm(APP), why = JSON.stringify(r.value);
  assert.deepStrictEqual(r.value.warm.map(x => x.cls), ['bigfx-warm gold', 'bigfx-warm teal'], why);
  assert.ok(r.value.warm.every(x => x.opacity <= 0.01 && !x.shook && x.ms !== null && x.ms < 2000), why);
  assert.strictEqual(r.value.left, 0, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：開頁後沒叫預演，要判成沒預演；預演沒設透明，要判成看得到', async () => {
  await withCopy([[path.join('js', 'view', 'main.js'), 'idle(() => V.fx.rehearse());', '']], async tmp => {
    assert.deepStrictEqual((await warm(tmp)).value.warm, []);
  });
  await withCopy([[SHOWCASE, '.bigfx-warm { opacity: 0.004 !important; }', '']], async tmp => {
    const r = await warm(tmp);
    assert.ok(r.value.warm.length === 2 && r.value.warm.every(x => x.opacity > 0.5), JSON.stringify(r.value));
  });
});

// 大特效 2 秒裡暗幕把 3D 牌桌整個蓋住，牌桌也沒有東西在動：最多開頭補畫一次。改之前每一格都重畫（約 120 次）
const REDRAW = `(async () => {
  const s = BJK.view.stage;
  await s.dealer.ready;
  await new Promise(r => setTimeout(r, 2500));   // 等開頁的預演做完
  let renders = 0, frames = 0, live = true;
  const r = s.renderer, orig = r.render;
  r.render = function () { renders++; return orig.apply(this, arguments); };
  (function tick() { frames++; if (live) requestAnimationFrame(tick); })();
  await BJK.view.fx.showcase('player');
  live = false;
  return { renders, frames };
})()`;
const redraw = dir => withPage(first(), DESKTOP, page => page.goto(url(dir)).then(() => page.evaluate(REDRAW, 30000)));

test(`${first()}：大特效播的 2 秒裡不重畫被蓋住的 3D 牌桌（最多補畫 2 次）`, async t => {
  const r = await redraw(APP), why = JSON.stringify(r.value);
  t.diagnostic(`${r.value.frames} 格裡重畫 ${r.value.renders} 次`);
  assert.ok(r.value.frames >= 30, `量法有誤：2 秒只跑了 ${r.value.frames} 格`);
  assert.ok(r.value.renders <= 2, why);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：動畫迴圈改回每一格都重畫，要判成特效期間一直重畫', t => withCopy([[path.join('js', 'view', 'anim.js'), 'if (moved) render();', 'render();']], async tmp => {
  const r = await redraw(tmp);
  t.diagnostic(`破壞後 ${r.value.frames} 格裡重畫 ${r.value.renders} 次`);
  assert.ok(r.value.renders > r.value.frames / 2, JSON.stringify(r.value));
}));
