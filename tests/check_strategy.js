// 穩健型的答案逐格寫死，都不從程式反推：硬牌、軟牌照 6 副牌、莊家軟 17 停的公開基本策略表抄，分牌表與 11 對 10
// 照 v0.11.0 規則（荷官不偷看、多押的一起輸、21 點平手）逐張扣牌算的結果（版本紀錄 v0.11.0）。
// 跟公開表不同的三格：11 對 10 要牌、8+8 對 10 與 A 不分
const test = require('node:test');
const assert = require('node:assert');
const { decide, bet } = require('../app/js/core/strategy.js');
const { DEFAULTS } = require('../app/js/core/game.js');
const { rng } = require('./rng_util');

const h = (...ranks) => ranks.map(rank => ({ rank, suit: 'S' }));
const up = rank => ({ rank, suit: 'H' });
const ANY = ['hit', 'stand', 'double'];            // 頭兩張任何點數都能加倍（doubleOn: 'any'）
const NO_DOUBLE = ['hit', 'stand'];
const PAIR = ['hit', 'stand', 'split'];
const REPAIR = ['stand', 'split'];                  // 只補一張的手（A）又補到 A：只能再分或停
const UPS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const name = cards => cards.map(c => c.rank).join('+');

function check(personality, cases, legal) {
  for (const [cards, d, want] of cases) {
    assert.strictEqual(decide(personality, cards, up(d), legal), want, `${name(cards)} 對 ${d}（可以：${legal.join('、')}）`);
  }
}

test('穩健：硬牌（能加倍時照表加倍）', () => {
  check('steady', [
    [h('10', '7'), 'A', 'stand'], [h('10', '6'), '6', 'stand'], [h('10', '6'), '7', 'hit'], [h('10', '6'), 'K', 'hit'],
    [h('9', '4'), '2', 'stand'], [h('9', '4'), '7', 'hit'],
    [h('10', '2'), '3', 'hit'], [h('10', '2'), '4', 'stand'], [h('10', '2'), '6', 'stand'], [h('10', '2'), '7', 'hit'],
    [h('6', '5'), '6', 'double'], [h('6', '5'), '9', 'double'], [h('6', '5'), '10', 'hit'], [h('6', '5'), 'A', 'hit'],
    [h('7', '4'), '10', 'hit'], [h('9', '2'), 'K', 'hit'],
    [h('6', '4'), '9', 'double'], [h('6', '4'), '10', 'hit'], [h('6', '4'), 'A', 'hit'],
    [h('5', '4'), '2', 'hit'], [h('5', '4'), '3', 'double'], [h('5', '4'), '6', 'double'], [h('5', '4'), '7', 'hit'],
    [h('5', '3'), '6', 'hit'],
  ], ANY);
});

test('穩健：軟牌（能加倍時照表加倍）', () => {
  check('steady', [
    [h('A', '8'), '6', 'stand'], [h('A', '9'), 'A', 'stand'],
    [h('A', '7'), '2', 'stand'], [h('A', '7'), '3', 'double'], [h('A', '7'), '6', 'double'],
    [h('A', '7'), '7', 'stand'], [h('A', '7'), '8', 'stand'], [h('A', '7'), '9', 'hit'], [h('A', '7'), 'A', 'hit'],
    [h('A', '6'), '2', 'hit'], [h('A', '6'), '3', 'double'], [h('A', '6'), '7', 'hit'],
    [h('A', '5'), '3', 'hit'], [h('A', '5'), '4', 'double'], [h('A', '4'), '6', 'double'],
    [h('A', '3'), '4', 'hit'], [h('A', '3'), '5', 'double'], [h('A', '2'), '6', 'double'], [h('A', '2'), '7', 'hit'],
    // A+A 不能分（籌碼不夠）時，答案來自逐張扣牌的精確計算（v0.7.2 版本紀錄）
    [h('A', 'A'), '5', 'hit'], [h('A', 'A'), '6', 'double'], [h('A', 'A'), '7', 'hit'],
  ], ANY);
});

test('穩健：定案的規則只有 10、11 點能加倍，9 點與軟牌照表的另一個字要或停', () => {
  check('steady', [
    [h('5', '4'), '3', 'hit'], [h('5', '4'), '6', 'hit'], [h('A', '7'), '3', 'stand'], [h('A', '7'), '6', 'stand'],
    [h('A', '6'), '3', 'hit'], [h('A', '2'), '6', 'hit'], [h('A', 'A'), '6', 'hit'],
  ], NO_DOUBLE);
  check('steady', [[h('6', '5'), '6', 'double'], [h('6', '4'), '9', 'double'], [h('6', '5'), '10', 'hit'], [h('6', '5'), 'A', 'hit'], [h('6', '4'), '10', 'hit']],
    ['hit', 'stand', 'double']);
  assert.strictEqual(decide('steady', h('2', '3', '6'), up('6'), NO_DOUBLE), 'hit');
});

// A 以外分完照一般打法、10／11 能加倍、再分不限手數；A 只補一張；分後 A＋10 點牌賠 1.5 倍；荷官不偷看（逐張扣牌算過）：
// A 全分；8 對 2–9；2、3、7 對 2–7；6 對 2–6；4 只對 5、6；9 對 2–6 與 8、9；5、10 怎樣都不分
test('穩健：分牌表（v0.11.0 規則逐張扣牌算過）', () => {
  const want = {
    A: UPS, 8: ['2', '3', '4', '5', '6', '7', '8', '9'], 2: ['2', '3', '4', '5', '6', '7'], 3: ['2', '3', '4', '5', '6', '7'], 7: ['2', '3', '4', '5', '6', '7'],
    6: ['2', '3', '4', '5', '6'], 4: ['5', '6'], 9: ['2', '3', '4', '5', '6', '8', '9'],
  };
  for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'K']) {
    const legal = r === '5' ? ['hit', 'stand', 'double', 'split'] : PAIR;
    for (const d of UPS) {
      const split = decide('steady', h(r, r), up(d), legal) === 'split';
      assert.strictEqual(split, (want[r] || []).includes(d), `${r}+${r} 對 ${d}`);
    }
  }
  // 不分的時候照硬牌、軟牌的表
  check('steady', [
    [h('9', '9'), '7', 'stand'], [h('9', '9'), '10', 'stand'], [h('9', '9'), 'A', 'stand'], [h('7', '7'), '8', 'hit'],
    [h('8', '8'), '10', 'hit'], [h('8', '8'), 'A', 'hit'],
    [h('6', '6'), '7', 'hit'], [h('4', '4'), '4', 'hit'], [h('4', '4'), '7', 'hit'], [h('3', '3'), '8', 'hit'],
    [h('2', '2'), '8', 'hit'], [h('10', '10'), '6', 'stand'], [h('K', 'Q'), '6', 'stand'],
  ], PAIR);
  check('steady', [[h('5', '5'), '9', 'double'], [h('5', '5'), '10', 'hit']], ['hit', 'stand', 'double', 'split']);
  // 籌碼不夠分（沒有分牌可選）時照硬牌表：8+8 是 16、7+7 是 14
  check('steady', [[h('8', '8'), '6', 'stand'], [h('8', '8'), '10', 'hit'], [h('7', '7'), '6', 'stand']], NO_DOUBLE);
});

// A 以外分完照一般打法，又成對時能做的動作跟頭兩張一樣，策略分不出來，照同一張表就對了。
// 只補一張的手（A，或把 splitOneCard 設成 true 時的每一種對子）又成對時沒有要牌：表上說分就分，不分就停
test('穩健：只補一張的手又成對、只能再分或停時，照同一張分牌表，不分就停', () => {
  for (const d of UPS) assert.strictEqual(decide('steady', h('A', 'A'), up(d), REPAIR), 'split', `A+A 對 ${d}`);
  check('steady', [
    [h('8', '8'), '9', 'split'], [h('8', '8'), '10', 'stand'], [h('9', '9'), '7', 'stand'], [h('9', '9'), '8', 'split'], [h('2', '2'), '8', 'stand'],
    [h('5', '5'), '6', 'stand'], [h('10', '10'), '6', 'stand'],
  ], REPAIR);
  assert.strictEqual(decide('steady', h('A', 'A'), up('6'), ['stand']), 'stand');
  assert.strictEqual(decide('steady', h('8', '8'), up('6'), ['stand']), 'stand');
});

test('穩健：不能加倍時，「加倍或停」改停、「加倍或要」改要；籌碼不夠分的 A+A 照軟 12 打', () => {
  assert.strictEqual(decide('steady', h('A', '7'), up('4'), NO_DOUBLE), 'stand');
  assert.strictEqual(decide('steady', h('6', '5'), up('6'), NO_DOUBLE), 'hit');
  assert.strictEqual(decide('steady', h('2', '3', '6'), up('6'), NO_DOUBLE), 'hit');
  assert.strictEqual(decide('steady', h('A', 'A'), up('6'), NO_DOUBLE), 'hit');
});

test('莽撞：16 點以下都要牌、能加倍的 9–11 點一律加倍、10 點牌以外的對子都分（分完又成對照樣再分）', () => {
  assert.strictEqual(decide('reckless', h('10', '6'), up('5'), NO_DOUBLE), 'hit');
  assert.strictEqual(decide('reckless', h('10', '7'), up('A'), NO_DOUBLE), 'stand');
  assert.strictEqual(decide('reckless', h('5', '4'), up('A'), ANY), 'double');
  assert.strictEqual(decide('reckless', h('5', '4'), up('A'), NO_DOUBLE), 'hit');
  assert.strictEqual(decide('reckless', h('6', '5'), up('A'), ['hit', 'stand', 'double']), 'double');
  assert.strictEqual(decide('reckless', h('A', '7'), up('2'), ANY), 'hit');
  for (const r of ['A', '2', '3', '4', '6', '7', '8', '9']) {
    assert.strictEqual(decide('reckless', h(r, r), up('10'), PAIR), 'split', `${r}+${r}`);
    assert.strictEqual(decide('reckless', h(r, r), up('10'), REPAIR), 'split', `再成對 ${r}+${r}`);
  }
  assert.strictEqual(decide('reckless', h('K', 'Q'), up('6'), PAIR), 'stand');
  assert.strictEqual(decide('reckless', h('5', '5'), up('6'), ['hit', 'stand', 'double', 'split']), 'double');
  assert.strictEqual(decide('reckless', h('5', '5'), up('6'), REPAIR), 'split');
});

test('膽小：硬牌 12 點就停、從不加倍、只分 A 與 8（再成對照樣分）', () => {
  assert.strictEqual(decide('timid', h('10', '2'), up('A'), ANY), 'stand');
  assert.strictEqual(decide('timid', h('6', '5'), up('6'), ANY), 'hit');
  assert.strictEqual(decide('timid', h('A', '6'), up('10'), ANY), 'hit');
  assert.strictEqual(decide('timid', h('A', '7'), up('10'), ANY), 'stand');
  assert.strictEqual(decide('timid', h('A', 'A'), up('10'), PAIR), 'split');
  assert.strictEqual(decide('timid', h('8', '8'), up('A'), PAIR), 'split');
  assert.strictEqual(decide('timid', h('9', '9'), up('6'), PAIR), 'stand');
  assert.strictEqual(decide('timid', h('2', '2'), up('6'), PAIR), 'hit');
  assert.strictEqual(decide('timid', h('A', 'A'), up('6'), REPAIR), 'split');
  assert.strictEqual(decide('timid', h('9', '9'), up('6'), REPAIR), 'stand');
  assert.strictEqual(decide('timid', h('8', '8'), up('6'), ['hit', 'stand']), 'stand');
});

test('沒給能做的動作就擲錯，免得策略自己假設能加倍或分牌', () => {
  assert.throws(() => decide('steady', h('8', '8'), up('6'), true), /legal/);
  assert.throws(() => decide('steady', h('8', '8'), up('6'), []), /legal/);
  assert.throws(() => decide('nobody', h('8', '8'), up('6'), PAIR), /沒有這種個性/);
});

test('下注：以 10 為單位、不超過籌碼（有上限時也不超過上限）、不夠最低注就不下', () => {
  const limits = { minBet: 10, maxBet: 1000, step: 10 };
  const fixed = () => 0.5;
  assert.strictEqual(bet('steady', 1000, fixed, limits), 50);
  assert.strictEqual(bet('timid', 1000, fixed, limits), 10);
  assert.strictEqual(bet('reckless', 1000, fixed, limits), 200);
  assert.strictEqual(bet('reckless', 50000, fixed, limits), 1000);
  assert.strictEqual(bet('steady', 15, fixed, limits), 10);
  assert.strictEqual(bet('steady', 9, fixed, limits), 0);
  // 預設不設上限：大注照籌碼比例押（兩成），押一半的那一下押到一半，最多押到全部籌碼
  assert.strictEqual(DEFAULTS.maxBet, Infinity);
  assert.strictEqual(bet('reckless', 50000, fixed, DEFAULTS), 10000);
  assert.strictEqual(bet('reckless', 50000, () => 0.01, DEFAULTS), 25000);
  assert.strictEqual(bet('steady', 50000, fixed, DEFAULTS), 2500);
  assert.strictEqual(bet('reckless', 35, () => 0.01, DEFAULTS), 10);
});

// ---- 牌局裡會傳 rng：人性化的隨機 ----
const N = 4000;
function tally(personality, cards, d, legal, seed = 1) {
  const r = rng(seed), count = {};
  for (let i = 0; i < N; i++) {
    const a = decide(personality, cards, up(d), legal, r);
    count[a] = (count[a] || 0) + 1;
  }
  return count;
}

test('帶亂數時，邊界上的牌會出現不同決定，比例落在設定附近', () => {
  // [個性, 手牌, 莊家明牌, 能做的動作, 要量的那個決定, 設定的比例]；容許 ±3%，約是四千次抽樣標準差的四倍以上
  const cases = [
    ['reckless', h('10', '7'), '7', NO_DOUBLE, 'hit', 0.35],
    ['reckless', h('10', '6'), '7', NO_DOUBLE, 'stand', 0.15],
    ['reckless', h('6', '5'), 'A', ['hit', 'stand', 'double'], 'hit', 0.15],
    ['reckless', h('8', '8'), '7', PAIR, 'split', 0.9],
    ['reckless', h('K', 'Q'), '7', PAIR, 'split', 0.2],
    ['timid', h('10', '2'), '7', NO_DOUBLE, 'hit', 0.25],
    ['timid', h('A', '6'), '7', NO_DOUBLE, 'hit', 0.4],
    ['timid', h('8', '8'), '7', PAIR, 'split', 0.7],
    ['steady', h('10', '6'), '10', NO_DOUBLE, 'stand', 0.08],
    ['steady', h('6', '5'), '6', ['hit', 'stand', 'double'], 'hit', 0.1],
  ];
  for (const [p, cards, d, legal, decision, rate] of cases) {
    const c = tally(p, cards, d, legal);
    const share = (c[decision] || 0) / N;
    assert.ok(Math.abs(share - rate) < 0.03, `${p} ${name(cards)} 對 ${d}：「${decision}」佔 ${share.toFixed(3)}，設定 ${rate}（${JSON.stringify(c)}）`);
  }
});

test('帶亂數時也不做明顯的蠢事，而且只挑能做的動作', () => {
  const hard = t => (t <= 11 ? h('2', String(t - 2)) : t <= 20 ? h('10', String(t - 10)) : h('10', '6', '5'));
  const soft = t => (t === 12 ? h('A', 'A') : h('A', String(t - 11)));
  const r = rng(9);
  const bad = [];
  const ask = (p, cards, d, legal) => {
    const a = decide(p, cards, up(d), legal, r);
    if (!legal.includes(a)) bad.push(`${p} ${name(cards)} 對 ${d} 做了不能做的 ${a}（可以：${legal.join('、')}）`);
    return a;
  };
  for (const p of ['steady', 'reckless', 'timid']) {
    for (const d of ['2', '6', '7', '10', 'A']) {
      for (const legal of [ANY, NO_DOUBLE]) {
        for (let k = 0; k < 200; k++) {
          for (let t = 5; t <= 21; t++) {
            const a = ask(p, hard(t), d, legal);
            if (t >= 19 && a !== 'stand') bad.push(`${p} 硬 ${t} ${a}`);
            if (p === 'timid' && (a === 'double' || (t >= 14 && a !== 'stand'))) bad.push(`膽小 硬 ${t} ${a}`);
            if (p === 'steady' && t <= 11 && a === 'stand') bad.push(`穩健 硬 ${t} 停`);
            if (p === 'reckless' && t <= 15 && a === 'stand') bad.push(`莽撞 硬 ${t} 停`);
          }
          for (let t = 12; t <= 21; t++) {
            const a = ask(p, soft(t), d, legal);
            if (t >= 19 && a !== 'stand') bad.push(`${p} 軟 ${t} ${a}`);
            if (t <= 16 && a === 'stand') bad.push(`${p} 軟 ${t} 就停`);
          }
        }
      }
      // 對子：能分的時候、與分完又成對只能再分或停的時候
      for (const r2 of ['A', '2', '5', '8', '9', '10', 'K']) {
        for (let k = 0; k < 100; k++) {
          const a = ask(p, h(r2, r2), d, PAIR);
          const again = ask(p, h(r2, r2), d, REPAIR);
          if (p === 'timid' && (a === 'split' || again === 'split') && !['A', '8'].includes(r2)) bad.push(`膽小 分了 ${r2}+${r2}`);
          if (p === 'steady' && ['5', '10', 'K'].includes(r2) && (a === 'split' || again === 'split')) bad.push(`穩健 分了 ${r2}+${r2}`);
        }
      }
    }
  }
  assert.deepStrictEqual([...new Set(bad)], []);
});

test('帶亂數的下注：會變化、以 10 為單位、不超出範圍，膽小只下最低注或兩倍', () => {
  const r = rng(5);
  for (const limits of [{ minBet: 10, maxBet: 1000, step: 10 }, DEFAULTS]) {
    for (const [p, bank] of [['steady', 1000], ['reckless', 1000], ['timid', 1000], ['reckless', 120], ['reckless', 20000]]) {
      const seen = new Set();
      for (let i = 0; i < 2000; i++) {
        const b = bet(p, bank, r, limits);
        assert.ok(b % 10 === 0 && b >= 10 && b <= Math.min(limits.maxBet, bank), `${p} 籌碼 ${bank} 上限 ${limits.maxBet} 下了 ${b}`);
        seen.add(b);
      }
      if (p === 'timid') assert.deepStrictEqual([...seen].sort((a, b) => a - b), [10, 20]);
      else assert.ok(seen.size >= 4 || (bank > 1000 && limits.maxBet === 1000), `${p} 籌碼 ${bank} 只下過 ${[...seen].join('、')}`);
      // 不設上限時，兩萬籌碼的大注會超過舊上限 1,000（押一半的那一下押到一萬）
      if (bank === 20000 && limits.maxBet === Infinity) assert.strictEqual(Math.max(...seen), 10000, `莽撞 兩萬籌碼最大注 ${Math.max(...seen)}`);
    }
  }
});
