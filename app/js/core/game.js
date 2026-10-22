// 一張桌子的牌局狀態機。每個動作回傳事件陣列，畫面層照事件順序播動畫。
// 流程：startRound(下注) → 輪到誰就 act(誰, 'hit'|'stand'|'double') → phase 變 'dealer' 時 finishRound()
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./hand.js'), require('./shoe.js'), require('./strategy.js'));
  } else {
    (root.BJK = root.BJK || {}).game = factory(root.BJK.hand, root.BJK.shoe, root.BJK.strategy);
  }
})(globalThis, function (hand, shoeLib, strategy) {
  if (!hand || !shoeLib || !strategy) throw new Error('core 載入順序錯：game.js 要排在 hand.js、shoe.js、strategy.js 之後');

  // 下注以 10 為單位：Blackjack 賠 1.5 倍後仍是 5 的倍數，桌上最小的 5 元籌碼付得出來
  const DEFAULTS = { decks: 6, penetration: 0.75, minBet: 10, maxBet: 1000, step: 10 };

  function createGame(options) {
    const o = Object.assign({}, DEFAULTS, options);
    if (typeof o.rng !== 'function') throw new Error('createGame 需要呼叫端傳入亂數函式 rng');
    const shoe = o.shoe || shoeLib.createShoe({ decks: o.decks, penetration: o.penetration, rng: o.rng });
    const seats = o.seats.map(s => ({
      id: s.id, name: s.name, personality: s.personality || null, bankroll: s.bankroll,
      bet: 0, doubled: false, cards: [], status: 'out', result: null,
    }));
    const dealer = { cards: [], holeHidden: false };
    let phase = 'idle', turn = null, house = 0, topUps = 0;

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

    function give(events, to, faceUp) {
      const card = draw(events);
      (to === 'dealer' ? dealer.cards : seat(to).cards).push(card);
      events.push({ type: 'deal', to, card, faceUp });
      return card;
    }

    function advance(events) {
      const next = seats.find(s => s.status === 'playing');
      if (next) {
        phase = 'player';
        turn = next.id;
        events.push({ type: 'turn', seat: next.id });
      } else {
        phase = 'dealer';
        turn = null;
      }
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
        s.cards = []; s.result = null; s.doubled = false;
        const amount = bets[s.id] || 0;
        s.bet = amount;
        s.status = amount ? 'playing' : 'out';
        if (amount) {
          s.bankroll -= amount;
          events.push({ type: 'bet', seat: s.id, amount });
        }
      }
      const active = seats.filter(s => s.status === 'playing');
      for (const s of active) give(events, s.id, true);
      give(events, 'dealer', true);
      for (const s of active) give(events, s.id, true);
      give(events, 'dealer', false);

      for (const s of active) {
        if (hand.value(s.cards).blackjack) {
          s.status = 'blackjack';
          events.push({ type: 'blackjack', seat: s.id });
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
      const s = seat(id);
      return s.cards.length === 2 && s.bankroll >= s.bet ? ['hit', 'stand', 'double'] : ['hit', 'stand'];
    }

    function act(id, action) {
      if (!legal(id).includes(action)) throw new Error(`${id} 現在不能 ${action}（可以：${legal(id).join('、') || '無'}）`);
      const s = seat(id);
      const events = [];
      if (action === 'double') {
        s.bankroll -= s.bet;
        s.bet *= 2;
        s.doubled = true;
        events.push({ type: 'double', seat: id, amount: s.bet });
      }
      if (action === 'hit' || action === 'double') {
        give(events, id, true);
        const v = hand.value(s.cards);
        if (v.bust) {
          s.status = 'bust';
          events.push({ type: 'bust', seat: id });
        } else if (action === 'double' || v.total === 21) {
          s.status = 'stood';
          events.push({ type: 'stand', seat: id, auto: true });
        }
      } else {
        s.status = 'stood';
        events.push({ type: 'stand', seat: id, auto: false });
      }
      if (s.status !== 'playing') advance(events);
      return events;
    }

    function aiChoice(id) {
      const s = seat(id);
      return strategy.decide(s.personality || 'steady', s.cards, dealer.cards[0], legal(id).includes('double'));
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
      if (seats.some(s => s.status === 'stood')) {
        while (hand.value(dealer.cards).total < 17) give(events, 'dealer', true);
        if (hand.value(dealer.cards).bust) events.push({ type: 'dealerBust' });
      }
      settle(events);
      return events;
    }

    // returned 是退回座位的籌碼（含本金）；net 是這一局淨輸贏
    function settle(events) {
      const d = hand.value(dealer.cards);
      for (const s of seats) {
        if (s.status === 'out') continue;
        const v = hand.value(s.cards);
        let result;
        if (s.status === 'blackjack') result = d.blackjack ? 'push' : 'blackjack';
        else if (s.status === 'bust') result = 'bust';
        else if (d.blackjack) result = 'lose';
        else if (d.bust || v.total > d.total) result = 'win';
        else result = v.total === d.total ? 'push' : 'lose';
        const returned = { blackjack: s.bet * 2.5, win: s.bet * 2, push: s.bet, lose: 0, bust: 0 }[result];
        const net = returned - s.bet;
        s.bankroll += returned;
        house -= net;
        s.result = { result, net };
        events.push({ type: 'settle', seat: s.id, result, bet: s.bet, net });
      }
      shoe.discard(dealer.cards.concat(...seats.map(s => s.cards)));
      phase = 'idle';
      turn = null;
      events.push({ type: 'roundEnd' });
    }

    function topUp(id, amount) {
      if (phase !== 'idle') throw new Error('牌局進行中不能補籌碼');
      seat(id).bankroll += amount;
      topUps += amount;
    }

    function state() {
      const visible = dealer.holeHidden ? dealer.cards.slice(0, 1) : dealer.cards;
      return JSON.parse(JSON.stringify({
        phase, turn, house, topUps,
        dealer: {
          cards: dealer.holeHidden ? [dealer.cards[0], null] : dealer.cards,
          total: visible.length ? hand.value(visible).total : 0,
        },
        seats: seats.map(s => Object.assign({}, s, { total: s.cards.length ? hand.value(s.cards).total : 0 })),
      }));
    }

    return { startRound, legal, act, aiChoice, finishRound, topUp, state, rules: o };
  }

  return { createGame, DEFAULTS };
});
