// 勝率提示：只用桌上「看得到」的牌（自己的牌、荷官明牌、同桌亮出的牌），算要牌／停牌／加倍各自的勝、平、輸機率。
// 荷官底牌是蓋著的，這裡拿不到也不准拿。
// 近似：剩下的牌照「牌靴扣掉亮出的牌」的比例抽，之後每抽一張不再回頭調整比例；
// 與真的一張一張扣的模擬比對，誤差見 tests/check_odds.js 印出的數字。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hand.js'));
  else (root.BJK = root.BJK || {}).odds = factory(root.BJK.hand);
})(globalThis, function (hand) {
  if (!hand) throw new Error('core 載入順序錯：odds.js 要排在 hand.js 之後');

  // 點數 1（A）到 10（10、J、Q、K）各還剩幾張
  function remaining(decks, seen) {
    const counts = new Array(11).fill(0);
    for (let v = 1; v <= 9; v++) counts[v] = 4 * decks;
    counts[10] = 16 * decks;
    for (const c of seen) counts[hand.rankValue(c.rank)]--;
    if (counts.some(n => n < 0)) throw new Error('亮出的牌比牌靴裡有的還多');
    return counts;
  }

  function probs(counts, exclude) {
    const total = counts.reduce((a, n, v) => a + (v === exclude ? 0 : n), 0);
    return counts.map((n, v) => (v === 0 || v === exclude || !total ? 0 : n / total));
  }

  const best = (hard, ace) => (ace && hard + 10 <= 21 ? hard + 10 : hard);

  // 荷官最後停在 17–21 或爆牌的機率。明牌 A 或 10 時荷官已經偷看過、沒有 Blackjack，底牌就不可能是補成 Blackjack 的那張
  function dealerFinal(upValue, p, holeExclude) {
    const memo = new Map();
    function go(hard, ace) {
      const t = best(hard, ace);
      if (hard > 21) return { bust: 1 };
      if (t >= 17) return { [t]: 1 };
      const key = hard * 2 + (ace ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      const out = {};
      for (let v = 1; v <= 10; v++) {
        if (!p[v]) continue;
        const sub = go(hard + v, ace || v === 1);
        for (const k in sub) out[k] = (out[k] || 0) + p[v] * sub[k];
      }
      memo.set(key, out);
      return out;
    }
    const hole = probs(p.counts, holeExclude);
    const out = {};
    for (let v = 1; v <= 10; v++) {
      if (!hole[v]) continue;
      const sub = go(upValue + v, upValue === 1 || v === 1);
      for (const k in sub) out[k] = (out[k] || 0) + hole[v] * sub[k];
    }
    return out;
  }

  function standAgainst(total, dealer) {
    let win = dealer.bust || 0, push = 0;
    for (let d = 17; d <= 21; d++) {
      if (d < total) win += dealer[d] || 0;
      else if (d === total) push += dealer[d] || 0;
    }
    return { win, push, lose: 1 - win - push };
  }

  const LOSE = { win: 0, push: 0, lose: 1 };
  const ev = o => o.win - o.lose;
  function mix(parts) {
    const out = { win: 0, push: 0, lose: 0 };
    for (const [w, o] of parts) { out.win += w * o.win; out.push += w * o.push; out.lose += w * o.lose; }
    return out;
  }

  // hand：玩家自己的牌；up：荷官明牌；seen：桌上所有亮出的牌（含 hand 與 up）
  function forHand({ hand: cards, up, seen, decks = 6, canDouble }) {
    const counts = remaining(decks, seen);
    const p = probs(counts);
    p.counts = counts;
    const upValue = hand.rankValue(up.rank);
    const holeExclude = upValue === 1 ? 10 : upValue === 10 ? 1 : 0;
    const dealer = dealerFinal(upValue, p, holeExclude);

    // 要牌之後每一步都照期望值選停或再要；policy 記下每個點數選了什麼，探針的模擬照它打
    const memo = new Map(), policy = {};
    function play(hard, ace) {
      const key = hard * 2 + (ace ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      const stand = standAgainst(best(hard, ace), dealer);
      let result = stand, choice = 'stand';
      if (best(hard, ace) < 21) {
        const hit = hitFrom(hard, ace);
        if (ev(hit) > ev(stand)) { result = hit; choice = 'hit'; }
      }
      policy[`${ace && hard + 10 <= 21 ? 's' : 'h'}${best(hard, ace)}`] = choice;
      memo.set(key, result);
      return result;
    }
    function hitFrom(hard, ace) {
      const parts = [];
      for (let v = 1; v <= 10; v++) {
        if (!p[v]) continue;
        parts.push([p[v], hard + v > 21 ? LOSE : play(hard + v, ace || v === 1)]);
      }
      return mix(parts);
    }

    let hard = 0, ace = false;
    for (const c of cards) { hard += hand.rankValue(c.rank); ace = ace || c.rank === 'A'; }
    const result = {
      stand: standAgainst(best(hard, ace), dealer),
      hit: hitFrom(hard, ace),
      double: null,
      dealer,
      policy,
    };
    if (canDouble) {
      const parts = [];
      for (let v = 1; v <= 10; v++) {
        if (!p[v]) continue;
        parts.push([p[v], hard + v > 21 ? LOSE : standAgainst(best(hard + v, ace || v === 1), dealer)]);
      }
      result.double = mix(parts);
    }
    return result;
  }

  return { forHand, remaining };
});
