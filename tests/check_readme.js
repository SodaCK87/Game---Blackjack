// 守 README 裡同事會照著做的兩節：籌碼存在哪（網址開與雙擊開各記各的，盤點 B-02）、遇到問題找誰（盤點 D-03）。
// 純讀檔，CI 也跑。驗不到：同事讀了會不會照做。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const ISSUES = 'https://github.com/SodaCK87/Game---Blackjack/issues';

// 取「## 標題」到下一個「## 」之前；找不到回 null
function section(md, title) {
  const part = md.split(/^## /m).find(s => s.split(/\r?\n/)[0].trim() === title);
  return part === undefined ? null : part;
}

function problems(md) {
  const out = [];
  const save = section(md, '籌碼存在哪');
  if (save === null) out.push('少了〈籌碼存在哪〉');
  else if (!/網址/.test(save) || !/雙擊/.test(save)) out.push('〈籌碼存在哪〉沒講網址開和雙擊開各記各的');
  const help = section(md, '遇到問題');
  if (help === null) out.push('少了〈遇到問題〉');
  else {
    if (!help.includes(ISSUES)) out.push(`〈遇到問題〉沒指到 ${ISSUES}`);
    if (!/版本號/.test(help) || !/截圖/.test(help)) out.push('〈遇到問題〉沒講回報要附版本號與截圖');
  }
  return out;
}

test('README 的〈籌碼存在哪〉講了兩份籌碼，〈遇到問題〉講了找誰、附什麼', () => {
  assert.deepStrictEqual(problems(README), []);
});

test('陽性對照：刪掉兩份籌碼那句、或整節〈遇到問題〉，都要判紅', () => {
  const noSplit = README.split(/\r?\n/).filter(l => !(l.includes('網址') && l.includes('雙擊'))).join('\n');
  assert.deepStrictEqual(problems(noSplit), ['〈籌碼存在哪〉沒講網址開和雙擊開各記各的']);
  const noHelp = README.replace(/^## 遇到問題[\s\S]*?(?=^## )/m, '');
  assert.deepStrictEqual(problems(noHelp), ['少了〈遇到問題〉']);
});
