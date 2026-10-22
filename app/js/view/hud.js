// 畫面下方的操作列：下注階段疊籌碼、按發牌；輪到你時要牌／停牌／加倍
(function () {
  const V = window.BJK.view;

  // 勝率提示開或關，記在瀏覽器裡（跟籌碼存檔分開放：清掉偏好不該動到籌碼）
  const PREFS_KEY = 'bjk.prefs.v1';
  function loadOddsPref() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY));
      return p && typeof p.odds === 'boolean' ? p.odds : true;
    } catch (e) {
      return true;
    }
  }
  const pct = x => `${Math.round(x * 100)}%`;

  function create({ minBet, maxBet, onDeal, onReset }) {
    const $ = id => document.getElementById(id);
    const betBar = $('betBar'), actBar = $('actBar'), brokeBar = $('brokeBar');
    $('resetBtn').addEventListener('click', () => onReset());

    let oddsOn = loadOddsPref();
    function applyOddsToggle() {
      $('oddsToggle').setAttribute('aria-pressed', String(oddsOn));
      $('oddsToggle').textContent = `勝率提示：${oddsOn ? '開' : '關'}`;
      $('hud').dataset.odds = oddsOn ? 'on' : 'off';
    }
    $('oddsToggle').addEventListener('click', () => {
      oddsOn = !oddsOn;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify({ odds: oddsOn })); } catch (e) { /* 存不了就只在這一場有效 */ }
      applyOddsToggle();
    });
    applyOddsToggle();
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
      // o 是 BJK.odds.forHand 的結果；null 清掉。關掉提示時照樣填，只是 CSS 把它藏起來，打開就看得到。
      // 平手一起寫：只寫勝的話，18 點對 8 這種平手很多的牌，停牌看起來會比實際差
      showOdds(o) {
        for (const [id, key] of [['hitBtn', 'hit'], ['standBtn', 'stand'], ['doubleBtn', 'double']]) {
          const r = o && o[key];
          $(id).querySelector('.odds').textContent = r ? `勝 ${pct(r.win)}・平 ${pct(r.push)}` : '';
          $(id).title = r ? `勝 ${pct(r.win)}・平 ${pct(r.push)}・輸 ${pct(r.lose)}` : '';
          $(id).classList.toggle('best', !!(r && o.best === key));
        }
      },
      get oddsOn() { return oddsOn; },
      get currentMode() { return mode; },
    };
  }

  V.hud = { create };
})();
