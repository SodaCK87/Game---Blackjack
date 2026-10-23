// 牌局流程與結算：用疊好的牌重現每一種結局，加倍與分牌的每一種規則參數都各跑一次
const test = require('node:test');
const assert = require('node:assert');
const { createGame, prefillBet, DEFAULTS } = require('../app/js/core/game.js');
const { stackedShoe } = require('./shoe_util');

const noRng = () => { throw new Error('疊牌的牌局不該用到亂數'); };
// 發牌順序：玩家第一張、荷官明牌、玩家第二張、荷官底牌，之後照要牌順序
function oneSeat(ranks, bankroll = 1000, rules = {}) {
  return createGame(Object.assign({ rng: noRng, shoe: stackedShoe(ranks), seats: [{ id: 'p', name: '玩家', bankroll }] }, rules));
}
const settleOf = events => events.find(e => e.type === 'settle');
const settles = events => events.filter(e => e.type === 'settle').map(({ hand, result, net }) => ({ hand, result, net }));
const handsOf = g => g.state().seats[0].hands.map(h => h.cards.map(c => c.rank).join('+'));
const typesOf = events => events.map(e => (e.hand === undefined ? e.type : `${e.type}${e.hand}`));
// 頭兩張發完、輪到玩家時能做什麼（荷官 9＋7＝16，不偷看）
function legalWith(first, second, rules) {
  const g = oneSeat([first, '9', second, '7'], 1000, rules);
  g.startRound({ p: 100 });
  return g.legal('p');
}

test('玩家 Blackjack、荷官不是：贏 1.5 倍', () => {
  const g = oneSeat(['A', '10', 'K', '7']);
  const ev = g.startRound({ p: 100 });
  assert.ok(ev.some(e => e.type === 'blackjack' && e.seat === 'p'));
  assert.strictEqual(g.state().phase, 'dealer');
  assert.deepStrictEqual(settleOf(g.finishRound()), { type: 'settle', seat: 'p', hand: 0, result: 'blackjack', bet: 100, net: 150 });
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

test('荷官明牌 A、底牌 10：先偷看，閒家 20 點直接輸原注，沒有機會加倍或分牌', () => {
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
  assert.strictEqual(g.state().turnHand, 0);
});

test('加倍：賭注加倍、只再拿一張、自動停牌，贏了淨賺兩倍原注', () => {
  const g = oneSeat(['6', '9', '5', '7', '10', '8']);
  g.startRound({ p: 100 });
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'double']);
  const ev = g.act('p', 'double');
  assert.deepStrictEqual(ev.filter(e => e.type === 'deal').length, 1);
  assert.strictEqual(g.state().seats[0].hands[0].bet, 200);
  assert.strictEqual(g.state().seats[0].totalBet, 200);
  assert.strictEqual(g.state().phase, 'dealer');
  const fin = g.finishRound();
  assert.ok(fin.some(e => e.type === 'dealerBust'));
  assert.deepStrictEqual(settleOf(fin), { type: 'settle', seat: 'p', hand: 0, result: 'win', bet: 200, net: 200 });
  assert.strictEqual(g.state().seats[0].bankroll, 1200);
});

// 上一條加倍後剛好 21，「到 21 自動停」那條也會讓它停牌，守不住加倍本身的自動停牌
test('加倍後沒到 21 也自動停牌，不能再要牌', () => {
  const g = oneSeat(['6', '9', '5', '7', '4', '10']);
  g.startRound({ p: 100 });
  const ev = g.act('p', 'double');
  assert.ok(ev.some(e => e.type === 'stand' && e.seat === 'p' && e.auto));
  assert.strictEqual(g.state().seats[0].hands[0].status, 'stood');
  assert.strictEqual(g.state().phase, 'dealer');
  assert.deepStrictEqual(g.legal('p'), []);
  assert.throws(() => g.act('p', 'hit'));
  assert.deepStrictEqual(settleOf(g.finishRound()), { type: 'settle', seat: 'p', hand: 0, result: 'win', bet: 200, net: 200 });
});

test('加倍點數（預設）：頭兩張硬 10、硬 11 才能加倍；9、12、有 A 的軟牌、要過牌的 10 點都不行', () => {
  for (const [a, b] of [['2', '8'], ['4', '6'], ['5', '5'], ['2', '9'], ['5', '6'], ['3', '8']]) {
    assert.ok(legalWith(a, b).includes('double'), `${a}+${b} 應該能加倍`);
  }
  for (const [a, b] of [['4', '5'], ['10', '2'], ['A', '9'], ['A', '8'], ['A', '7'], ['A', 'A']]) {
    assert.ok(!legalWith(a, b).includes('double'), `${a}+${b} 不該能加倍`);
  }
  const g = oneSeat(['2', '9', '3', '7', '5']);
  g.startRound({ p: 100 });
  g.act('p', 'hit');
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand'], '三張湊到 10 點不能加倍');
  assert.deepStrictEqual(DEFAULTS.doubleOn, [10, 11]);
});

test("加倍點數 doubleOn: 'any'：頭兩張任何點數都能加倍；[11]：只有 11", () => {
  for (const [a, b] of [['A', '7'], ['10', '2'], ['4', '5'], ['2', '8']]) {
    assert.ok(legalWith(a, b, { doubleOn: 'any' }).includes('double'), `any：${a}+${b}`);
  }
  assert.ok(legalWith('5', '6', { doubleOn: [11] }).includes('double'));
  assert.ok(!legalWith('4', '6', { doubleOn: [11] }).includes('double'));
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
  const g = oneSeat(['6', '9', '5', '7', '2']);
  g.startRound({ p: 100 });
  assert.ok(g.legal('p').includes('double'));
  g.act('p', 'hit');
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand']);
  assert.throws(() => g.act('p', 'double'), /不能 double/);

  const poor = oneSeat(['6', '9', '5', '7'], 150);
  poor.startRound({ p: 100 });
  assert.deepStrictEqual(poor.legal('p'), ['hit', 'stand']);
});

test("分牌看點數（預設 splitBy: 'value'）：K+Q、10+J 也能分；'rank' 要牌面相同", () => {
  assert.strictEqual(DEFAULTS.splitBy, 'value');
  for (const [a, b] of [['K', 'Q'], ['10', 'J'], ['8', '8'], ['A', 'A']]) assert.ok(legalWith(a, b).includes('split'), `value：${a}+${b}`);
  for (const [a, b] of [['8', '7'], ['A', '9']]) assert.ok(!legalWith(a, b).includes('split'), `value：${a}+${b}`);
  assert.ok(!legalWith('K', 'Q', { splitBy: 'rank' }).includes('split'));
  assert.ok(legalWith('K', 'K', { splitBy: 'rank' }).includes('split'));
  assert.ok(legalWith('8', '8', { splitBy: 'rank' }).includes('split'));
});

test('分牌（預設每手只補一張）：多押一份同額的注，第二張移到新的一手，兩手各補一張就停、逐手結算', () => {
  const g = oneSeat(['8', '6', '8', '10', '3', 'K', 'A']);
  g.startRound({ p: 100 });
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'split']);
  const ev = g.act('p', 'split');
  assert.deepStrictEqual(typesOf(ev), ['split0', 'deal0', 'stand0', 'deal1', 'stand1']);
  assert.deepStrictEqual(ev[0], { type: 'split', seat: 'p', hand: 0, card: { rank: '8', suit: 'D' }, amount: 100 });
  assert.ok(ev.filter(e => e.type === 'stand').every(e => e.auto), '分出來的手補完牌自動停');
  assert.deepStrictEqual(handsOf(g), ['8+3', '8+K']);
  assert.strictEqual(g.state().seats[0].bankroll, 800);
  assert.strictEqual(g.state().seats[0].totalBet, 200);
  assert.strictEqual(g.state().phase, 'dealer');
  // 荷官 16 補 A 成 17：11 點那手輸、18 點那手贏，帳平
  const fin = g.finishRound();
  assert.deepStrictEqual(settles(fin), [{ hand: 0, result: 'lose', net: -100 }, { hand: 1, result: 'win', net: 100 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
  assert.strictEqual(g.state().house, 0);
});

test('分完補到同點數：只能再分或停（不能要牌、不能加倍）；不限手數，新的一手插在這一手後面', () => {
  const g = oneSeat(['8', '6', '8', '10', '8', '8', '8', '8', '2', '3', '4', '5', '7', '9', 'A']);
  g.startRound({ p: 100 });
  let ev = g.act('p', 'split');
  assert.deepStrictEqual(typesOf(ev), ['split0', 'deal0', 'turn0']);
  assert.deepStrictEqual(g.legal('p'), ['stand', 'split']);
  for (let i = 0; i < 4; i++) ev = g.act('p', 'split');
  assert.strictEqual(DEFAULTS.maxHands, Infinity);
  assert.deepStrictEqual(handsOf(g), ['8+2', '8+3', '8+4', '8+5', '8+7', '8+9']);
  // 還沒補牌的手都只有一張 8，看點數分不出插在哪；看花色：最後分出來的 8♣ 插在第 1 手、第一次分出來的 8♦ 被擠到最後
  assert.deepStrictEqual(g.state().seats[0].hands.map(x => x.cards[0].suit), ['S', 'C', 'D', 'H', 'S', 'D']);
  assert.ok(!ev.some(e => e.type === 'turn'), '補到不同點數的手自動停，不再問');
  assert.strictEqual(g.state().seats[0].bankroll, 400);
  // 荷官 17：只有 17 點那手平手，其他五手輸
  assert.deepStrictEqual(settles(g.finishRound()).map(s => s.net), [-100, -100, -100, -100, -100, 0]);
  assert.strictEqual(g.state().seats[0].bankroll, 500);

  // 5+5 再成對是 10 點，照樣不能加倍
  const five = oneSeat(['5', '9', '5', '7', '5']);
  five.startRound({ p: 100 });
  assert.deepStrictEqual(five.legal('p'), ['hit', 'stand', 'double', 'split']);
  five.act('p', 'split');
  assert.deepStrictEqual(five.legal('p'), ['stand', 'split']);
});

test('maxHands: 4：分到第四手後再成對就不能分，只補一張的手自動停；一般打法的手照常要牌', () => {
  const g = oneSeat(['8', '6', '8', '10', '8', '8', '8', '2', '3', '4', 'A'], 1000, { maxHands: 4 });
  g.startRound({ p: 100 });
  g.act('p', 'split');
  g.act('p', 'split');
  const ev = g.act('p', 'split');
  assert.deepStrictEqual(handsOf(g), ['8+8', '8+2', '8+3', '8+4']);
  assert.ok(ev.some(e => e.type === 'stand' && e.hand === 0 && e.auto), '第四手時再成對要自動停');
  assert.strictEqual(g.state().phase, 'dealer');

  const free = oneSeat(['8', '6', '8', '10', '8', '8', '8'], 1000, { maxHands: 4, splitOneCard: false });
  free.startRound({ p: 100 });
  free.act('p', 'split');
  assert.ok(free.legal('p').includes('split'));
  free.act('p', 'split');
  free.act('p', 'split');
  assert.deepStrictEqual(free.legal('p'), ['hit', 'stand']);
});

test('籌碼不夠付新的一份注就不能分；夠付一次就只能再分一次', () => {
  const poor = oneSeat(['8', '6', '8', '10'], 150);
  poor.startRound({ p: 100 });
  assert.deepStrictEqual(poor.legal('p'), ['hit', 'stand']);

  const g = oneSeat(['8', '6', '8', '10', '8', '8', '3', '4', 'A'], 300);
  g.startRound({ p: 100 });
  g.act('p', 'split');
  assert.deepStrictEqual(g.legal('p'), ['stand', 'split']);
  const ev = g.act('p', 'split');
  assert.strictEqual(g.state().seats[0].bankroll, 0);
  assert.ok(!ev.some(e => e.type === 'turn'), '付不起就不再問，8+8 自動停');
  assert.deepStrictEqual(handsOf(g), ['8+8', '8+3', '8+4']);
});

test('分開的 A 各補一張就停（splitOneCard: false 也一樣）；A＋10 點牌算 21 點、贏只賠 1 倍', () => {
  const g = oneSeat(['A', '9', 'A', '8', 'K', '7'], 1000, { splitOneCard: false });
  g.startRound({ p: 100 });
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'split']);
  const ev = g.act('p', 'split');
  assert.ok(!ev.some(e => e.type === 'blackjack'));
  assert.ok(!ev.some(e => e.type === 'turn'), '分開的 A 補一張就停，不再問');
  assert.deepStrictEqual(handsOf(g), ['A+K', 'A+7']);
  assert.ok(g.state().seats[0].hands.every(h => h.status === 'stood'));
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'win', net: 100 }, { hand: 1, result: 'win', net: 100 }]);
});

test('分出來的 A＋10 點牌碰到荷官 21 點是平手（真的 Blackjack 會贏 1.5 倍）；A 又補到 A 可以再分', () => {
  const g = oneSeat(['A', '5', 'A', '6', 'K', '9', '10']);
  g.startRound({ p: 100 });
  g.act('p', 'split');
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'push', net: 0 }, { hand: 1, result: 'lose', net: -100 }]);

  const again = oneSeat(['A', '9', 'A', '8', 'A']);
  again.startRound({ p: 100 });
  again.act('p', 'split');
  assert.deepStrictEqual(again.legal('p'), ['stand', 'split']);
});

test('splitOneCard: false：分出來的手照一般的手打，可以要牌，能加倍的點數可以加倍', () => {
  const g = oneSeat(['8', '6', '8', '10', '3', '2', '9', 'A'], 1000, { splitOneCard: false });
  g.startRound({ p: 100 });
  const ev = g.act('p', 'split');
  assert.deepStrictEqual(typesOf(ev), ['split0', 'deal0', 'turn0']);
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'double']);
  const dbl = g.act('p', 'double');
  assert.deepStrictEqual(typesOf(dbl), ['double0', 'deal0', 'stand0', 'deal1', 'turn1']);
  assert.strictEqual(g.state().turnHand, 1);
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand']);
  g.act('p', 'stand');
  assert.strictEqual(g.state().seats[0].bankroll, 700);
  // 荷官 17：加倍的 13 點輸兩份、17 點平手
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'lose', net: -200 }, { hand: 1, result: 'push', net: 0 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 800);
});

test('分牌的座位打完所有的手，才輪到下一個座位', () => {
  const g = createGame({
    rng: noRng,
    shoe: stackedShoe(['8', '10', '6', '8', '9', '10', '3', '4']),
    seats: [{ id: 'a', name: '甲', bankroll: 1000 }, { id: 'b', name: '乙', bankroll: 1000 }],
  });
  g.startRound({ a: 10, b: 10 });
  const ev = g.act('a', 'split');
  assert.deepStrictEqual(ev.filter(e => e.type === 'turn'), [{ type: 'turn', seat: 'b', hand: 0 }]);
  assert.strictEqual(g.state().turn, 'b');
});

test('規則參數打錯字當場擲錯', () => {
  const make = rules => () => oneSeat(['10', '10', '8', '8'], 1000, rules);
  assert.throws(make({ doubleOn: 'sometimes' }), /doubleOn/);
  assert.throws(make({ splitBy: 'suit' }), /splitBy/);
  assert.throws(make({ maxHands: 0 }), /maxHands/);
  assert.doesNotThrow(make({ maxHands: 1 }));
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
