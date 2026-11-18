// 畫面下方的操作列：下注階段疊籌碼、按發牌；輪到你時要牌／停牌／加倍／分牌。音效開關、戰績與直式畫面的拉頁也在這裡接
(function () {
  const V = window.BJK.view;

  // 勝率提示與音效開或關、荷官的造型，記在瀏覽器裡（跟籌碼存檔分開放：清掉偏好不該動到籌碼）。
  // 全部存在同一筆，寫一個時要保留其他的；沒存過的開關當成開
  const PREFS_KEY = 'bjk.prefs.v1';
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY));
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch (e) {
      return {};
    }
  }
  const prefOn = name => loadPrefs()[name] !== false;
  function savePref(name, value) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.assign(loadPrefs(), { [name]: value }))); } catch (e) { /* 存不了就只在這一場有效 */ }
  }
  const pct = x => `${Math.round(x * 100)}%`;

  // 戰績面板的每一列：[標題, 內容]。數字照籌碼的寫法加千分位
  function statsRows(s) {
    const n = x => x.toLocaleString();
    const rate = BJK.stats.basicRate(s);
    return [
      ['打了', `${n(s.rounds)} 局`],
      ['贏／輸／平', `${n(s.wins)}／${n(s.losses)}／${n(s.pushes)} 手`],
      ['Blackjack', `${n(s.blackjacks)} 次`],
      ['爆牌', `${n(s.busts)} 次`],
      ['加倍／分牌', `${n(s.doubles)}／${n(s.splits)} 次`],
      ['最長連勝', `${n(s.bestStreak)} 局（目前 ${n(s.streak)} 局）`],
      ['籌碼最高', n(s.peak)],
      ['累計輸贏', s.net > 0 ? `+${n(s.net)}` : n(s.net)],
      ['照基本策略打', rate === null ? '還沒輪到你做決定' : `${rate}%（${n(s.decisions)} 次決定）`],
    ];
  }

  function create({ minBet, maxBet, step, resetTo, onDeal, onReset, onResetChips, getStats }) {
    if (!V.sfx) throw new Error('載入順序錯：sfx.js 要排在 hud.js 之前');
    const $ = id => document.getElementById(id);
    const betBar = $('betBar'), actBar = $('actBar'), brokeBar = $('brokeBar');
    $('resetBtn').addEventListener('click', () => onReset());

    // 戰績與籌碼重置的視窗開著時，底下蓋一層遮罩（style.css 的 #scrim）：拉頁、按鈕、牌桌都點不到，
    // 點遮罩等同關閉／取消。關掉後焦點回到叫出視窗的那顆鈕，拉頁維持原本的開合
    const statsPanel = $('statsPanel'), statsBtn = $('statsBtn');
    const resetBtn = $('chipResetBtn'), resetPanel = $('chipResetPanel'), scrim = $('scrim');
    const syncScrim = () => { scrim.hidden = statsPanel.hidden && resetPanel.hidden; };

    // 戰績：點左上第二顆鈕打開，關閉鈕、Esc、點遮罩都會關
    function openStats() {
      const s = getStats && getStats();
      if (!s) return;
      $('statsList').replaceChildren(...statsRows(s).flatMap(([k, v]) => [
        Object.assign(document.createElement('dt'), { textContent: k }),
        Object.assign(document.createElement('dd'), { textContent: v }),
      ]));
      statsPanel.hidden = false;
      syncScrim();
      $('statsClose').focus();
    }
    function closeStats() {
      if (statsPanel.hidden) return;
      statsPanel.hidden = true;
      syncScrim();
      statsBtn.focus();
    }
    statsBtn.addEventListener('click', () => (statsPanel.hidden ? openStats() : closeStats()));
    $('statsClose').addEventListener('click', closeStats);

    // 籌碼重置：先跳確認視窗。焦點先放在取消（按 Enter 不會一下子就清掉籌碼）
    const canResetChips = () => mode === 'bet' || mode === 'broke';
    function openReset() {
      if (!canResetChips()) return;
      $('chipResetText').textContent = `籌碼會回到 ${resetTo.toLocaleString()}（現在 ${bankroll.toLocaleString()}）`;
      resetPanel.hidden = false;
      syncScrim();
      $('chipResetCancel').focus();
    }
    function cancelReset() {
      resetPanel.hidden = true;
      syncScrim();
      resetBtn.focus();
    }
    resetBtn.addEventListener('click', () => (resetPanel.hidden ? openReset() : cancelReset()));
    $('chipResetCancel').addEventListener('click', cancelReset);
    scrim.addEventListener('click', () => (resetPanel.hidden ? closeStats() : cancelReset()));
    $('chipResetOk').addEventListener('click', () => {
      resetPanel.hidden = true;
      syncScrim();
      if (!canResetChips()) return;
      // 下注歸零，回到下注階段時也不沿用上一注；先歸零再交給導演，它核對畫面時看到的下注才是 0
      bet = 0;
      lastBet = 0;
      refresh();
      onResetChips();
      // 直式畫面收起拉頁，荷官的對白與新的籌碼數字才不會被拉頁擋住
      setDrawer(false);
      (document.body.dataset.orient === 'portrait' ? handle : resetBtn).focus();
    });

    // 直式畫面左邊緣的拉頁：點把手拉出、再點收回；點拉頁外面或按 Esc 也收回。橫式畫面 CSS 不套用，開關的狀態不影響畫面
    const drawer = $('drawer'), handle = $('drawerHandle');
    function setDrawer(open) {
      drawer.dataset.open = String(open);
      handle.setAttribute('aria-expanded', String(open));
    }
    handle.addEventListener('click', () => setDrawer(drawer.dataset.open !== 'true'));
    // 視窗開著時 Esc 只關最上面那個視窗：拉頁與焦點留在原按鈕
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!resetPanel.hidden) cancelReset();
      else if (!statsPanel.hidden) closeStats();
      else setDrawer(false);
    });
    // 視窗與遮罩也算在拉頁裡：視窗是從拉頁裡的鈕叫出來的，關掉視窗不該順手把拉頁收掉
    const inDrawer = t => drawer.contains(t) || scrim.contains(t) || statsPanel.contains(t) || resetPanel.contains(t);
    document.addEventListener('pointerdown', e => { if (drawer.dataset.open === 'true' && !inDrawer(e.target)) setDrawer(false); });

    let soundOn = prefOn('sound');
    function applySound() {
      V.sfx.on = soundOn;
      $('soundToggle').setAttribute('aria-pressed', String(soundOn));
      $('soundToggle').title = `音效：${soundOn ? '開' : '關'}`;
    }
    $('soundToggle').addEventListener('click', () => {
      soundOn = !soundOn;
      savePref('sound', soundOn);
      applySound();
    });
    applySound();

    let oddsOn = prefOn('odds');
    function applyOddsToggle() {
      $('oddsToggle').setAttribute('aria-pressed', String(oddsOn));
      $('oddsToggle').textContent = `勝率提示：${oddsOn ? '開' : '關'}`;
      $('hud').dataset.odds = oddsOn ? 'on' : 'off';
    }
    $('oddsToggle').addEventListener('click', () => {
      oddsOn = !oddsOn;
      savePref('odds', oddsOn);
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
      for (const b of betBar.querySelectorAll('[data-chip]')) b.disabled = added(b) === bet;
    }

    // 超過能押的就押到全部（core 的 addChip），已經押到全部才反灰
    const added = b => BJK.game.addChip(bet, Number(b.dataset.chip), bankroll, { minBet, maxBet, step });
    for (const b of betBar.querySelectorAll('[data-chip]')) {
      b.addEventListener('click', () => {
        if (added(b) === bet) return;
        bet = added(b);
        V.sfx.play('chip');
        refresh();
      });
    }
    $('clearBet').addEventListener('click', () => { bet = 0; refresh(); });
    $('dealBtn').addEventListener('click', () => {
      if (bet < minBet) return;
      lastBet = bet;
      const amount = bet;
      bet = 0;
      onDeal(amount);
    });
    const ACTS = [['hitBtn', 'hit'], ['standBtn', 'stand'], ['doubleBtn', 'double'], ['splitBtn', 'split']];
    for (const [id, action] of ACTS) {
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
        resetBtn.disabled = !canResetChips();
        if (resetBtn.disabled) { resetPanel.hidden = true; syncScrim(); }
        if (m === 'bet') bet = BJK.game.prefillBet(lastBet, bankroll, { minBet, maxBet, step });
        if (m === 'act') {
          // 加倍照舊反灰（看得出這手不能加倍）；分牌鈕能分才出現。分開的 A 又補到 A 只能再分或停，要牌與加倍收起來
          const normal = legal.includes('hit');
          $('hitBtn').hidden = !normal;
          $('doubleBtn').hidden = !normal;
          $('splitBtn').hidden = !legal.includes('split');
          for (const [id, action] of ACTS) $(id).disabled = !legal.includes(action);
        }
        document.getElementById('hud').dataset.mode = m;
        refresh();
      },
      nextAction() { return new Promise(resolve => { pendingAction = resolve; }); },
      // o 是 BJK.odds.forHand 的結果；null 清掉。關掉提示時照樣填，只是 CSS 把它藏起來，打開就看得到。
      // 平手一起寫：只寫勝的話，18 點對 8 這種平手很多的牌，停牌看起來會比實際差。分牌寫的是分出來每一手的機率
      showOdds(o) {
        for (const [id, key] of ACTS) {
          const r = o && o[key];
          // 勝、平分成兩段：手機上四顆鈕要排進一排，CSS 把它們拆成兩行、藏掉中間的點
          const part = (text, cls) => Object.assign(document.createElement('span'), { textContent: text, className: cls || '' });
          $(id).querySelector('.odds').replaceChildren(...(r ? [part(`勝 ${pct(r.win)}`), part('・', 'sep'), part(`平 ${pct(r.push)}`)] : []));
          $(id).title = r ? `勝 ${pct(r.win)}・平 ${pct(r.push)}・輸 ${pct(r.lose)}` : '';
          $(id).classList.toggle('best', !!(r && o.best === key));
        }
      },
      get oddsOn() { return oddsOn; },
      get currentMode() { return mode; },
    };
  }

  V.hud = { create, loadPrefs, savePref };
})();
