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

function availableBrowsers() {
  return Object.keys(CANDIDATES).filter(b => fs.existsSync(CANDIDATES[b]));
}

// 只認這一輪 mkdtemp 出來的 user-data-dir：認不出是自己起的進程就不動
function markedPids(marker) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { $_.ProcessId }`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().split(/\s+/).filter(Boolean);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-probe-'));
  const marker = path.basename(dir);
  const args = ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', 'about:blank'];
  // Edge 會先把自己重新啟動一次，拿到的 pid 只是 launcher
  if (browser === 'edge') args.unshift('--edge-skip-compat-layer-relaunch');
  const proc = spawn(CANDIDATES[browser], args, { stdio: 'ignore' });
  let client = null;
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
        await client.send('Page.navigate', { url });
        await withTimeout(done, CDP_TIMEOUT_MS, `載入 ${url}`);
      },
      // 要等很久的（例如連打好幾局）自己給 timeoutMs，預設 15 秒
      async evaluate(expression, timeoutMs) {
        const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
        if (r.exceptionDetails) throw new Error(`頁面內執行失敗：${r.exceptionDetails.text}`);
        return r.result.value;
      },
      async screenshot(file) {
        const r = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      },
      console: result.console,
    };
    result.value = await fn(page);
  } finally {
    if (client) {
      try { await client.send('Browser.close'); } catch { /* 已經關了 */ }
      client.close();
    }
    for (let i = 0; i < 100 && proc.exitCode === null; i++) await sleep(100);
    let left = markedPids(marker);
    if (left.length) {
      // 列出來到砍下去之間，有些進程已經自己結束了：Stop-Process 找不到 pid 會讓 powershell 回非零（
      // -ErrorAction SilentlyContinue 只擋訊息、不擋退出碼），探針就被自己的收尾弄紅。所以逐一砍、最後明講 exit 0，
      // 收得乾不乾淨以下一行重數為準
      const kill = left.map(pid => `try { Stop-Process -Id ${pid} -Force -ErrorAction Stop } catch {}`).join('; ');
      execFileSync('powershell', ['-NoProfile', '-Command', `${kill}; exit 0`]);
      left = markedPids(marker);
    }
    result.leftover = left.length;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 進程剛收完，偶爾還鎖著 */ }
  }
  return result;
}

module.exports = { availableBrowsers, withPage };
