// 牌局流程與結算：用疊好的牌重現每一種結局，下注、加倍與分牌的每一種規則參數都各跑一次
const test = require('node:test');
const assert = require('node:assert');
const { createGame, prefillBet, addChip, DEFAULTS } = require('../app/js/core/game.js');
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
const ONE = { splitOneCard: true };   // v0.10.0 的規則：分出來的每一手都只補一張

test('玩家 Blackjack、荷官不是：贏 1.5 倍', () => {
  const g = oneSeat(['A', '10', 'K', '7']);
  const ev = g.startRound({ p: 100 });
  assert.ok(ev.some(e => e.type === 'blackjack' && e.seat === 'p'));
  assert.strictEqual(g.state().phase, 'dealer');
  assert.deepStrictEqual(settleOf(g.finishRound()), { type: 'settle', seat: 'p', hand: 0, result: 'blackjack', bet: 100, net: 150 });
  assert.strictEqual(g.state().seats[0].bankroll, 1150);
});

// ---- 荷官的 Blackjack：預設不偷看（peek: false），所有座位打完、荷官最後才翻底牌 ----
const PEEK = { peek: true };   // v0.10 以前的規則：明牌 A／10 先偷看
const ORIGINAL = { dealerBlackjackTakes: 'original' };
const ONLY_BJ = { dealerBlackjackPush: 'blackjack' };

test('雙方都是 Blackjack：平手退注。預設荷官最後才翻牌；peek: true 時牌局在發牌當下就結束', () => {
  for (const rules of [{}, ONLY_BJ, ORIGINAL]) {
    const g = oneSeat(['A', 'A', 'K', 'K'], 1000, rules);
    const ev = g.startRound({ p: 100 });
    assert.ok(!ev.some(e => e.type === 'dealerBlackjack' || e.type === 'reveal'), '開局不翻底牌');
    assert.strictEqual(g.state().phase, 'dealer');
    const fin = g.finishRound();
    assert.deepStrictEqual(typesOf(fin), ['reveal', 'dealerBlackjack', 'settle0', 'roundEnd']);
    assert.strictEqual(settleOf(fin).result, 'push');
    assert.strictEqual(g.state().seats[0].bankroll, 1000);
  }
  const g = oneSeat(['A', 'A', 'K', 'K'], 1000, PEEK);
  const ev = g.startRound({ p: 100 });
  assert.ok(ev.some(e => e.type === 'dealerBlackjack'));
  assert.strictEqual(settleOf(ev).result, 'push');
  assert.strictEqual(g.state().phase, 'idle');
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
});

test('荷官明牌 A、底牌 10：預設照常輪到閒家，最後翻開是 Blackjack 才結算，荷官不補牌；peek: true 先偷看、直接輸原注', () => {
  const g = oneSeat(['K', 'A', '9', 'K']);
  const ev = g.startRound({ p: 100 });
  assert.deepStrictEqual(typesOf(ev).slice(-1), ['turn0']);
  assert.strictEqual(g.state().dealer.cards[1], null, '底牌蓋著');
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand']);
  g.act('p', 'stand');
  const fin = g.finishRound();
  assert.deepStrictEqual(typesOf(fin), ['reveal', 'dealerBlackjack', 'settle0', 'roundEnd']);
  assert.deepStrictEqual(settles(fin), [{ hand: 0, result: 'lose', net: -100 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 900);

  const p = oneSeat(['K', 'A', 'Q', 'K'], 1000, PEEK);
  const pev = p.startRound({ p: 100 });
  assert.ok(!pev.some(e => e.type === 'turn'));
  assert.deepStrictEqual(p.legal('p'), []);
  assert.strictEqual(settleOf(pev).net, -100);
});

test('荷官最後翻出 Blackjack：加倍多押的一起輸；加倍或要牌湊到 21 點平手，退回那一手全部的注', () => {
  // 5+6 對 10（底牌 A）：加倍補到 9 是 20 點 → 輸 200
  let g = oneSeat(['5', '10', '6', 'A', '9']);
  g.startRound({ p: 100 });
  g.act('p', 'double');
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'lose', net: -200 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 800);
  // 加倍補到 K 是 21 點 → 平手退回 200
  g = oneSeat(['5', '10', '6', 'A', 'K']);
  g.startRound({ p: 100 });
  g.act('p', 'double');
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'push', net: 0 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
  // 要牌湊成三張的 21 點也平手；dealerBlackjackPush: 'blackjack' 時只有 Blackjack 平手，21 點照輸
  for (const [rules, want, bank] of [[{}, 'push', 1000], [ONLY_BJ, 'lose', 900]]) {
    g = oneSeat(['5', '10', '6', 'A', 'K'], 1000, rules);
    g.startRound({ p: 100 });
    g.act('p', 'hit');
    assert.strictEqual(settleOf(g.finishRound()).result, want, JSON.stringify(rules));
    assert.strictEqual(g.state().seats[0].bankroll, bank);
  }
});

test('荷官最後翻出 Blackjack：分牌多押的一起輸，21 點的那一手平手；dealerBlackjackTakes: \'original\' 只輸第一手的原注', () => {
  // 8+8 對 A（底牌 K）：第一手 8+2 加倍補 7＝17，第二手 8+3 加倍補 5＝16
  const shoe = ['8', 'A', '8', 'K', '2', '7', '3', '5'];
  const play = rules => {
    const g = oneSeat(shoe, 1000, rules);
    g.startRound({ p: 100 });
    g.act('p', 'split');
    g.act('p', 'double');
    g.act('p', 'double');
    assert.strictEqual(g.state().seats[0].bankroll, 600);
    const fin = g.finishRound();
    assert.ok(!fin.some(e => e.type === 'deal'), '荷官 Blackjack 不補牌');
    return [settles(fin), g.state().seats[0].bankroll];
  };
  assert.deepStrictEqual(play({}), [[{ hand: 0, result: 'lose', net: -200 }, { hand: 1, result: 'lose', net: -200 }], 600]);
  // 只輸原注：第一手輸原本那 100（加倍的那份退回），分出來的第二手整份退回
  assert.deepStrictEqual(play(ORIGINAL), [[{ hand: 0, result: 'lose', net: -100 }, { hand: 1, result: 'push', net: 0 }], 900]);

  // 第一手 8+10＝18 停，第二手 8+3 加倍補 K＝21：18 輸、21 平手退回加倍後的 200
  const g = oneSeat(['8', 'A', '8', 'K', '10', '3', 'K']);
  g.startRound({ p: 100 });
  g.act('p', 'split');
  g.act('p', 'stand');
  g.act('p', 'double');
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'lose', net: -100 }, { hand: 1, result: 'push', net: 0 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 900);

  // 只輸原注時，分出來的手爆牌也退回；第一手爆牌照輸原注
  for (const [rules, want, bank] of [[{}, [-100, -100], 800], [ORIGINAL, [-100, 0], 900]]) {
    const b = oneSeat(['8', 'A', '8', 'K', '6', 'K', '6', 'K'], 1000, rules);
    b.startRound({ p: 100 });
    b.act('p', 'split');
    b.act('p', 'hit');
    b.act('p', 'hit');
    const st = settles(b.finishRound());
    assert.deepStrictEqual(st.map(s => s.net), want, JSON.stringify(rules));
    assert.strictEqual(st[0].result, 'bust');
    assert.strictEqual(b.state().seats[0].bankroll, bank);
  }
});

test('不偷看：荷官藏著 Blackjack 時，每個座位照樣輪流打完（加倍、分牌、要牌都照常），最後才翻牌一起結算', () => {
  // 甲 5+6 加倍補 9＝20；乙 8+8 分牌，第一手補 3 要牌補 K＝21、第二手補 9＝17 停；荷官明牌 A、底牌 K
  const g = createGame({
    rng: noRng,
    shoe: stackedShoe(['5', '8', 'A', '6', '8', 'K', '9', '3', 'K', '9']),
    seats: [{ id: 'a', name: '甲', bankroll: 1000 }, { id: 'b', name: '乙', bankroll: 1000 }],
  });
  const played = [g.startRound({ a: 100, b: 100 }), g.act('a', 'double'), g.act('b', 'split'), g.act('b', 'hit'), g.act('b', 'stand')].flat();
  assert.deepStrictEqual(played.filter(e => e.type === 'turn').map(e => `${e.seat}${e.hand}`), ['a0', 'b0', 'b0', 'b1']);
  assert.ok(!played.some(e => e.type === 'reveal' || e.type === 'dealerBlackjack' || e.type === 'settle'), '打完之前不翻底牌、不結算');
  assert.strictEqual(g.state().phase, 'dealer');
  const fin = g.finishRound();
  assert.deepStrictEqual(typesOf(fin), ['reveal', 'dealerBlackjack', 'settle0', 'settle0', 'settle1', 'roundEnd']);
  assert.deepStrictEqual(fin.filter(e => e.type === 'settle').map(({ seat, hand, result, net }) => `${seat}${hand} ${result} ${net}`),
    ['a0 lose -200', 'b0 push 0', 'b1 lose -100']);
  assert.deepStrictEqual(g.state().seats.map(s => s.bankroll), [800, 900]);
  assert.strictEqual(g.state().house, 300);
});

test('分後 Blackjack 碰到荷官最後翻出的 Blackjack：平手退回（兩種 dealerBlackjackPush 都是），另一手照輸', () => {
  for (const rules of [{}, ONLY_BJ]) {
    // A+A 對 10（底牌 A）：第一手補 K 是分後 Blackjack，第二手補 9 是 20 點
    const g = oneSeat(['A', '10', 'A', 'A', 'K', '9'], 1000, rules);
    g.startRound({ p: 100 });
    g.act('p', 'split');
    const fin = g.finishRound();
    assert.deepStrictEqual(settles(fin), [{ hand: 0, result: 'push', net: 0 }, { hand: 1, result: 'lose', net: -100 }], JSON.stringify(rules));
    assert.strictEqual(g.state().seats[0].bankroll, 900);
  }
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

test('下注列預填的注沿用上一注，但對齊 10 的倍數、不超過籌碼；預設沒有上限，給了 maxBet 才夾（BJK-02）', () => {
  assert.strictEqual(DEFAULTS.maxBet, Infinity);
  assert.strictEqual(prefillBet(500, 15), 10);
  assert.strictEqual(prefillBet(500, 45), 40);
  assert.strictEqual(prefillBet(1000, 995), 990);
  assert.strictEqual(prefillBet(50, 1015), 50);
  assert.strictEqual(prefillBet(5000, 99999), 5000);
  assert.strictEqual(prefillBet(50000, 23455), 23450);
  assert.strictEqual(prefillBet(5000, 99999, { maxBet: 1000 }), 1000);
  assert.strictEqual(prefillBet(500, 5), 0);
});

test('籌碼鈕超過能押的就押到全部（對齊 10 的倍數、不超過 maxBet）；已經押到全部就加不上去', () => {
  assert.strictEqual(addChip(10, 1000, 1000), 1000);
  assert.strictEqual(addChip(10, 2000, 1000), 1000);
  assert.strictEqual(addChip(0, 2000, 1005), 1000);
  assert.strictEqual(addChip(10, 50, 1000), 60);
  assert.strictEqual(addChip(0, 2000, 99999), 2000);
  assert.strictEqual(addChip(1000, 10, 1000), 1000);
  assert.strictEqual(addChip(990, 500, 995), 990);
  assert.strictEqual(addChip(500, 2000, 5000, { maxBet: 1000 }), 1000);
});

test('下注沒有上限：最多押上手上全部籌碼；最低注與 10 的倍數照舊，給了 maxBet 才擋', () => {
  const g = oneSeat(['10', '9', '8', '7'], 5000);
  g.startRound({ p: 5000 });
  assert.strictEqual(g.state().seats[0].bankroll, 0);
  assert.strictEqual(g.state().seats[0].totalBet, 5000);
  assert.throws(() => oneSeat(['10', '9', '8', '7'], 5000).startRound({ p: 5010 }), /不夠下/);
  assert.throws(() => oneSeat(['10', '9', '8', '7'], 5000, { maxBet: 1000 }).startRound({ p: 2000 }), /超過上限 1000/);
  assert.throws(() => oneSeat(['10', '9', '8', '7'], 5000, { minBet: 20 }).startRound({ p: 10 }), /低於最低注 20/);
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

test('分牌（預設 splitOneCard: false）：A 以外分出來的手照一般的手打，輪到它才補第二張，可以要牌、停牌；逐手結算', () => {
  assert.strictEqual(DEFAULTS.splitOneCard, false);
  // 8+8 對荷官 6＋10：分牌 → 第一手補 3（11 點）輪到它 → 要牌補 5 成 16 → 停；第二手補 K（18）→ 停
  const g = oneSeat(['8', '6', '8', '10', '3', '5', 'K', 'A']);
  g.startRound({ p: 100 });
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'split']);
  const ev = g.act('p', 'split');
  assert.deepStrictEqual(typesOf(ev), ['split0', 'deal0', 'turn0']);
  assert.deepStrictEqual(ev[0], { type: 'split', seat: 'p', hand: 0, card: { rank: '8', suit: 'D' }, amount: 100 });
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'double']);
  assert.deepStrictEqual(typesOf(g.act('p', 'hit')), ['deal0']);
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand']);
  assert.deepStrictEqual(typesOf(g.act('p', 'stand')), ['stand0', 'deal1', 'turn1']);
  g.act('p', 'stand');
  assert.deepStrictEqual(handsOf(g), ['8+3+5', '8+K']);
  assert.strictEqual(g.state().seats[0].bankroll, 800);
  assert.strictEqual(g.state().seats[0].totalBet, 200);
  // 荷官 16 補 A 成 17：16 點那手輸、18 點那手贏，帳平
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'lose', net: -100 }, { hand: 1, result: 'win', net: 100 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
  assert.strictEqual(g.state().house, 0);
});

test('分牌後可以加倍（頭兩張 10、11 點），加的是那一手的原注', () => {
  // 8+8 對荷官 6＋10：第一手補 2（10 點）加倍補 9 成 19；第二手補 3（11 點）加倍補 2 成 13
  const g = oneSeat(['8', '6', '8', '10', '2', '9', '3', '2', 'A']);
  g.startRound({ p: 100 });
  g.act('p', 'split');
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'double']);
  const d0 = g.act('p', 'double');
  assert.deepStrictEqual(typesOf(d0), ['double0', 'deal0', 'stand0', 'deal1', 'turn1']);
  assert.deepStrictEqual(d0[0], { type: 'double', seat: 'p', hand: 0, amount: 200 });
  g.act('p', 'double');
  assert.deepStrictEqual(handsOf(g), ['8+2+9', '8+3+2']);
  assert.strictEqual(g.state().seats[0].bankroll, 600);
  // 荷官 17：19 點加倍贏兩份、13 點加倍輸兩份
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'win', net: 200 }, { hand: 1, result: 'lose', net: -200 }]);
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
});

test('分完又補到同點數可以再分，不限手數；新的一手插在這一手後面，每一手都輪到你打', () => {
  const g = oneSeat(['8', '6', '8', '10', '8', '8', '8', '8', '2', '3', '4', '5', '7', '9', 'A']);
  g.startRound({ p: 100 });
  g.act('p', 'split');
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'split']);
  for (let i = 0; i < 4; i++) g.act('p', 'split');
  assert.strictEqual(DEFAULTS.maxHands, Infinity);
  for (let k = 0; k < 6; k++) {
    assert.strictEqual(g.state().turnHand, k);
    g.act('p', 'stand');
  }
  assert.deepStrictEqual(handsOf(g), ['8+2', '8+3', '8+4', '8+5', '8+7', '8+9']);
  // 還沒補牌的手都只有一張 8，看點數分不出插在哪；看花色：最後分出來的 8♣ 插在第 1 手、第一次分出來的 8♦ 被擠到最後
  assert.deepStrictEqual(g.state().seats[0].hands.map(x => x.cards[0].suit), ['S', 'C', 'D', 'H', 'S', 'D']);
  assert.strictEqual(g.state().seats[0].bankroll, 400);
  // 荷官 17：只有 17 點那手平手，其他五手輸
  assert.deepStrictEqual(settles(g.finishRound()).map(s => s.net), [-100, -100, -100, -100, -100, 0]);
  assert.strictEqual(g.state().seats[0].bankroll, 500);
});

test('splitOneCard: true：分出來的每一手只補一張就停；又成對只能再分或停（不能要牌、不能加倍）', () => {
  const g = oneSeat(['8', '6', '8', '10', '3', 'K', 'A'], 1000, ONE);
  g.startRound({ p: 100 });
  const ev = g.act('p', 'split');
  assert.deepStrictEqual(typesOf(ev), ['split0', 'deal0', 'stand0', 'deal1', 'stand1']);
  assert.ok(ev.filter(e => e.type === 'stand').every(e => e.auto), '分出來的手補完牌自動停');
  assert.deepStrictEqual(handsOf(g), ['8+3', '8+K']);
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'lose', net: -100 }, { hand: 1, result: 'win', net: 100 }]);

  const again = oneSeat(['8', '6', '8', '10', '8'], 1000, ONE);
  again.startRound({ p: 100 });
  assert.deepStrictEqual(typesOf(again.act('p', 'split')), ['split0', 'deal0', 'turn0']);
  assert.deepStrictEqual(again.legal('p'), ['stand', 'split']);

  const five = oneSeat(['5', '9', '5', '7', '5'], 1000, ONE);
  five.startRound({ p: 100 });
  assert.deepStrictEqual(five.legal('p'), ['hit', 'stand', 'double', 'split']);
  five.act('p', 'split');
  assert.deepStrictEqual(five.legal('p'), ['stand', 'split'], '5+5 再成對是 10 點，只補一張的手照樣不能加倍');
});

test('maxHands: 4：分到第四手後再成對就不能分（只補一張的手自動停；一般的手照常要牌）', () => {
  const g = oneSeat(['8', '6', '8', '10', '8', '8', '8', '2', '3', '4', 'A'], 1000, { ...ONE, maxHands: 4 });
  g.startRound({ p: 100 });
  g.act('p', 'split');
  g.act('p', 'split');
  const ev = g.act('p', 'split');
  assert.deepStrictEqual(handsOf(g), ['8+8', '8+2', '8+3', '8+4']);
  assert.ok(ev.some(e => e.type === 'stand' && e.hand === 0 && e.auto), '第四手時再成對要自動停');
  assert.strictEqual(g.state().phase, 'dealer');

  const free = oneSeat(['8', '6', '8', '10', '8', '8', '8'], 1000, { maxHands: 4 });
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
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'split']);
  g.act('p', 'split');
  assert.strictEqual(g.state().seats[0].bankroll, 0);
  assert.deepStrictEqual(g.legal('p'), ['hit', 'stand'], '付不起就不能再分（16 點也不能加倍）');
  assert.deepStrictEqual(handsOf(g), ['8+8', '8', '8']);
});

test('分開的 A 各補一張就停（splitOneCard 預設 false 與 true 都一樣），A 又補到 A 只能再分或停；分後 A＋10 點牌算 Blackjack 賠 1.5 倍', () => {
  assert.strictEqual(DEFAULTS.splitBlackjack, true);
  for (const rules of [{}, ONE]) {
    // A+A 對荷官 9＋8（17）：第一手補 K 是 Blackjack、第二手補 7（軟 18）自動停
    const g = oneSeat(['A', '9', 'A', '8', 'K', '7'], 1000, rules);
    g.startRound({ p: 100 });
    assert.deepStrictEqual(g.legal('p'), ['hit', 'stand', 'split']);
    const ev = g.act('p', 'split');
    assert.deepStrictEqual(typesOf(ev), ['split0', 'deal0', 'blackjack0', 'deal1', 'stand1'], JSON.stringify(rules));
    assert.deepStrictEqual(handsOf(g), ['A+K', 'A+7']);
    assert.deepStrictEqual(g.state().seats[0].hands.map(h => h.status), ['blackjack', 'stood']);
    assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'blackjack', net: 150 }, { hand: 1, result: 'win', net: 100 }]);
    assert.strictEqual(g.state().seats[0].bankroll, 1250);
  }
  const again = oneSeat(['A', '9', 'A', '8', 'A']);
  again.startRound({ p: 100 });
  again.act('p', 'split');
  assert.deepStrictEqual(again.legal('p'), ['stand', 'split']);
});

test('分後 Blackjack 碰到荷官補到 21 點照樣贏 1.5 倍；10＋10 分開補到 A 也算；splitBlackjack: false 只算 21 點', () => {
  // A+A 對荷官 5＋6：第一手補 K（Blackjack）、第二手補 9（20），荷官 11 補 10 成 21
  const g = oneSeat(['A', '5', 'A', '6', 'K', '9', '10']);
  g.startRound({ p: 100 });
  g.act('p', 'split');
  assert.deepStrictEqual(settles(g.finishRound()), [{ hand: 0, result: 'blackjack', net: 150 }, { hand: 1, result: 'lose', net: -100 }]);

  const plain = oneSeat(['A', '5', 'A', '6', 'K', '9', '10'], 1000, { splitBlackjack: false });
  plain.startRound({ p: 100 });
  assert.ok(!plain.act('p', 'split').some(e => e.type === 'blackjack'));
  assert.deepStrictEqual(settles(plain.finishRound()), [{ hand: 0, result: 'push', net: 0 }, { hand: 1, result: 'lose', net: -100 }]);

  // 10+K 對荷官 6＋10（16）：第一手補 A 是 Blackjack，第二手補 7（17）輪到你；荷官補 5 成 21
  const tens = oneSeat(['10', '6', 'K', '10', 'A', '7', '5']);
  tens.startRound({ p: 100 });
  assert.deepStrictEqual(typesOf(tens.act('p', 'split')), ['split0', 'deal0', 'blackjack0', 'deal1', 'turn1']);
  tens.act('p', 'stand');
  assert.deepStrictEqual(settles(tens.finishRound()), [{ hand: 0, result: 'blackjack', net: 150 }, { hand: 1, result: 'lose', net: -100 }]);
});

test('分牌的座位打完所有的手，才輪到下一個座位', () => {
  const g = createGame({
    rng: noRng,
    shoe: stackedShoe(['8', '10', '6', '8', '9', '10', '3', '4']),
    seats: [{ id: 'a', name: '甲', bankroll: 1000 }, { id: 'b', name: '乙', bankroll: 1000 }],
  });
  g.startRound({ a: 10, b: 10 });
  const turns = [g.act('a', 'split'), g.act('a', 'stand'), g.act('a', 'stand')].flat().filter(e => e.type === 'turn');
  assert.deepStrictEqual(turns, [{ type: 'turn', seat: 'a', hand: 0 }, { type: 'turn', seat: 'a', hand: 1 }, { type: 'turn', seat: 'b', hand: 0 }]);
  assert.strictEqual(g.state().turn, 'b');
});

test('規則參數打錯字當場擲錯', () => {
  const make = rules => () => oneSeat(['10', '10', '8', '8'], 1000, rules);
  assert.throws(make({ doubleOn: 'sometimes' }), /doubleOn/);
  assert.throws(make({ splitBy: 'suit' }), /splitBy/);
  assert.throws(make({ splitOneCard: 'tens' }), /splitOneCard/);
  assert.throws(make({ splitBlackjack: 'yes' }), /splitBlackjack/);
  assert.throws(make({ maxHands: 0 }), /maxHands/);
  assert.throws(make({ maxBet: 5 }), /maxBet/);
  assert.throws(make({ peek: 'no' }), /peek/);
  assert.throws(make({ dealerBlackjackTakes: 'some' }), /dealerBlackjackTakes/);
  assert.throws(make({ dealerBlackjackPush: 21 }), /dealerBlackjackPush/);
  assert.doesNotThrow(make({ maxHands: 1, maxBet: 1000, peek: true, dealerBlackjackTakes: 'original', dealerBlackjackPush: 'blackjack' }));
  assert.deepStrictEqual([DEFAULTS.peek, DEFAULTS.dealerBlackjackTakes, DEFAULTS.dealerBlackjackPush], [false, 'all', 'any21']);
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

// 畫面與 AI 都拿 state() 來讀；回傳的若是引擎裡的同一個物件，誰改了它就等於偷改牌局
test('state() 回傳的是拷貝：改它的牌、手、座位，引擎裡的照舊', () => {
  const g = oneSeat(['10', '9', '8', '7']);
  g.startRound({ p: 100 });
  const before = JSON.stringify(g.state());
  const st = g.state();
  st.dealer.cards[0].rank = 'A';
  st.dealer.cards.push({ rank: 'K', suit: 'S' });
  st.seats[0].hands[0].cards[0].rank = 'A';
  st.seats[0].hands[0].cards.push({ rank: 'K', suit: 'S' });
  st.seats[0].hands[0].bet = 1;
  st.seats[0].hands.push({});
  st.seats[0].bankroll = 0;
  assert.strictEqual(JSON.stringify(g.state()), before);
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
  assert.throws(() => g.startRound({ p: 2000 }), /不夠下/);
  assert.throws(() => g.startRound({ p: 0 }), /至少要有一個座位下注/);
  const poor = oneSeat(['10', '10', '8', '8'], 50);
  assert.throws(() => poor.startRound({ p: 100 }), /不夠下/);
  assert.strictEqual(g.state().seats[0].bankroll, 1000);
  assert.strictEqual(g.state().phase, 'idle');
});
