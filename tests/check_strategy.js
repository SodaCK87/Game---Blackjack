// 穩健型的答案照 6 副牌、莊家軟 17 停的公開基本策略表逐格抄，不從程式反推
const test = require('node:test');
const assert = require('node:assert');
const { decide, bet } = require('../app/js/core/strategy.js');

const h = (...ranks) => ranks.map(rank => ({ rank, suit: 'S' }));
const up = rank => ({ rank, suit: 'H' });

test('穩健：硬牌', () => {
  const cases = [
    [h('10', '7'), 'A', 'stand'], [h('10', '6'), '6', 'stand'], [h('10', '6'), '7', 'hit'], [h('10', '6'), 'K', 'hit'],
    [h('9', '4'), '2', 'stand'], [h('9', '4'), '7', 'hit'],
    [h('10', '2'), '3', 'hit'], [h('10', '2'), '4', 'stand'], [h('10', '2'), '6', 'stand'], [h('10', '2'), '7', 'hit'],
    [h('6', '5'), '6', 'double'], [h('6', '5'), '10', 'double'], [h('6', '5'), 'A', 'hit'],
    [h('6', '4'), '9', 'double'], [h('6', '4'), '10', 'hit'], [h('6', '4'), 'A', 'hit'],
    [h('5', '4'), '2', 'hit'], [h('5', '4'), '3', 'double'], [h('5', '4'), '6', 'double'], [h('5', '4'), '7', 'hit'],
    [h('5', '3'), '6', 'hit'],
  ];
  for (const [cards, d, want] of cases) {
    assert.strictEqual(decide('steady', cards, up(d), true), want, `${cards.map(c => c.rank).join('+')} 對 ${d}`);
  }
});

test('穩健：軟牌', () => {
  const cases = [
    [h('A', '8'), '6', 'stand'], [h('A', '9'), 'A', 'stand'],
    [h('A', '7'), '2', 'stand'], [h('A', '7'), '3', 'double'], [h('A', '7'), '6', 'double'],
    [h('A', '7'), '7', 'stand'], [h('A', '7'), '8', 'stand'], [h('A', '7'), '9', 'hit'], [h('A', '7'), 'A', 'hit'],
    [h('A', '6'), '2', 'hit'], [h('A', '6'), '3', 'double'], [h('A', '6'), '7', 'hit'],
    [h('A', '5'), '3', 'hit'], [h('A', '5'), '4', 'double'], [h('A', '4'), '6', 'double'],
    [h('A', '3'), '4', 'hit'], [h('A', '3'), '5', 'double'], [h('A', '2'), '6', 'double'], [h('A', '2'), '7', 'hit'],
    [h('A', 'A'), '6', 'hit'],
  ];
  for (const [cards, d, want] of cases) {
    assert.strictEqual(decide('steady', cards, up(d), true), want, `${cards.map(c => c.rank).join('+')} 對 ${d}`);
  }
});

test('穩健：不能加倍時，「加倍或停」改停、「加倍或要」改要', () => {
  assert.strictEqual(decide('steady', h('A', '7'), up('4'), false), 'stand');
  assert.strictEqual(decide('steady', h('6', '5'), up('6'), false), 'hit');
  assert.strictEqual(decide('steady', h('2', '3', '6'), up('6'), false), 'hit');
});

test('莽撞：16 點以下都要牌、9–11 點一律加倍', () => {
  assert.strictEqual(decide('reckless', h('10', '6'), up('5'), true), 'hit');
  assert.strictEqual(decide('reckless', h('10', '7'), up('A'), true), 'stand');
  assert.strictEqual(decide('reckless', h('5', '4'), up('A'), true), 'double');
  assert.strictEqual(decide('reckless', h('5', '4'), up('A'), false), 'hit');
  assert.strictEqual(decide('reckless', h('A', '7'), up('2'), true), 'hit');
});

test('膽小：硬牌 12 點就停、從不加倍', () => {
  assert.strictEqual(decide('timid', h('10', '2'), up('A'), true), 'stand');
  assert.strictEqual(decide('timid', h('6', '5'), up('6'), true), 'hit');
  assert.strictEqual(decide('timid', h('A', '6'), up('10'), true), 'hit');
  assert.strictEqual(decide('timid', h('A', '7'), up('10'), true), 'stand');
});

test('下注：以 10 為單位、不超過籌碼與上限、不夠最低注就不下', () => {
  const limits = { minBet: 10, maxBet: 1000, step: 10 };
  const fixed = () => 0.5;
  assert.strictEqual(bet('steady', 1000, fixed, limits), 50);
  assert.strictEqual(bet('timid', 1000, fixed, limits), 10);
  assert.strictEqual(bet('reckless', 1000, fixed, limits), 200);
  assert.strictEqual(bet('reckless', 50000, fixed, limits), 1000);
  assert.strictEqual(bet('steady', 15, fixed, limits), 10);
  assert.strictEqual(bet('steady', 9, fixed, limits), 0);
});
