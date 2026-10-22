// 測試用的疊牌牌靴：照給的順序發牌，介面與 core/shoe.js 的 createShoe 相同。
// 發牌順序：每位閒家一張 → 荷官明牌 → 每位閒家第二張 → 荷官底牌 → 之後依要牌順序
function stackedShoe(ranks) {
  const cards = ranks.map((rank, i) => ({ rank, suit: 'SHDC'[i % 4] }));
  let next = 0;
  return {
    size: cards.length,
    get remaining() { return cards.length - next; },
    needsShuffle: () => false,
    shuffle() {},
    draw() {
      if (next >= cards.length) throw new Error(`疊好的 ${cards.length} 張牌不夠發`);
      return cards[next++];
    },
    discard() {},
    recycle() { throw new Error('疊好的牌不該用到回收'); },
  };
}

module.exports = { stackedShoe };
