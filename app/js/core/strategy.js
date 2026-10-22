// AI 同桌的三種個性：要牌／停牌／加倍怎麼選、每局下多少
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand.js'));
  else (root.BJK = root.BJK || {}).strategy = factory(root.BJK.hand);
})(globalThis, function (hand) {
  if (!hand) throw new Error('core 載入順序錯：strategy.js 要排在 hand.js 之後');

  // 下面括號裡是固定打法；牌局裡傳了 rng，會在這個基準附近隨機搖擺（見 HUMAN）
  const PERSONALITIES = {
    steady: { label: '穩健' },    // 照基本策略
    reckless: { label: '莽撞' },  // 16 點以下都要牌，9–11 點一律加倍，下注大
    timid: { label: '膽小' },     // 硬牌 12 點就停，從不加倍，只下最低注
  };

  // 莊家明牌換成 2–11（A 算 11）
  function upValue(card) {
    return card.rank === 'A' ? 11 : hand.rankValue(card.rank);
  }

  // 6 副牌、莊家軟 17 停、不分牌不投降的基本策略；不能加倍時「加倍或停」停、「加倍或要」要
  function basic(cards, up, canDouble) {
    const { total: t, soft } = hand.value(cards);
    const d = upValue(up);
    const dbl = fallback => (canDouble ? 'double' : fallback);
    if (soft) {
      if (t >= 19) return 'stand';
      if (t === 18) {
        if (d >= 3 && d <= 6) return dbl('stand');
        return d <= 8 ? 'stand' : 'hit';
      }
      if (t === 17) return d >= 3 && d <= 6 ? dbl('hit') : 'hit';
      if (t >= 15) return d >= 4 && d <= 6 ? dbl('hit') : 'hit';
      if (t >= 13) return d >= 5 && d <= 6 ? dbl('hit') : 'hit';
      // 軟 12 只會是 A+A：公開的表是分牌，不能分牌時逐張扣牌精確算過，只有對 6 加倍贏要牌（0.1907 對 0.1880）
      return d === 6 ? dbl('hit') : 'hit';
    }
    if (t >= 17) return 'stand';
    if (t >= 13) return d <= 6 ? 'stand' : 'hit';
    if (t === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
    if (t === 11) return d <= 10 ? dbl('hit') : 'hit';
    if (t === 10) return d <= 9 ? dbl('hit') : 'hit';
    if (t === 9) return d >= 3 && d <= 6 ? dbl('hit') : 'hit';
    return 'hit';
  }

  function reckless(cards, up, canDouble) {
    const { total: t, soft } = hand.value(cards);
    if (soft) return t >= 19 ? 'stand' : 'hit';
    if (t >= 17) return 'stand';
    if (t >= 9 && t <= 11 && canDouble) return 'double';
    return 'hit';
  }

  function timid(cards) {
    const { total: t, soft } = hand.value(cards);
    if (soft) return t >= 18 ? 'stand' : 'hit';
    return t >= 12 ? 'stand' : 'hit';
  }

  const DECIDE = { steady: basic, reckless, timid };

  // ---- 人性化的隨機（有傳 rng 才用）：同一手牌不一定每次同一個決定，但只在個性的邊界附近搖擺，不做明顯的蠢事 ----
  const chance = (rng, p) => rng() < p;

  // 穩健：照基本策略，偶爾不敢加倍，12–16 點這種兩難的牌偶爾憑手感
  function steadyHuman(cards, up, canDouble, rng) {
    const base = basic(cards, up, canDouble);
    const { total: t, soft } = hand.value(cards);
    if (base === 'double') return chance(rng, 0.1) ? basic(cards, up, false) : 'double';
    if (!soft && t >= 12 && t <= 16 && chance(rng, 0.08)) return base === 'hit' ? 'stand' : 'hit';
    return base;
  }

  // 莽撞：16 點多半還要、17 點三成硬拚，9–11 點幾乎都加倍，軟牌偶爾衝動加倍
  function recklessHuman(cards, up, canDouble, rng) {
    const { total: t, soft } = hand.value(cards);
    if (soft) {
      if (canDouble && t >= 16 && t <= 18 && chance(rng, 0.15)) return 'double';
      if (t <= 17) return 'hit';
      if (t === 18) return chance(rng, 0.6) ? 'hit' : 'stand';
      return 'stand';
    }
    if (t >= 9 && t <= 11 && canDouble) return chance(rng, 0.85) ? 'double' : 'hit';
    if (t <= 15) return 'hit';
    if (t === 16) return chance(rng, 0.15) ? 'stand' : 'hit';
    if (t === 17) return chance(rng, 0.35) ? 'hit' : 'stand';
    if (t === 18) return chance(rng, 0.1) ? 'hit' : 'stand';
    return 'stand';
  }

  // 膽小：多半 12 點就停，偶爾鼓起勇氣多要一張；從不加倍
  function timidHuman(cards, up, canDouble, rng) {
    const { total: t, soft } = hand.value(cards);
    if (soft) {
      if (t <= 16) return 'hit';
      if (t === 17) return chance(rng, 0.6) ? 'stand' : 'hit';
      return 'stand';
    }
    if (t <= 11) return 'hit';
    if (t === 12) return chance(rng, 0.75) ? 'stand' : 'hit';
    if (t === 13) return chance(rng, 0.9) ? 'stand' : 'hit';
    return 'stand';
  }

  const HUMAN = { steady: steadyHuman, reckless: recklessHuman, timid: timidHuman };

  // 不傳 rng 就是照表的固定打法（單元測試對著基本策略表逐格比的就是這條）
  function decide(personality, cards, up, canDouble, rng) {
    if (!DECIDE[personality]) throw new Error(`沒有這種個性：${personality}`);
    if (rng) return HUMAN[personality](cards, up, canDouble, rng);
    return DECIDE[personality](cards, up, canDouble);
  }

  // 回傳 0 代表坐著不下注（籌碼不夠最低注）
  // 膽小多半最低注、偶爾兩倍；莽撞 10–30%，偶爾押一半；穩健 3–7%
  function bet(personality, bankroll, rng, { minBet, maxBet, step }) {
    if (bankroll < minBet) return 0;
    let want;
    if (personality === 'timid') want = rng() < 0.2 ? minBet * 2 : minBet;
    else if (personality === 'reckless') want = rng() < 0.08 ? bankroll * 0.5 : bankroll * (0.1 + rng() * 0.2);
    else want = bankroll * (0.03 + rng() * 0.04);
    const cap = Math.min(maxBet, bankroll);
    const amount = Math.floor(Math.min(Math.max(want, minBet), cap) / step) * step;
    return amount >= minBet ? amount : 0;
  }

  return { PERSONALITIES, decide, bet, basic };
});
