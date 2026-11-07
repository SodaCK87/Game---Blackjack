// 戰績（core/stats.js）：用疊好的牌打真的牌局，把引擎吐出的事件丟進 record()，數字要對；存檔讀回來格式不對一律當新玩家
const test = require('node:test');
const assert = require('node:assert');
const { createGame } = require('../app/js/core/game.js');
const S = require('../app/js/core/stats.js');
const { stackedShoe } = require('./shoe_util');

const noRng = () => { throw new Error('疊牌的牌局不該用到亂數'); };
// 一局打完回傳全部事件與結算後的籌碼。actions 是輪到玩家時依序做的動作；發牌順序：玩家、荷官明牌、玩家、荷官底牌、之後照要牌順序
function round(ranks, actions = [], bet = 100, bankroll = 1000) {
  const g = createGame({ rng: noRng, shoe: stackedShoe(ranks), seats: [{ id: 'me', name: '你', bankroll }] });
  const events = [...g.startRound({ me: bet })];
  for (const a of actions) events.push(...g.act('me', a));
  if (g.state().phase === 'dealer') events.push(...g.finishRound());
  return { events, bankroll: g.state().seats[0].bankroll };
}
const play = (stats, r) => S.record(stats, r.events, { seat: 'me', bankroll: r.bankroll });

const WIN = () => round(['10', '9', 'K', '8'], ['stand']);                 // 20 對 17
const PUSH = () => round(['10', '9', '7', '8'], ['stand']);                // 17 對 17
const LOSS = () => round(['10', '10', '6', '8'], ['stand']);               // 16 對 18
const BJ = () => round(['A', '9', 'K', '8']);                               // Blackjack
const BUST = () => round(['10', '9', '6', '8', 'K'], ['hit']);              // 16 要到 26

test('贏、輸、平、Blackjack、爆牌各記在對的欄位，淨輸贏與籌碼最高點跟著走', () => {
  let s = S.empty(1000);
  s = play(s, WIN());
  s = play(s, LOSS());
  s = play(s, PUSH());
  s = play(s, BJ());
  s = play(s, BUST());
  assert.deepStrictEqual(
    { rounds: s.rounds, hands: s.hands, wins: s.wins, losses: s.losses, pushes: s.pushes, blackjacks: s.blackjacks, busts: s.busts, net: s.net },
    { rounds: 5, hands: 5, wins: 2, losses: 2, pushes: 1, blackjacks: 1, busts: 1, net: 100 - 100 + 0 + 150 - 100 });
  assert.strictEqual(s.peak, 1150, '每一局都從 1,000 起算，Blackjack 那局結算後 1,150 最高');
});

test('連勝以局計：贏加一、輸歸零、平手不變，最長的留著', () => {
  let s = S.empty(1000);
  for (const r of [WIN, WIN, PUSH, WIN, LOSS, WIN]) s = play(s, r());
  assert.strictEqual(s.streak, 1);
  assert.strictEqual(s.bestStreak, 3);
});

test('分牌：一局兩手各記一手，加倍與分牌的次數也記；一局淨輸贏是正的才算贏一局', () => {
  // 8+8 對荷官 10+7：分開後第一手補 3 加倍補 K＝21，第二手補 10 停＝18；荷官 17 停。兩手都贏
  const r = round(['8', '10', '8', '7', '3', 'K', '10'], ['split', 'double', 'stand']);
  const s = play(S.empty(1000), r);
  assert.deepStrictEqual({ rounds: s.rounds, hands: s.hands, wins: s.wins, splits: s.splits, doubles: s.doubles, streak: s.streak, net: s.net },
    { rounds: 1, hands: 2, wins: 2, splits: 1, doubles: 1, streak: 1, net: 300 });
});

test('別的座位的事件不算進玩家的戰績；沒有結算的事件不算一局', () => {
  const s0 = S.empty(1000);
  const r = WIN();
  const other = r.events.map(e => (e.seat === 'me' ? { ...e, seat: 'ai' } : e));
  assert.strictEqual(S.record(s0, other, { seat: 'me', bankroll: 1100 }), s0);
  assert.strictEqual(S.record(s0, r.events.filter(e => e.type !== 'settle'), { seat: 'me', bankroll: 1100 }), s0);
});

test('照基本策略的比例：還沒做過決定是 null，之後四捨五入到整數', () => {
  let s = S.empty(1000);
  assert.strictEqual(S.basicRate(s), null);
  s = S.decide(S.decide(S.decide(s, true), true), false);
  assert.deepStrictEqual({ decisions: s.decisions, basic: s.basic, rate: S.basicRate(s) }, { decisions: 3, basic: 2, rate: 67 });
});

test('record 與 decide 不改傳進來的物件', () => {
  const s0 = Object.freeze(S.empty(1000));
  assert.doesNotThrow(() => { play(s0, WIN()); S.decide(s0, true); });
  assert.strictEqual(s0.rounds, 0);
});

test('讀回來的存檔：正常的照收；格式不對、欄位不對、數字互相矛盾一律當新玩家', () => {
  let good = S.empty(1000);
  for (const r of [WIN, LOSS, BJ]) good = play(good, r());
  good = S.decide(good, true);
  assert.deepStrictEqual(S.parse(JSON.parse(JSON.stringify(good)), 500), good);
  const fresh = S.empty(500);
  const bad = [null, 'x', 42, [], {}, { ...good, v: 2 }, { ...good, wins: -1 }, { ...good, rounds: 1.5 }, { ...good, peak: '9' },
    { ...good, basic: good.decisions + 1 }, { ...good, hands: good.hands + 1 }, { ...good, streak: good.bestStreak + 1 },
    Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'busts'))];
  for (const b of bad) assert.deepStrictEqual(S.parse(b, 500), fresh, JSON.stringify(b));
  assert.strictEqual(S.parse({ ...good, net: -300 }, 500).net, -300, '淨輸贏可以是負的');
});
