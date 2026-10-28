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
    reckless: { win: '爽啦！', lose: '再來！', bust: '爆就爆！', blackjack: '看到沒！Blackjack！', push: '嘖。', double: '加倍！', split: '分！', stand: '停。', rebuy: '再換一千！' },
    steady: { win: '穩穩入袋。', lose: '下一局。', bust: '算錯了…', blackjack: '運氣不錯。', push: '平手也好。', double: '這手加倍。', split: '這對分開。', stand: '停。', rebuy: '補點籌碼。' },
    timid: { win: '贏、贏了？', lose: '唉…', bust: '嗚，爆了…', blackjack: '真的假的！', push: '還好還好。', double: '加、加倍…', split: '分、分開…', stand: '我、我停。', rebuy: '只好再買一點…' },
  };
  const ACTION_NAMES = { hit: '要牌', stand: '停牌', double: '加倍', split: '分牌' };

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

  // 分牌後一個座位要擺好幾手。一手的時候跟以前一樣（牌在手牌位、籌碼在下注圈）；兩手並排；
  // 三手以上排兩排：裡排靠荷官、外排靠玩家，兩排的籌碼面對面放中間，點數標籤放在兩排外側（裡排在上、外排在下），
  // 不會夾在兩排之間。一排最寬 SPAN（約一個座位的寬度，不擠到隔壁座位），手越多牌與籌碼縮得越小。
  // 回傳每一手：row 第幾排、x 沿座位左右方向的位置、cw 一手佔多寬、s 縮放。
  // 分成好幾手時兩張牌只錯開 0.16 張寬（一手時是 0.22），一手寬 0.71 張牌，同樣的寬度擠得下大一點的牌
  const SPAN = 1.6, FAN = 0.16;
  function arrange(n) {
    if (n <= 1) return [{ row: 0, rows: 1, x: 0, cw: SPAN, s: 1 }];
    const rows = n <= 2 ? 1 : 2;
    const perRow = rows === 1 ? n : Math.ceil(n / 2);
    const cw = Math.min(0.9, SPAN / perRow);
    const s = Math.min(rows === 1 ? 1 : 0.75, (cw - 0.03) / (0.55 + FAN));
    return Array.from({ length: n }, (_, k) => {
      const row = k < perRow ? 0 : 1, inRow = row === 0 ? perRow : n - perRow, col = row === 0 ? k : k - perRow;
      return { row, rows, x: (col - (inRow - 1) / 2) * cw, cw, s };
    });
  }
  V.arrangeHands = arrange;

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
    // 少了 showcase.js 要在開頁就說，不要等到第一次 Blackjack 才卡住
    if (!FX.showcase || !FX.doubleDown) throw new Error('載入順序錯：showcase.js 要排在 director.js 之前');
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
    // 每個座位的每一手：cards 牌、stacks 籌碼疊（原注、加倍、贏來的）。只照事件增減，不讀引擎
    const hands = new Map(SEATS.map(s => [s.id, []]));
    const handsOf = id => hands.get(id);
    let dealerCards = [];
    let auto = false;
    let roundsPlayed = 0, splits = 0;
    let turnHand = 0;
    const settledNet = new Map(), settledBj = new Map();
    let showcaseShown = false;
    // 畫面上的籌碼數字照事件一筆一筆加減，不直接讀引擎：引擎一次就把整局結算完，直接讀的話荷官還在翻牌，
    // 籌碼就已經是結算後的數字。每批事件演完 verify() 照舊拿它跟引擎比
    const money = { bank: new Map(), onTable: 0 };
    // 引擎結算完（idle）還留著上一局的手與注，那時桌上其實已經沒有籌碼；照讀的話，下一局的下注會疊上上一局的（BJK-08）
    const onTableOf = st => (st.phase === 'idle' ? 0 : st.seats.find(s => s.id === 'me').totalBet);
    function syncMoney() {
      const st = game.state();
      for (const s of st.seats) money.bank.set(s.id, s.bankroll);
      money.onTable = onTableOf(st);
    }
    function applyMoney(e) {
      const delta = { bet: -e.amount, split: -e.amount, double: -e.amount / 2, settle: e.bet + e.net }[e.type];
      if (delta === undefined || !money.bank.has(e.seat)) return;
      money.bank.set(e.seat, money.bank.get(e.seat) + delta);
      if (e.seat === 'me') money.onTable -= e.type === 'settle' ? e.bet : delta;
    }
    syncMoney();
    const mismatches = [];

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 12, 48), new THREE.MeshBasicMaterial({ color: 0x2ec4c4 }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);

    // ---- 位置 ----
    const seatOf = id => T.seats[meta[id].table];
    const tangent = id => new THREE.Vector3(1, 0, 0).applyAxisAngle(Y, seatOf(id).rotY);
    const outward = id => seatOf(id).circle.clone().setY(0).normalize();
    const R_HAND = T.seats[0].hand.length(), R_CIRCLE = T.seats[0].circle.length();
    const shoePoint = T.shoe.position.clone().add(new THREE.Vector3(0, 0.45, 0));
    const discardPoint = T.discard.position.clone().add(new THREE.Vector3(0, 0.3, 0));
    const rackPoint = new THREE.Vector3(0, 0.75, 0.42);

    // 第 k 手（共 n 手）的牌中心與籌碼離桌心多遠
    function spot(k, n) {
      const a = arrange(n)[k];
      let cardR, chipR;
      if (a.rows === 1) { cardR = R_HAND; chipR = R_CIRCLE; }
      else if (a.row === 0) { cardR = R_HAND - 0.1; chipR = cardR + 0.635 * a.s; }
      else { chipR = R_HAND - 0.1 + 1.185 * a.s; cardR = chipR + 0.635 * a.s; }
      return Object.assign({ cardR, chipR }, a);
    }
    // 第 i 張牌（這一手共 m 張）。一手時照舊往右錯開；分成好幾手時前兩張以這手為中心，再要的牌往右擠在這手的寬度裡
    function cardPos(id, k, n, i, m) {
      if (id === 'dealer') return T.dealer.hand.clone().add(new THREE.Vector3(i * 0.32 - 0.16, 0.006 + i * 0.012, 0));
      const sp = spot(k, n);
      let x = i * 0.22 - 0.2;
      if (n > 1) {
        const step = m > 2 ? Math.min(FAN * sp.s, (sp.cw / 2 - 0.3 * sp.s) / (m - 1.5)) : FAN * sp.s;
        x = sp.x + (i - 0.5) * step;
      }
      return outward(id).multiplyScalar(sp.cardR).addScaledVector(tangent(id), x).setY(0.006 + i * 0.012);
    }
    function chipBase(id, k, n) {
      const sp = spot(k, n);
      return outward(id).multiplyScalar(sp.chipR).addScaledVector(tangent(id), sp.x).setY(0);
    }
    // 0：原注　1：加倍的那疊　2：贏來的那疊。一手時三疊並排（跟以前一樣）；分成好幾手時往上疊在原注上面（under 是已經疊多高）
    function chipPos(id, k, n, slotIdx, under) {
      if (n === 1) return chipBase(id, k, n).addScaledVector(tangent(id), [0, 0.46, -0.46][slotIdx]);
      return chipBase(id, k, n).setY(under);
    }
    const ringSpot = (id, k, n) => chipBase(id, k, n).setY(0.015);
    const ringScale = (k, n) => (n === 1 ? 1 : Math.min(arrange(n)[k].s, arrange(n)[k].cw * 0.9));
    // 點數標籤：一手時照舊在最後一張牌上方；分成好幾手時放在牌的外側，裡排往荷官那邊、外排往玩家那邊
    function labelPos(id, k, n, m) {
      if (n === 1) return cardPos(id, k, 1, Math.max(0, m - 1), m).add(new THREE.Vector3(0, 0.45, 0));
      const sp = spot(k, n), off = 0.385 * sp.s + 0.2;
      return outward(id).multiplyScalar(sp.cardR + (sp.row === 1 ? off : -off)).addScaledVector(tangent(id), sp.x).setY(0.05);
    }
    // 座位前方、扶手外面：閒家自己的籌碼從這裡推出去、贏了收回這裡
    const railOf = id => seatOf(id).circle.clone().setLength(V.table.R + 0.6).setY(0.25);
    const stackHeight = st => st.children.length * V.chips.H * st.scale.x;

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
    const handLabels = new Map(SEATS.map(s => [s.id, []]));
    const dealerTotal = label('total');
    function labelsOf(id, n) {
      const pool = handLabels.get(id);
      while (pool.length < n) pool.push(label('total'));
      return pool;
    }
    function place(el, p) {
      const s = project(p);
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      FX.keepInView(el);
    }
    function visibleValue(list) {
      const up = list.filter(m => m.rotation.z === 0).map(m => m.userData);
      return up.length ? BJK.hand.value(up) : null;
    }
    const totalText = v => (v.bust ? `${v.total} 爆` : v.soft && v.total < 21 ? `${v.total - 10}／${v.total}` : String(v.total));
    // 分成好幾手時標籤縮小、只寫一個數字（軟牌寫大的那個），一手的寬度才放得下
    const miniText = v => (v.bust ? `${v.total}爆` : String(v.total));
    // 一排的標籤比手的間隔寬時，隔一個往外錯開一層（裡排往上、外排往下），不讓讓位把它推到別手的牌上
    function stagger(id, n, placed) {
      const lay = arrange(n);
      for (const row of [0, 1]) {
        const items = placed.filter(x => lay[x.k].row === row).sort((a, b) => lay[a.k].x - lay[b.k].x);
        const rects = items.map(x => x.el.getBoundingClientRect());
        if (!rects.some((r, i) => i && r.left < rects[i - 1].right + 2 && r.right > rects[i - 1].left - 2)) continue;
        items.forEach((x, i) => {
          if (i % 2 === 0) return;
          x.el.style.top = `${parseFloat(x.el.style.top) + (row === 0 ? -1 : 1) * (rects[i].height + 2)}px`;
          FX.keepInView(x.el);
        });
      }
    }
    function updateLabels() {
      const st = game.state();
      for (const s of st.seats) {
        if (tags[s.id]) {
          tags[s.id].innerHTML = `<b>${s.name}</b>${money.bank.get(s.id).toLocaleString()}`;
          tags[s.id].hidden = false;
          place(tags[s.id], railOf(s.id).setY(0));
        }
      }
      hud.setBank(money.bank.get('me'), money.onTable);
      const shown = [];
      for (const s of SEATS) {
        const list = handsOf(s.id), n = list.length, placed = [];
        labelsOf(s.id, n).forEach((el, k) => {
          const v = k < n ? visibleValue(list[k].cards) : null;
          el.hidden = !v;
          if (!v) return;
          el.textContent = n > 1 ? miniText(v) : totalText(v);
          el.classList.toggle('bust', v.bust);
          el.classList.toggle('mini', n > 1);
          place(el, labelPos(s.id, k, n, list[k].cards.length));
          placed.push({ el, k });
          shown.push(el);
        });
        if (n > 1) stagger(s.id, n, placed);
      }
      const dv = visibleValue(dealerCards);
      dealerTotal.hidden = !dv;
      if (dv) {
        dealerTotal.textContent = totalText(dv);
        dealerTotal.classList.toggle('bust', dv.bust);
        place(dealerTotal, cardPos('dealer', 0, 1, Math.max(0, dealerCards.length - 1)).add(new THREE.Vector3(0, 0.45, 0)));
      }
      declutter([...shown, dealerTotal, ...Object.values(tags)]);
    }

    function say(mood, text) {
      if (mood) dealer.setMood(mood);
      if (text) dealer.say(text);
    }
    // AI 的小對白冒在它的名牌正上方，一看就知道是誰講的，也不會壓到桌上的點數
    function popLine(id, key) {
      const line = LINES[meta[id].personality] && LINES[meta[id].personality][key];
      if (!line) return;
      // 跟著名牌現在的位置（可能被夾回畫面內、被讓位往上移過），不重新投影
      const tag = tags[id];
      FX.pop(line, { x: parseFloat(tag.style.left), y: parseFloat(tag.style.top) - 34 }, key);
    }

    // ---- 事件 → 動畫 ----
    function moveTo(obj, to, scale, ms) {
      const from = obj.position.clone(), s0 = obj.scale.x;
      return A.tween(ms, t => {
        obj.position.lerpVectors(from, to, t);
        obj.scale.setScalar(s0 + (scale - s0) * t);
      });
    }

    async function flyChips(id, k, amount, from, slotIdx) {
      const h = handsOf(id)[k], n = handsOf(id).length;
      const stack = V.chips.stack(amount, rng);
      stack.position.copy(from);
      stack.scale.setScalar(arrange(n)[k].s);
      scene.add(stack);
      const under = h.stacks.reduce((a, st) => a + stackHeight(st), 0);
      h.stacks.push(stack);
      await FX.arc(stack, chipPos(id, k, n, slotIdx, under), { ms: 420, lift: 0.8 });
    }

    async function collect(id, k, to) {
      const h = handsOf(id)[k];
      await Promise.all(h.stacks.map(s => FX.arc(s, to, { ms: 450, lift: 0.6 })));
      h.stacks.forEach(s => scene.remove(s));
      h.stacks = [];
    }

    // 手數變了：這個座位每一手的牌與籌碼一起滑到新的位置、縮成新的大小
    function relayout(id, ms) {
      const list = handsOf(id), n = list.length, jobs = [];
      list.forEach((h, k) => {
        const s = arrange(n)[k].s;
        h.cards.forEach((m, i) => jobs.push(moveTo(m, cardPos(id, k, n, i, h.cards.length), s, ms)));
        let under = 0;
        h.stacks.forEach((st, j) => {
          jobs.push(moveTo(st, chipPos(id, k, n, j, under), s, ms));
          under += st.children.length * V.chips.H * s;
        });
      });
      return Promise.all(jobs);
    }

    function ringTo(id, k) {
      const n = handsOf(id).length;
      ring.position.copy(ringSpot(id, k, n));
      ring.scale.setScalar(ringScale(k, n));
      ring.visible = true;
    }

    const handlers = {
      async shuffle(e) {
        say('deal', e.midRound ? '牌發完了，把棄牌洗回去。' : '洗牌中…');
        await A.wait(800);
      },
      bet(e) {
        hands.set(e.seat, [{ cards: [], stacks: [] }]);
        return flyChips(e.seat, 0, e.amount, railOf(e.seat), 0);
      },
      async deal(e) {
        const mesh = V.cards.make(e.card.rank, e.card.suit, true);
        mesh.position.copy(shoePoint);
        mesh.rotation.set(0, T.shoe.rotation.y, Math.PI);
        scene.add(mesh);
        dealer.setMood('deal');
        if (e.to === 'dealer') {
          const k = dealerCards.length;
          dealerCards.push(mesh);
          await FX.arc(mesh, cardPos('dealer', 0, 1, k), { ms: 360, lift: 0.5, rot: { x: 0, y: T.dealer.rotY, z: e.faceUp ? 0 : Math.PI } });
        } else {
          const n = handsOf(e.to).length, h = handsOf(e.to)[e.hand], i = h.cards.length;
          h.cards.push(mesh);
          mesh.scale.setScalar(arrange(n)[e.hand].s);
          const others = n > 1 && i >= 2 ? h.cards.slice(0, i).map((m, j) => moveTo(m, cardPos(e.to, e.hand, n, j, i + 1), m.scale.x, 200)) : [];
          await Promise.all([...others, FX.arc(mesh, cardPos(e.to, e.hand, n, i, i + 1), { ms: 360, lift: 0.5, rot: { x: 0, y: seatOf(e.to).rotY, z: 0 } })]);
        }
        mesh.rotation.z = e.faceUp ? 0 : Math.PI;
        updateLabels();
      },
      // 開局的 Blackjack 與分牌後補成的 Blackjack（A＋10 點牌）都走這裡，後者帶的 hand 是分出來的那一手
      async blackjack(e) {
        if (e.seat === 'me') {
          say('surprised', handsOf('me').length > 1 ? `第 ${e.hand + 1} 手 Blackjack！` : '哇，Blackjack！');
          // 分 A 兩手都中時，2 秒的大特效連播會把一局拖長（BJK-05）：同一局只播第一次，之後只靠對白
          if (showcaseShown) await A.wait(500);
          else {
            showcaseShown = true;
            await FX.showcase('player');
          }
        } else {
          popLine(e.seat, 'blackjack');
          await A.wait(500);
        }
      },
      // 不偷看的規則下，大家都打完了才翻到：講清楚哪些手平手、多押的怎麼算（偷看時開局就翻，桌上只有原注）
      async dealerBlackjack() {
        const tie = rules.dealerBlackjackPush === 'any21' ? '21 點' : 'Blackjack';
        const rest = rules.peek ? '' : rules.dealerBlackjackTakes === 'all' ? '，其餘連加倍、分牌的注一起收' : '，其餘只收原注';
        say('smile', `莊家 Blackjack！${tie}平手${rest}。`);
        await FX.showcase('dealer');
      },
      async turn(e) {
        turnHand = e.hand;
        ringTo(e.seat, e.hand);
        render();
        if (e.seat === 'me') {
          const legal = game.legal('me'), names = legal.map(a => ACTION_NAMES[a]);
          const who = handsOf('me').length > 1 ? `第 ${e.hand + 1} 手` : '輪到你了';
          say('idle', legal.includes('hit') ? `${who}：${names.slice(0, -1).join('、')}，還是${names[names.length - 1]}？` : `${who}又是一對：再分還是停？`);
        }
        await A.wait(200);
      },
      // 第二張牌移到新的一手（插在這一手後面），整個座位重新排好，再從座位前推出新的一份籌碼
      async split(e) {
        splits++;
        const list = handsOf(e.seat);
        const moved = list[e.hand].cards.pop();
        list.splice(e.hand + 1, 0, { cards: [moved], stacks: [] });
        if (e.seat === 'me') {
          const ace = e.card.rank === 'A';
          say('deal', ace || rules.splitOneCard ? `${ace ? '分 A' : '分牌'}：每一手補一張就停。` : '分牌！每一手照常要牌、停牌。');
        } else popLine(e.seat, 'split');
        await relayout(e.seat, 380);
        await flyChips(e.seat, e.hand + 1, e.amount, railOf(e.seat), 0);
        updateLabels();
      },
      async double(e) {
        popLine(e.seat, 'double');
        // 你加倍時先播完大特效（你的手把籌碼彈上桌），才把加倍那疊推上桌
        if (e.seat === 'me') await FX.doubleDown(e.amount / 2);
        await flyChips(e.seat, e.hand, e.amount / 2, railOf(e.seat), 1);
      },
      async stand(e) {
        if (!e.auto && e.seat !== 'me') popLine(e.seat, 'stand');
        await A.wait(150);
      },
      async bust(e) {
        await FX.shake(handsOf(e.seat)[e.hand].cards, tangent(e.seat));
        if (e.seat === 'me') say('sorry', handsOf('me').length > 1 ? `第 ${e.hand + 1} 手爆牌了。` : '爆牌了，可惜。');
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
        const id = e.seat, k = e.hand, n = handsOf(id).length;
        if (e.result === 'win' || e.result === 'blackjack') {
          await flyChips(id, k, e.net, rackPoint, 2);
          await collect(id, k, railOf(id));
        } else if (e.result === 'push') {
          await collect(id, k, railOf(id));
        } else {
          await collect(id, k, rackPoint);
        }
        // 分成好幾手時，最後一手結算完才講一次合計；中間有 Blackjack 的手（賠 1.5 倍）在合計裡點名
        const net = (settledNet.get(id) || 0) + e.net;
        settledNet.set(id, k === n - 1 ? 0 : net);
        const bjs = (settledBj.get(id) || []).concat(e.result === 'blackjack' ? [k + 1] : []);
        settledBj.set(id, k === n - 1 ? [] : bjs);
        if (id === 'me') {
          if (n === 1) {
            if (e.result === 'blackjack') say('smile', `Blackjack 賠 1.5 倍，你贏了 ${e.net}！`);
            else if (e.result === 'win') say('smile', `恭喜，這局你贏了 ${e.net}！`);
            else if (e.result === 'push') say('idle', '平手，退回賭注。');
            else say('sorry', '可惜，這局莊家贏。');
            if (e.net > 0) FX.coinRain(scene);
          } else if (k === n - 1) {
            const bjNote = bjs.length ? `第 ${bjs.join('、')} 手 Blackjack 賠 1.5 倍，` : '';
            if (net > 0) say('smile', `${bjNote}${n} 手合計贏了 ${net}！`);
            else if (net < 0) say('sorry', `${bjNote || '可惜，'}${n} 手合計輸了 ${-net}。`);
            else say('idle', `${bjNote}${n} 手合計打成平手。`);
            if (net > 0) FX.coinRain(scene);
          } else if (e.result === 'blackjack') {
            say('smile', `第 ${k + 1} 手 Blackjack 賠 1.5 倍，贏 ${e.net}！`);
          }
        } else if (n === 1) {
          popLine(id, e.result);
        } else if (k === n - 1) {
          popLine(id, net > 0 ? 'win' : net < 0 ? 'lose' : 'push');
        }
        updateLabels();
      },
      async roundEnd() {
        ring.visible = false;
        const all = [...dealerCards, ...SEATS.flatMap(s => handsOf(s.id).flatMap(h => h.cards))];
        await Promise.all(all.map(m => FX.arc(m, discardPoint, {
          ms: 420, lift: 0.4, rot: { x: 0, y: T.discard.rotation.y, z: Math.PI },
        })));
        all.forEach(m => scene.remove(m));
        dealerCards = [];
        for (const s of SEATS) hands.set(s.id, []);
        showcaseShown = false;
        updateLabels();
      },
    };

    async function play(events) {
      // 連續的下注一起飛；其他事件照順序一個演完再演下一個
      for (let i = 0; i < events.length;) {
        if (events[i].type === 'bet') {
          const group = [];
          while (i < events.length && events[i].type === 'bet') group.push(events[i++]);
          group.forEach(applyMoney);
          await Promise.all(group.map(e => handlers.bet(e)));
          group.forEach(checkAfter);
        } else {
          const e = events[i++];
          applyMoney(e);
          if (handlers[e.type]) await handlers[e.type](e);
          checkAfter(e);
        }
      }
      verify();
    }

    // ---- 自我核對：畫面要跟事件對得上，事件累積起來要跟引擎對得上 ----
    // shadow 是「照事件演到這裡，桌上每個座位的每一手應該是哪些牌」；每演完一個事件就拿畫面跟它比
    const shadow = { hands: new Map(SEATS.map(s => [s.id, []])), dealer: [], holeHidden: false };
    const fail = msg => mismatches.push(`第 ${roundsPlayed + 1} 局：${msg}`);
    const key = list => list.map(c => (c.userData || c).rank + (c.userData || c).suit).join(',');
    const keys = list => list.map(key).join('｜');

    function checkAfter(e) {
      if (e.type === 'bet') {
        shadow.hands.set(e.seat, [[]]);
      } else if (e.type === 'deal') {
        if (e.to === 'dealer') {
          shadow.dealer.push(e.card);
          if (!e.faceUp) shadow.holeHidden = true;
        } else {
          shadow.hands.get(e.to)[e.hand].push(e.card);
        }
      } else if (e.type === 'split') {
        const hs = shadow.hands.get(e.seat);
        hs.splice(e.hand + 1, 0, [hs[e.hand].pop()]);
        const fresh = handsOf(e.seat)[e.hand + 1];
        if (!fresh || fresh.stacks.length !== 1) fail(`${meta[e.seat].name} 分牌之後新的一手沒有自己的一份籌碼`);
      } else if (e.type === 'turn') {
        const n = handsOf(e.seat).length;
        if (!ring.visible || ring.position.distanceTo(ringSpot(e.seat, e.hand, n)) > 1e-6) fail(`輪到 ${meta[e.seat].name} 第 ${e.hand + 1} 手時，藍圈沒有指到那一手`);
      } else if (e.type === 'reveal') {
        shadow.holeHidden = false;
      } else if (e.type === 'roundEnd') {
        shadow.dealer = [];
        shadow.holeHidden = false;
        for (const id of shadow.hands.keys()) shadow.hands.set(id, []);
      } else if (e.type === 'settle' && handsOf(e.seat)[e.hand].stacks.length) {
        fail(`${meta[e.seat].name} 第 ${e.hand + 1} 手結算後籌碼還留在桌上（${e.result}）`);
      }
      for (const s of SEATS) {
        const seen = keys(handsOf(s.id).map(h => h.cards)), want = keys(shadow.hands.get(s.id));
        if (seen !== want) fail(`${e.type} 之後 ${s.name} 的牌 畫面「${seen}」≠ 事件「${want}」`);
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
          const want = keys(s.hands.map(h => h.cards)), got = keys(shadow.hands.get(s.id));
          if (got !== want) fail(`${s.name} 的牌 事件累積「${got}」≠ 引擎「${want}」`);
        }
        if (shadow.holeHidden !== (st.dealer.cards[1] === null)) fail('荷官底牌蓋著與否，事件累積與引擎不一致');
      }
      const bank = Number(document.getElementById('bank').textContent.replace(/,/g, ''));
      const me = st.seats.find(s => s.id === 'me').bankroll;
      if (bank !== me) fail(`畫面上的籌碼 ${bank} ≠ 引擎 ${me}`);
      // 牌局中操作列的「下注」顯示桌上押的（加倍、分牌都算進去）
      const shownBet = Number(document.getElementById('bet').textContent.replace(/,/g, ''));
      if (shownBet !== onTableOf(st)) fail(`畫面上的下注 ${shownBet} ≠ 引擎 ${onTableOf(st)}`);
    }

    // 勝率只用畫面上翻開的牌算（rotation.z === 0），荷官的底牌蓋著就拿不到；不准改成去讀引擎狀態。
    // 算的是輪到的那一手；分牌要知道規則（分完補幾張、能不能再分）與這個座位現在有幾手
    let lastOdds = null;
    function computeOdds() {
      const faceUp = list => list.filter(m => m.rotation.z === 0).map(m => m.userData);
      const seen = [...faceUp(dealerCards), ...SEATS.flatMap(s => handsOf(s.id).flatMap(h => faceUp(h.cards)))];
      const mine = handsOf('me');
      const result = BJK.odds.forHand({
        hand: mine[turnHand].cards.map(m => m.userData),
        up: dealerCards[0].userData,
        seen,
        decks: rules.decks,
        legal: game.legal('me'),
        rules,
        hands: mine.length,
        index: turnHand,
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
      syncMoney();
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
      syncMoney();
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

    // 探針用：玩家也交給穩健策略，連打 n 局，回傳每局花多久、分了幾次牌、畫面引擎的不一致清單
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
      return { rounds: roundsPlayed, splits, times, mismatches: mismatches.slice(), state: game.state() };
    }

    function layout() { updateLabels(); }

    enterBetting();
    if (hud.currentMode !== 'broke') say('idle', saved.me !== undefined ? '歡迎回來，籌碼幫你留著了。請下注！' : '歡迎光臨，請下注！');

    return {
      game, layout, autoplay, runRound, resetBankroll,
      // 探針量版面用：每個座位的每一手（牌、籌碼）與各手的點數標籤
      hands: id => handsOf(id),
      labels: id => handLabels.get(id).slice(0, handsOf(id).length),
      get mismatches() { return mismatches.slice(); },
      get lastOdds() { return lastOdds; },
      get rounds() { return roundsPlayed; },
      get splits() { return splits; },
    };
  }

  V.director = { create, SEATS };
})();
