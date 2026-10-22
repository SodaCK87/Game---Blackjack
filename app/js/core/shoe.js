// 牌靴：多副牌洗在一起，發到切牌點（預設 75%）後下一局開始前整靴重洗
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BJK = root.BJK || {}).shoe = factory();
})(globalThis, function () {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['S', 'H', 'D', 'C'];

  function freshDecks(decks) {
    const cards = [];
    for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
    return cards;
  }

  function shuffleInPlace(cards, rng) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function createShoe({ decks = 6, penetration = 0.75, rng }) {
    if (typeof rng !== 'function') throw new Error('createShoe 需要呼叫端傳入亂數函式 rng');
    const size = decks * 52;
    let cards = [], discards = [], dealt = 0;
    const shoe = {
      size,
      get remaining() { return cards.length; },
      get dealt() { return dealt; },
      needsShuffle() { return dealt >= size * penetration; },
      shuffle() {
        cards = shuffleInPlace(freshDecks(decks), rng);
        discards = [];
        dealt = 0;
      },
      draw() {
        if (cards.length === 0) throw new Error('牌靴空了：要先 recycle()');
        dealt++;
        return cards.pop();
      },
      discard(list) { discards.push(...list); },
      // 一局裡把牌發光（理論上要一手吃很多張小牌才會發生）：把棄牌盒洗回牌靴繼續發
      recycle() {
        cards = shuffleInPlace(discards, rng);
        discards = [];
      },
    };
    shoe.shuffle();
    return shoe;
  }

  return { createShoe, freshDecks, RANKS, SUITS };
});
