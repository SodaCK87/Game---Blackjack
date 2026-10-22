// 一手牌的點數。牌的形狀：{ rank: 'A'|'2'…'10'|'J'|'Q'|'K', suit: 'S'|'H'|'D'|'C' }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BJK = root.BJK || {}).hand = factory();
})(globalThis, function () {
  const TEN = new Set(['10', 'J', 'Q', 'K']);

  function rankValue(rank) {
    if (rank === 'A') return 1;
    return TEN.has(rank) ? 10 : Number(rank);
  }

  // 一手牌最多只會有一張 A 算 11（兩張就 22 爆了），所以先全算 1、能加 10 就加
  function value(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      total += rankValue(c.rank);
      if (c.rank === 'A') aces++;
    }
    const soft = aces > 0 && total + 10 <= 21;
    if (soft) total += 10;
    return { total, soft, bust: total > 21, blackjack: cards.length === 2 && total === 21 };
  }

  return { value, rankValue, isTen: rank => TEN.has(rank) };
});
