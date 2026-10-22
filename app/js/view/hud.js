// 畫面下方的操作列：下注階段疊籌碼、按發牌；輪到你時要牌／停牌／加倍
(function () {
  const V = window.BJK.view;

  function create({ minBet, maxBet, onDeal, onReset }) {
    const $ = id => document.getElementById(id);
    const betBar = $('betBar'), actBar = $('actBar'), brokeBar = $('brokeBar');
    $('resetBtn').addEventListener('click', () => onReset());
    let bankroll = 0, bet = 0, inPlay = 0, mode = 'bet', lastBet = minBet, pendingAction = null;

    // 下注階段顯示正在疊的籌碼，牌局中顯示這一局實際押在桌上的（加倍後會變兩倍）
    function refresh() {
      $('bank').textContent = bankroll.toLocaleString();
      $('bet').textContent = (mode === 'bet' ? bet : inPlay).toLocaleString();
      $('dealBtn').disabled = bet < minBet;
      $('clearBet').disabled = bet === 0;
      for (const b of betBar.querySelectorAll('[data-chip]')) {
        b.disabled = bet + Number(b.dataset.chip) > Math.min(bankroll, maxBet);
      }
    }

    for (const b of betBar.querySelectorAll('[data-chip]')) {
      b.addEventListener('click', () => { bet += Number(b.dataset.chip); refresh(); });
    }
    $('clearBet').addEventListener('click', () => { bet = 0; refresh(); });
    $('dealBtn').addEventListener('click', () => {
      if (bet < minBet) return;
      lastBet = bet;
      const amount = bet;
      bet = 0;
      onDeal(amount);
    });
    for (const [id, action] of [['hitBtn', 'hit'], ['standBtn', 'stand'], ['doubleBtn', 'double']]) {
      $(id).addEventListener('click', () => {
        if (!pendingAction) return;
        const resolve = pendingAction;
        pendingAction = null;
        resolve(action);
      });
    }

    return {
      setBank(n, onTable) { bankroll = n; inPlay = onTable || 0; refresh(); },
      // mode：'bet' 下注、'act' 輪到你（legal 是可以按的動作）、'busy' 動畫中全部鎖住、'broke' 籌碼輸光只剩重新開始
      mode(m, legal) {
        mode = m;
        betBar.hidden = m !== 'bet';
        actBar.hidden = m !== 'act';
        brokeBar.hidden = m !== 'broke';
        if (m === 'bet') bet = Math.min(lastBet, bankroll, maxBet) >= minBet ? Math.min(lastBet, bankroll, maxBet) : 0;
        if (m === 'act') {
          $('hitBtn').disabled = !legal.includes('hit');
          $('standBtn').disabled = !legal.includes('stand');
          $('doubleBtn').disabled = !legal.includes('double');
        }
        document.getElementById('hud').dataset.mode = m;
        refresh();
      },
      nextAction() { return new Promise(resolve => { pendingAction = resolve; }); },
      get currentMode() { return mode; },
    };
  }

  V.hud = { create };
})();
