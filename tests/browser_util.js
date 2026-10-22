// 探針共用：無頭開 Edge／Chrome 載一個網址，回傳 dump 出來的 DOM 與頁面自己的主控台訊息。
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = {
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

function availableBrowsers() {
  return Object.keys(CANDIDATES).filter(b => fs.existsSync(CANDIDATES[b]));
}

// 只認這一輪 mkdtemp 出來的 user-data-dir：認不出是自己起的進程就不動
function markedPids(marker) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { $_.ProcessId }`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().split(/\s+/).filter(Boolean);
}

async function openHeadless(browser, url, { timeoutMs = 30000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-probe-'));
  const args = ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--enable-logging=stderr', '--v=0', '--virtual-time-budget=5000', '--dump-dom', url];
  // Edge 會先把自己重新啟動一次，拿到的 pid 只是 launcher、stdout 也會斷掉
  if (browser === 'edge') args.unshift('--edge-skip-compat-layer-relaunch');
  // 不能用 spawnSync：它卡住事件迴圈，同一個行程裡若有 http 伺服器就回不了應
  const r = await new Promise(resolve => {
    const p = spawn(CANDIDATES[browser], args);
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on('close', (status, signal) => { clearTimeout(timer); resolve({ stdout, stderr, status, signal }); });
  });
  const marker = path.basename(dir);
  let leftover = markedPids(marker);
  if (leftover.length) {
    execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${leftover.join(',')} -Force -ErrorAction SilentlyContinue`]);
    leftover = markedPids(marker);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 進程剛收完，偶爾還鎖著 */ }
  // Edge 內建擴充也會寫主控台，只留頁面本身（file:// 或 http://127.0.0.1）來源的訊息
  const pageConsole = r.stderr.split(/\r?\n/)
    .filter(l => /:CONSOLE[:(]/.test(l) && /(file:\/\/\/|http:\/\/127\.0\.0\.1)/.test(l));
  return { dom: r.stdout, pageConsole, status: r.status, signal: r.signal, leftover: leftover.length };
}

function readBjkStatus(dom) {
  const m = dom.match(/data-bjk="([^"]*)"/);
  if (!m) return null;
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

module.exports = { availableBrowsers, openHeadless, readBjkStatus };
