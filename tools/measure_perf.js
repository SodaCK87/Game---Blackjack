// 效能基準量測：量同事（玩的人）與開發者（跑測試的人）真的在等的那幾段，印成一張 Markdown 表，給 docs\perf-baseline.md 用。
// 只印量得出來的欄位：進入點、分段、中位數／最大值、取樣次數、佔比、輸入大小。「感覺得到嗎、原因、改法」是判斷，不由這支產生。
// 不改 app\ 一個字：頁面裡的分段計時是 CDP 在頁面載入前注入的（HOOK），工具類跑在暫存複本或暫存輸出上。
// 改前改後要比，就用同一支、同一組參數重跑；既有段的量法不改，新的進入點只加新段（量法一換，前後就沒有可比性）。
//
// 用法：node tools/measure_perf.js [選項]
//   --samples N   正式取樣次數，預設 5；每段另跑 1 次 warmup 不計
//   --only a,b    只跑這幾段，預設 live 以外全部：blank,load,round,resize,click,soak,odds,engine,test,mutants,build,shoot,live
//   --live        加跑 live（線上網址開啟、tools/check_live.js、GitHub Actions 發布耗時；要連網）
//   --browser B   edge／chrome／all，預設第一個找得到的（順序同 tests/browser_util.js）
//   --tmp DIR     暫存根目錄，預設 %TEMP%\bjk-perf-<pid>；跑完刪掉，加 --keep 保留（原始取樣 raw.json 在裡面）
//   --json FILE   原始取樣另存一份到 FILE
//   --smoke       冒煙：每段只跑 1 次、不 warmup，test 段只跑不開瀏覽器的檔；印出來的數字不算基準
// 會開無頭 Edge／Chrome，不搶焦點。量之前把會搶 CPU 的程式關掉、筆電插電，環境寫在輸出的開頭。
'use strict';
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { availableBrowsers } = require('../tests/browser_util');

const REPO = path.join(__dirname, '..');
const APP = path.join(REPO, 'app');
const APP_URL = pathToFileURL(path.join(APP, 'index.html')).href;
const LIVE_URL = 'https://sodack87.github.io/Game---Blackjack/';   // 同 tools/check_live.js
const BROWSER_EXE = {   // 同 tests/browser_util.js 的 CANDIDATES
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};
const VIEWPORTS = { 桌機: { size: [1280, 720], mobile: false }, 手機: { size: [390, 844], mobile: true } };   // 同 tests/check_ui.js
// director.js 拿 Date.now() 當牌局種子：凍結它，每次量的才是同一副牌、同一串事件，前後兩輪比得起來
const FREEZE = 20261022;
const ROUNDS_PER_PAGE = 2;   // 第 1 局是開頁後第一局（牌面貼圖現畫、荷官表情第一次上傳），第 2 局是熱的
// 連玩：使用者 2026-10-22 定 200 局，不准比開頭慢 20%、記憶體不准一路漲；分 4 段各 50 局，每段之後 GC 再量 heap 看趨勢
const SOAK_ROUNDS = 200, SOAK_CHUNK = 50;

// ---- 參數 ----
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flag = name => argv.includes(name);
const SMOKE = flag('--smoke');
const SAMPLES = SMOKE ? 1 : Number(opt('--samples') || 5);
const WARMUP = SMOKE ? 0 : 1;
const SEGMENTS = ['blank', 'load', 'round', 'resize', 'click', 'soak', 'odds', 'engine', 'test', 'mutants', 'build', 'shoot', 'live'];
const ONLY = opt('--only') ? opt('--only').split(',') : SEGMENTS.filter(s => s !== 'live');
if (flag('--live') && !ONLY.includes('live')) ONLY.push('live');
for (const s of ONLY) if (!SEGMENTS.includes(s)) throw new Error(`沒有這一段：${s}（可用：${SEGMENTS.join(',')}）`);
const BROWSERS = (() => {
  const want = opt('--browser'), have = availableBrowsers();
  if (!have.length) throw new Error('找不到 Edge 或 Chrome');
  if (!want) return have.slice(0, 1);
  if (want === 'all') return have;
  if (!have.includes(want)) throw new Error(`這台沒有 ${want}（有：${have.join('、')}）`);
  return [want];
})();
const TMP = path.resolve(opt('--tmp') || path.join(os.tmpdir(), `bjk-perf-${process.pid}`));
const KEEP = flag('--keep');
const JSON_OUT = opt('--json');

const now = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => process.stderr.write(`[${new Date().toLocaleTimeString('zh-TW', { hour12: false })}] ${msg}\n`);

// ---- 結果：一個進入點一筆，每次取樣記總時間與各分段 ----
const results = [];
function entry(name, input, note) {
  const e = { name, input, note: note || '', samples: [], order: [] };
  results.push(e);
  return e;
}
// segs 的鍵：一般分段（佔比＝分段÷總時間）；「◆」開頭是里程碑（從 0 量到那一刻，不是總時間的一塊）
function addSample(e, total, segs = {}, counts = {}) {
  e.samples.push({ total, segs, counts });
  for (const k of Object.keys(segs)) if (!e.order.includes(k)) e.order.push(k);
}
// warmup 跑完不記，之後 SAMPLES 次記下來
async function repeat(label, fn) {
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    log(`${label} ${i < WARMUP ? 'warmup' : `第 ${i - WARMUP + 1}/${SAMPLES} 次`}`);
    await fn(i >= WARMUP);
  }
}

// ---- 無頭瀏覽器（自己開，因為要用 Performance／Emulation／HeapProfiler 與載入前注入，tests/browser_util.js 的 page 沒開放這些）----
// 收進程的做法照 tests/browser_util.js：先 Browser.close，再按這一輪專屬的 user-data-dir 補砍，收完數一次
const launched = new Set();
function markedPids(marker) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { $_.ProcessId }`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().split(/\s+/).filter(Boolean);
}
function killMarked(marker) {
  let left = markedPids(marker);
  if (left.length) {
    const kill = left.map(pid => `try { Stop-Process -Id ${pid} -Force -ErrorAction Stop } catch {}`).join('; ');
    execFileSync('powershell', ['-NoProfile', '-Command', `${kill}; exit 0`]);
    left = markedPids(marker);
  }
  return left.length;
}
let leftoverTotal = 0;
const pageConsole = [];
const otherPages = new Set();

async function launch(browser, { size, mobile }) {
  const t0 = now();
  // 設定檔永遠放 %TEMP% 底下的 ASCII 路徑，不跟 --tmp：換了路徑就換了環境，前後兩輪不能比
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-perf-'));
  const marker = path.basename(dir);
  launched.add(marker);
  // 擴充與同步要關：2026-10-22 實測這台的 Edge 連全新設定檔都會裝上擴充、開同步確認頁與擴充的登入頁，
  // 新分頁搶到前景後量測頁變成 hidden、requestAnimationFrame 停掉，動畫永遠播不完（連玩那段卡了 10 分鐘）
  const args = ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--disable-extensions', '--disable-sync', '--disable-default-apps', '--disable-component-update', 'about:blank'];
  if (browser === 'edge') args.unshift('--edge-skip-compat-layer-relaunch');
  const proc = spawn(BROWSER_EXE[browser], args, { stdio: 'ignore' });
  proc.on('error', () => { /* 起不來的話下面等偵錯埠會逾時，訊息在那裡 */ });
  const timing = {};
  let ws = null, id = 0;
  const pending = new Map(), listeners = [];
  async function close() {
    const c0 = now();
    if (ws) {
      try { await send('Browser.close', {}, 5000); } catch { /* 已經關了 */ }
      try { ws.close(); } catch { /* 已經斷了 */ }
    }
    for (let i = 0; i < 100 && proc.exitCode === null; i++) await sleep(100);
    timing.close = now() - c0;
    const k0 = now();
    const left = killMarked(marker);
    timing.reap = now() - k0;
    leftoverTotal += left;
    launched.delete(marker);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 進程剛收完，偶爾還鎖著 */ }
    return left;
  }
  function send(method, params = {}, timeoutMs = 15000) {
    const msgId = ++id;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { pending.delete(msgId); fail(new Error(`CDP 逾時：${method}`)); }, timeoutMs);
      pending.set(msgId, { ok: v => { clearTimeout(timer); ok(v); }, fail: e => { clearTimeout(timer); fail(e); } });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  try {
    const portFile = path.join(dir, 'DevToolsActivePort');
    let port = '';
    for (let i = 0; i < 150 && !port; i++) {
      try { port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim(); } catch { /* 還沒寫好 */ }
      if (!port) await sleep(50);
    }
    if (!port) throw new Error(`${browser} 沒有開出偵錯埠`);
    timing.port = now() - t0;
    const c0 = now();
    // 自己開一個新分頁來量，其他分頁全關：不要拿「清單上第一個 page」，那可能是瀏覽器自己開的頁
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    for (const t of await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) {
      if (t.type === 'page' && t.id !== page.id) {
        if (t.url !== 'about:blank') otherPages.add(t.url.split('?')[0]);
        await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
      }
    }
    ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(page.webSocketDebuggerUrl);
      s.onopen = () => resolve(s);
      s.onerror = () => reject(new Error('連不上 CDP'));
    });
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.fail(new Error(msg.error.message)) : p.ok(msg.result);
      } else if (msg.method) {
        listeners.forEach(fn => fn(msg));
      }
    };
    listeners.push(msg => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        pageConsole.push(`exception: ${d.exception ? d.exception.description : d.text}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        pageConsole.push(`${msg.params.type}: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
      }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Performance.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    timing.connect = now() - c0;
    const version = (await send('Browser.getVersion')).product;
    return {
      send, close, timing, version,
      on: fn => listeners.push(fn),
      async goto(url, timeoutMs = 60000) {
        let done;
        const loaded = new Promise(r => { done = r; });
        const fn = msg => { if (msg.method === 'Page.loadEventFired') done(); };
        listeners.push(fn);
        try {
          await send('Page.navigate', { url });
          await Promise.race([loaded, sleep(timeoutMs).then(() => { throw new Error(`載入逾時：${url}`); })]);
        } finally {
          listeners.splice(listeners.indexOf(fn), 1);
        }
      },
      async evaluate(expression, timeoutMs = 15000) {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
        if (r.exceptionDetails) throw new Error(`頁面內執行失敗：${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
        return r.result.value;
      },
      async metrics() {
        const r = await send('Performance.getMetrics');
        return Object.fromEntries(r.metrics.map(m => [m.name, m.value]));
      },
    };
  } catch (e) {
    await close();
    throw e;
  }
}
async function withBrowser(browser, vp, fn) {
  const b = await launch(browser, vp);
  try { return await fn(b); } finally { await b.close(); }
}

// ---- 載入前注入頁面的埋點：只包外層函式、記開始時間與耗時，不改任何行為 ----
// render 依呼叫來源分三種：move＝動畫格裡有東西在動、idle＝動畫格裡只剩 wait 在跑（畫面沒變也重畫）、direct＝動畫格外直接呼叫
const HOOK = `(() => {
  if (window.__perf) return;
  const now = () => performance.now();
  const P = window.__perf = { scripts: [], spans: {}, tweens: [], modes: [], marks: {}, errors: [], longTasks: [], moving: 0, inFrame: false, waiters: [] };
  const FROZEN = ${FREEZE};
  Date.now = () => FROZEN;
  // 分頁一變 hidden，requestAnimationFrame 就停、動畫等不完：記下來，量到的數字就不算
  P.hidden = document.visibilityState === 'visible' ? [] : [[0, document.visibilityState]];
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') P.hidden.push([now(), document.visibilityState]); });
  function add(name, start, ms, tag) { (P.spans[name] || (P.spans[name] = [])).push(tag ? [start, ms, tag] : [start, ms]); }
  function timed(name, fn) {
    return function () { const t = now(); try { return fn.apply(this, arguments); } finally { add(name, t, now() - t); } };
  }
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { P.errors.push('longtask：' + e.message); }
  // 長掉格：瀏覽器自己判定超過 50ms 的動畫格（Long Animation Frames）
  P.loaf = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.loaf.push([e.startTime, e.duration]); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { P.errors.push('long-animation-frame：' + e.message); }
  const addEL = window.addEventListener;
  window.addEventListener = function (type, fn, opt) {
    if (type === 'resize' && typeof fn === 'function') fn = timed('resize', fn);
    return addEL.call(this, type, fn, opt);
  };
  P.waitMode = (list, from) => new Promise(res => {
    const check = () => {
      for (let i = from; i < P.modes.length; i++) if (list.includes(P.modes[i][1])) { res({ t: P.modes[i][0], mode: P.modes[i][1] }); return true; }
      return false;
    };
    const again = () => { if (!check()) P.waiters.push(again); };
    again();
  });
  const hooks = {
    'lib/three.js'() {
      const T = window.THREE, Base = T.WebGLRenderer;
      class Timed extends Base {
        constructor(...a) {
          const t = now();
          super(...a);
          add('renderer.new', t, now() - t);
          const r = this.render;
          this.render = function () {
            const t0 = now();
            try { return r.apply(this, arguments); } finally { add('render', t0, now() - t0, P.inFrame ? (P.moving ? 'move' : 'idle') : 'direct'); }
          };
          P.renderer = this;
        }
      }
      window.THREE = new Proxy(T, { get: (o, k) => (k === 'WebGLRenderer' ? Timed : Reflect.get(o, k)) });
    },
    'js/core/odds.js'() { BJK.odds.forHand = timed('odds', BJK.odds.forHand); },
    'js/core/game.js'() {
      const cg = BJK.game.createGame;
      BJK.game.createGame = function (o) {
        const g = cg(o);
        for (const k of ['startRound', 'act', 'finishRound', 'aiChoice', 'legal', 'state', 'topUp']) g[k] = timed('engine', g[k]);
        return g;
      };
    },
    'js/view/textures.js'() { const X = BJK.view.textures; for (const k of Object.keys(X)) X[k] = timed('texture.' + k, X[k]); },
    'js/view/effects.js'() { BJK.view.fx.keepInView = timed('labels', BJK.view.fx.keepInView); },
    'js/view/table.js'() { BJK.view.table.build = timed('table.build', BJK.view.table.build); },
    'js/view/room.js'() {
      const b = BJK.view.room.build;
      BJK.view.room.build = timed('room.build', function () { const r = b.apply(this, arguments); r.layout = timed('room.layout', r.layout); return r; });
    },
    'js/view/dealer.js'() {
      const c = BJK.view.dealer.create;
      BJK.view.dealer.create = timed('dealer.create', function () {
        const d = c.apply(this, arguments);
        d.ready.then(() => { P.marks.dealerReady = now(); }, () => { P.marks.dealerReady = -1; });
        return d;
      });
    },
    'js/view/anim.js'() {
      const A = BJK.view.anim, tw = A.tween, wt = A.wait, sr = A.setRender;
      let waiting = false;
      A.wait = function (ms) { waiting = true; try { return wt.call(A, ms); } finally { waiting = false; } };
      A.tween = function (ms, update, easing) {
        const isWait = waiting;
        waiting = false;
        P.tweens.push([now(), ms / A.speed, isWait ? 1 : 0]);
        if (!isWait) P.moving++;
        const p = tw.call(A, ms, update, easing);
        if (!isWait) p.then(() => { P.moving--; });
        return p;
      };
      A.setRender = function (fn) { return sr.call(A, function () { P.inFrame = true; try { return fn.apply(this, arguments); } finally { P.inFrame = false; } }); };
    },
    'js/view/hud.js'() {
      const c = BJK.view.hud.create;
      BJK.view.hud.create = function () {
        const h = c.apply(this, arguments), m = h.mode;
        h.mode = function (mode, legal) {
          const r = m.call(h, mode, legal);
          P.modes.push([now(), mode]);
          const w = P.waiters; P.waiters = []; w.forEach(f => f());
          return r;
        };
        return h;
      };
    },
  };
  document.addEventListener('load', e => {
    const el = e.target;
    if (!el || el.tagName !== 'SCRIPT') return;
    const src = el.getAttribute('src') || '';
    P.scripts.push([src, now()]);
    if (hooks[src]) { try { hooks[src](); } catch (err) { P.errors.push(src + '：' + err.message); } }
  }, true);
})();`;

// 等荷官貼圖上去、再過兩格，畫面才算完整
const READY = `(async () => {
  const s = window.BJK && BJK.view && BJK.view.stage;
  if (s) { try { await s.dealer.ready; } catch (e) {} }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return !!s;
})()`;
const IDLE = `(async () => {
  const A = BJK.view.anim;
  for (let i = 0; i < 800 && A.busy; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 300));
  return !A.busy;
})()`;
const DUMP = `(() => {
  const P = window.__perf, s = BJK.view.stage, nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource').find(r => /lib\\/three\\.js$/.test(r.name));
  let gl = '';
  try { const c = s.renderer.getContext(), x = c.getExtension('WEBGL_debug_renderer_info'); gl = x ? c.getParameter(x.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); } catch (e) { gl = '讀不到：' + e.message; }
  return {
    nav: nav && { responseEnd: nav.responseEnd, domInteractive: nav.domInteractive, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd },
    paint: Object.fromEntries(performance.getEntriesByType('paint').map(e => [e.name, e.startTime])),
    three: res && { start: res.startTime, end: res.responseEnd, transfer: res.transferSize, encoded: res.encodedBodySize },
    scripts: P.scripts, spans: P.spans, marks: P.marks, errors: P.errors, longTasks: P.longTasks, loaf: P.loaf, modes: P.modes, hidden: P.hidden,
    hooked: !!P.renderer, gl, info: s && { calls: s.renderer.info.render.calls, triangles: s.renderer.info.render.triangles, geometries: s.renderer.info.memory.geometries, textures: s.renderer.info.memory.textures },
    dpr: devicePixelRatio, view: [innerWidth, innerHeight], ua: navigator.userAgent,
  };
})()`;

// ---- 小工具 ----
const sum = list => list.reduce((a, x) => a + x, 0);
const median = xs => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const spansIn = (P, name, t0, t1) => (P.spans[name] || []).filter(([s]) => s >= t0 && s <= t1);
const spanSum = (P, name, t0, t1, tag) => sum(spansIn(P, name, t0, t1).filter(x => !tag || x[2] === tag).map(x => x[1]));
const textureSum = (P, t0, t1) => sum(Object.keys(P.spans).filter(k => k.startsWith('texture.')).map(k => spanSum(P, k, t0, t1)));
const scriptAt = (P, src) => { const s = P.scripts.find(x => x[0] === src); return s ? s[1] : NaN; };
const hookProblems = [];
function checkHook(d, where) {
  const miss = [];
  if (!d.hooked) miss.push('render');
  for (const k of ['table.build', 'room.build', 'dealer.create', 'engine', 'texture.felt', 'labels', 'room.layout']) if (!d.spans[k]) miss.push(k);
  if (d.marks.dealerReady === undefined) miss.push('dealerReady');
  if (d.errors.length) miss.push(...d.errors);
  if (miss.length) hookProblems.push(`${where}：埋點沒接上 ${miss.join('、')}`);
  if (d.hidden && d.hidden.length) hookProblems.push(`${where}：量測中分頁變成 ${d.hidden.map(h => h[1]).join('、')}（動畫會停），這一筆不能信`);
}
function dirSize(dir) {
  let bytes = 0, files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = dirSize(p); bytes += s.bytes; files += s.files; } else { bytes += fs.statSync(p).size; files++; }
  }
  return { bytes, files };
}
// powercfg 這類原生指令印的是 cp950：先照預設編碼收進變數，再切 UTF-8 輸出給 node
function ps(command) {
  try { return execFileSync('powershell', ['-NoProfile', '-Command', `$__o = & { ${command} }; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $__o`]).toString('utf8').trim(); } catch (e) { return `讀不到（${e.message.split('\n')[0]}）`; }
}
// 外部指令量牆鐘時間；每印一行記下時間，拿來切分段（mutants 一行一個破壞、shoot 一行一張圖）
function timedRun(cmd, args, { cwd = REPO, shell = false, env } = {}) {
  return new Promise(resolve => {
    const t0 = now(), lines = [];
    let buf = '', err = '';
    const p = spawn(cmd, args, { cwd, shell, env: env || process.env });
    p.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push([now() - t0, buf.slice(0, i).replace(/\r$/, '')]); buf = buf.slice(i + 1); }
    });
    p.stderr.on('data', d => { err += d.toString('utf8'); });
    p.on('close', code => {
      if (buf) lines.push([now() - t0, buf]);
      resolve({ ms: now() - t0, code, lines, err });
    });
  });
}

// ---- 環境 ----
function environment() {
  const app = dirSize(APP);
  const cpus = os.cpus();
  let head = '', dirty = '';
  try {
    head = execFileSync('git', ['-c', 'core.quotepath=off', 'rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim();
    dirty = execFileSync('git', ['-c', 'core.quotepath=off', 'status', '--porcelain'], { cwd: REPO }).toString().trim().split('\n').filter(Boolean).length;
  } catch { /* 不在 git 裡 */ }
  return {
    時間: new Date().toLocaleString('zh-TW', { hour12: false }),
    機器: `${os.hostname()}｜${cpus[0].model.trim()}｜${cpus.length} 執行緒｜RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GB｜${os.version()} ${os.release()}`,
    node: process.version,
    npm: (() => { try { return execFileSync('npm --version', { shell: true }).toString().trim(); } catch { return '讀不到'; } })(),
    電源: ps(`$b = Get-CimInstance Win32_Battery | Select-Object -First 1; $s = (powercfg /getactivescheme) -join ' '; if ($b) { "電池狀態 $($b.BatteryStatus)（2＝接電源、1＝用電池）、電量 $($b.EstimatedChargeRemaining)%｜$s" } else { "沒有電池（桌機）｜$s" }`),
    背景負載: ps(`$c = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime; $g = Get-Process node,msedge,chrome -ErrorAction SilentlyContinue | Group-Object Name | ForEach-Object { "$($_.Name) $($_.Count) 個" }; "CPU $c%｜" + ($g -join '、')`),
    版本: `${head}${dirty ? `（工作樹有 ${dirty} 個未 commit 的檔）` : ''}`,
    組態: 'app\\ 原樣（沒有建置步驟；app\\lib\\three.js 是 minify 過的成品）',
    app: `${app.files} 個檔、${app.bytes.toLocaleString()} bytes；three.js ${fs.statSync(path.join(APP, 'lib', 'three.js')).size.toLocaleString()} bytes`,
    瀏覽器: BROWSERS.join('、'),
    取樣: SMOKE ? '冒煙（1 次、不 warmup）：數字不算基準' : `warmup ${WARMUP} 次＋正式 ${SAMPLES} 次`,
  };
}
const envMore = {};

// ---- 各段 ----
// 空跑底線：分得出哪些時間是工具自己的
async function segBlank() {
  const nodeE = entry('空跑：node 啟動（node -e ""）', '—');
  await repeat('空跑 node', async keep => { const t0 = now(); spawnSync(process.execPath, ['-e', '']); if (keep) addSample(nodeE, now() - t0); });
  const npmE = entry('空跑：npm 啟動（npm --version）', '—', 'npm test／npm run 比直接跑 node 多出約這麼多');
  await repeat('空跑 npm', async keep => { const t0 = now(); spawnSync('npm --version', { shell: true }); if (keep) addSample(npmE, now() - t0); });
  const emptyTest = path.join(TMP, 'empty.test.js');
  fs.writeFileSync(emptyTest, "require('node:test')('空', () => {});\n");
  const testE = entry('空跑：node --test 一個空測試檔', '1 個檔、1 條空測試');
  await repeat('空跑 node --test', async keep => { const r = await timedRun(process.execPath, ['--test', emptyTest]); if (keep) addSample(testE, r.ms); });
  const blank = path.join(TMP, 'blank.html');
  fs.writeFileSync(blank, '<!doctype html><title>blank</title>');
  for (const browser of BROWSERS) {
    const e = entry(`空跑：無頭 ${browser} 開一頁再收掉`, '空白 html，1280×720', '每支開瀏覽器的測試都要付這一段；「查殘留進程」是 tests/browser_util.js:20 同一條 PowerShell 指令');
    await repeat(`空跑 ${browser}`, async keep => {
      const b = await launch(browser, VIEWPORTS.桌機);
      const g0 = now();
      await b.goto(pathToFileURL(blank).href);
      const nav = now() - g0;
      await b.close();
      const t = b.timing;
      if (keep) addSample(e, t.port + t.connect + nav + t.close + t.reap, { '啟動到偵錯埠就緒': t.port, '連上 CDP 與設定': t.connect, '導覽到空白頁': nav, '關閉（Browser.close 到進程結束）': t.close, '查殘留進程（PowerShell＋CIM）': t.reap });
    });
  }
}

// 開啟到可下注：冷開（新瀏覽器、沒有快取）與重新整理（同一個瀏覽器第二次開）
function loadSegments(d) {
  const nav = d.nav, P = d;
  const t3 = scriptAt(P, 'lib/three.js'), tCore = scriptAt(P, 'js/core/game.js'), tDefs = scriptAt(P, 'js/view/director.js'), tMain = scriptAt(P, 'js/view/main.js');
  const ready = d.marks.dealerReady > 0 ? d.marks.dealerReady : NaN;
  const total = Number.isFinite(ready) ? Math.max(ready, nav.dcl) : nav.dcl;
  const w0 = tDefs, w1 = tMain;
  const one = name => sum(spansIn(P, name, w0, w1).map(x => x[1]));
  const renders = spansIn(P, 'render', w0, w1);
  const director = spansIn(P, 'director.create', w0, w1);
  const inside = (list, outer) => list.filter(([s]) => outer.some(([o, d2]) => s >= o && s <= o + d2));
  const dirRenders = sum(inside(renders, director).map(x => x[1]));
  const felt = one('texture.felt');
  const engineOutsideDirector = sum(spansIn(P, 'engine', w0, w1).filter(x => !inside([x], director).length).map(x => x[1]));
  const segs = {
    'HTML 下載與解析（到回應結束）': nav.responseEnd,
    'three.js 載入與執行': t3 - nav.responseEnd,
    'core 6 支載入與執行': tCore - t3,
    'view 11 支載入與執行（只定義函式）': tDefs - tCore,
    'main.js：建 WebGLRenderer': one('renderer.new'),
    'main.js：絨布貼圖現畫（9 萬個顆粒）': felt,
    'main.js：牌桌其餘（模型、籌碼架）': one('table.build') - felt,
    'main.js：佈景（地毯、牆、光點）': one('room.build'),
    'main.js：荷官建立（同步部分）': one('dealer.create'),
    'main.js：導演建立（扣掉其中的 render）': one('director.create') - dirRenders,
    'main.js：引擎（core 自測一局）': engineOutsideDirector,
    'main.js：光點擺位（room.layout）': one('room.layout'),
    'main.js：第一次 render（含 shader 編譯）': renders.length ? renders[0][1] : 0,
    'main.js：其餘 render': sum(renders.slice(1).map(x => x[1])),
  };
  const mainParts = sum(Object.keys(segs).filter(k => k.startsWith('main.js：')).map(k => segs[k]));
  segs['main.js：其餘（框景計算、HUD、標籤…）'] = (tMain - tDefs) - mainParts;
  segs['main.js 結束到 DOMContentLoaded'] = nav.dcl - tMain;
  segs['可下注之後等荷官貼圖（SVG 解碼）'] = Math.max(0, ready - nav.dcl);
  segs['◆ 可下注（DOMContentLoaded）'] = nav.dcl;
  if (d.paint['first-contentful-paint']) segs['◆ 第一次有內容的繪製（FCP）'] = d.paint['first-contentful-paint'];
  const counts = { 'main.js 裡 render 次數': renders.length, 'long task 數（>50ms）': d.longTasks.length, '最後一格 draw call': d.info ? d.info.calls : NaN, '最後一格三角形': d.info ? d.info.triangles : NaN };
  return { total, segs, counts };
}
async function segLoad(url, label, input) {
  for (const browser of BROWSERS) {
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      const cold = entry(`${label}（冷：新瀏覽器、沒有快取）｜${browser}・${vpName}`, `${input}、${vp.size.join('×')}${vp.mobile ? ' DPR2 手機模擬' : ''}`);
      const warm = url === LIVE_URL ? null : entry(`重新整理（同一個瀏覽器第二次開）｜${browser}・${vpName}`, `${input}、${vp.size.join('×')}`);
      await repeat(`${label} ${browser} ${vpName}`, async keep => {
        await withBrowser(browser, vp, async b => {
          await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
          envMore[`瀏覽器版本（${browser}）`] = b.version;
          for (const [e, i] of [[cold, 0], [warm, 1]]) {
            if (!e) continue;
            await b.goto(url);
            if (!(await b.evaluate(READY, 30000))) throw new Error('頁面沒有建出 BJK.view.stage');
            const d = await b.evaluate(DUMP);
            checkHook(d, `${e.name}`);
            envMore[`WebGL（${browser}・${vpName}）`] = d.gl;
            if (i === 0 && d.three && url === LIVE_URL) envMore['線上 three.js 傳輸'] = `${d.three.transfer.toLocaleString()} bytes（解壓前 ${d.three.encoded.toLocaleString()}）`;
            const { total, segs, counts } = loadSegments(d);
            if (keep) addSample(e, total, segs, counts);
          }
        });
      });
    }
  }
}

// 每局：按發牌到輪到你、按停牌到回到下注。正常速度（anim.speed 1），一律停牌，種子固定所以每次都是同一局。
// 主緒忙碌是 CDP 的 TaskDuration，只量得到「兩次呼叫之間」：窗口的尾巴會多到 tEnd（對白泡泡還在飄、還在重畫），
// 所以「其他主緒工作」用同一個加長的窗口扣埋點，閒著＝本段總時間扣掉埋點與其他
const instrumented = (P, t0, t1) => spanSum(P, 'render', t0, t1) + spanSum(P, 'engine', t0, t1) + spanSum(P, 'odds', t0, t1) + spanSum(P, 'labels', t0, t1) + textureSum(P, t0, t1);
function roundSegments(P, w, busyMs) {
  const { t0, t1, tEnd } = w;
  const r = tag => spanSum(P, 'render', t0, t1, tag);
  const renders = spansIn(P, 'render', t0, t1);
  const loaf = P.loaf.filter(([s]) => s >= t0 && s <= t1);
  const segs = {
    '◆ 按下到下一格畫面（反應）': w.tFrame - t0,
    'render：有東西在動的動畫格': r('move'),
    'render：畫面沒動也重畫（只剩 wait／對白在跑）': r('idle'),
    'render：動畫格外直接呼叫（換表情、亮圈）': r('direct'),
    '引擎（startRound／act／state…）': spanSum(P, 'engine', t0, t1),
    '勝率計算（odds.forHand）': spanSum(P, 'odds', t0, t1),
    '標籤夾回畫面（keepInView，含強制版面計算）': spanSum(P, 'labels', t0, t1),
    '貼圖現畫（第一次出現的牌面、籌碼）': textureSum(P, t0, t1),
  };
  const known = sum(Object.entries(segs).filter(([k]) => !k.startsWith('◆')).map(([, v]) => v));
  const other = busyMs - instrumented(P, t0, tEnd);
  segs['其他主緒工作（DOM、樣式、版面、GC…；CDP 量）'] = other;
  segs['主緒閒著（等動畫與計時器）'] = (t1 - t0) - known - other;
  const counts = {
    'render 次數（動／空轉／直接）': `${renders.filter(x => x[2] === 'move').length}／${renders.filter(x => x[2] === 'idle').length}／${renders.filter(x => x[2] === 'direct').length}`,
    '最長一次 render ms': renders.length ? Math.max(...renders.map(x => x[1])) : NaN,
    'long task 數（>50ms）': P.longTasks.filter(([s]) => s >= t0 && s <= t1).length,
    '長掉格數（LoAF >50ms）': loaf.length,
    '最長一格 ms': loaf.length ? Math.max(...loaf.map(x => x[1])) : 0,
  };
  return { segs, counts };
}
async function segRound() {
  for (const browser of BROWSERS) {
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      const es = [];
      for (let k = 1; k <= ROUNDS_PER_PAGE; k++) {
        const tag = k === 1 ? '開頁後第 1 局' : `第 ${k} 局`;
        es.push({
          deal: entry(`按發牌→輪到你（${tag}）｜${browser}・${vpName}`, `種子 ${FREEZE}、下注 10、正常速度、${vp.size.join('×')}`, '含三位 AI 中排在你前面的那位；勝率計算在這一段的最後'),
          stand: entry(`按停牌→回到下注（${tag}）｜${browser}・${vpName}`, `同上，你一律停牌`, '含排在你後面的 AI、荷官補牌、結算、收牌'),
        });
      }
      await repeat(`每局 ${browser} ${vpName}`, async keep => {
        await withBrowser(browser, vp, async b => {
          await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
          await b.goto(APP_URL);
          if (!(await b.evaluate(READY, 30000))) throw new Error('頁面沒有建出 BJK.view.stage');
          const windows = [];
          for (let k = 0; k < ROUNDS_PER_PAGE; k++) {
            await b.evaluate(IDLE, 30000);
            const m0 = await b.metrics();
            // 按下去之後的下一格動畫格＝同事看到「有反應」的時候
            const a = await b.evaluate(`(async () => { const P = __perf, from = P.modes.length, t0 = performance.now();
              document.getElementById('dealBtn').click();
              const tFrame = await new Promise(r => requestAnimationFrame(() => r(performance.now())));
              const m = await P.waitMode(['act', 'bet', 'broke'], from); return { t0, tFrame, t1: m.t, mode: m.mode }; })()`, 180000);
            a.tEnd = await b.evaluate('performance.now()');
            const m1 = await b.metrics();
            let s = null, m2 = null;
            if (a.mode === 'act') {
              s = await b.evaluate(`(async () => { const P = __perf, from = P.modes.length, t0 = performance.now();
                document.getElementById('standBtn').click();
                const tFrame = await new Promise(r => requestAnimationFrame(() => r(performance.now())));
                const m = await P.waitMode(['bet', 'broke'], from); return { t0, tFrame, t1: m.t, mode: m.mode }; })()`, 180000);
              s.tEnd = await b.evaluate('performance.now()');
              m2 = await b.metrics();
            }
            windows.push({ a, s, busyA: (m1.TaskDuration - m0.TaskDuration) * 1000, busyS: m2 ? (m2.TaskDuration - m1.TaskDuration) * 1000 : NaN });
          }
          const P = await b.evaluate(DUMP);
          checkHook(P, `每局 ${browser}・${vpName}`);
          windows.forEach((w, k) => {
            if (w.a.mode !== 'act') { hookProblems.push(`每局 ${browser}・${vpName} 第 ${k + 1} 局沒輪到你（${w.a.mode}），這一局只量得到整局：換 FREEZE 種子`); return; }
            if (!keep) return;
            const A = roundSegments(P, w.a, w.busyA);
            addSample(es[k].deal, w.a.t1 - w.a.t0, A.segs, A.counts);
            const S = roundSegments(P, w.s, w.busyS);
            addSample(es[k].stand, w.s.t1 - w.s.t0, S.segs, S.counts);
          });
        });
      });
    }
  }
}

// 轉手機方向／調整視窗大小：真的換 viewport，量 resize 監聽器（main.js 的 layout）本身
async function segResize() {
  for (const browser of BROWSERS) {
    const toPortrait = entry(`轉成直式（橫式桌機→直式手機）｜${browser}`, '1280×720 → 390×844 DPR2');
    const toLandscape = entry(`轉回橫式（直式手機→橫式桌機）｜${browser}`, '390×844 → 1280×720');
    await withBrowser(browser, VIEWPORTS.桌機, async b => {
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
      await b.goto(APP_URL);
      await b.evaluate(READY, 30000);
      await b.evaluate(IDLE, 30000);
      await repeat(`轉向 ${browser}`, async keep => {
        for (const [e, vp] of [[toPortrait, VIEWPORTS.手機], [toLandscape, VIEWPORTS.桌機]]) {
          const before = await b.evaluate('(__perf.spans.resize || []).length');
          await b.send('Emulation.setDeviceMetricsOverride', { width: vp.size[0], height: vp.size[1], deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile });
          await b.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
          const P = await b.evaluate(`(async () => { for (let i = 0; i < 200 && (__perf.spans.resize || []).length <= ${before}; i++) await new Promise(r => setTimeout(r, 10));
            await new Promise(r => setTimeout(r, 400)); const s = __perf.spans; return { hidden: __perf.hidden.length, spans: { resize: s.resize, render: s.render, 'room.layout': s['room.layout'] } }; })()`, 15000);
          if (P.hidden) hookProblems.push(`轉向 ${browser}：量測中分頁變成 hidden，這一筆不能信`);
          const calls = (P.spans.resize || []).slice(before);
          if (!calls.length) { hookProblems.push(`轉向 ${browser}：換尺寸後沒有收到 resize`); continue; }
          const t0 = calls[0][0], t1 = calls[calls.length - 1][0] + calls[calls.length - 1][1];
          const total = sum(calls.map(x => x[1]));
          const render = spanSum(P, 'render', t0, t1), layout = spanSum(P, 'room.layout', t0, t1);
          if (keep) addSample(e, total, { 'render': render, '光點擺位（room.layout）': layout, '其餘（框景二分搜尋、標籤、泡泡）': total - render - layout }, { 'resize 呼叫次數': calls.length });
        }
      });
    });
  }
}

// 下注階段的按鈕：點下去到下一格畫面（只改 DOM，沒有動畫）
async function segClick() {
  const defs = [['+10', `document.querySelector('[data-chip="10"]')`], ['清除', `document.getElementById('clearBet')`], ['勝率提示：開／關', `document.getElementById('oddsToggle')`]];
  for (const browser of BROWSERS) {
    const es = defs.map(([n]) => entry(`按「${n}」到下一格畫面｜${browser}・桌機`, '下注階段、1280×720'));
    await withBrowser(browser, VIEWPORTS.桌機, async b => {
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
      await b.goto(APP_URL);
      await b.evaluate(READY, 30000);
      await b.evaluate(IDLE, 30000);
      await repeat(`按鈕 ${browser}`, async keep => {
        for (let i = 0; i < defs.length; i++) {
          const r = await b.evaluate(`(async () => { const el = ${defs[i][1]}; const t0 = performance.now(); el.click(); const t1 = performance.now();
            await new Promise(r => requestAnimationFrame(() => r())); return { handler: t1 - t0, frame: performance.now() - t0, hidden: __perf.hidden.length }; })()`);
          if (r.hidden) hookProblems.push(`按鈕 ${browser}：量測中分頁變成 hidden，這一筆不能信`);
          if (keep) addSample(es[i], r.frame, { '點擊處理（同步）': r.handler, '等到下一格畫面': r.frame - r.handler });
        }
      });
    });
  }
}

// 連玩很多局會不會越來越慢、記憶體會不會一直長：加速 40 倍連打（tests/check_play.js 同一個 autoplay）
async function segSoak() {
  for (const browser of BROWSERS) {
    const e = entry(`連玩 ${SOAK_ROUNDS} 局（加速 40 倍）｜${browser}・桌機`, `種子 ${FREEZE}、1280×720`, '看前 10 局與後 10 局每局時間、heap 與場景物件數有沒有一直長');
    await repeat(`連玩 ${browser}`, async keep => {
      await withBrowser(browser, VIEWPORTS.桌機, async b => {
        await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
        await b.goto(APP_URL);
        await b.evaluate(READY, 30000);
        const snap = async () => {
          // 埋點自己每格記一筆，200 局下來就有好幾 MB：量 heap 前先清掉，量到的才是遊戲本身
          // （2026-10-22 同一種子連玩 200 局：沒清時 GC 後 heap 每 50 局漲約 1 MB，清了之後第 50 局起每 50 局只漲約 0.1 MB）
          await b.evaluate('(() => { const P = __perf; P.spans = {}; P.tweens = []; P.longTasks = []; P.loaf = []; P.modes = []; return true; })()');
          await b.send('HeapProfiler.collectGarbage');
          const h = await b.send('Runtime.getHeapUsage');
          const s = await b.evaluate(`(() => { const s = BJK.view.stage, i = s.renderer.info.memory; return { children: s.scene.children.length, geometries: i.geometries, textures: i.textures, overlay: document.getElementById('overlay').children.length, hidden: __perf.hidden.length }; })()`);
          if (s.hidden) hookProblems.push(`連玩 ${browser}：量測中分頁變成 hidden（動畫會停），這一筆不能信`);
          return { heap: h.usedSize / 2 ** 20, ...s };
        };
        const snaps = [await snap()];
        const times = [];
        let mismatches = 0;
        for (let done = 0; done < SOAK_ROUNDS; done += SOAK_CHUNK) {
          // 卡住就認卡住（同 tests/check_play.js 的做法），不要等到 CDP 逾時
          const r = await b.evaluate(`(async () => { BJK.view.anim.speed = 40; const d = BJK.view.stage.director;
            const stuck = new Promise(res => setTimeout(() => res({ stuck: true, rounds: d.rounds }), 180000));
            return Promise.race([d.autoplay(${SOAK_CHUNK}).then(x => ({ times: x.times, mismatches: x.mismatches.length })), stuck]); })()`, 200000);
          if (r.stuck) throw new Error(`連玩卡住：打到第 ${r.rounds} 局，3 分鐘沒打完這 ${SOAK_CHUNK} 局`);
          times.push(...r.times);
          mismatches = r.mismatches;
          await b.evaluate(IDLE, 30000);
          snaps.push(await snap());
        }
        if (!keep) return;
        const first = times.slice(0, 10), last = times.slice(-10);
        const s0 = snaps[0], s1 = snaps[snaps.length - 1];
        addSample(e, sum(times), { '◆ 前 10 局每局中位': median(first), '◆ 後 10 局每局中位': median(last) }, {
          '後 10÷前 10': median(last) / median(first),
          [`heap MB（GC 後，每 ${SOAK_CHUNK} 局一次）`]: snaps.map(s => s.heap.toFixed(1)).join('→'),
          '場景物件數': `${s0.children}→${s1.children}`, 'GPU 幾何／貼圖數': `${s0.geometries}/${s0.textures}→${s1.geometries}/${s1.textures}`,
          '畫面疊字元素數': `${s0.overlay}→${s1.overlay}`, '畫面與引擎不一致': mismatches,
        });
      });
    });
  }
}

// 勝率計算本身（node 跑，跟瀏覽器裡那次是同一支 core\odds.js）：兩張牌的每種組合對每種明牌各算一次
async function segOdds() {
  const { forHand } = require('../app/js/core/odds.js');
  const { value } = require('../app/js/core/hand.js');
  const c = (rank, suit) => ({ rank, suit });
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const cases = [];
  for (let i = 0; i < RANKS.length; i++) for (let j = i; j < RANKS.length; j++) {
    const hand = [c(RANKS[i], 'S'), c(RANKS[j], 'H')];
    if (value(hand).total === 21) continue;
    for (const u of RANKS) cases.push({ hand, up: c(u, 'D') });
  }
  const e = entry(`勝率計算 odds.forHand（node）`, `${cases.length} 種（兩張牌組合×10 種明牌）、6 副牌、可加倍`, '同事每輪到他一次就算一次；瀏覽器裡那一次的耗時在「按發牌→輪到你」的分段裡');
  await repeat('勝率', async keep => {
    const t0 = now();
    for (const k of cases) forHand({ hand: k.hand, up: k.up, seen: [...k.hand, k.up], canDouble: true });
    const ms = now() - t0;
    if (keep) addSample(e, ms, { '◆ 每次 forHand': ms / cases.length });
  });
}

// 規則引擎長跑（node）：照 tests/check_simulation.js 第一個測試的迴圈，記 state() 的深拷貝佔多少
async function segEngine() {
  const { createGame } = require('../app/js/core/game.js');
  const strategy = require('../app/js/core/strategy.js');
  const { rng } = require('../tests/rng_util');
  const ROUNDS = 10000;
  const e = entry(`規則引擎全 AI ${ROUNDS.toLocaleString()} 局（node）`, `${ROUNDS.toLocaleString()} 局、4 座位、6 副牌、種子 2026`, '迴圈同 tests/check_simulation.js 第一個測試；同事玩的時候一局只跑一次');
  await repeat('引擎', async keep => {
    const r = rng(2026);
    const seats = [
      { id: 's0', name: '甲', personality: 'reckless', bankroll: 1000 }, { id: 's1', name: '乙', personality: 'steady', bankroll: 1000 },
      { id: 'me', name: '玩家', personality: null, bankroll: 1000 }, { id: 's3', name: '丙', personality: 'timid', bankroll: 1000 },
    ];
    const g = createGame({ rng: r, seats });
    const acc = {};
    const wrap = (name, fn) => function () { const t = now(); try { return fn.apply(this, arguments); } finally { acc[name] = (acc[name] || 0) + now() - t; } };
    for (const k of ['state', 'startRound', 'act', 'aiChoice', 'finishRound', 'topUp']) g[k] = wrap(k, g[k]);
    const bet = wrap('strategy.bet', strategy.bet);
    const t0 = now();
    for (let round = 0; round < ROUNDS; round++) {
      for (const s of g.state().seats) if (s.bankroll < g.rules.minBet) g.topUp(s.id, 1000);
      const bets = {};
      for (const s of g.state().seats) bets[s.id] = bet(s.personality || 'steady', s.bankroll, r, g.rules);
      g.startRound(bets);
      while (g.state().phase === 'player') { const id = g.state().turn; g.act(id, g.aiChoice(id)); }
      if (g.state().phase === 'dealer') g.finishRound();
      const st = g.state();
      st.seats.reduce((a, s) => a + s.bankroll, 0);
    }
    const ms = now() - t0;
    if (!keep) return;
    const segs = {
      'state()（每次 JSON 深拷貝整桌）': acc.state, 'startRound（含洗牌）': acc.startRound, 'act': acc.act,
      'aiChoice（AI 策略）': acc.aiChoice, 'finishRound（荷官補牌與結算）': acc.finishRound, 'strategy.bet': acc['strategy.bet'], 'topUp': acc.topUp || 0,
    };
    segs['迴圈其餘'] = ms - sum(Object.values(segs));
    addSample(e, ms, segs);
  });
}

// npm test：照 package.json 的 node --test，多掛一個 junit 報表拿每支檔的測試耗時（node 平行跑各檔）
async function segTest() {
  const files = fs.readdirSync(path.join(REPO, 'tests')).filter(f => /^check_.*\.js$/.test(f));
  const noBrowser = files.filter(f => !fs.readFileSync(path.join(REPO, 'tests', f), 'utf8').includes('browser_util'));
  const pattern = SMOKE ? noBrowser.map(f => `tests/${f}`) : ['tests/check_*.js'];
  const e = entry(SMOKE ? `node --test 不開瀏覽器的 ${noBrowser.length} 支（冒煙縮小版）` : 'npm test（node --test 全套）', `${SMOKE ? noBrowser.length : files.length} 支檔、平行 ${Math.max(1, os.availableParallelism() - 1)}`,
    '平行執行：分段是各檔測試本體時間（不含開進程與載入），佔比以各檔加總為分母；比 npm test 少了 npm 自己的啟動，見空跑那列');
  let k = 0;
  await repeat('npm test', async keep => {
    const junit = path.join(TMP, `junit-${k++}.xml`);
    const r = await timedRun(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${junit}`, ...pattern]);
    if (r.code !== 0) hookProblems.push(`npm test 第 ${k} 次結束碼 ${r.code}（有測試失敗或逾時，時間照記但要看是不是失敗拉長的）：${r.lines.filter(([, l]) => /^✖/.test(l)).slice(0, 3).map(x => x[1]).join('｜')}`);
    const xml = fs.existsSync(junit) ? fs.readFileSync(junit, 'utf8') : '';
    const per = {};
    for (const m of xml.matchAll(/<testcase [^>]*?time="([\d.]+)"[^>]*?file="([^"]+)"/g)) {
      const f = path.basename(m[2]);
      per[f] = (per[f] || 0) + Number(m[1]) * 1000;
    }
    if (!keep) return;
    const segs = Object.fromEntries(Object.entries(per).sort((a, b) => b[1] - a[1]));
    addSample(e, r.ms, segs, { '各檔測試時間加總 ms': Math.round(sum(Object.values(per))), '測試條數': (xml.match(/<testcase /g) || []).length });
  });
  // 平行跑：牆鐘時間不是各檔加總，佔比改用各檔加總當分母
  e.shareOfSegs = true;
}

// npm run mutants：一行一個破壞，用印出那一行的時間切分段
async function segMutants() {
  const e = entry('npm run mutants（node tests/mutants.js）', '15 個破壞、每個複製 app\\＋tests\\ 再跑一支測試檔', '比 npm run 少了 npm 自己的啟動');
  await repeat('mutants', async keep => {
    const r = await timedRun(process.execPath, ['tests/mutants.js']);
    if (r.code !== 0) hookProblems.push(`mutants 結束碼 ${r.code}：${r.lines.slice(-1).map(x => x[1]).join('')}`);
    if (!keep) return;
    const segs = {};
    let prev = 0;
    for (const [t, line] of r.lines) {
      const m = line.match(/^(?:紅（抓到了）|綠（沒抓到！）|✖) (.+?)(?: →|：|$)/);
      if (!m) continue;
      segs[m[1]] = t - prev;
      prev = t;
    }
    addSample(e, r.ms, segs);
  });
}

// three.js 重新打包：呼叫 tools/build_three.js 的 build()，輸出到暫存（不碰 app\lib\three.js）
async function segBuild() {
  const { build } = require('./build_three');
  const out = path.join(TMP, 'three-bench.js');
  const e = entry('npm run build:three（esbuild 打包 three）', `node_modules\\three ${require('../node_modules/three/package.json').version}`, '輸出寫到暫存檔；tests/check_three_bundle.js 每次 npm test 也跑這一段');
  await repeat('build:three', async keep => { const t0 = now(); build(out); const ms = now() - t0; if (keep) addSample(e, ms); });
  fs.rmSync(out, { force: true });
}

// tools/shoot.js 截圖：在暫存複本上跑，截圖落在複本裡，不寫進專案
async function segShoot() {
  const copy = path.join(TMP, 'repo');
  fs.cpSync(APP, path.join(copy, 'app'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(copy, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tests', 'browser_util.js'), path.join(copy, 'tests', 'browser_util.js'));
  fs.copyFileSync(path.join(REPO, 'tools', 'shoot.js'), path.join(copy, 'tools', 'shoot.js'));
  for (const [mode, what] of [['', '桌機＋手機各一張'], ['--dealer', '荷官五種表情＋手機一張'], ['--round', '正常速度打一局，桌機與手機各截四張']]) {
    const e = entry(`node tools/shoot.js ${mode || '（預設）'}`, what, '在暫存複本上跑；分段＝印出每一行（每張圖）的時間差');
    await repeat(`shoot ${mode}`, async keep => {
      const r = await timedRun(process.execPath, ['tools/shoot.js', 'perf', ...(mode ? [mode] : [])], { cwd: copy });
      if (r.code !== 0) hookProblems.push(`shoot ${mode} 結束碼 ${r.code}：${r.err.split('\n')[0]}`);
      if (!keep) return;
      const segs = {};
      let prev = 0;
      r.lines.filter(([, l]) => l.startsWith('✔')).forEach(([t, l], i) => { segs[`第 ${i + 1} 張 ${(l.match(/perf-[\w-]+/) || [''])[0]}`] = t - prev; prev = t; });
      addSample(e, r.ms, segs);
    });
  }
}

// 線上：開網址（GitHub Pages）、check_live.js、GitHub Actions 發布耗時（GitHub 記的歷史值）
async function segLive() {
  await segLoad(LIVE_URL, '開網址（GitHub Pages）', '線上版');
  const e = entry('node tools/check_live.js', 'Edge 與 Chrome × 桌機與手機，各打兩局（加速）', '要連網；推上 main、workflow 跑完之後跑');
  await repeat('check_live', async keep => {
    const r = await timedRun(process.execPath, ['tools/check_live.js']);
    if (r.code !== 0) hookProblems.push(`check_live 結束碼 ${r.code}：${r.lines.slice(-1).map(x => x[1]).join('')}`);
    if (!keep) return;
    const segs = {};
    let prev = 0;
    r.lines.filter(([, l]) => /^[✔✖] /.test(l)).forEach(([t, l]) => { segs[l.slice(2).split('：')[0]] = t - prev; prev = t; });
    addSample(e, r.ms, segs);
  });
  try {
    const runs = JSON.parse(execFileSync('gh', ['run', 'list', '--workflow', 'pages.yml', '--limit', '10', '--json', 'createdAt,updatedAt,status,conclusion'], { cwd: REPO }).toString());
    const done = runs.filter(x => x.status === 'completed' && x.conclusion === 'success');
    const g = entry('推上 main 到 Pages 發布完（GitHub Actions）', `最近 ${done.length} 次成功的 workflow`, '這列是 GitHub 記的歷史值（createdAt→updatedAt），不是本腳本量的；取樣次數＝歷史筆數');
    for (const x of done) addSample(g, new Date(x.updatedAt) - new Date(x.createdAt));
  } catch (err) {
    hookProblems.push(`gh run list 讀不到：${err.message.split('\n')[0]}`);
  }
}

// ---- 輸出 ----
const fmt = x => (typeof x !== 'number' || !Number.isFinite(x) ? '—' : Math.abs(x) >= 100 ? Math.round(x).toLocaleString() : x.toFixed(x >= 10 ? 1 : 2));
function printTable(env) {
  const out = [];
  out.push(`## 量測環境\n`);
  for (const [k, v] of Object.entries({ ...env, ...envMore })) out.push(`1. ${k}：${v}`);
  out.push('', '## 結果', '', '中位數／最大值單位 ms；最大值超過中位數兩倍標 ⚠（環境有噪音，先講明再判讀）。「◆」是里程碑：從開始量到那一刻，不是總時間的一塊。', '');
  out.push('| 所屬進入點 | 熱點（分段） | 中位數／最大值 | 取樣次數 | 佔該進入點 | 輸入大小筆數 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of results) {
    if (!e.samples.length) { out.push(`| ${e.name} | （量不到，見下方問題） | — | 0 | — | ${e.input} |`); continue; }
    const tot = e.samples.map(s => s.total);
    const mt = median(tot), xt = Math.max(...tot);
    const counts = Object.keys(e.samples[0].counts);
    const cText = counts.map(k => `${k} ${(() => { const v = e.samples.map(s => s.counts[k]); return typeof v[0] === 'number' ? fmt(median(v)) : v[v.length >> 1]; })()}`).join('；');
    out.push(`| ${e.name} | **總計** | ${fmt(mt)}／${fmt(xt)}${xt > 2 * mt && mt > 1 ? ' ⚠' : ''} | ${e.samples.length} | 100% | ${e.input}${cText ? `；${cText}` : ''}${e.note ? `（${e.note}）` : ''} |`);
    for (const k of e.order) {
      const v = e.samples.map(s => s.segs[k]).filter(x => Number.isFinite(x));
      if (!v.length) continue;
      const m = median(v), x = Math.max(...v);
      const base = s => (e.shareOfSegs ? sum(Object.entries(s.segs).filter(([n, x]) => !n.startsWith('◆') && Number.isFinite(x)).map(([, x]) => x)) : s.total);
      const share = median(e.samples.filter(s => Number.isFinite(s.segs[k]) && base(s)).map(s => s.segs[k] / base(s)));
      out.push(`| | ${k} | ${fmt(m)}／${fmt(x)}${x > 2 * m && m > 1 ? ' ⚠' : ''} | ${v.length} | ${k.startsWith('◆') ? '—' : `${(share * 100).toFixed(1)}%`} | |`);
    }
  }
  if (hookProblems.length || pageConsole.length || leftoverTotal || otherPages.size) {
    out.push('', '## 量測本身的問題（有這節就先處理，再信上面的數字）', '');
    for (const p of [...new Set(hookProblems)]) out.push(`1. ${p}`);
    if (otherPages.size) out.push(`1. 無頭瀏覽器啟動時自己開了別的分頁（已關掉，量測頁沒被搶前景才算數）：${[...otherPages].join('、')}`);
    for (const c of [...new Set(pageConsole)].slice(0, 10)) out.push(`1. 頁面主控台：${c}`);
    if (leftoverTotal) out.push(`1. 無頭瀏覽器殘留 ${leftoverTotal} 個進程`);
  }
  console.log(out.join('\n'));
}

// ---- 主程式 ----
async function cleanup() {
  for (const m of launched) { try { leftoverTotal += killMarked(m); } catch { /* 收不掉就算進殘留 */ } }
  if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 暫存還鎖著 */ } }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const env = environment();
  log(`開始：${ONLY.join(',')}｜瀏覽器 ${BROWSERS.join('、')}｜${env.取樣}｜暫存 ${TMP}`);
  const run = {
    blank: segBlank,
    load: () => segLoad(APP_URL, '開啟到畫面完整（雙擊 app\\index.html）', `app\\ ${dirSize(APP).bytes.toLocaleString()} bytes`),
    round: segRound, resize: segResize, click: segClick, soak: segSoak, odds: segOdds, engine: segEngine,
    test: segTest, mutants: segMutants, build: segBuild, shoot: segShoot, live: segLive,
  };
  try {
    for (const s of ONLY) {
      envMore[`開始「${s}」前的背景負載`] = ps(`$c = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime; "CPU $c%"`);
      try { await run[s](); } catch (err) { hookProblems.push(`「${s}」這一段中途失敗：${err.message}`); log(`✖ ${s}：${err.stack}`); }
    }
  } finally {
    printTable(env);
    const raw = JSON.stringify({ env: { ...env, ...envMore }, results, hookProblems, pageConsole, leftoverTotal }, null, 1);
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, raw);
    if (KEEP) fs.writeFileSync(path.join(TMP, 'raw.json'), raw);
    await cleanup();
    log(`結束${KEEP ? `（暫存保留在 ${TMP}）` : ''}`);
  }
})();
