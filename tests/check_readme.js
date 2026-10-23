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

// 下注、加倍、分牌、荷官 Blackjack 的規則是 game.js 的參數（同事試玩後改過好幾次）。預設值改了而〈規則〉沒跟著改，同事會照錯的規則玩
const { DEFAULTS } = require('../app/js/core/game.js');
const RULE_LINES = [
  [/沒有上限/, '下注沒有上限'],
  [/10 點或 11 點才能加倍/, '加倍只准頭兩張 10、11 點'],
  [/K 加 Q/, '分牌看點數（K 加 Q 也能分）'],
  [/分出來的每一手照一般的手打/, '分出來的手照一般的手打'],
  [/分開的 A 每一手只補一張牌就停/, '只有分開的 A 只補一張就停'],
  [/要分成幾手都可以/, '再分不限手數'],
  [/A 加一張 10 點牌，也算 Blackjack/, '分出來的 A 加 10 點牌也算 Blackjack'],
  [/荷官不偷看底牌/, '荷官不偷看底牌'],
  [/連加倍、分牌多押的也一起輸/, '荷官 Blackjack 時多押的一起輸'],
  [/也是 21 點時算平手/, '21 點跟荷官的 Blackjack 平手'],
];
function ruleProblems(md) {
  const rules = section(md, '規則');
  if (rules === null) return ['少了〈規則〉'];
  return RULE_LINES.filter(([re]) => !re.test(rules)).map(([, what]) => `〈規則〉沒寫${what}`);
}

test('README〈規則〉寫的下注、加倍、分牌、荷官 Blackjack，就是牌局現在的預設規則', () => {
  const keys = ['maxBet', 'doubleOn', 'splitBy', 'splitOneCard', 'splitBlackjack', 'maxHands', 'peek', 'dealerBlackjackTakes', 'dealerBlackjackPush'];
  assert.deepStrictEqual(Object.fromEntries(keys.map(k => [k, DEFAULTS[k]])), {
    maxBet: Infinity, doubleOn: [10, 11], splitBy: 'value', splitOneCard: false, splitBlackjack: true, maxHands: Infinity,
    peek: false, dealerBlackjackTakes: 'all', dealerBlackjackPush: 'any21',
  }, 'game.js 的預設規則改了：README〈規則〉要照實改寫，這支的 RULE_LINES 也要跟著改');
  assert.deepStrictEqual(ruleProblems(README), []);
});

test('陽性對照：刪掉〈規則〉裡加倍那一條、荷官不偷看那一條，都要判紅', () => {
  const without = word => README.split(/\r?\n/).filter(l => !l.includes(word)).join('\n');
  assert.deepStrictEqual(ruleProblems(without('才能加倍')), ['〈規則〉沒寫加倍只准頭兩張 10、11 點']);
  assert.deepStrictEqual(ruleProblems(without('荷官不偷看底牌')),
    ['〈規則〉沒寫荷官不偷看底牌', '〈規則〉沒寫荷官 Blackjack 時多押的一起輸', '〈規則〉沒寫21 點跟荷官的 Blackjack 平手']);
});

test('陽性對照：刪掉兩份籌碼那句、或整節〈遇到問題〉，都要判紅', () => {
  const noSplit = README.split(/\r?\n/).filter(l => !(l.includes('網址') && l.includes('雙擊'))).join('\n');
  assert.deepStrictEqual(problems(noSplit), ['〈籌碼存在哪〉沒講網址開和雙擊開各記各的']);
  const noHelp = README.replace(/^## 遇到問題[\s\S]*?(?=^## )/m, '');
  assert.deepStrictEqual(problems(noHelp), ['少了〈遇到問題〉']);
});
