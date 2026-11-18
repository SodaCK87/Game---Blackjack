// 對白用的字型：霞鶩文楷 TC Medium 只收對白用得到的字，切成 WOFF2 子集，寫成 app/lib/bubble_font.js（不准手改），
// 授權全文抄到 app/lib/bubble_font_ofl.txt。改了對白、換了字型或改了這支的任何一行就重跑：node tools/make_bubble_font.js
// 原字型放 tools/_fonts/（15 MB，不進版控）；切子集要 python 的 fontTools 與 brotli。
// 對白從 app/js 的原始碼掃：say(…)、aside(…) 的引數與 pop(…) 的第一個引數裡的字串，引數裡用到的變數照宣告追下去
// （AI 的名字、動作名、Blackjack 的說明都是這樣插進句子的），再加上泡泡 CSS 的 content 字串（名牌）。
// tests/check_bubble_font.js 用同一套掃法比對產出檔，CI 上沒有原字型也判得了。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const FONT = path.join(__dirname, '_fonts', 'LXGWWenKaiTC-Medium.ttf');
const LICENSE = path.join(__dirname, '_fonts', 'OFL.txt');
const TARGET = path.join(APP, 'lib', 'bubble_font.js');
const LICENSE_OUT = path.join(APP, 'lib', 'bubble_font_ofl.txt');
const FAMILY = 'BJK WenKai';
// 產生的資料檔：只有圖與字型，沒有對白；dealer_art.js 一支就 558 KB，掃了只是白費時間
const SKIP = ['dealer_art.js', 'table_art.js'];
// 會講出對白的呼叫：引數裡的字串都算對白。pop 只看第一個（第二個是座標）
const CALLS = { say: 'all', aside: 'all', pop: 'first' };
// 數字、半形 ASCII 一律收：籌碼數字是執行時才插進去的；全形標點收常用的，對白改了也不必擔心缺標點
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const PUNCT = '，。、！？：；「」『』（）《》〈〉【】…—～・％＋－';

// ---- 把 JS 切成 token：註解丟掉；字串與樣板字串的字面部分是 str，樣板裡 ${…} 的內容照一般程式碼切 ----
const OPS = ['===', '!==', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/='];
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
function unescape(s, i) {
  const c = s[i + 1];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  if (c in simple) return [simple[c], 2];
  if (c === 'x') return [String.fromCharCode(parseInt(s.substr(i + 2, 2), 16)), 4];
  if (c === 'u' && s[i + 2] === '{') { const end = s.indexOf('}', i); return [String.fromCodePoint(parseInt(s.slice(i + 3, end), 16)), end - i + 1]; }
  if (c === 'u') return [String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)), 6];
  if (c === '\r' && s[i + 2] === '\n') return ['', 3];
  if (c === '\n') return ['', 2];
  return [c, 2];
}
function tokenize(src) {
  const out = [], braces = [];   // braces：每進一層樣板的 ${ 推一個計數，回到 0 時的 } 是那一層的結尾
  let i = 0;
  const push = (type, value) => out.push({ type, value });
  const regexOk = () => {
    const t = out[out.length - 1];
    if (!t) return true;
    if (t.type === 'punc') return !/^[)\]}]$/.test(t.value);
    if (t.type === 'id') return KEYWORDS_BEFORE_REGEX.has(t.value);
    return false;
  };
  function template() {   // 從樣板字串的字面部分讀到 ` 或 ${
    let buf = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { const [ch, n] = unescape(src, i); buf += ch; i += n; continue; }
      if (c === '`') { push('str', buf); i++; return; }
      if (c === '$' && src[i + 1] === '{') { push('str', buf); push('punc', '${'); i += 2; braces.push(0); return; }
      buf += c;
      i++;
    }
    throw new Error('樣板字串沒有收尾');
  }
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) throw new Error('註解沒有收尾'); continue; }
    if (c === '"' || c === "'") {
      let buf = '';
      i++;
      while (src[i] !== c) {
        if (i >= src.length || src[i] === '\n') throw new Error('字串沒有收尾');
        if (src[i] === '\\') { const [ch, n] = unescape(src, i); buf += ch; i += n; } else buf += src[i++];
      }
      i++;
      push('str', buf);
      continue;
    }
    if (c === '`') { i++; template(); continue; }
    if (c === '}' && braces.length && braces[braces.length - 1] === 0) { braces.pop(); push('punc', '}$'); i++; template(); continue; }
    if (c === '/' && regexOk()) {
      let inClass = false;
      i++;
      while (inClass || src[i] !== '/') {
        if (i >= src.length || src[i] === '\n') throw new Error('正規表示式沒有收尾');
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] || '')) i++;
      push('regex', '');
      continue;
    }
    const id = /^[A-Za-z_$À-￿][\w$À-￿]*/.exec(src.slice(i, i + 200));
    if (id) { push('id', id[0]); i += id[0].length; continue; }
    const num = /^(0[xX][\da-fA-F_]+|\d[\d_]*\.?\d*(e[+-]?\d+)?|\.\d+)n?/.exec(src.slice(i, i + 50));
    if (num) { push('num', num[0]); i += num[0].length; continue; }
    const op = OPS.find(o => src.startsWith(o, i)) || c;
    if (op === '{' && braces.length) braces[braces.length - 1]++;
    if (op === '}' && braces.length) braces[braces.length - 1]--;
    push('punc', op);
    i += op.length;
  }
  return out;
}

const OPEN = { '(': ')', '[': ']', '{': '}', '${': '}$' };
// 從 start（開括號）找到對應的關括號，回傳中間的 token
function enclosed(toks, start) {
  const stack = [];
  for (let j = start; j < toks.length; j++) {
    const v = toks[j].type === 'punc' ? toks[j].value : null;
    if (v in OPEN) stack.push(OPEN[v]);
    else if (v && v === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return toks.slice(start + 1, j); }
  }
  throw new Error('括號沒有收尾');
}
// 從 start 讀一個運算式，讀到同一層的 , 或 ; 為止（宣告的初始值、第一個引數）
function expression(toks, start) {
  const stack = [];
  let j = start;
  for (; j < toks.length; j++) {
    const v = toks[j].type === 'punc' ? toks[j].value : null;
    if (!stack.length && (v === ',' || v === ';' || v === ')' || v === ']' || v === '}')) break;
    if (v in OPEN) stack.push(OPEN[v]);
    else if (v && v === stack[stack.length - 1]) stack.pop();
  }
  return toks.slice(start, j);
}

// 一支檔裡的宣告：const／let／var 的名稱 → 初始值的 token；V.<名稱> = … → 掛到 window.BJK.view 上的模組（跨檔追）
function declarations(toks) {
  const local = new Map(), exported = new Map();
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j];
    if (t.type === 'id' && (t.value === 'const' || t.value === 'let' || t.value === 'var')) {
      for (let k = j + 1; ;) {
        if (toks[k].type !== 'id' || toks[k + 1].value !== '=') break;   // 解構（const { a } = …）不追
        const init = expression(toks, k + 2);
        if (!local.has(toks[k].value)) local.set(toks[k].value, init);
        k += 2 + init.length;
        if (toks[k] && toks[k].value === ',') k++; else break;
      }
    }
    if (t.type === 'id' && t.value === 'V' && toks[j + 1] && toks[j + 1].value === '.' && toks[j + 2].type === 'id' && toks[j + 3] && toks[j + 3].value === '=') {
      exported.set(toks[j + 2].value, expression(toks, j + 4));
    }
  }
  return { local, exported };
}

// files：{ 相對路徑: 原始碼 }。回傳對白用到的字（排好、不重複）與每支檔貢獻了哪些字串
function dialogueText(files) {
  const parsed = Object.fromEntries(Object.entries(files).map(([f, src]) => {
    const toks = tokenize(src);
    return [f, { toks, ...declarations(toks) }];
  }));
  const strings = new Map();   // 字串 → 出自哪支檔
  const seen = new Set();
  function walk(toks, file) {
    toks.forEach((t, j) => {
      if (t.type === 'str') { if (!strings.has(t.value)) strings.set(t.value, file); return; }
      if (t.type !== 'id') return;
      const prev = toks[j - 1], next = toks[j + 1];
      if (prev && prev.value === '.') {
        // V.<名稱>：另一支檔掛出來的模組
        if (toks[j - 2] && toks[j - 2].value === 'V') follow(`V.${t.value}`, () => {
          const hit = Object.entries(parsed).find(([, p]) => p.exported.has(t.value));
          return hit && [hit[1].exported.get(t.value), hit[0]];
        });
        return;
      }
      if (next && next.value === ':' && prev && (prev.value === '{' || prev.value === ',')) return;   // 物件的鍵
      follow(`${file}:${t.value}`, () => parsed[file].local.has(t.value) && [parsed[file].local.get(t.value), file]);
    });
  }
  function follow(key, find) {
    if (seen.has(key)) return;
    seen.add(key);
    const hit = find();
    if (hit) walk(...hit);
  }
  for (const [file, { toks }] of Object.entries(parsed)) {
    toks.forEach((t, j) => {
      if (t.type !== 'id' || !(t.value in CALLS) || !toks[j + 1] || toks[j + 1].value !== '(') return;
      if (toks[j - 1] && toks[j - 1].value === 'function') return;   // 函式自己的宣告
      const args = enclosed(toks, j + 1);
      walk(CALLS[t.value] === 'first' ? expression(args, 0) : args, file);
    });
  }
  const chars = [...new Set([...strings.keys()].join(''))].sort().join('');
  return { chars, strings };
}

// 泡泡 CSS 的 content 字串（名牌的「荷官」）：只看選擇器帶 bubble 的規則
function cssText(css) {
  let out = '';
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selector, body] = block.split('{');
    if (!body || !/bubble/.test(selector)) continue;
    for (const m of body.matchAll(/content:\s*"([^"]*)"/g)) out += m[1];
  }
  return out;
}

// app/js 底下的程式（產生的資料檔除外）與 style.css。override：{ 相對路徑: 原始碼 }，測試拿來塞一句假對白
function appSources(override = {}) {
  const files = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && !SKIP.includes(e.name)) files[path.relative(APP, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'utf8');
    }
  })(path.join(APP, 'js'));
  return { js: { ...files, ...override.js }, css: override.css ?? fs.readFileSync(path.join(APP, 'style.css'), 'utf8') };
}

// 子集要收的字：ASCII、常用全形標點、對白、名牌。排好、不重複
function charset(sources = appSources()) {
  const { chars } = dialogueText(sources.js);
  return [...new Set(ASCII + PUNCT + chars + cssText(sources.css))].sort().join('');
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const scriptHash = (script = fs.readFileSync(__filename, 'utf8')) => sha(script.replace(/\r\n/g, '\n'));

module.exports = { FAMILY, FONT, LICENSE, TARGET, LICENSE_OUT, ASCII, PUNCT, tokenize, dialogueText, cssText, appSources, charset, scriptHash, sha };

if (require.main === module) main();

function main() {
  if (!fs.existsSync(FONT)) throw new Error(`找不到原字型 ${FONT}：從 https://github.com/lxgw/LxgwWenkaiTC 的 release 下載 LXGWWenKaiTC-Medium.ttf 與 OFL.txt 放進 tools/_fonts/`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-font-'));
  try {
    // 原字型沒有的字：標點可以少（退回系統字），對白的字不行
    const py = (code, ...args) => execFileSync('python', ['-c', code, ...args], { cwd: tmp, encoding: 'utf8' });
    const has = new Set(JSON.parse(py('import sys,json\nfrom fontTools.ttLib import TTFont\nprint(json.dumps(sorted(TTFont(sys.argv[1], lazy=True).getBestCmap())))', FONT)));
    const wanted = charset();
    const lacking = [...wanted].filter(ch => !has.has(ch.codePointAt(0)));
    const dialogue = dialogueText(appSources().js).chars;
    const fatal = lacking.filter(ch => dialogue.includes(ch));
    if (fatal.length) throw new Error(`原字型沒有對白用到的字：${fatal.join('')}`);
    const chars = [...wanted].filter(ch => has.has(ch.codePointAt(0))).join('');
    const info = JSON.parse(py('import sys,json\nfrom fontTools.ttLib import TTFont\nn=TTFont(sys.argv[1], lazy=True)["name"]\nprint(json.dumps({"name": n.getDebugName(4), "version": n.getDebugName(5), "copyright": n.getDebugName(0)}))', FONT));
    const list = path.join(tmp, 'chars.txt'), woff2 = path.join(tmp, 'subset.woff2');
    fs.writeFileSync(list, chars, 'utf8');
    // 不收 hinting（字小時 Windows 也不靠它）、直排用的 vhea／vmtx；名稱表全留，授權與版權寫在裡面
    execFileSync('python', ['-m', 'fontTools.subset', FONT, `--text-file=${list}`, '--flavor=woff2', `--output-file=${woff2}`,
      '--no-hinting', '--drop-tables+=vhea,vmtx,meta', '--name-IDs=*', '--name-languages=*', '--notdef-outline'], { cwd: tmp });
    const bytes = fs.readFileSync(woff2);
    const version = info.version.match(/Version ([\d.]+)/)[1];
    const source = { font: sha(fs.readFileSync(FONT)), script: scriptHash(), woff2: sha(bytes) };
    fs.writeFileSync(TARGET, render({ info, version, chars, source, lacking, url: `data:font/woff2;base64,${bytes.toString('base64')}` }));
    fs.copyFileSync(LICENSE, LICENSE_OUT);
    console.log(`✔ ${path.relative(ROOT, TARGET)}：${[...chars].length} 個字，WOFF2 ${(bytes.length / 1024).toFixed(1)} KB，產出檔 ${(fs.statSync(TARGET).size / 1024).toFixed(1)} KB`);
    if (lacking.length) console.log(`  原字型沒有、退回系統字的標點：${lacking.join('')}`);
    console.log(`✔ ${path.relative(ROOT, LICENSE_OUT)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function render({ info, version, chars, source, lacking, url }) {
  const copyright = info.copyright.split(/\r?\n/).map(l => `//   ${l}`).join('\n');
  return `// 由 tools/make_bubble_font.js 產生，不准手改：對白泡泡與 AI 小對白用的字型。
// 字型：${info.name}（霞鶩文楷 TC），Version ${version}；只收對白用得到的 ${[...chars].length} 個字（WOFF2 子集，走 data: URL，file:// 下也載得到）。
// 授權：SIL Open Font License 1.1（OFL-1.1），全文在同一個資料夾的 bubble_font_ofl.txt。
${copyright}
// source 是原字型、產生器與子集本身的雜湊；chars 是子集收的字。改了對白卻沒重跑，tests/check_bubble_font.js 會紅。
// 用 FontFace 載好才加進 document.fonts：載好之前 CSS 找不到這個字型名，直接用系統字，不會有一段字是隱形的。
// ready 載好時是 true；載不起來是 false，主控台留一行警告，泡泡照樣用系統字。
(function () {
  const BJK = (window.BJK = window.BJK || {});
  const V = (BJK.view = BJK.view || {});
  const font = {
    family: ${JSON.stringify(FAMILY)},
    name: ${JSON.stringify(info.name)},
    version: ${JSON.stringify(version)},
    license: 'OFL-1.1',
    source: ${JSON.stringify(source)},
    chars: ${JSON.stringify(chars)},
    lacking: ${JSON.stringify(lacking.join(''))},
    url: '${url}',
  };
  font.ready = Promise.resolve()
    .then(() => new FontFace(font.family, \`url("\${font.url}") format("woff2")\`).load())
    .then(face => { document.fonts.add(face); return true; })
    .catch(e => { console.warn(\`對白字型載不起來，改用系統字：\${e && e.message || e}\`); return false; });
  V.bubbleFont = font;
})();
`;
}
