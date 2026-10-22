// 穩健型的答案照 6 副牌、莊家軟 17 停的公開基本策略表逐格抄，不從程式反推
const test = require('node:test');
const assert = require('node:assert');
const { decide, bet } = require('../app/js/core/strategy.js');
const { rng } = require('./rng_util');

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

// ---- 牌局裡會傳 rng：人性化的隨機 ----
const N = 4000;
function tally(personality, cards, d, canDouble, seed = 1) {
  const r = rng(seed), count = {};
  for (let i = 0; i < N; i++) {
    const a = decide(personality, cards, up(d), canDouble, r);
    count[a] = (count[a] || 0) + 1;
  }
  return count;
}

test('帶亂數時，邊界上的牌會出現不同決定，比例落在設定附近', () => {
  // [個性, 手牌, 莊家明牌, 少數派的決定, 設定的比例]；容許 ±3%，約是四千次抽樣標準差的四倍以上
  const cases = [
    ['reckless', h('10', '7'), '7', 'hit', 0.35],
    ['reckless', h('10', '6'), '7', 'stand', 0.15],
    ['reckless', h('5', '4'), 'A', 'hit', 0.15],
    ['timid', h('10', '2'), '7', 'hit', 0.25],
    ['timid', h('A', '6'), '7', 'hit', 0.4],
    ['steady', h('10', '6'), '10', 'stand', 0.08],
    ['steady', h('6', '5'), '6', 'hit', 0.1],
  ];
  for (const [p, cards, d, minority, rate] of cases) {
    const c = tally(p, cards, d, true);
    const share = (c[minority] || 0) / N;
    assert.ok(Math.abs(share - rate) < 0.03, `${p} ${cards.map(x => x.rank).join('+')} 對 ${d}：「${minority}」佔 ${share.toFixed(3)}，設定 ${rate}（${JSON.stringify(c)}）`);
  }
});

test('帶亂數時也不做明顯的蠢事', () => {
  const hard = t => (t <= 11 ? h('2', String(t - 2)) : t <= 20 ? h('10', String(t - 10)) : h('10', '6', '5'));
  const soft = t => (t === 12 ? h('A', 'A') : h('A', String(t - 11)));
  const r = rng(9);
  const bad = [];
  for (const p of ['steady', 'reckless', 'timid']) {
    for (const d of ['2', '6', '7', '10', 'A']) {
      for (const canDouble of [true, false]) {
        for (let k = 0; k < 200; k++) {
          for (let t = 5; t <= 21; t++) {
            const a = decide(p, hard(t), up(d), canDouble, r);
            if (t >= 19 && a !== 'stand') bad.push(`${p} 硬 ${t} ${a}`);
            if (!canDouble && a === 'double') bad.push(`${p} 不能加倍卻加倍`);
            if (p === 'timid' && (a === 'double' || (t >= 14 && a !== 'stand'))) bad.push(`膽小 硬 ${t} ${a}`);
            if (p === 'steady' && t <= 11 && a === 'stand') bad.push(`穩健 硬 ${t} 停`);
            if (p === 'reckless' && t <= 15 && a === 'stand') bad.push(`莽撞 硬 ${t} 停`);
          }
          for (let t = 12; t <= 21; t++) {
            const a = decide(p, soft(t), up(d), canDouble, r);
            if (t >= 19 && a !== 'stand') bad.push(`${p} 軟 ${t} ${a}`);
            if (t <= 16 && a === 'stand') bad.push(`${p} 軟 ${t} 就停`);
          }
        }
      }
    }
  }
  assert.deepStrictEqual([...new Set(bad)], []);
});

test('帶亂數的下注：會變化、以 10 為單位、不超出範圍，膽小只下最低注或兩倍', () => {
  const limits = { minBet: 10, maxBet: 1000, step: 10 };
  const r = rng(5);
  for (const [p, bank] of [['steady', 1000], ['reckless', 1000], ['timid', 1000], ['reckless', 120]]) {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const b = bet(p, bank, r, limits);
      assert.ok(b % 10 === 0 && b >= 10 && b <= Math.min(1000, bank), `${p} 籌碼 ${bank} 下了 ${b}`);
      seen.add(b);
    }
    if (p === 'timid') assert.deepStrictEqual([...seen].sort((a, b) => a - b), [10, 20]);
    else assert.ok(seen.size >= 4, `${p} 籌碼 ${bank} 只下過 ${[...seen].join('、')}`);
  }
});
