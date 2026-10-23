// 一張桌子的牌局狀態機。每個動作回傳事件陣列，畫面層照事件順序播動畫。
// 流程：startRound(下注) → 輪到誰就 act(誰, 'hit'|'stand'|'double'|'split') → phase 變 'dealer' 時 finishRound()
// 一個座位可以分成好幾手（seat.hands），輪到的是 turn 那個座位的第 turnHand 手；跟手有關的事件都帶 hand（第幾手，從 0 起）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./hand.js'), require('./shoe.js'), require('./strategy.js'));
  } else {
    (root.BJK = root.BJK || {}).game = factory(root.BJK.hand, root.BJK.shoe, root.BJK.strategy);
  }
})(globalThis, function (hand, shoeLib, strategy) {
  if (!hand || !shoeLib || !strategy) throw new Error('core 載入順序錯：game.js 要排在 hand.js、shoe.js、strategy.js 之後');

  // 下注以 10 為單位：Blackjack 賠 1.5 倍後仍是 5 的倍數，桌上最小的 5 元籌碼付得出來。
  // 加倍與分牌的規則是參數（同事定案前試過好幾種），預設值是 2026-10-23 定案的那組：
  //   doubleOn     'any' 頭兩張任何點數都能加倍；陣列：頭兩張是這幾種硬點數才能加倍（有 A 的軟牌不算）
  //   splitBy      'value' 點數相同就能分（K+Q 可以）；'rank' 要牌面相同
  //   splitOneCard 分出來的每一手只補一張就停，補到同點數可以再分或停；false 照一般的手打。A 分開後一律只補一張
  //   maxHands     一個座位最多分成幾手，Infinity 不限（實際上限是籌碼夠不夠付每一份注）
  const DEFAULTS = {
    decks: 6, penetration: 0.75, minBet: 10, maxBet: 1000, step: 10,
    doubleOn: [10, 11], splitBy: 'value', splitOneCard: true, maxHands: Infinity,
  };

  function checkRules(o) {
    if (!(o.doubleOn === 'any' || (Array.isArray(o.doubleOn) && o.doubleOn.every(Number.isInteger)))) {
      throw new Error(`doubleOn 要是 'any' 或點數陣列，收到 ${JSON.stringify(o.doubleOn)}`);
    }
    if (o.splitBy !== 'value' && o.splitBy !== 'rank') throw new Error(`splitBy 要是 'value' 或 'rank'，收到 ${o.splitBy}`);
    if (!(o.maxHands === Infinity || (Number.isInteger(o.maxHands) && o.maxHands >= 1))) throw new Error(`maxHands 要是正整數或 Infinity，收到 ${o.maxHands}`);
  }

  function createGame(options) {
    const o = Object.assign({}, DEFAULTS, options);
    if (typeof o.rng !== 'function') throw new Error('createGame 需要呼叫端傳入亂數函式 rng');
    checkRules(o);
    const shoe = o.shoe || shoeLib.createShoe({ decks: o.decks, penetration: o.penetration, rng: o.rng });
    const seats = o.seats.map(s => ({
      id: s.id, name: s.name, personality: s.personality || null, bankroll: s.bankroll, hands: [], current: 0,
    }));
    const dealer = { cards: [], holeHidden: false };
    let phase = 'idle', turn = null, house = 0, topUps = 0;

    // split：這一手是分出來的；oneCard：分出來後只補一張（補到同點數才有得選：再分或停）
    const newHand = (bet, split, oneCard) => ({ cards: [], bet, doubled: false, split, oneCard, status: 'playing', result: null });

    function seat(id) {
      const s = seats.find(x => x.id === id);
      if (!s) throw new Error(`沒有這個座位：${id}`);
      return s;
    }

    function draw(events) {
      if (shoe.remaining === 0) {
        shoe.recycle();
        events.push({ type: 'shuffle', midRound: true });
      }
      return shoe.draw();
    }

    function toDealer(events, faceUp) {
      const card = draw(events);
      dealer.cards.push(card);
      events.push({ type: 'deal', to: 'dealer', card, faceUp });
    }

    function toHand(events, s, k) {
      const card = draw(events);
      s.hands[k].cards.push(card);
      events.push({ type: 'deal', to: s.id, hand: k, card, faceUp: true });
    }

    function canDouble(s, h) {
      if (h.oneCard || h.cards.length !== 2 || s.bankroll < h.bet) return false;
      if (o.doubleOn === 'any') return true;
      const v = hand.value(h.cards);
      return !v.soft && o.doubleOn.includes(v.total);
    }

    function canSplit(s, h) {
      if (h.cards.length !== 2 || s.bankroll < h.bet || s.hands.length >= o.maxHands) return false;
      const [a, b] = h.cards;
      return o.splitBy === 'rank' ? a.rank === b.rank : hand.rankValue(a.rank) === hand.rankValue(b.rank);
    }

    // 輪到下一手要做決定的牌：照座位順序、同一座位照手的順序。分出來的手輪到時才補第二張，
    // 只補一張的手補完就停，除非又湊成可以再分的一對；一般的手補到 21 自動停
    function advance(events) {
      for (const s of seats) {
        for (let k = 0; k < s.hands.length; k++) {
          const h = s.hands[k];
          if (h.status !== 'playing') continue;
          if (h.cards.length === 1) {
            toHand(events, s, k);
            if ((h.oneCard && !canSplit(s, h)) || hand.value(h.cards).total === 21) {
              h.status = 'stood';
              events.push({ type: 'stand', seat: s.id, hand: k, auto: true });
              continue;
            }
          }
          phase = 'player';
          turn = s.id;
          s.current = k;
          events.push({ type: 'turn', seat: s.id, hand: k });
          return;
        }
      }
      phase = 'dealer';
      turn = null;
    }

    function validateBets(bets) {
      let any = false;
      for (const [id, amount] of Object.entries(bets)) {
        const s = seat(id);
        if (!amount) continue;
        if (!Number.isInteger(amount) || amount % o.step !== 0) throw new Error(`${s.name} 的下注 ${amount} 不是 ${o.step} 的倍數`);
        if (amount < o.minBet || amount > o.maxBet) throw new Error(`${s.name} 的下注 ${amount} 超出 ${o.minBet}–${o.maxBet}`);
        if (amount > s.bankroll) throw new Error(`${s.name} 的籌碼只有 ${s.bankroll}，不夠下 ${amount}`);
        any = true;
      }
      if (!any) throw new Error('至少要有一個座位下注');
    }

    function startRound(bets) {
      if (phase !== 'idle') throw new Error(`現在是 ${phase} 階段，不能開新局`);
      validateBets(bets);
      const events = [];
      if (shoe.needsShuffle()) {
        shoe.shuffle();
        events.push({ type: 'shuffle', midRound: false });
      }
      dealer.cards = [];
      dealer.holeHidden = true;
      for (const s of seats) {
        const amount = bets[s.id] || 0;
        s.hands = amount ? [newHand(amount, false, false)] : [];
        s.current = 0;
        if (amount) {
          s.bankroll -= amount;
          events.push({ type: 'bet', seat: s.id, hand: 0, amount });
        }
      }
      const active = seats.filter(s => s.hands.length);
      for (const s of active) toHand(events, s, 0);
      toDealer(events, true);
      for (const s of active) toHand(events, s, 0);
      toDealer(events, false);

      for (const s of active) {
        if (hand.value(s.hands[0].cards).blackjack) {
          s.hands[0].status = 'blackjack';
          events.push({ type: 'blackjack', seat: s.id, hand: 0 });
        }
      }
      // 明牌是 A 或 10 點牌時荷官先偷看底牌，是 Blackjack 就直接結算，閒家不必再做決定
      const up = dealer.cards[0];
      if ((up.rank === 'A' || hand.isTen(up.rank)) && hand.value(dealer.cards).blackjack) {
        reveal(events);
        events.push({ type: 'dealerBlackjack' });
        settle(events);
        return events;
      }
      advance(events);
      return events;
    }

    function legal(id) {
      if (phase !== 'player' || turn !== id) return [];
      const s = seat(id), h = s.hands[s.current];
      const out = h.oneCard ? ['stand'] : ['hit', 'stand'];
      if (canDouble(s, h)) out.push('double');
      if (canSplit(s, h)) out.push('split');
      return out;
    }

    function act(id, action) {
      if (!legal(id).includes(action)) throw new Error(`${id} 現在不能 ${action}（可以：${legal(id).join('、') || '無'}）`);
      const s = seat(id), k = s.current, h = s.hands[k];
      const events = [];
      if (action === 'split') {
        // 第二張牌移到新的一手，插在這一手後面；兩手都等輪到時才補牌
        s.bankroll -= h.bet;
        const card = h.cards.pop();
        h.split = true;
        h.oneCard = o.splitOneCard || card.rank === 'A';
        s.hands.splice(k + 1, 0, Object.assign(newHand(h.bet, true, h.oneCard), { cards: [card] }));
        events.push({ type: 'split', seat: id, hand: k, card, amount: h.bet });
        advance(events);
        return events;
      }
      if (action === 'double') {
        s.bankroll -= h.bet;
        h.bet *= 2;
        h.doubled = true;
        events.push({ type: 'double', seat: id, hand: k, amount: h.bet });
      }
      if (action === 'hit' || action === 'double') {
        toHand(events, s, k);
        const v = hand.value(h.cards);
        if (v.bust) {
          h.status = 'bust';
          events.push({ type: 'bust', seat: id, hand: k });
        } else if (action === 'double' || v.total === 21) {
          h.status = 'stood';
          events.push({ type: 'stand', seat: id, hand: k, auto: true });
        }
      } else {
        h.status = 'stood';
        events.push({ type: 'stand', seat: id, hand: k, auto: false });
      }
      if (h.status !== 'playing') advance(events);
      return events;
    }

    function aiChoice(id) {
      const s = seat(id);
      return strategy.decide(s.personality || 'steady', s.hands[s.current].cards, dealer.cards[0], legal(id), o.rng);
    }

    function reveal(events) {
      dealer.holeHidden = false;
      events.push({ type: 'reveal', card: dealer.cards[1] });
    }

    function finishRound() {
      if (phase !== 'dealer') throw new Error(`現在是 ${phase} 階段，還不到荷官`);
      const events = [];
      reveal(events);
      // 閒家全爆或全拿 Blackjack 時，荷官不必補牌
      if (seats.some(s => s.hands.some(h => h.status === 'stood'))) {
        while (hand.value(dealer.cards).total < 17) toDealer(events, true);
        if (hand.value(dealer.cards).bust) events.push({ type: 'dealerBust' });
      }
      settle(events);
      return events;
    }

    // 逐手結算。returned 是退回座位的籌碼（含本金）；net 是這一手的淨輸贏。
    // 分出來的 A＋10 點牌只是 21 點：status 從來不會是 blackjack，所以照一般的贏賠 1 倍
    function settle(events) {
      const d = hand.value(dealer.cards);
      for (const s of seats) {
        s.hands.forEach((h, k) => {
          const v = hand.value(h.cards);
          let result;
          if (h.status === 'blackjack') result = d.blackjack ? 'push' : 'blackjack';
          else if (h.status === 'bust') result = 'bust';
          else if (d.blackjack) result = 'lose';
          else if (d.bust || v.total > d.total) result = 'win';
          else result = v.total === d.total ? 'push' : 'lose';
          const returned = { blackjack: h.bet * 2.5, win: h.bet * 2, push: h.bet, lose: 0, bust: 0 }[result];
          const net = returned - h.bet;
          s.bankroll += returned;
          house -= net;
          h.result = { result, net };
          events.push({ type: 'settle', seat: s.id, hand: k, result, bet: h.bet, net });
        });
      }
      shoe.discard(dealer.cards.concat(...seats.flatMap(s => s.hands.map(h => h.cards))));
      phase = 'idle';
      turn = null;
      events.push({ type: 'roundEnd' });
    }

    function topUp(id, amount) {
      if (phase !== 'idle') throw new Error('牌局進行中不能補籌碼');
      seat(id).bankroll += amount;
      topUps += amount;
    }

    // totalBet：這個座位押在桌上的總額（各手加起來）
    function state() {
      const visible = dealer.holeHidden ? dealer.cards.slice(0, 1) : dealer.cards;
      return JSON.parse(JSON.stringify({
        phase, turn, turnHand: turn ? seat(turn).current : null, house, topUps,
        dealer: {
          cards: dealer.holeHidden ? [dealer.cards[0], null] : dealer.cards,
          total: visible.length ? hand.value(visible).total : 0,
        },
        seats: seats.map(s => ({
          id: s.id, name: s.name, personality: s.personality, bankroll: s.bankroll,
          totalBet: s.hands.reduce((a, h) => a + h.bet, 0),
          hands: s.hands.map(h => Object.assign({}, h, { total: h.cards.length ? hand.value(h.cards).total : 0 })),
        })),
      }));
    }

    return { startRound, legal, act, aiChoice, finishRound, topUp, state, rules: o };
  }

  // 下注階段預先填好的注：沿用上一注，但不超過籌碼與上限，還要對齊 step。
  // 籌碼尾數是 5（拿過 Blackjack）又少於上一注時，沒取整會填出 15，按發牌就被 validateBets 擋下（BJK-02）
  function prefillBet(lastBet, bankroll, rules) {
    const o = Object.assign({}, DEFAULTS, rules);
    const cap = Math.min(lastBet, bankroll, o.maxBet);
    const bet = cap - (cap % o.step);
    return bet >= o.minBet ? bet : 0;
  }

  return { createGame, prefillBet, DEFAULTS };
});
