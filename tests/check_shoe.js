const test = require('node:test');
const assert = require('node:assert');
const { createShoe } = require('../app/js/core/shoe.js');
const { rng } = require('./rng_util');

test('6 副牌共 312 張，每種牌剛好 6 張', () => {
  const shoe = createShoe({ decks: 6, rng: rng(1) });
  const count = new Map();
  while (shoe.remaining) {
    const c = shoe.draw();
    count.set(c.rank + c.suit, (count.get(c.rank + c.suit) || 0) + 1);
  }
  assert.strictEqual(shoe.size, 312);
  assert.strictEqual(count.size, 52);
  assert.ok([...count.values()].every(n => n === 6));
});

test('同一個種子洗出同一副牌，不同種子不同', () => {
  const order = seed => { const s = createShoe({ rng: rng(seed) }); return Array.from({ length: 20 }, () => s.draw().rank).join(','); };
  assert.strictEqual(order(7), order(7));
  assert.notStrictEqual(order(7), order(8));
});

test('發到 75% 才要求重洗', () => {
  const shoe = createShoe({ decks: 6, penetration: 0.75, rng: rng(2) });
  for (let i = 0; i < 233; i++) shoe.draw();
  assert.strictEqual(shoe.needsShuffle(), false);
  shoe.draw();
  assert.strictEqual(shoe.needsShuffle(), true, '第 234 張（312×0.75）發出後要重洗');
  shoe.shuffle();
  assert.strictEqual(shoe.needsShuffle(), false);
  assert.strictEqual(shoe.remaining, 312);
});

test('牌靴發光時要先回收棄牌才能再發', () => {
  const shoe = createShoe({ decks: 1, rng: rng(3) });
  const all = [];
  while (shoe.remaining) all.push(shoe.draw());
  assert.throws(() => shoe.draw(), /牌靴空了/);
  shoe.discard(all.slice(0, 10));
  shoe.recycle();
  assert.strictEqual(shoe.remaining, 10);
});

test('沒給亂數函式就拒絕建立（core 不准自己呼叫 Math.random）', () => {
  assert.throws(() => createShoe({ decks: 6 }), /亂數/);
});
