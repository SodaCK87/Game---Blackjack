// 勝率提示的數字要對：拿「真的一張一張從剩下的牌抽」的模擬去對 odds.js 的計算。
// 模擬照實際牌局的順序：底牌先發（荷官偷看過，補成 Blackjack 的那幾局整局丟掉不算）、玩家先抽、荷官最後補牌。
const test = require('node:test');
const assert = require('node:assert');
const { forHand } = require('../app/js/core/odds.js');
const { value } = require('../app/js/core/hand.js');
const { freshDecks } = require('../app/js/core/shoe.js');
const { rng } = require('./rng_util');

const c = (rank, suit = 'S') => ({ rank, suit });
const SUITS = ['S', 'H', 'D', 'C'];
const many = (rank, n) => Array.from({ length: n }, (_, i) => c(rank, SUITS[i % 4]));

function pool(seen) {
  const cards = freshDecks(6);
  for (const s of seen) {
    const i = cards.findIndex(x => x.rank === s.rank && x.suit === s.suit);
    assert.ok(i >= 0, `牌靴裡已經沒有 ${s.rank}${s.suit}`);
    cards.splice(i, 1);
  }
  return cards;
}

function simulate({ hand, up, seen, action, policy, n, seed }) {
  const cards = pool(seen);
  const r = rng(seed);
  const t = { win: 0, push: 0, lose: 0 };
  let kept = 0;
  for (let trial = 0; trial < n; trial++) {
    // 每局從牌堆尾端做部分洗牌，抽出來的牌留在原陣列裡，牌堆的組成每局都一樣
    let end = cards.length;
    const draw = () => { const j = Math.floor(r() * end); end--; [cards[j], cards[end]] = [cards[end], cards[j]]; return cards[end]; };
    const hole = draw();
    if (value([up, hole]).blackjack) continue;
    kept++;
    const me = hand.slice();
    if (action === 'double') me.push(draw());
    if (action === 'hit') {
      me.push(draw());
      for (;;) {
        const v = value(me);
        if (v.bust || policy[`${v.soft ? 's' : 'h'}${v.total}`] !== 'hit') break;
        me.push(draw());
      }
    }
    const mine = value(me);
    if (mine.bust) { t.lose++; continue; }
    const dealer = [up, hole];
    while (value(dealer).total < 17) dealer.push(draw());
    const d = value(dealer);
    if (d.bust || mine.total > d.total) t.win++;
    else if (mine.total === d.total) t.push++;
    else t.lose++;
  }
  return { win: t.win / kept, push: t.push / kept, lose: t.lose / kept };
}

const SCENARIOS = [
  { name: '16 對 10', hand: [c('10'), c('6', 'H')], up: c('K', 'D'), others: [] },
  { name: '11 對 6（可加倍）', hand: [c('5'), c('6', 'H')], up: c('6', 'D'), others: [], canDouble: true },
  { name: '軟 18 對 9', hand: [c('A'), c('7', 'H')], up: c('9', 'D'), others: [], canDouble: true },
  { name: '5 對 7（要牌要很多層）', hand: [c('2'), c('3', 'H')], up: c('7', 'D'), others: [], canDouble: true },
  { name: '16 對 A（底牌不可能是 10 點牌）', hand: [c('9'), c('7', 'H')], up: c('A', 'D'), others: [] },
  { name: '12 對 4，同桌亮出 12 張 10 點牌與 4 張 6', hand: [c('10', 'C'), c('2', 'H')], up: c('4', 'D'), others: [...many('Q', 12), ...many('6', 4)], canDouble: true },
];

test('每個選項的勝＋平＋輸＝1，而且都在 0 到 1 之間', () => {
  for (const s of SCENARIOS) {
    const seen = [...s.hand, s.up, ...s.others];
    const o = forHand({ hand: s.hand, up: s.up, seen, canDouble: !!s.canDouble });
    for (const k of ['stand', 'hit', 'double']) {
      if (!o[k]) continue;
      const sum = o[k].win + o[k].push + o[k].lose;
      assert.ok(Math.abs(sum - 1) < 1e-9, `${s.name} ${k} 加總 ${sum}`);
      assert.ok([o[k].win, o[k].push, o[k].lose].every(x => x >= -1e-12 && x <= 1 + 1e-12), `${s.name} ${k} ${JSON.stringify(o[k])}`);
    }
  }
});

test('16 點以下停牌，只有荷官爆牌才會贏，不會平手', () => {
  const s = SCENARIOS[0];
  const o = forHand({ hand: s.hand, up: s.up, seen: [...s.hand, s.up], canDouble: false });
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
    const o = forHand({ hand: s.hand, up: s.up, seen, canDouble: !!s.canDouble });
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

// ---- 「建議」：期望值最高的動作 ----
const { basic } = require('../app/js/core/strategy.js');
const fresh = (hand, up) => forHand({ hand, up, seen: [...hand, up], canDouble: true });

test('建議挑期望值最高的那個，加倍的期望值算兩倍', () => {
  const o = fresh([c('5'), c('6', 'H')], c('6', 'D'));
  assert.strictEqual(o.best, 'double');
  assert.ok(Math.abs(o.ev.double - 2 * (o.double.win - o.double.lose)) < 1e-12);
  assert.strictEqual(fresh([c('K'), c('Q', 'H')], c('6', 'D')).best, 'stand');
  assert.strictEqual(fresh([c('2'), c('3', 'H')], c('7', 'D')).best, 'hit');
  for (const k of ['stand', 'hit', 'double']) assert.ok(o.ev[o.best] >= o.ev[k]);
});

// 2026-10-22 量到 540 格只有 1 格不一致（A+A 對 6：表要牌、算加倍——公開的表在這格是分牌，
// 這個遊戲不能分牌，strategy.js 退回要牌；不能分牌時加倍確實比較好）。門檻定 99%：最多容 5 格
test('建議與公開的基本策略表對照：兩張牌的每一種組合對每一種明牌，至少 99% 一致', t => {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  let same = 0, total = 0;
  const diff = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      const hand = [c(RANKS[i]), c(RANKS[j], 'H')];
      if (value(hand).total === 21) continue;
      for (const u of RANKS) {
        const up = c(u, 'D');
        const want = basic(hand, up, true), got = fresh(hand, up).best;
        total++;
        if (want === got) same++;
        else diff.push(`${RANKS[i]}+${RANKS[j]} 對 ${u}：表 ${want}、算 ${got}`);
      }
    }
  }
  t.diagnostic(`${total} 格一致 ${same} 格（${(same / total * 100).toFixed(1)}%）；不一致：${diff.join('；') || '無'}`);
  assert.ok(same / total >= 0.99, `一致率 ${(same / total * 100).toFixed(1)}%：${diff.slice(0, 10).join('；')}`);
});
