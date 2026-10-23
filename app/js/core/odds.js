// 勝率提示：只用桌上「看得到」的牌（自己的牌、荷官明牌、同桌亮出的牌），算停牌／要牌／加倍／分牌各自的勝、平、輸機率。
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
  const scale = (o, k) => ({ win: o.win * k, push: o.push * k, lose: o.lose * k });

  // hand：玩家這一手的牌；up：荷官明牌；seen：桌上所有亮出的牌（含 hand 與 up）
  // legal：這一手現在能做的動作（game.legal）；要算分牌時 rules（game.rules）必給：分完怎麼補牌、能不能再分；
  // hands：這個座位現在有幾手（分牌有手數上限時才用得到）
  function forHand({ hand: cards, up, seen, decks = 6, legal = ['hit', 'stand'], rules, hands = 1 }) {
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
    function doubleFrom(hard, ace) {
      const parts = [];
      for (let v = 1; v <= 10; v++) {
        if (!p[v]) continue;
        parts.push([p[v], hard + v > 21 ? LOSE : standAgainst(best(hard + v, ace || v === 1), dealer)]);
      }
      return mix(parts);
    }

    let hard = 0, ace = false;
    for (const c of cards) { hard += hand.rankValue(c.rank); ace = ace || c.rank === 'A'; }
    const can = a => legal.includes(a);
    const result = {
      stand: standAgainst(best(hard, ace), dealer),
      hit: can('hit') ? hitFrom(hard, ace) : null,
      double: can('double') ? doubleFrom(hard, ace) : null,
      split: can('split') ? splitFrom(cards[0], rules, hands, seen, decks, p, dealer, { play, hitFrom, doubleFrom }) : null,
      dealer,
      policy,
    };
    // 建議：每押一單位的期望值最高的那個。加倍押兩倍，期望值也是兩倍；分牌把分出來的每一手都算進去。
    // 一樣高時照停牌、要牌、加倍、分牌的順序取前面的
    result.ev = { stand: ev(result.stand) };
    if (result.hit) result.ev.hit = ev(result.hit);
    if (result.double) result.ev.double = 2 * ev(result.double);
    if (result.split) result.ev.split = result.split.ev;
    result.best = Object.keys(result.ev).reduce((a, k) => (result.ev[k] > result.ev[a] + 1e-12 ? k : a), 'stand');
    return result;
  }

  // 分牌：兩手各從一張 x 開始。只補一張的手（splitOneCard，或分的是 A）補到的牌就定案；其他的手補完照最有利的打法。
  // 補到同一種牌（照 splitBy）可以再分：不限手數時一手的期望值 V＝R＋q·max(B, 2V)，有上限時照手數逐層算。
  // 回傳的勝、平、輸是分出來的每一手平均；ev 是全部的手加起來、每押一單位原注的期望值
  function splitFrom(first, rules, hands, seen, decks, p, dealer, f) {
    if (!rules) throw new Error('算分牌要給牌局規則 rules（game.rules）');
    const x = hand.rankValue(first.rank);
    const oneCard = rules.splitOneCard || first.rank === 'A';
    // 再成對的機率：看點數是 p[x]；看牌面時 10 點牌只有同一種牌面才算
    let q = p[x];
    if (rules.splitBy === 'rank' && x === 10) {
      const sameLeft = 4 * decks - seen.filter(c => c.rank === first.rank).length;
      q = p[10] * Math.max(0, sameLeft) / p.counts[10];
    }
    // 補到 v 之後這一手的結果與期望值（加倍的手期望值算兩倍）
    function settled(v) {
      const hard = x + v, ace = x === 1 || v === 1;
      if (oneCard) { const o = standAgainst(best(hard, ace), dealer); return { o, ev: ev(o) }; }
      const opts = [[f.play(hard, ace), 1]];
      const doubleOn = rules.doubleOn;
      const soft = ace && hard + 10 <= 21;
      if (doubleOn === 'any' || (!soft && doubleOn.includes(best(hard, ace)))) opts.push([f.doubleFrom(hard, ace), 2]);
      const [o, k] = opts.reduce((a, b) => (ev(b[0]) * b[1] > ev(a[0]) * a[1] ? b : a));
      return { o, ev: k * ev(o) };
    }
    const parts = [];
    let R = 0;
    for (let v = 1; v <= 10; v++) {
      const w = v === x ? p[v] - q : p[v];
      if (w <= 0) continue;
      const s = settled(v);
      parts.push([w, s.o]);
      R += w * s.ev;
    }
    const rest = mix(parts);                  // 不會再成對的那些手（權重合計 1−q）
    const B = settled(x);                     // 再成對卻停下來（或照一般打法打完）的那一手
    const maxHands = rules.maxHands === undefined ? Infinity : rules.maxHands;
    let total, n1, n2, resplit;
    if (maxHands === Infinity && 2 * q < 1) {
      const again = R / (1 - 2 * q), stop = R + q * B.ev;
      resplit = q > 0 && again > stop;
      total = 2 * (resplit ? again : stop);
      n1 = resplit ? 2 * (1 - q) / (1 - 2 * q) : 2 * (1 - q);
      n2 = resplit ? 0 : 2 * q;
    } else {
      // pending：還沒補牌的手數；made：這個座位已經有幾手。回傳期望值與兩類手的期望手數
      const cap = maxHands === Infinity ? hands + 30 : maxHands;
      const memo = new Map();
      const go = (pending, made) => {
        if (pending === 0) return { ev: 0, n1: 0, n2: 0 };
        const k = pending * 1000 + made;
        if (memo.has(k)) return memo.get(k);
        const after = go(pending - 1, made);
        const stop = { ev: B.ev + after.ev, n1: after.n1, n2: after.n2 + 1 };
        const more = made < cap ? go(pending + 1, made + 1) : null;
        const pick = more && more.ev > stop.ev ? more : stop;
        const r = {
          ev: R + (1 - q) * after.ev + q * pick.ev,
          n1: (1 - q) * (1 + after.n1) + q * pick.n1,
          n2: (1 - q) * after.n2 + q * pick.n2,
          again: !!(more && more.ev > stop.ev),
        };
        memo.set(k, r);
        return r;
      };
      const r = go(2, hands + 1);
      total = r.ev; n1 = r.n1; n2 = r.n2; resplit = r.again;
    }
    const perHand = mix([[n1 / (n1 + n2), scale(rest, 1 / (1 - q))], [n2 / (n1 + n2), B.o]]);
    return Object.assign(perHand, { ev: total, hands: n1 + n2, resplit });
  }

  return { forHand, remaining };
});
