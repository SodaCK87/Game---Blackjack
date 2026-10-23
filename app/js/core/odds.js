// 勝率提示：只用桌上「看得到」的牌（自己的牌、荷官明牌、同桌亮出的牌），算停牌／要牌／加倍／分牌各自的勝、平、輸機率。
// 荷官底牌是蓋著的，這裡拿不到也不准拿：不偷看的規則下，明牌 A 或 10 點牌時底牌可能補成 Blackjack，照機率算進去。
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

  // 荷官最後停在 17–21、爆牌，或底牌翻開是 Blackjack（bj）的機率。
  // 偷看（rules.peek）的規則下，明牌 A 或 10 已經確認過沒有 Blackjack，底牌就不可能是補成 Blackjack 的那張，也就沒有 bj
  function dealerFinal(upValue, p, peek) {
    const bjHole = upValue === 1 ? 10 : upValue === 10 ? 1 : 0;
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
    const hole = probs(p.counts, peek ? bjHole : 0);
    const out = {};
    for (let v = 1; v <= 10; v++) {
      if (!hole[v]) continue;
      if (v === bjHole) { out.bj = hole[v]; continue; }
      const sub = go(upValue + v, upValue === 1 || v === 1);
      for (const k in sub) out[k] = (out[k] || 0) + hole[v] * sub[k];
    }
    return out;
  }

  // 停在 total 點對荷官的勝、平、輸。bjl 是輸給荷官 Blackjack 的那一份（算在輸裡）：只輸原注的規則會把它退回一部分。
  // push21：21 點碰到荷官的 Blackjack 算平手
  function standAgainst(total, dealer, push21) {
    let win = dealer.bust || 0, push = 0;
    for (let d = 17; d <= 21; d++) {
      if (d < total) win += dealer[d] || 0;
      else if (d === total) push += dealer[d] || 0;
    }
    const bj = dealer.bj || 0, tie = push21 && total === 21;
    if (tie) push += bj;
    return { win, push, lose: 1 - win - push, bjl: tie ? 0 : bj };
  }

  function mix(parts) {
    const out = { win: 0, push: 0, lose: 0, bjl: 0 };
    for (const [w, o] of parts) for (const k in out) out[k] += w * o[k];
    return out;
  }
  const scale = (o, f) => ({ win: o.win * f, push: o.push * f, lose: o.lose * f, bjl: o.bjl * f });
  // 期望值：這一手押 m 份，荷官 Blackjack 時輸 s 份（全輸 s＝m；只輸原注時押著原注的第一手 s＝1、其他手 s＝0）
  const value = (o, m, s) => m * (o.win - o.lose) + (m - s) * o.bjl;
  // 荷官 Blackjack 時整份退回（s＝0）的那一份，畫面上算平手
  const shown = (o, s) => (s ? o : { win: o.win, push: o.push + o.bjl, lose: o.lose - o.bjl, bjl: 0 });

  // hand：玩家這一手的牌；up：荷官明牌；seen：桌上所有亮出的牌（含 hand 與 up）；rules：牌局規則（game.rules，必給）
  // legal：這一手現在能做的動作（game.legal）；hands：這個座位現在有幾手（分牌有手數上限時才用得到）；
  // index：輪到的是第幾手（從 0 起；只輸原注的規則下，第一手押著原注，其他手的處境不一樣）
  function forHand({ hand: cards, up, seen, decks = 6, legal = ['hit', 'stand'], rules, hands = 1, index = 0 }) {
    if (!rules) throw new Error('算勝率要給牌局規則 rules（game.rules）：荷官偷不偷看底牌、Blackjack 時怎麼算、分完怎麼補牌');
    const counts = remaining(decks, seen);
    const p = probs(counts);
    p.counts = counts;
    const dealer = dealerFinal(hand.rankValue(up.rank), p, rules.peek);
    const push21 = rules.dealerBlackjackPush === 'any21';
    const original = rules.dealerBlackjackTakes === 'original';
    const BUST = { win: 0, push: 0, lose: 1, bjl: dealer.bj || 0 };
    // 押 m 份的手，荷官 Blackjack 時輸幾份；first：是不是座位的第一手
    const stake = (m, first) => (original ? (first ? 1 : 0) : m);

    // 要牌之後每一步都照期望值選停或再要（s：一份注的手碰到荷官 Blackjack 輸幾份）；policy 記下每個點數選了什麼，探針的模擬照它打
    const memo = new Map(), policies = [{}, {}];
    function play(hard, ace, s) {
      const key = (hard * 2 + (ace ? 1 : 0)) * 2 + s;
      if (memo.has(key)) return memo.get(key);
      const t = best(hard, ace);
      const stand = standAgainst(t, dealer, push21);
      let result = stand, choice = 'stand';
      if (t < 21) {
        const hit = hitFrom(hard, ace, s);
        if (value(hit, 1, s) > value(stand, 1, s)) { result = hit; choice = 'hit'; }
      }
      policies[s][`${ace && hard + 10 <= 21 ? 's' : 'h'}${t}`] = choice;
      memo.set(key, result);
      return result;
    }
    function hitFrom(hard, ace, s) {
      const parts = [];
      for (let v = 1; v <= 10; v++) {
        if (!p[v]) continue;
        parts.push([p[v], hard + v > 21 ? BUST : play(hard + v, ace || v === 1, s)]);
      }
      return mix(parts);
    }
    function doubleFrom(hard, ace) {
      const parts = [];
      for (let v = 1; v <= 10; v++) {
        if (!p[v]) continue;
        parts.push([p[v], hard + v > 21 ? BUST : standAgainst(best(hard + v, ace || v === 1), dealer, push21)]);
      }
      return mix(parts);
    }

    let hard = 0, ace = false;
    for (const c of cards) { hard += hand.rankValue(c.rank); ace = ace || c.rank === 'A'; }
    const can = a => legal.includes(a);
    const s1 = stake(1, index === 0), s2 = stake(2, index === 0);
    const stand = standAgainst(best(hard, ace), dealer, push21);
    const hit = can('hit') ? hitFrom(hard, ace, s1) : null;
    const dbl = can('double') ? doubleFrom(hard, ace) : null;
    const ctx = { rules, hands, index, seen, decks, p, dealer, push21, original, stake, play, doubleFrom };
    const result = {
      stand: shown(stand, s1),
      hit: hit && shown(hit, s1),
      double: dbl && shown(dbl, s2),
      split: can('split') ? splitFrom(cards[0], ctx) : null,
      dealer,
      policy: policies[s1],
    };
    // 建議：每押一單位的期望值最高的那個。加倍押兩倍，期望值也是兩倍；分牌把分出來的每一手都算進去。
    // 一樣高時照停牌、要牌、加倍、分牌的順序取前面的
    result.ev = { stand: value(stand, 1, s1) };
    if (hit) result.ev.hit = value(hit, 1, s1);
    if (dbl) result.ev.double = value(dbl, 2, s2);
    if (result.split) result.ev.split = result.split.ev;
    result.best = Object.keys(result.ev).reduce((a, k) => (result.ev[k] > result.ev[a] + 1e-12 ? k : a), 'stand');
    return result;
  }

  // 分牌：兩手各從一張 x 開始。只補一張的手（分的是 A，或 splitOneCard 是 true）補到的牌就定案；
  // 其他的手補完照最有利的打法（能加倍的點數照 doubleOn）。分後 A＋10 點牌在 splitBlackjack 時算 Blackjack、賠 1.5 倍，
  // 碰到荷官的 Blackjack 平手。補到同一種牌（照 splitBy）可以再分：照手數逐層算到上限，不限手數時算到多分 40 手（再往下的機率小到不計）。
  // 只輸原注時，押著原注的第一手跟其他手碰到荷官 Blackjack 的處境不同，分兩類算；第一手永遠排在還沒補牌的最前面。
  // 回傳的勝、平、輸是分出來的每一手平均（Blackjack 算在勝裡，blackjack 另外標它的機率）；
  // ev 是全部的手加起來、每押一單位原注的期望值
  function splitFrom(first, { rules, hands, index, seen, decks, p, dealer, push21, original, stake, play, doubleFrom }) {
    const x = hand.rankValue(first.rank);
    const oneCard = rules.splitOneCard || first.rank === 'A';
    // 再成對的機率：看點數是 p[x]；看牌面時 10 點牌只有同一種牌面才算
    let q = p[x];
    if (rules.splitBy === 'rank' && x === 10) {
      const sameLeft = 4 * decks - seen.filter(c => c.rank === first.rank).length;
      q = p[10] * Math.max(0, sameLeft) / p.counts[10];
    }
    const bj = dealer.bj || 0;
    // 補到 v 之後這一手畫面上的勝平輸與期望值（加倍的手押兩份）；isFirst：是不是座位的第一手
    function settled(v, isFirst) {
      const hard = x + v, ace = x === 1 || v === 1;
      if (rules.splitBlackjack && hard === 11 && ace) return { o: { win: 1 - bj, push: bj, lose: 0, bjl: 0 }, ev: 1.5 * (1 - bj), bj: true };
      if (oneCard) {
        const o = standAgainst(best(hard, ace), dealer, push21), s = stake(1, isFirst);
        return { o: shown(o, s), ev: value(o, 1, s) };
      }
      const opts = [[play(hard, ace, stake(1, isFirst)), 1, stake(1, isFirst)]];
      const doubleOn = rules.doubleOn, soft = ace && hard + 10 <= 21;
      if (doubleOn === 'any' || (!soft && doubleOn.includes(best(hard, ace)))) opts.push([doubleFrom(hard, ace), 2, stake(2, isFirst)]);
      const [o, m, s] = opts.reduce((a, b) => (value(...b) > value(...a) ? b : a));
      return { o: shown(o, s), ev: value(o, m, s) };
    }
    // 一類手補一張：不會再成對的那些手（權重合計 1−q）的結果 rest 與期望值 R、其中 Blackjack 的權重，以及再成對卻停下的 B
    function classOf(isFirst) {
      const parts = [];
      let R = 0, bjw = 0;
      for (let v = 1; v <= 10; v++) {
        const w = v === x ? p[v] - q : p[v];
        if (w <= 0) continue;
        const s = settled(v, isFirst);
        parts.push([w, s.o]);
        R += w * s.ev;
        if (s.bj) bjw += w;
      }
      return { rest: mix(parts), R, bjw, B: settled(x, isFirst) };
    }
    const C0 = classOf(false);
    const C1 = original && index === 0 ? classOf(true) : C0;
    const maxHands = rules.maxHands === undefined ? Infinity : rules.maxHands;
    const cap = maxHands === Infinity ? hands + 41 : maxHands;
    const add = (n, c) => (c ? [n[0], n[1] + 1] : [n[0] + 1, n[1]]);
    const lin = (a, u, b, v) => [a * u[0] + b * v[0], a * u[1] + b * v[1]];
    // pending：還沒補牌的手數；made：這個座位已經有幾手；lead：排第一個的是不是第一類（押著原注的第一手）。
    // 回傳期望值，與兩類手各有幾手「補到不同點數定案」（n1）、「再成對卻停下」（n2）
    const memo = new Map();
    const go = (pending, made, lead) => {
      if (pending === 0) return { ev: 0, n1: [0, 0], n2: [0, 0], again: false };
      const k = (pending * 1000 + made) * 2 + (lead ? 1 : 0);
      if (memo.has(k)) return memo.get(k);
      const C = lead ? C1 : C0, c = lead ? 1 : 0;
      const after = go(pending - 1, made, false);
      const stop = { ev: C.B.ev + after.ev, n1: after.n1, n2: add(after.n2, c) };
      const more = made < cap ? go(pending + 1, made + 1, lead) : null;
      const again = !!(more && more.ev > stop.ev);
      const pick = again ? more : stop;
      const r = {
        ev: C.R + (1 - q) * after.ev + q * pick.ev,
        n1: lin(1 - q, add(after.n1, c), q, pick.n1),
        n2: lin(1 - q, after.n2, q, pick.n2),
        again,
      };
      memo.set(k, r);
      return r;
    };
    const r = go(2, hands + 1, C1 !== C0);
    const n1 = r.n1[0] + r.n1[1], n = n1 + r.n2[0] + r.n2[1];
    const perHand = mix([
      [r.n1[0] / n, scale(C0.rest, 1 / (1 - q))], [r.n1[1] / n, scale(C1.rest, 1 / (1 - q))],
      [r.n2[0] / n, C0.B.o], [r.n2[1] / n, C1.B.o],
    ]);
    return Object.assign(perHand, { ev: r.ev, hands: n, resplit: r.again, blackjack: n1 / n * C0.bjw / (1 - q) });
  }

  return { forHand, remaining };
});
