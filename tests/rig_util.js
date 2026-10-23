// 探針共用：讓畫面上那一桌照給的順序發牌，發完再接一般洗好的牌靴。要打到分牌、四顆動作鈕全出現這種
// 靠運氣很少撞到的局面時用。做法是頁面載入前（withPage 的 init）攔下 core 掛 BJK.game 的那一刻，
// 只替座位裡有「你」的牌局換牌靴；main.js 開頁自檢的那局全 AI 牌局照常洗牌。產品檔一個字都不改。
// 發牌順序：有下注的座位照輪流順序（小虎、你、阿德、阿美）各一張 → 荷官明牌 → 各座位第二張 → 荷官底牌 →
// 之後照要牌、分牌補牌的順序。AI 拿 10＋9（19 點、不成對）三種個性都會停牌，不會吃掉後面疊好的牌
function rigInit(ranks) {
  return `(() => {
    const queue = ${JSON.stringify(ranks)}.map((rank, i) => ({ rank, suit: 'SHDC'[i % 4] }));
    const B = window.BJK = window.BJK || {};
    let real;
    Object.defineProperty(B, 'game', {
      configurable: true, enumerable: true,
      get() { return real; },
      set(g) {
        const create = g.createGame;
        real = Object.assign({}, g, {
          createGame(o) {
            if (!o.seats.some(s => s.id === 'me')) return create(o);
            const shoe = B.shoe.createShoe({ decks: 6, penetration: 0.75, rng: o.rng });
            return create(Object.assign({}, o, { shoe: {
              size: shoe.size,
              get remaining() { return shoe.remaining + queue.length; },
              get dealt() { return shoe.dealt; },
              needsShuffle: () => !queue.length && shoe.needsShuffle(),
              shuffle: () => { if (!queue.length) shoe.shuffle(); },
              draw: () => (queue.length ? queue.shift() : shoe.draw()),
              discard: list => shoe.discard(list),
              recycle: () => shoe.recycle(),
            } }));
          },
        });
      },
    });
  })();`;
}

// 常用的開局：小虎、阿德、阿美都拿 19 點，荷官明牌 6、底牌 10（16 點），你拿 a、b
const deal = (a, b) => ['10', a, '10', '10', '6', '9', b, '9', '9', '10'];

// 你拿 8、8，一路分成 n 手：第一手補到 8 就再分，分到 n 手後第一手補 K，之後各手補不成對、不到 21 點的牌
//（分出來的手照一般的手打，探針要逐手按停牌），最後一手又補到 8——停在「最後一手又成對、問你要牌、停牌或再分」，
// n 手都各有兩張牌，畫面是靜止的
function splitInto(n) {
  const fillers = ['K', '3', '9', 'A', '2', '5', '7', 'Q', '4', 'J', '6'];
  return [...deal('8', '8'), ...Array(n - 2).fill('8'), ...fillers.slice(0, n - 1), '8'];
}

module.exports = { rigInit, deal, splitInto };
