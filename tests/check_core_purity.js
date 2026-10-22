// 守 CLAUDE.md 第 3 條：core 是純邏輯，不碰亂數來源、畫面、計時器，也不引用 view
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = path.join(__dirname, '..', 'app', 'js', 'core');
const FORBIDDEN = [
  [/Math\.random\s*\(/, 'Math.random'],
  [/\bdocument\./, 'document'],
  [/\bwindow\./, 'window'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/, '計時器'],
  [/\bTHREE\./, 'THREE'],
  [/\bBJK\.view\b|['"][^'"]*\/view\//, 'view'],
];

// 先剝掉註解再掃：解釋規則的註解本身就會提到這些字（index.html 的 type="module" 已經咬過一次）
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function scan(dir) {
  const bad = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const code = stripComments(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const [re, label] of FORBIDDEN) if (re.test(code)) bad.push(`${name}：${label}`);
  }
  return bad;
}

test('app/js/core 底下沒有亂數來源、DOM、計時器、THREE、view 的引用', () => {
  assert.ok(fs.readdirSync(CORE).filter(n => n.endsWith('.js')).length >= 5, 'core 的檔案數不對，掃描可能掃錯資料夾');
  assert.deepStrictEqual(scan(CORE), []);
});

test('陽性對照：每一類違規都抓得到，只出現在註解裡的不算', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-purity-'));
  try {
    const files = {
      'a.js': 'const x = Math.random();',
      'b.js': 'document.title = "x";',
      'c.js': 'window.foo = 1;',
      'd.js': 'setTimeout(() => {}, 10);',
      'e.js': 'const v = new THREE.Vector3();',
      'f.js': "const t = require('../view/table.js');",
      'ok.js': '// 不准呼叫 Math.random()、document.、setTimeout(\n/* THREE. window. */\nconst y = 1;',
    };
    for (const [n, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, n), src);
    assert.deepStrictEqual(scan(tmp).sort(), ['a.js：Math.random', 'b.js：document', 'c.js：window', 'd.js：計時器', 'e.js：THREE', 'f.js：view']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
