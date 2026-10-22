// AI 同桌的三種個性：要牌／停牌／加倍怎麼選、每局下多少
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand.js'));
  else (root.BJK = root.BJK || {}).strategy = factory(root.BJK.hand);
})(globalThis, function (hand) {
  if (!hand) throw new Error('core 載入順序錯：strategy.js 要排在 hand.js 之後');

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
      return 'hit';
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

  function decide(personality, cards, up, canDouble) {
    const fn = DECIDE[personality];
    if (!fn) throw new Error(`沒有這種個性：${personality}`);
    return fn(cards, up, canDouble);
  }

  // 回傳 0 代表坐著不下注（籌碼不夠最低注）
  function bet(personality, bankroll, rng, { minBet, maxBet, step }) {
    if (bankroll < minBet) return 0;
    let want;
    if (personality === 'timid') want = minBet;
    else if (personality === 'reckless') want = bankroll * (0.1 + rng() * 0.2);
    else want = bankroll * 0.05;
    const cap = Math.min(maxBet, bankroll);
    const amount = Math.floor(Math.min(Math.max(want, minBet), cap) / step) * step;
    return amount >= minBet ? amount : 0;
  }

  return { PERSONALITIES, decide, bet, basic };
});
