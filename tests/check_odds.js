// 勝率提示的數字要對：拿「真的一張一張從剩下的牌抽」的模擬去對 odds.js 的計算。
// 模擬照實際牌局的順序：底牌先發（荷官偷看過，補成 Blackjack 的那幾局整局丟掉不算）、玩家先抽、荷官最後補牌。
const test = require('node:test');
const assert = require('node:assert');
const { forHand } = require('../app/js/core/odds.js');
const { value, rankValue } = require('../app/js/core/hand.js');
const { freshDecks } = require('../app/js/core/shoe.js');
const { DEFAULTS } = require('../app/js/core/game.js');
const { rng } = require('./rng_util');

const c = (rank, suit = 'S') => ({ rank, suit });
const SUITS = ['S', 'H', 'D', 'C'];
const many = (rank, n) => Array.from({ length: n }, (_, i) => c(rank, SUITS[i % 4]));
const ALL3 = ['hit', 'stand', 'double'];

function pool(seen) {
  const cards = freshDecks(6);
  for (const s of seen) {
    const i = cards.findIndex(x => x.rank === s.rank && x.suit === s.suit);
    assert.ok(i >= 0, `牌靴裡已經沒有 ${s.rank}${s.suit}`);
    cards.splice(i, 1);
  }
  return cards;
}

// 每局從牌堆尾端做部分洗牌，抽出來的牌留在原陣列裡，牌堆的組成每局都一樣
function dealer(cards, r) {
  let end = cards.length;
  return () => { const j = Math.floor(r() * end); end--; [cards[j], cards[end]] = [cards[end], cards[j]]; return cards[end]; };
}
function finishDealer(up, hole, draw) {
  const d = [up, hole];
  while (value(d).total < 17) d.push(draw());
  return value(d);
}
const outcome = (mine, d) => (mine.bust ? 'lose' : d.bust || mine.total > d.total ? 'win' : mine.total === d.total ? 'push' : 'lose');
// 照 policy 要牌直到停（policy 是 odds.js 算出來的每個點數停或要）
function hitOut(me, policy, draw) {
  for (;;) {
    const v = value(me);
    if (v.bust || v.total >= 21 || policy[`${v.soft ? 's' : 'h'}${v.total}`] !== 'hit') return me;
    me.push(draw());
  }
}

function simulate({ hand, up, seen, action, policy, n, seed }) {
  const cards = pool(seen);
  const r = rng(seed);
  const t = { win: 0, push: 0, lose: 0 };
  let kept = 0;
  for (let trial = 0; trial < n; trial++) {
    const draw = dealer(cards, r);
    const hole = draw();
    if (value([up, hole]).blackjack) continue;
    kept++;
    let me = hand.slice();
    if (action === 'double') me.push(draw());
    if (action === 'hit') { me.push(draw()); me = hitOut(me, policy, draw); }
    const mine = value(me);
    if (mine.bust) { t.lose++; continue; }
    t[outcome(mine, finishDealer(up, hole, draw))]++;
  }
  return { win: t.win / kept, push: t.push / kept, lose: t.lose / kept };
}

// 分牌：兩手各從一張開始，補到同一種牌照計算的決定再分；每一手照規則補牌（只補一張，或照 odds.js 的打法打完）。
// 回傳每一手平均的勝平輸、每局的期望值（加倍的手算兩份）、平均分成幾手
function simulateSplit({ hand, up, seen, rules, o, n, seed }) {
  const cards = pool(seen);
  const r = rng(seed);
  const x = hand[0];
  const repair = card => (rules.splitBy === 'rank' ? card.rank === x.rank : rankValue(card.rank) === rankValue(x.rank));
  const oneCard = rules.splitOneCard || x.rank === 'A';
  const plays = new Map();   // 一般打法：兩張牌的那一手照 odds.js 對它算出的最佳動作
  const playOf = two => {
    const k = two.map(q => q.rank).join('+');
    if (!plays.has(k)) {
      const v = value(two);
      const canDbl = rules.doubleOn === 'any' || (!v.soft && rules.doubleOn.includes(v.total));
      plays.set(k, forHand({ hand: two, up, seen, legal: ['hit', 'stand'].concat(canDbl ? ['double'] : []) }));
    }
    return plays.get(k);
  };
  const t = { win: 0, push: 0, lose: 0 };
  let kept = 0, totalHands = 0, payoff = 0;
  for (let trial = 0; trial < n; trial++) {
    const draw = dealer(cards, r);
    const hole = draw();
    if (value([up, hole]).blackjack) continue;
    kept++;
    const pending = [[x], [x]], done = [];
    let made = 2;
    while (pending.length) {
      const me = pending.shift();
      me.push(draw());
      if (repair(me[1]) && o.split.resplit && made < rules.maxHands) { made++; pending.unshift([x], [x]); continue; }
      if (oneCard) { done.push({ cards: me, k: 1 }); continue; }
      const best = playOf(me).best;
      if (best === 'double') { me.push(draw()); done.push({ cards: me, k: 2 }); }
      else if (best === 'hit') { me.push(draw()); done.push({ cards: hitOut(me, playOf(me.slice(0, 2)).policy, draw), k: 1 }); }
      else done.push({ cards: me, k: 1 });
    }
    const d = finishDealer(up, hole, draw);
    for (const h of done) {
      const res = outcome(value(h.cards), d);
      t[res]++;
      payoff += h.k * (res === 'win' ? 1 : res === 'lose' ? -1 : 0);
    }
    totalHands += done.length;
  }
  return { win: t.win / totalHands, push: t.push / totalHands, lose: t.lose / totalHands, ev: payoff / kept, hands: totalHands / kept };
}

const SCENARIOS = [
  { name: '16 對 10', hand: [c('10'), c('6', 'H')], up: c('K', 'D'), others: [] },
  { name: '11 對 6（可加倍）', hand: [c('5'), c('6', 'H')], up: c('6', 'D'), others: [], legal: ALL3 },
  { name: '軟 18 對 9（任何點數都能加倍的規則）', hand: [c('A'), c('7', 'H')], up: c('9', 'D'), others: [], legal: ALL3 },
  { name: '5 對 7（要牌要很多層）', hand: [c('2'), c('3', 'H')], up: c('7', 'D'), others: [], legal: ALL3 },
  { name: '16 對 A（底牌不可能是 10 點牌）', hand: [c('9'), c('7', 'H')], up: c('A', 'D'), others: [] },
  { name: '12 對 4，同桌亮出 12 張 10 點牌與 4 張 6', hand: [c('10', 'C'), c('2', 'H')], up: c('4', 'D'), others: [...many('Q', 12), ...many('6', 4)], legal: ALL3 },
];

const SPLITS = [
  { name: '8+8 對 6（只補一張，補到 8 再分）', hand: [c('8'), c('8', 'H')], up: c('6', 'D'), rules: DEFAULTS },
  { name: 'A+A 對 10（分 A，各補一張）', hand: [c('A'), c('A', 'H')], up: c('10', 'D'), rules: DEFAULTS },
  { name: '9+9 對 5，同桌亮出 3 張 9', hand: [c('9'), c('9', 'H')], up: c('5', 'D'), others: many('9', 3), rules: DEFAULTS },
  { name: '8+8 對 10（splitOneCard: false，分完照一般打法、10／11 能加倍）', hand: [c('8'), c('8', 'H')], up: c('10', 'D'), rules: { ...DEFAULTS, splitOneCard: false } },
  { name: 'A+A 對 6（maxHands: 3，最多再分一次）', hand: [c('A'), c('A', 'H')], up: c('6', 'D'), rules: { ...DEFAULTS, maxHands: 3 } },
  { name: "K+K 對 6（splitBy: 'rank'，只有補到 K 才算再成對）", hand: [c('K'), c('K', 'H')], up: c('6', 'D'), rules: { ...DEFAULTS, splitBy: 'rank' } },
];
const splitSeen = s => [...s.hand, s.up, ...(s.others || [])];
const splitOdds = s => forHand({ hand: s.hand, up: s.up, seen: splitSeen(s), legal: ['hit', 'stand', 'split'], rules: s.rules });

test('每個選項的勝＋平＋輸＝1，而且都在 0 到 1 之間', () => {
  const all = [...SCENARIOS.map(s => [s.name, forHand({ hand: s.hand, up: s.up, seen: [...s.hand, s.up, ...s.others], legal: s.legal })]),
    ...SPLITS.map(s => [s.name, splitOdds(s)])];
  for (const [name, o] of all) {
    for (const k of ['stand', 'hit', 'double', 'split']) {
      if (!o[k]) continue;
      const sum = o[k].win + o[k].push + o[k].lose;
      assert.ok(Math.abs(sum - 1) < 1e-9, `${name} ${k} 加總 ${sum}`);
      assert.ok([o[k].win, o[k].push, o[k].lose].every(x => x >= -1e-12 && x <= 1 + 1e-12), `${name} ${k} ${JSON.stringify(o[k])}`);
    }
  }
});

test('不能做的動作不算：沒給加倍、分牌就沒有那兩項；分完只能再分或停時沒有要牌', () => {
  const s = SCENARIOS[1];
  const o = forHand({ hand: s.hand, up: s.up, seen: [...s.hand, s.up] });
  assert.deepStrictEqual([o.double, o.split, Object.keys(o.ev)], [null, null, ['stand', 'hit']]);
  const p = SPLITS[0];
  const repair = forHand({ hand: p.hand, up: p.up, seen: splitSeen(p), legal: ['stand', 'split'], rules: DEFAULTS, hands: 2 });
  assert.deepStrictEqual([repair.hit, Object.keys(repair.ev)], [null, ['stand', 'split']]);
  assert.throws(() => forHand({ hand: p.hand, up: p.up, seen: splitSeen(p), legal: ['hit', 'stand', 'split'] }), /rules/);
});

test('16 點以下停牌，只有荷官爆牌才會贏，不會平手', () => {
  const s = SCENARIOS[0];
  const o = forHand({ hand: s.hand, up: s.up, seen: [...s.hand, s.up] });
  assert.ok(Math.abs(o.stand.win - o.dealer.bust) < 1e-12);
  assert.strictEqual(o.stand.push, 0);
});

test('亮出越多 10 點牌，荷官明牌 4 越不容易爆（亮出的牌真的有扣掉）', () => {
  const hand = [c('10', 'C'), c('2', 'H')], up = c('4', 'D');
  const plain = forHand({ hand, up, seen: [...hand, up] });
  const tensGone = forHand({ hand, up, seen: [...hand, up, ...many('Q', 24)] });
  assert.ok(tensGone.dealer.bust < plain.dealer.bust - 0.02, `${plain.dealer.bust} → ${tensGone.dealer.bust}`);
});

test('與真實抽牌的模擬比對：每個選項的勝、平、輸都差不到 1.5%', t => {
  const N = 60000;
  let worst = { err: 0 };
  for (const [i, s] of SCENARIOS.entries()) {
    const seen = [...s.hand, s.up, ...s.others];
    const o = forHand({ hand: s.hand, up: s.up, seen, legal: s.legal });
    for (const action of ['stand', 'hit', 'double']) {
      if (!o[action]) continue;
      const sim = simulate({ hand: s.hand, up: s.up, seen, action, policy: o.policy, n: N, seed: 100 + i });
      for (const k of ['win', 'push', 'lose']) {
        const err = Math.abs(sim[k] - o[action][k]);
        if (err > worst.err) worst = { err, where: `${s.name} ${action} ${k}`, calc: o[action][k], sim: sim[k] };
        assert.ok(err < 0.015, `${s.name} ${action} ${k}：計算 ${o[action][k].toFixed(4)}，模擬 ${sim[k].toFixed(4)}`);
      }
    }
  }
  // 誤差照實印出來：模擬本身的抽樣誤差約 ±0.4%（六萬局、兩個標準差），超過的部分才是近似造成的
  t.diagnostic(`最大差距 ${(worst.err * 100).toFixed(2)}%（${worst.where}：計算 ${(worst.calc * 100).toFixed(2)}%、模擬 ${(worst.sim * 100).toFixed(2)}%）`);
});

// 分牌的模擬一局有兩手以上、還會再分，期望值的抽樣誤差比單手大，門檻放寬到 3%（六萬局約兩個標準差的兩倍半）
test('分牌與模擬比對：每一手的勝、平、輸差不到 1.5%，每局期望值差不到 3%，平均分成幾手差不到 0.03', t => {
  const N = 60000;
  const lines = [];
  for (const [i, s] of SPLITS.entries()) {
    const o = splitOdds(s);
    const sim = simulateSplit({ hand: s.hand, up: s.up, seen: splitSeen(s), rules: s.rules, o, n: N, seed: 300 + i });
    for (const k of ['win', 'push', 'lose']) {
      assert.ok(Math.abs(sim[k] - o.split[k]) < 0.015, `${s.name} 分牌 ${k}：計算 ${o.split[k].toFixed(4)}，模擬 ${sim[k].toFixed(4)}`);
    }
    assert.ok(Math.abs(sim.ev - o.ev.split) < 0.03, `${s.name} 期望值：計算 ${o.ev.split.toFixed(4)}，模擬 ${sim.ev.toFixed(4)}`);
    assert.ok(Math.abs(sim.hands - o.split.hands) < 0.03, `${s.name} 手數：計算 ${o.split.hands.toFixed(3)}，模擬 ${sim.hands.toFixed(3)}`);
    lines.push(`${s.name}：期望值 計算 ${o.ev.split.toFixed(3)}／模擬 ${sim.ev.toFixed(3)}，手數 ${o.split.hands.toFixed(2)}／${sim.hands.toFixed(2)}`);
  }
  t.diagnostic(lines.join('；'));
});

// ---- 「建議」：期望值最高的動作 ----
const { basic } = require('../app/js/core/strategy.js');
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

test('建議挑期望值最高的那個，加倍的期望值算兩倍，分牌把每一手都算進去', () => {
  const fresh = (hand, up, legal) => forHand({ hand, up, seen: [...hand, up], legal, rules: DEFAULTS });
  const o = fresh([c('5'), c('6', 'H')], c('6', 'D'), ALL3);
  assert.strictEqual(o.best, 'double');
  assert.ok(Math.abs(o.ev.double - 2 * (o.double.win - o.double.lose)) < 1e-12);
  assert.strictEqual(fresh([c('K'), c('Q', 'H')], c('6', 'D'), ['hit', 'stand', 'split']).best, 'stand');
  assert.strictEqual(fresh([c('2'), c('3', 'H')], c('7', 'D'), ['hit', 'stand']).best, 'hit');
  const aa = fresh([c('A'), c('A', 'H')], c('6', 'D'), ['hit', 'stand', 'split']);
  assert.strictEqual(aa.best, 'split');
  assert.ok(Math.abs(aa.ev.split - aa.split.hands * (aa.split.win - aa.split.lose)) < 1e-9, '分牌只補一張時，期望值＝手數 ×（每手勝－輸）');
  // 補到 A 再分比停在軟 12 好：平均手數＝2(1−q)/(1−2q)，q 是再補到 A 的機率（牌靴扣掉亮出的兩張 A 與明牌 6）
  const q = 22 / 309;
  assert.ok(aa.split.resplit && Math.abs(aa.split.hands - 2 * (1 - q) / (1 - 2 * q)) < 1e-9, `A+A 對 6 補到 A 要再分：${JSON.stringify(aa.split)}`);
  for (const k of Object.keys(o.ev)) assert.ok(o.ev[o.best] >= o.ev[k]);
});

// 拿兩張牌的每一種組合對每一種明牌（540 格）跟阿德的表比。v0.7.2 起要求全對，翻掉的那格會被點名，再決定是表錯還是算錯。
// 表的分牌格與加倍規則改動的格子另外逐張扣牌精確算過（v0.10.0 版本紀錄）
function grid(rules, legalFor) {
  let total = 0;
  const diff = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      const hand = [c(RANKS[i]), c(RANKS[j], 'H')];
      if (value(hand).total === 21) continue;
      for (const u of RANKS) {
        const up = c(u, 'D'), legal = legalFor(hand);
        const want = basic(hand, up, legal), got = forHand({ hand, up, seen: [...hand, up], legal, rules }).best;
        total++;
        if (want !== got) diff.push(`${RANKS[i]}+${RANKS[j]} 對 ${u}：表 ${want}、算 ${got}`);
      }
    }
  }
  return { total, diff };
}

test('建議與阿德的表對照（定案規則：10／11 點能加倍、對子能分）：540 格全部一致', t => {
  const { total, diff } = grid(DEFAULTS, hand => {
    const v = value(hand), legal = ['hit', 'stand'];
    if (!v.soft && [10, 11].includes(v.total)) legal.push('double');
    if (hand[0].rank === hand[1].rank) legal.push('split');
    return legal;
  });
  t.diagnostic(`${total} 格；不一致：${diff.join('；') || '無'}`);
  assert.strictEqual(total, 540);
  assert.deepStrictEqual(diff, []);
});

test("建議與阿德的表對照（doubleOn: 'any'、不分牌，就是 v0.9 的規則）：540 格全部一致", () => {
  const { total, diff } = grid({ ...DEFAULTS, doubleOn: 'any' }, () => ALL3);
  assert.strictEqual(total, 540);
  assert.deepStrictEqual(diff, []);
});

test('分完補到同點數、只能再分或停的時候：建議與阿德的表對照，100 格全部一致', () => {
  const diff = [];
  for (const r of RANKS) {
    for (const u of RANKS) {
      const hand = [c(r), c(r, 'H')], up = c(u, 'D'), legal = ['stand', 'split'];
      const want = basic(hand, up, legal), got = forHand({ hand, up, seen: [...hand, up], legal, rules: DEFAULTS, hands: 2 }).best;
      if (want !== got) diff.push(`${r}+${r} 對 ${u}：表 ${want}、算 ${got}`);
    }
  }
  assert.deepStrictEqual(diff, []);
});
