// 導演：把 core/game.js 回傳的事件一個一個翻成牌桌上的動畫、荷官表情與對白，並決定現在輪到誰。
// 引擎一次就把結果算完，畫面照事件順序慢慢演；每演完一批事件，就核對一次畫面與引擎的狀態對不對得上。
(function () {
  const V = window.BJK.view;
  const A = V.anim, FX = V.fx;
  const Y = new THREE.Vector3(0, 1, 0);
  const START = 1000;

  // table 是 table.js 的座位編號（玩家看過去由左到右 0–4）；陣列順序就是輪流順序，荷官左手邊（玩家看是右邊）先
  const SEATS = [
    { id: 'tiger', name: '小虎', personality: 'reckless', table: 3 },
    { id: 'me', name: '你', personality: null, table: 2 },
    { id: 'ade', name: '阿德', personality: 'steady', table: 1 },
    { id: 'mei', name: '阿美', personality: 'timid', table: 0 },
  ];
  const LINES = {
    reckless: { win: '爽啦！', lose: '再來！', bust: '爆就爆！', blackjack: '看到沒！Blackjack！', push: '嘖。', double: '加倍！', stand: '停。', rebuy: '再換一千！' },
    steady: { win: '穩穩入袋。', lose: '下一局。', bust: '算錯了…', blackjack: '運氣不錯。', push: '平手也好。', double: '這手加倍。', stand: '停。', rebuy: '補點籌碼。' },
    timid: { win: '贏、贏了？', lose: '唉…', bust: '嗚，爆了…', blackjack: '真的假的！', push: '還好還好。', double: '加、加倍…', stand: '我、我停。', rebuy: '只好再買一點…' },
  };

  // 標籤互相壓到時，由下往上排：上面那個往上讓到不重疊為止（點數標籤本來就在牌的上方，往上讓不會蓋到自己的牌）。
  // 放在 create 外面，探針才能拿一組故意疊在一起的標籤直接驗它，不必靠運氣等牌局撞出重疊
  function declutter(els) {
    const items = els.filter(el => !el.hidden).map(el => ({ el, r: el.getBoundingClientRect(), dy: 0 }));
    items.sort((a, b) => b.r.top - a.r.top);
    const box = it => ({ left: it.r.left, right: it.r.right, top: it.r.top + it.dy, bottom: it.r.bottom + it.dy });
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (let i = 1; i < items.length; i++) {
      for (let guard = 0; guard < items.length; guard++) {
        const me = box(items[i]);
        const below = items.slice(0, i).map(box).find(b => hit(me, b));
        if (!below) break;
        items[i].dy -= me.bottom - below.top + 2;
      }
    }
    for (const it of items) if (it.dy) it.el.style.top = `${parseFloat(it.el.style.top) + it.dy}px`;
  }
  V.declutter = declutter;

  // 籌碼存在這台電腦的瀏覽器裡（localStorage）。讀不到、格式不對就當新玩家，不擲錯
  const SAVE_KEY = 'bjk.save.v1';
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s || s.v !== 1 || typeof s.bankrolls !== 'object') return {};
      const ok = n => Number.isFinite(n) && n >= 0 && n % 5 === 0;
      return Object.fromEntries(Object.entries(s.bankrolls).filter(([, n]) => ok(n)));
    } catch (e) {
      return {};
    }
  }

  function create({ scene, table: T, dealer, project, render, hud }) {
    const rng = V.rng(Date.now() & 0x7fffffff);
    const saved = loadSave();
    const game = BJK.game.createGame({
      rng,
      seats: SEATS.map(s => ({ id: s.id, name: s.name, personality: s.personality, bankroll: s.id in saved ? saved[s.id] : START })),
    });
    function save() {
      try {
        const bankrolls = Object.fromEntries(game.state().seats.map(s => [s.id, s.bankroll]));
        localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, bankrolls }));
      } catch (e) { /* 無痕視窗或關掉網站資料時寫不進去：這一場照玩，只是不記 */ }
    }
    const rules = game.rules;
    const meta = Object.fromEntries(SEATS.map(s => [s.id, s]));
    const cards = new Map(SEATS.map(s => [s.id, []]));
    const stacks = new Map(SEATS.map(s => [s.id, []]));
    let dealerCards = [];
    let auto = false;
    let roundsPlayed = 0;
    const mismatches = [];

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 12, 48), new THREE.MeshBasicMaterial({ color: 0x2ec4c4 }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);

    // ---- 位置 ----
    const seatOf = id => T.seats[meta[id].table];
    const tangent = id => new THREE.Vector3(1, 0, 0).applyAxisAngle(Y, seatOf(id).rotY);
    const shoePoint = T.shoe.position.clone().add(new THREE.Vector3(0, 0.45, 0));
    const discardPoint = T.discard.position.clone().add(new THREE.Vector3(0, 0.3, 0));
    const rackPoint = new THREE.Vector3(0, 0.75, 0.42);
    function slot(id, k) {
      if (id === 'dealer') return T.dealer.hand.clone().add(new THREE.Vector3(k * 0.32 - 0.16, 0.006 + k * 0.012, 0));
      return seatOf(id).hand.clone().add(new THREE.Vector3(k * 0.22 - 0.2, 0.006 + k * 0.012, 0).applyAxisAngle(Y, seatOf(id).rotY));
    }
    // 0：原注　1：加倍的那疊　2：贏來的那疊
    function chipSlot(id, k) {
      const offset = [0, 0.46, -0.46][k];
      return seatOf(id).circle.clone().addScaledVector(tangent(id), offset).setY(0);
    }
    // 座位前方、扶手外面：閒家自己的籌碼從這裡推出去、贏了收回這裡
    const railOf = id => seatOf(id).circle.clone().setLength(V.table.R + 0.6).setY(0.25);

    // ---- 疊在畫面上的字：座位名牌、各手點數 ----
    const overlay = document.getElementById('overlay');
    function label(cls) {
      const el = document.createElement('div');
      el.className = cls;
      el.hidden = true;
      overlay.appendChild(el);
      return el;
    }
    const tags = Object.fromEntries(SEATS.filter(s => s.id !== 'me').map(s => [s.id, label('seat-tag')]));
    const totals = Object.fromEntries([...SEATS.map(s => s.id), 'dealer'].map(id => [id, label('total')]));
    function place(el, p) {
      const s = project(p);
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
    }
    function visibleValue(list) {
      const up = list.filter(m => m.rotation.z === 0).map(m => m.userData);
      return up.length ? BJK.hand.value(up) : null;
    }
    function updateLabels() {
      const st = game.state();
      for (const s of st.seats) {
        if (tags[s.id]) {
          tags[s.id].innerHTML = `<b>${s.name}</b>${s.bankroll.toLocaleString()}`;
          tags[s.id].hidden = false;
          place(tags[s.id], railOf(s.id).setY(0));
        }
      }
      const me = st.seats.find(s => s.id === 'me');
      hud.setBank(me.bankroll, me.bet);
      for (const id of Object.keys(totals)) {
        const list = id === 'dealer' ? dealerCards : cards.get(id);
        const v = visibleValue(list);
        const el = totals[id];
        el.hidden = !v;
        if (!v) continue;
        el.textContent = v.bust ? `${v.total} 爆` : v.soft && v.total < 21 ? `${v.total - 10}／${v.total}` : String(v.total);
        el.classList.toggle('bust', v.bust);
        place(el, slot(id, Math.max(0, list.length - 1)).add(new THREE.Vector3(0, 0.45, 0)));
      }
      declutter([...Object.values(totals), ...Object.values(tags)]);
    }

    function say(mood, text) {
      if (mood) dealer.setMood(mood);
      if (text) dealer.say(text);
    }
    // AI 的小對白冒在它的名牌正上方，一看就知道是誰講的，也不會壓到桌上的點數
    function popLine(id, key) {
      const line = LINES[meta[id].personality] && LINES[meta[id].personality][key];
      if (!line) return;
      const at = project(railOf(id).setY(0));
      FX.pop(line, { x: at.x, y: at.y - 34 }, key);
    }

    // ---- 事件 → 動畫 ----
    async function flyChips(id, amount, from, k) {
      const stack = V.chips.stack(amount, rng);
      stack.position.copy(from);
      scene.add(stack);
      stacks.get(id).push(stack);
      await FX.arc(stack, chipSlot(id, k), { ms: 420, lift: 0.8 });
    }

    async function collect(id, to) {
      const list = stacks.get(id);
      await Promise.all(list.map(s => FX.arc(s, to, { ms: 450, lift: 0.6 })));
      list.forEach(s => scene.remove(s));
      stacks.set(id, []);
    }

    const handlers = {
      async shuffle(e) {
        say('deal', e.midRound ? '牌發完了，把棄牌洗回去。' : '洗牌中…');
        await A.wait(800);
      },
      bet(e) {
        return flyChips(e.seat, e.amount, railOf(e.seat), 0);
      },
      async deal(e) {
        const mesh = V.cards.make(e.card.rank, e.card.suit, true);
        mesh.position.copy(shoePoint);
        mesh.rotation.set(0, T.shoe.rotation.y, Math.PI);
        scene.add(mesh);
        const list = e.to === 'dealer' ? dealerCards : cards.get(e.to);
        const k = list.length;
        list.push(mesh);
        const rotY = e.to === 'dealer' ? T.dealer.rotY : seatOf(e.to).rotY;
        dealer.setMood('deal');
        await FX.arc(mesh, slot(e.to, k), { ms: 360, lift: 0.5, rot: { x: 0, y: rotY, z: e.faceUp ? 0 : Math.PI } });
        mesh.rotation.z = e.faceUp ? 0 : Math.PI;
        updateLabels();
      },
      async blackjack(e) {
        if (e.seat === 'me') {
          say('surprised', '哇，Blackjack！');
          await FX.banner('BLACKJACK!');
        } else {
          popLine(e.seat, 'blackjack');
          await A.wait(500);
        }
      },
      async dealerBlackjack() {
        say('surprised', '莊家 Blackjack！');
        await A.wait(1000);
      },
      async turn(e) {
        ring.position.copy(seatOf(e.seat).circle).setY(0.015);
        ring.visible = true;
        render();
        if (e.seat === 'me') say('idle', '輪到你了：要牌、停牌，還是加倍？');
        await A.wait(200);
      },
      async double(e) {
        popLine(e.seat, 'double');
        await flyChips(e.seat, e.amount / 2, railOf(e.seat), 1);
      },
      async stand(e) {
        if (!e.auto && e.seat !== 'me') popLine(e.seat, 'stand');
        await A.wait(150);
      },
      async bust(e) {
        await FX.shake(cards.get(e.seat), tangent(e.seat));
        if (e.seat === 'me') say('sorry', '爆牌了，可惜。');
        else popLine(e.seat, 'bust');
        updateLabels();
      },
      async reveal() {
        ring.visible = false;
        say('deal', '翻開底牌。');
        const hole = dealerCards[1];
        await FX.arc(hole, hole.position.clone(), { ms: 420, lift: 0.35, rot: { x: 0, y: hole.rotation.y, z: 0 } });
        hole.rotation.z = 0;
        updateLabels();
      },
      async dealerBust() {
        say('surprised', '我爆牌了！');
        await A.wait(900);
      },
      async settle(e) {
        const id = e.seat;
        if (e.result === 'win' || e.result === 'blackjack') {
          await flyChips(id, e.net, rackPoint, 2);
          await collect(id, railOf(id));
        } else if (e.result === 'push') {
          await collect(id, railOf(id));
        } else {
          await collect(id, rackPoint);
        }
        if (id === 'me') {
          if (e.result === 'blackjack') say('smile', `Blackjack 賠 1.5 倍，你贏了 ${e.net}！`);
          else if (e.result === 'win') say('smile', `恭喜，這局你贏了 ${e.net}！`);
          else if (e.result === 'push') say('idle', '平手，退回賭注。');
          else say('sorry', '可惜，這局莊家贏。');
          if (e.net > 0) FX.coinRain(scene);
        } else {
          popLine(id, e.result);
        }
        updateLabels();
      },
      async roundEnd() {
        ring.visible = false;
        const all = [...dealerCards, ...[...cards.values()].flat()];
        await Promise.all(all.map(m => FX.arc(m, discardPoint, {
          ms: 420, lift: 0.4, rot: { x: 0, y: T.discard.rotation.y, z: Math.PI },
        })));
        all.forEach(m => scene.remove(m));
        dealerCards = [];
        for (const id of cards.keys()) cards.set(id, []);
        updateLabels();
      },
    };

    async function play(events) {
      // 連續的下注一起飛；其他事件照順序一個演完再演下一個
      for (let i = 0; i < events.length;) {
        if (events[i].type === 'bet') {
          const group = [];
          while (i < events.length && events[i].type === 'bet') group.push(events[i++]);
          await Promise.all(group.map(e => handlers.bet(e)));
          group.forEach(checkAfter);
        } else {
          const e = events[i++];
          if (handlers[e.type]) await handlers[e.type](e);
          checkAfter(e);
        }
      }
      verify();
    }

    // ---- 自我核對：畫面要跟事件對得上，事件累積起來要跟引擎對得上 ----
    // shadow 是「照事件演到這裡，桌上應該長怎樣」；每演完一個事件就拿畫面跟它比
    const shadow = { hands: new Map(SEATS.map(s => [s.id, []])), dealer: [], holeHidden: false };
    const fail = msg => mismatches.push(`第 ${roundsPlayed + 1} 局：${msg}`);
    const key = list => list.map(c => (c.userData || c).rank + (c.userData || c).suit).join(',');

    function checkAfter(e) {
      if (e.type === 'deal') {
        (e.to === 'dealer' ? shadow.dealer : shadow.hands.get(e.to)).push(e.card);
        if (e.to === 'dealer' && !e.faceUp) shadow.holeHidden = true;
      } else if (e.type === 'reveal') {
        shadow.holeHidden = false;
      } else if (e.type === 'roundEnd') {
        shadow.dealer = [];
        shadow.holeHidden = false;
        for (const id of shadow.hands.keys()) shadow.hands.set(id, []);
      } else if (e.type === 'settle' && stacks.get(e.seat).length) {
        fail(`${meta[e.seat].name} 結算後籌碼還留在桌上（${e.result}）`);
      }
      for (const id of cards.keys()) {
        if (key(cards.get(id)) !== key(shadow.hands.get(id))) fail(`${e.type} 之後 ${meta[id].name} 的牌 畫面「${key(cards.get(id))}」≠ 事件「${key(shadow.hands.get(id))}」`);
      }
      if (key(dealerCards) !== key(shadow.dealer)) fail(`${e.type} 之後荷官的牌 畫面「${key(dealerCards)}」≠ 事件「${key(shadow.dealer)}」`);
      if (dealerCards[1]) {
        const faceDown = dealerCards[1].rotation.z !== 0;
        if (faceDown !== shadow.holeHidden) fail(`${e.type} 之後荷官底牌 畫面${faceDown ? '蓋著' : '翻開'}，應該${shadow.holeHidden ? '蓋著' : '翻開'}`);
      }
    }

    function verify() {
      const st = game.state();
      if (st.phase !== 'idle') {
        for (const s of st.seats) {
          if (key(shadow.hands.get(s.id)) !== key(s.cards)) fail(`${s.name} 的牌 事件累積「${key(shadow.hands.get(s.id))}」≠ 引擎「${key(s.cards)}」`);
        }
        if (shadow.holeHidden !== (st.dealer.cards[1] === null)) fail('荷官底牌蓋著與否，事件累積與引擎不一致');
      }
      const bank = Number(document.getElementById('bank').textContent.replace(/,/g, ''));
      const me = st.seats.find(s => s.id === 'me').bankroll;
      if (bank !== me) fail(`畫面上的籌碼 ${bank} ≠ 引擎 ${me}`);
    }

    // 勝率只用畫面上翻開的牌算（rotation.z === 0），荷官的底牌蓋著就拿不到；不准改成去讀引擎狀態
    let lastOdds = null;
    function computeOdds() {
      const faceUp = list => list.filter(m => m.rotation.z === 0).map(m => m.userData);
      const seen = [...faceUp(dealerCards), ...[...cards.values()].flatMap(faceUp)];
      const result = BJK.odds.forHand({
        hand: cards.get('me').map(m => m.userData),
        up: dealerCards[0].userData,
        seen,
        decks: rules.decks,
        canDouble: game.legal('me').includes('double'),
      });
      lastOdds = { seenCount: seen.length, result };
      return result;
    }

    async function runRound(playerBet) {
      hud.mode('busy');
      for (const s of game.state().seats) {
        if (s.id !== 'me' && s.bankroll < rules.minBet) {
          game.topUp(s.id, START);
          popLine(s.id, 'rebuy');
        }
      }
      const bets = { me: playerBet };
      for (const s of game.state().seats) {
        if (s.personality) bets[s.id] = BJK.strategy.bet(s.personality, s.bankroll, rng, rules);
      }
      say('deal', '下注結束，發牌！');
      await play(game.startRound(bets));
      while (game.state().phase === 'player') {
        const id = game.state().turn;
        let action;
        if (id === 'me' && !auto) {
          hud.showOdds(computeOdds());
          hud.mode('act', game.legal('me'));
          action = await hud.nextAction();
          hud.showOdds(null);
          hud.mode('busy');
        } else {
          await A.wait(id === 'me' ? 200 : 600);
          action = game.aiChoice(id);
        }
        await play(game.act(id, action));
      }
      if (game.state().phase === 'dealer') await play(game.finishRound());
      roundsPlayed++;
      enterBetting();
    }

    function enterBetting() {
      save();
      updateLabels();
      const me = game.state().seats.find(s => s.id === 'me');
      if (me.bankroll < rules.minBet) {
        hud.mode('broke');
        say('sorry', '籌碼輸光了。按「重新開始」補回 1,000 再來一次。');
      } else {
        hud.mode('bet');
      }
    }

    // 破產一鍵重置：只補玩家，補到剛好 START
    function resetBankroll() {
      const me = game.state().seats.find(s => s.id === 'me');
      if (me.bankroll >= rules.minBet) return;
      game.topUp('me', START - me.bankroll);
      say('smile', '籌碼補好了，祝你好運！');
      enterBetting();
    }

    // 探針用：玩家也交給穩健策略，連打 n 局，回傳每局花多久與畫面引擎的不一致清單
    async function autoplay(n, bet) {
      auto = true;
      const times = [];
      try {
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          resetBankroll();
          const me = game.state().seats.find(s => s.id === 'me');
          await runRound(Math.min(bet || 50, me.bankroll - (me.bankroll % rules.step)));
          times.push(Math.round(performance.now() - t0));
        }
      } finally {
        auto = false;
      }
      return { rounds: roundsPlayed, times, mismatches: mismatches.slice(), state: game.state() };
    }

    function layout() { updateLabels(); }

    enterBetting();
    if (hud.currentMode !== 'broke') say('idle', saved.me !== undefined ? '歡迎回來，籌碼幫你留著了。請下注！' : '歡迎光臨，請下注！');

    return {
      game, layout, autoplay, runRound, resetBankroll,
      get mismatches() { return mismatches.slice(); },
      get lastOdds() { return lastOdds; },
      get rounds() { return roundsPlayed; },
    };
  }

  V.director = { create, SEATS };
})();
