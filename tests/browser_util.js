// 探針共用：無頭開 Edge／Chrome，經 CDP 控制一個分頁（設視窗尺寸、讀頁面狀態、收主控台、截圖）。
// 不用 --window-size：無頭視窗寬度最小被夾在約 500px，量不到手機（2026-10-22 實測 390 寬得到 496）。
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = {
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};
const CDP_TIMEOUT_MS = 15000;
// 開頁比一般指令慢得多：全套平行跑時 Page.navigate 本身就等過 15 秒以上（2026-10-28 chrome 逾時一次）
const NAV_TIMEOUT_MS = 60000;
// Browser.close 之後子進程要一點時間才收完，機器忙時更久；沒等就數會數到正在結束的進程（A-03）
const EXIT_WAIT_MS = 10000;
const PROFILE_PREFIX = 'bjk-probe-';

function availableBrowsers() {
  return Object.keys(CANDIDATES).filter(b => fs.existsSync(CANDIDATES[b]));
}

// 只認這一輪 mkdtemp 出來的 user-data-dir：認不出是自己起的進程就不動
const markedQuery = marker => `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { $_.ProcessId }`;
function markedPids(marker) {
  return execFileSync('powershell', ['-NoProfile', '-Command', markedQuery(marker)]).toString().split(/\s+/).filter(Boolean);
}

// 同一個 node 進程共用一支常駐的 PowerShell 來查：每一頁起一支要 0.8 秒、佔開關一頁的四成（P-10），
// 常駐的每次約 0.18 秒，查法一樣是照 user-data-dir 找全部進程（瀏覽器自己報的清單漏掉 crashpad，2026-10-28 實測）。
// 只在有查詢等著時 ref，平常 unref：測試跑完 node 就結束，stdin 一關 PowerShell 跟著結束。壞了就退回每次起一支
const END = '<<bjk-end>>';
let shell = null;
function startShell() {
  if (shell) return shell;
  const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const s = shell = { proc, buf: '', waiters: [], dead: false };
  const idle = () => { if (!s.waiters.length) { proc.unref(); proc.stdout.unref(); proc.stdin.unref(); } };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', d => {
    s.buf += d;
    for (let i; (i = s.buf.indexOf(END)) >= 0;) {
      const out = s.buf.slice(0, i);
      s.buf = s.buf.slice(i + END.length);
      s.waiters.shift().ok(out);
    }
    idle();
  });
  const die = () => { s.dead = true; if (shell === s) shell = null; s.waiters.splice(0).forEach(w => w.fail(new Error('常駐 PowerShell 結束了'))); };
  proc.on('exit', die);
  proc.on('error', die);
  idle();
  return s;
}
async function markedPidsFast(marker) {
  const s = startShell();
  if (s.dead) return markedPids(marker);
  try {
    const out = await new Promise((ok, fail) => {
      s.waiters.push({ ok, fail });
      s.proc.ref(); s.proc.stdout.ref(); s.proc.stdin.ref();
      s.proc.stdin.write(`${markedQuery(marker)}\nWrite-Output '${END}'\n`);
    });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return markedPids(marker);
  }
}

// process.kill(pid, 0) 只問存不存在、不送訊號；EPERM 是存在但沒權限
function alive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitGone(pids, ms) {
  for (let t = 0; t < ms && pids.some(alive); t += 50) await sleep(50);
  return pids.filter(alive);
}

// 刪不掉的設定檔（進程剛收完還鎖著）留在 %TEMP% 會越積越多：每次載入時補刪一小時以前的。
// 一小時是為了不碰到別支測試檔正在用的（每一頁開關不到兩分鐘）
(function sweepOldProfiles() {
  const cutoff = Date.now() - 3600e3;
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    try { if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 還鎖著就下次再刪 */ }
  }
})();
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`CDP 逾時：${what}`)), ms); })])
    .finally(() => clearTimeout(timer));
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map(), listeners = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? fail(new Error(`${msg.error.message}`)) : ok(msg.result);
      } else if (msg.method) {
        listeners.forEach(fn => fn(msg));
      }
    };
    ws.onerror = () => reject(new Error(`連不上 ${wsUrl}`));
    ws.onopen = () => resolve({
      send(method, params = {}, timeoutMs = CDP_TIMEOUT_MS) {
        const msgId = ++id;
        const p = new Promise((ok, fail) => pending.set(msgId, { ok, fail }));
        ws.send(JSON.stringify({ id: msgId, method, params }));
        return withTimeout(p, timeoutMs, method);
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch { /* 已經斷了 */ } },
    });
  });
}

// size：CSS 像素；mobile：照手機模擬（觸控、device pixel ratio 2）；init：每次載入時比頁面自己的 script 先跑的程式碼
async function withPage(browser, { size = [1280, 720], mobile = false, init = '' } = {}, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const marker = path.basename(dir);
  const args = ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--remote-debugging-port=0', 'about:blank'];
  // Edge 會先把自己重新啟動一次，拿到的 pid 只是 launcher
  if (browser === 'edge') args.unshift('--edge-skip-compat-layer-relaunch');
  const proc = spawn(CANDIDATES[browser], args, { stdio: 'ignore' });
  startShell();   // 收尾要用；啟動要 0.7 秒，趁開頁的時候先起好
  let client = null, browserClient = null;
  const result = { console: [], leftover: -1 };
  try {
    // 檔案出現了不代表讀得到：瀏覽器還在寫的那一下會 EBUSY（全套平行跑、機器忙的時候撞過），讀到內容才算數
    const portFile = path.join(dir, 'DevToolsActivePort');
    let port = '';
    for (let i = 0; i < 150 && !port; i++) {
      try { port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim(); } catch (e) { /* 還沒寫好 */ }
      if (!port) await sleep(100);
    }
    if (!port) throw new Error(`${browser} 15 秒內沒有開出偵錯埠`);
    // 瀏覽器層級的連線：收尾時問它開了哪些進程、由它關掉整個瀏覽器
    browserClient = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pageTarget = targets.find(t => t.type === 'page');
    client = await connect(pageTarget.webSocketDebuggerUrl);
    client.on(msg => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        result.console.push(`${msg.params.type}: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        result.console.push(`exception: ${d.exception ? d.exception.description : d.text}`);
      } else if (msg.method === 'Log.entryAdded') {
        // 載入失敗的訊息本身不帶網址（「404」而已），網址在 entry.url
        const { level, text, url } = msg.params.entry;
        result.console.push(`${level}: ${text}${url ? `（${url}）` : ''}`);
      }
    });
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.enable');
    // alert／confirm 會卡住 renderer，CDP 回應就送不出來，探針會整支掛住
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;',
    });
    if (init) await client.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: size[0], height: size[1], deviceScaleFactor: mobile ? 2 : 1, mobile,
    });
    if (mobile) await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });

    const page = {
      async goto(url) {
        let loaded;
        const done = new Promise(r => { loaded = r; });
        client.on(msg => { if (msg.method === 'Page.loadEventFired') loaded(); });
        await client.send('Page.navigate', { url }, NAV_TIMEOUT_MS);
        await withTimeout(done, NAV_TIMEOUT_MS, `載入 ${url}`);
        // 分頁不在前景時 requestAnimationFrame 會被節流，動畫等不到、量到的時間全錯：那是量法錯，不是產品錯
        const vis = await page.evaluate('document.visibilityState');
        if (vis !== 'visible') throw new Error(`量法錯：無頭分頁的 visibilityState 是 ${vis}，不是 visible`);
      },
      // 要等很久的（例如連打好幾局）自己給 timeoutMs，預設 15 秒
      async evaluate(expression, timeoutMs) {
        const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
        if (r.exceptionDetails) throw new Error(`頁面內執行失敗：${r.exceptionDetails.text}`);
        return r.result.value;
      },
      // 真的點一下（CDP Input）：瀏覽器把它算成使用者操作，自動播放政策才放行音效；頁面裡的 el.click() 不算
      async click(x, y) {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        }
      },
      async screenshot(file) {
        const r = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      },
      console: result.console,
    };
    result.value = await fn(page);
  } finally {
    // 關之前先問瀏覽器自己開了哪些進程，關完用 pid 等它們結束：機器忙時子進程要好一陣子才收完，
    // 沒等就數會數到正在結束的、把探針弄紅（A-03）。清單漏掉 crashpad 與晚開的 utility（2026-10-28 實測），
    // 所以再照 user-data-dir 全面查一次；查到的先等它自己結束，等不到才砍
    const pids = [String(proc.pid)];
    if (browserClient) {
      try { pids.push(...(await browserClient.send('SystemInfo.getProcessInfo')).processInfo.map(p => String(p.id))); } catch { /* 瀏覽器已經掛了 */ }
      try { await browserClient.send('Browser.close'); } catch { /* 已經關了 */ }
      browserClient.close();
    }
    if (client) client.close();
    await waitGone(pids, EXIT_WAIT_MS);
    let left = await markedPidsFast(marker);
    if (left.length) left = await waitGone(left, EXIT_WAIT_MS);
    if (left.length) {
      // 列出來到砍下去之間，有些進程已經自己結束了：Stop-Process 找不到 pid 會讓 powershell 回非零（
      // -ErrorAction SilentlyContinue 只擋訊息、不擋退出碼），探針就被自己的收尾弄紅。所以逐一砍、最後明講 exit 0，
      // 收得乾不乾淨以下一行重數為準
      const kill = left.map(pid => `try { Stop-Process -Id ${pid} -Force -ErrorAction Stop } catch {}`).join('; ');
      execFileSync('powershell', ['-NoProfile', '-Command', `${kill}; exit 0`]);
      await waitGone(left, EXIT_WAIT_MS);
      left = await markedPidsFast(marker);
    }
    result.leftover = left.length;
    // 進程剛收完，設定檔偶爾還鎖著：重試幾次，還是刪不掉就留給下一次載入時的 sweepOldProfiles
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 留給下一次 */ }
  }
  return result;
}

module.exports = { availableBrowsers, withPage };
