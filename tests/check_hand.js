const test = require('node:test');
const assert = require('node:assert');
const { value } = require('../app/js/core/hand.js');

const h = (...ranks) => ranks.map(rank => ({ rank, suit: 'S' }));

test('A 與 10 點牌兩張就是 Blackjack（軟 21）', () => {
  for (const ten of ['10', 'J', 'Q', 'K']) {
    assert.deepStrictEqual(value(h('A', ten)), { total: 21, soft: true, bust: false, blackjack: true });
  }
});

test('三張湊到 21 不算 Blackjack', () => {
  assert.deepStrictEqual(value(h('7', '7', '7')), { total: 21, soft: false, bust: false, blackjack: false });
  assert.strictEqual(value(h('A', '5', '5')).blackjack, false);
});

test('A 會自動在 1 與 11 之間選不爆的那個', () => {
  assert.deepStrictEqual(value(h('A', 'A')), { total: 12, soft: true, bust: false, blackjack: false });
  assert.deepStrictEqual(value(h('A', '6')), { total: 17, soft: true, bust: false, blackjack: false });
  assert.deepStrictEqual(value(h('A', '6', '10')), { total: 17, soft: false, bust: false, blackjack: false });
  assert.deepStrictEqual(value(h('A', 'A', '9')), { total: 21, soft: true, bust: false, blackjack: false });
  assert.deepStrictEqual(value(h('A', 'A', 'A', 'A', '7')), { total: 21, soft: true, bust: false, blackjack: false });
});

test('超過 21 點是爆牌', () => {
  assert.deepStrictEqual(value(h('10', '6', 'K')), { total: 26, soft: false, bust: true, blackjack: false });
  assert.strictEqual(value(h('A', '9', '5', '10')).bust, true);
});
