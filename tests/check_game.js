// 牌局流程與結算：用疊好的牌重現每一種結局
const test = require('node:test');
const assert = require('node:assert');
const { createGame, prefillBet } = require('../app/js/core/game.js');
const { stackedShoe } = require('./shoe_util');

const noRng = () => { throw new Error('疊牌的牌局不該用到亂數'); };
function oneSeat(ranks, bankroll = 1000) {
  return createGame({ rng: noRng, shoe: stackedShoe(ranks), seats: [{ id: 'p', name: '玩家', bankroll }] });
}
const settleOf = events => events.find(e => e.type === 'settle');

test('玩家 Blackjack、荷官不是：贏 1.5 倍', () => {
  const g = oneSeat(['A', '10', 'K', '7']);
  const ev = g.startRound({ p: 100 });
  assert.ok(ev.some(e => e.type === 'blackjack' && e.seat === 'p'));
  assert.strictEqual(g.state().phase, 'dealer');
  assert.deepStrictEqual(settleOf(g.finishRound()), { type: 'settle', seat: 'p', result: 'blackjack', bet: 100, net: 150 });
  assert.strictEqual(g.state().seats[0].bankroll, 1150);
});

test('雙方都是 Blackjack：平手退注，牌局在發牌當下就結束', () => {
  const g = oneSeat(['A', 'A', 'K', 'K']);
  const ev = g.startRound({ p: 100 });
  assert.ok(ev.some(e => e.type === 'dealerBlackjack'));
  assert.strictEqual(settleOf(ev).result, 'push');
  assert.strictEqual(g.state().phase, 'idle');
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
});

test('荷官明牌 A、底牌 10：先偷看，閒家 20 點直接輸原注，沒有機會加倍', () => {
  const g = oneSeat(['K', 'A', 'Q', 'K']);
  const ev = g.startRound({ p: 100 });
  assert.ok(!ev.some(e => e.type === 'turn'));
  assert.deepStrictEqual(g.legal('p'), []);
  assert.strictEqual(settleOf(ev).net, -100);
});

test('荷官明牌 10 但沒有 Blackjack：照常輪到閒家', () => {
  const g = oneSeat(['9', '10', '9', '7']);
  g.startRound({ p: 100 });
  assert.strictEqual(g.state().turn, 'p');
});

test('加倍：賭注加倍、只再拿一張、自動停牌，贏了淨賺兩倍原注', () => {
  const g = oneSeat(['6', '9', '5', '7', '10', '8']);
  g.startRound({ p: 100 });
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'double']);
  const ev = g.act('p', 'double');
  assert.deepStrictEqual(ev.filter(e => e.type === 'deal').length, 1);
  assert.strictEqual(g.state().seats[0].bet, 200);
  assert.strictEqual(g.state().phase, 'dealer');
  const fin = g.finishRound();
  assert.ok(fin.some(e => e.type === 'dealerBust'));
  assert.deepStrictEqual(settleOf(fin), { type: 'settle', seat: 'p', result: 'win', bet: 200, net: 200 });
  assert.strictEqual(g.state().seats[0].bankroll, 1200);
});

// 上一條加倍後剛好 21，「到 21 自動停」那條也會讓它停牌，守不住加倍本身的自動停牌
test('加倍後沒到 21 也自動停牌，不能再要牌', () => {
  const g = oneSeat(['6', '9', '5', '7', '4', '10']);
  g.startRound({ p: 100 });
  const ev = g.act('p', 'double');
  assert.ok(ev.some(e => e.type === 'stand' && e.seat === 'p' && e.auto));
  assert.strictEqual(g.state().seats[0].status, 'stood');
  assert.strictEqual(g.state().phase, 'dealer');
  assert.deepStrictEqual(g.legal('p'), []);
  assert.throws(() => g.act('p', 'hit'));
  assert.deepStrictEqual(settleOf(g.finishRound()), { type: 'settle', seat: 'p', result: 'win', bet: 200, net: 200 });
});

test('下注列預填的注沿用上一注，但對齊 10 的倍數、不超過籌碼與上限（BJK-02）', () => {
  assert.strictEqual(prefillBet(500, 15), 10);
  assert.strictEqual(prefillBet(500, 45), 40);
  assert.strictEqual(prefillBet(1000, 995), 990);
  assert.strictEqual(prefillBet(50, 1015), 50);
  assert.strictEqual(prefillBet(5000, 99999), 1000);
  assert.strictEqual(prefillBet(500, 5), 0);
});

test('要過牌就不能加倍；籌碼不夠也不能加倍', () => {
  const g = oneSeat(['2', '9', '3', '7', '4']);
  g.startRound({ p: 100 });
  g.act('p', 'hit');
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand']);
  assert.throws(() => g.act('p', 'double'), /不能 double/);

  const poor = oneSeat(['6', '9', '5', '7'], 150);
  poor.startRound({ p: 100 });
  assert.deepStrictEqual(poor.legal('p'), ['hit', 'stand']);
});

test('閒家爆牌就輸，荷官不必補牌', () => {
  const g = oneSeat(['10', '10', '6', '6', '9']);
  g.startRound({ p: 100 });
  assert.ok(g.act('p', 'hit').some(e => e.type === 'bust'));
  const fin = g.finishRound();
  assert.strictEqual(g.state().dealer.cards.length, 2);
  assert.strictEqual(settleOf(fin).result, 'bust');
  assert.strictEqual(g.state().seats[0].bankroll, 900);
});

test('荷官軟 17 停牌（A＋6 不補）', () => {
  const g = oneSeat(['10', 'A', '9', '6']);
  g.startRound({ p: 100 });
  g.act('p', 'stand');
  const fin = g.finishRound();
  assert.strictEqual(g.state().dealer.cards.length, 2);
  assert.strictEqual(g.state().dealer.total, 17);
  assert.strictEqual(settleOf(fin).result, 'win');
});

test('荷官 16 點要補牌', () => {
  const g = oneSeat(['10', '10', '8', '6', '2']);
  g.startRound({ p: 100 });
  g.act('p', 'stand');
  g.finishRound();
  assert.strictEqual(g.state().dealer.cards.length, 3);
  assert.strictEqual(g.state().dealer.total, 18);
});

test('同點數平手退注', () => {
  const g = oneSeat(['10', '10', '8', '8']);
  g.startRound({ p: 100 });
  g.act('p', 'stand');
  assert.strictEqual(settleOf(g.finishRound()).result, 'push');
});

test('要到 21 點自動停牌', () => {
  const g = oneSeat(['5', '9', '6', '7', '10']);
  g.startRound({ p: 100 });
  const ev = g.act('p', 'hit');
  assert.ok(ev.some(e => e.type === 'stand' && e.auto));
  assert.strictEqual(g.state().phase, 'dealer');
});

test('牌局進行中荷官的底牌對外是蓋著的', () => {
  const g = oneSeat(['10', '9', '8', '7']);
  const ev = g.startRound({ p: 100 });
  const dealerDeals = ev.filter(e => e.type === 'deal' && e.to === 'dealer');
  assert.deepStrictEqual(dealerDeals.map(e => e.faceUp), [true, false]);
  assert.strictEqual(g.state().dealer.cards[1], null);
  assert.strictEqual(g.state().dealer.total, 9);
});

test('照座位順序輪流，沒輪到的人不能動', () => {
  const g = createGame({
    rng: noRng,
    shoe: stackedShoe(['10', '10', '9', '8', '8', '7']),
    seats: [{ id: 'a', name: '甲', bankroll: 1000 }, { id: 'b', name: '乙', bankroll: 1000 }],
  });
  g.startRound({ a: 10, b: 10 });
  assert.strictEqual(g.state().turn, 'a');
  assert.throws(() => g.act('b', 'stand'), /不能 stand/);
  g.act('a', 'stand');
  assert.strictEqual(g.state().turn, 'b');
});

test('不合規的下注整筆拒收，籌碼一毛不扣', () => {
  const g = oneSeat(['10', '10', '8', '8']);
  assert.throws(() => g.startRound({ p: 15 }), /不是 10 的倍數/);
  assert.throws(() => g.startRound({ p: 2000 }), /超出/);
  assert.throws(() => g.startRound({ p: 0 }), /至少要有一個座位下注/);
  const poor = oneSeat(['10', '10', '8', '8'], 50);
  assert.throws(() => poor.startRound({ p: 100 }), /不夠下/);
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
  assert.strictEqual(g.state().phase, 'idle');
});
