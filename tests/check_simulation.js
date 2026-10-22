// 長跑模擬：真的牌靴、真的洗牌，跑上萬局看帳對不對、三種個性的強弱對不對
const test = require('node:test');
const assert = require('node:assert');
const { createGame } = require('../app/js/core/game.js');
const { bet } = require('../app/js/core/strategy.js');
const { rng } = require('./rng_util');

function playOut(g) {
  while (g.state().phase === 'player') {
    const id = g.state().turn;
    g.act(id, g.aiChoice(id));
  }
  if (g.state().phase === 'dealer') g.finishRound();
}

test('一萬局全 AI 對局：每局結束後「籌碼總和＋莊家盈虧＝起始＋補給」，沒有人變負數', () => {
  const r = rng(2026);
  const seats = [
    { id: 's0', name: '甲', personality: 'reckless', bankroll: 1000 },
    { id: 's1', name: '乙', personality: 'steady', bankroll: 1000 },
    { id: 'me', name: '玩家', personality: null, bankroll: 1000 },
    { id: 's3', name: '丙', personality: 'timid', bankroll: 1000 },
  ];
  const g = createGame({ rng: r, seats });
  const initial = 4000;
  let shuffles = 0, doubles = 0, blackjacks = 0;
  for (let round = 0; round < 10000; round++) {
    for (const s of g.state().seats) if (s.bankroll < g.rules.minBet) g.topUp(s.id, 1000);
    const bets = {};
    for (const s of g.state().seats) bets[s.id] = bet(s.personality || 'steady', s.bankroll, r, g.rules);
    const events = g.startRound(bets);
    shuffles += events.filter(e => e.type === 'shuffle').length;
    blackjacks += events.filter(e => e.type === 'blackjack').length;
    while (g.state().phase === 'player') {
      const id = g.state().turn;
      const action = g.aiChoice(id);
      if (action === 'double') doubles++;
      g.act(id, action);
    }
    if (g.state().phase === 'dealer') g.finishRound();
    const st = g.state();
    const total = st.seats.reduce((a, s) => a + s.bankroll, 0);
    if (total + st.house !== initial + st.topUps) {
      assert.fail(`第 ${round} 局帳不平：籌碼 ${total} ＋ 莊家 ${st.house} ≠ 起始 ${initial} ＋ 補給 ${st.topUps}`);
    }
    const negative = st.seats.find(s => s.bankroll < 0);
    if (negative) assert.fail(`第 ${round} 局 ${negative.name} 的籌碼變成 ${negative.bankroll}`);
  }
  // 確認這一萬局真的走過重洗、加倍、Blackjack 這些分支，不是一直重複同一種局面
  assert.ok(shuffles > 100, `只洗了 ${shuffles} 次`);
  assert.ok(doubles > 100, `只加倍了 ${doubles} 次`);
  assert.ok(blackjacks > 100, `只出現 ${blackjacks} 次 Blackjack`);
});

// aiChoice 會把牌局的 rng 傳給策略，所以量到的是帶人性化隨機的打法
test('三種個性的長期期望值：穩健（基本策略帶少量隨機）比莽撞、膽小都至少少輸 1%', t => {
  const ROUNDS = 100000, UNIT = 10;
  const ids = ['steady', 'reckless', 'timid'];
  const g = createGame({
    rng: rng(77),
    seats: ids.map(id => ({ id, name: id, personality: id, bankroll: 1e12 })),
  });
  const start = g.state().seats.map(s => s.bankroll);
  for (let i = 0; i < ROUNDS; i++) {
    g.startRound(Object.fromEntries(ids.map(id => [id, UNIT])));
    playOut(g);
  }
  const ev = {};
  g.state().seats.forEach((s, i) => { ev[s.id] = (s.bankroll - start[i]) / (ROUNDS * UNIT); });
  // 量測值照實印出來，不設絕對門檻：數字會隨種子小幅浮動，只斷言三者的強弱順序
  t.diagnostic(`每注期望值（${ROUNDS.toLocaleString()} 局）：穩健 ${(ev.steady * 100).toFixed(2)}%、莽撞 ${(ev.reckless * 100).toFixed(2)}%、膽小 ${(ev.timid * 100).toFixed(2)}%`);
  assert.ok(ev.steady > ev.reckless + 0.01, `穩健 ${ev.steady} 沒有明顯勝過莽撞 ${ev.reckless}`);
  assert.ok(ev.steady > ev.timid + 0.01, `穩健 ${ev.steady} 沒有明顯勝過膽小 ${ev.timid}`);
});
