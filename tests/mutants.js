// core 規則的陽性對照總表：在暫存複本上逐一植入錯誤，確認對應的測試會紅。產品檔一個字都不碰。
// 用法：npm run mutants（約 2 分鐘，不在 npm test 裡；改了 core 的規則或測試之後跑一次）
// 「抓到」要同時成立兩件事：測試檔回非零，而且紅的是有名字的測試（node 會把載入就擲錯的檔案記成一條以檔名命名的
// 失敗，那只代表破壞讓檔案載不起來，不代表哪一條斷言在守這條規則）。開始前先在沒破壞的複本上跑一次，基準要全綠。
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
let survived = 0;
const MUTANTS = [
  ['Blackjack 改成 1 賠 1', 'app/js/core/game.js', 'blackjack: h.bet * 2.5', 'blackjack: h.bet * 2', 'tests/check_game.js'],
  ['荷官 16 點就停', 'app/js/core/game.js', 'hand.value(dealer.cards).total < 17', 'hand.value(dealer.cards).total < 16', 'tests/check_game.js'],
  ['加倍後沒自動停牌（沒到 21 還能要牌）', 'app/js/core/game.js', "} else if (action === 'double' || v.total === 21) {", '} else if (v.total === 21) {', 'tests/check_game.js'],
  ['預填的注沒對齊 step（BJK-02）', 'app/js/core/game.js', 'const bet = cap - (cap % o.step);', 'const bet = cap;', 'tests/check_game.js'],
  // ---- v0.13.1 籌碼鈕超過就押到全部 ----
  ['籌碼鈕超過能押的就加不上去（沒押到全部）', 'app/js/core/game.js', 'return Math.max(bet, Math.min(bet + chip, most));', 'return bet + chip <= most ? bet + chip : bet;', 'tests/check_game.js'],
  ['押到全部時沒對齊 step', 'app/js/core/game.js', 'const most = cap - (cap % o.step);', 'const most = cap;', 'tests/check_game.js'],
  ['加倍沒扣籌碼', 'app/js/core/game.js', 's.bankroll -= h.bet;\n        h.bet *= 2;', 'h.bet *= 2;', 'tests/check_simulation.js'],
  // ---- v0.10.0 加倍只准 10、11 點，分牌看點數、不限手數 ----
  ['加倍沒照點數（頭兩張任何點數都能加倍）', 'app/js/core/game.js', 'return !v.soft && o.doubleOn.includes(v.total);', 'return true;', 'tests/check_game.js'],
  ['有 A 的軟牌當硬點數加倍（A+9 當 10 點）', 'app/js/core/game.js', 'return !v.soft && o.doubleOn.includes(v.total);', 'return o.doubleOn.includes(h.cards.reduce((a, c) => a + hand.rankValue(c.rank), 0));', 'tests/check_game.js'],
  ['分牌看牌面（K+Q 不能分）', 'app/js/core/game.js', "return o.splitBy === 'rank' ? a.rank === b.rank : hand.rankValue(a.rank) === hand.rankValue(b.rank);", 'return a.rank === b.rank;', 'tests/check_game.js'],
  ['點數不同也能分', 'app/js/core/game.js', "return o.splitBy === 'rank' ? a.rank === b.rank : hand.rankValue(a.rank) === hand.rankValue(b.rank);", 'return true;', 'tests/check_game.js'],
  ['分牌沒押第二份注', 'app/js/core/game.js', 's.bankroll -= h.bet;\n        const card = h.cards.pop();', 'const card = h.cards.pop();', 'tests/check_game.js'],
  ['籌碼不夠也能分', 'app/js/core/game.js', 'if (h.cards.length !== 2 || s.bankroll < h.bet || s.hands.length >= o.maxHands) return false;', 'if (h.cards.length !== 2 || s.hands.length >= o.maxHands) return false;', 'tests/check_game.js'],
  ['手數上限失效（maxHands: 4 還能分第五手）', 'app/js/core/game.js', 'if (h.cards.length !== 2 || s.bankroll < h.bet || s.hands.length >= o.maxHands) return false;', 'if (h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'tests/check_game.js'],
  ['只補一張的手補完沒自動停（還要問）', 'app/js/core/game.js', 'if ((h.oneCard && !canSplit(s, h)) || hand.value(h.cards).total === 21) {', 'if (hand.value(h.cards).total === 21) {', 'tests/check_game.js'],
  ['只補一張的手又成對還能要牌', 'app/js/core/game.js', "const out = h.oneCard ? ['stand'] : ['hit', 'stand'];", "const out = ['hit', 'stand'];", 'tests/check_game.js'],
  ['只補一張的手補到 10 點還能加倍', 'app/js/core/game.js', 'if (h.oneCard || h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'if (h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'tests/check_game.js'],
  ['分開的 A 照一般的手打（沒限一張）', 'app/js/core/game.js', "h.oneCard = o.splitOneCard || card.rank === 'A';", 'h.oneCard = o.splitOneCard;', 'tests/check_game.js'],
  ['只結算第一手', 'app/js/core/game.js', 's.hands.forEach((h, k) => {', 's.hands.slice(0, 1).forEach((h, k) => {', 'tests/check_simulation.js'],
  ['新的一手放到最後，不是插在這一手後面', 'app/js/core/game.js', 's.hands.splice(k + 1, 0, ', 's.hands.splice(s.hands.length, 0, ', 'tests/check_game.js'],
  // ---- v0.11.0 下注不設上限、只有 A 分開後只補一張、分後 A＋10 點牌是 Blackjack、荷官不偷看 ----
  ['下注上限 1,000 還在（預設沒改成不設上限）', 'app/js/core/game.js', 'maxBet: Infinity,', 'maxBet: 1000,', 'tests/check_game.js'],
  ['給了 maxBet 也不擋', 'app/js/core/game.js', 'if (amount > o.maxBet) throw', 'if (false) throw', 'tests/check_game.js'],
  ['AI 下注還被 1,000 夾住', 'app/js/core/strategy.js', 'const cap = Math.min(maxBet, bankroll);', 'const cap = Math.min(maxBet, bankroll, 1000);', 'tests/check_strategy.js'],
  ['A 以外分出來的手也只補一張（預設沒改）', 'app/js/core/game.js', 'splitOneCard: false,', 'splitOneCard: true,', 'tests/check_game.js'],
  ['分出來的手不能加倍', 'app/js/core/game.js', 'if (h.oneCard || h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'if (h.split || h.oneCard || h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'tests/check_game.js'],
  ['分後 A＋10 點牌沒算 Blackjack（只當 21 點）', 'app/js/core/game.js', 'if (o.splitBlackjack && hand.value(h.cards).blackjack) {', 'if (false) {', 'tests/check_game.js'],
  ['splitBlackjack: false 時分後 A＋10 照樣當 Blackjack', 'app/js/core/game.js', 'if (o.splitBlackjack && hand.value(h.cards).blackjack) {', 'if (hand.value(h.cards).blackjack) {', 'tests/check_game.js'],
  ['預設照舊先偷看（不偷看的規則失效）', 'app/js/core/game.js', "if (o.peek && (up.rank === 'A'", "if ((up.rank === 'A'", 'tests/check_game.js'],
  ['peek: true 也不先偷看', 'app/js/core/game.js', "if (o.peek && (up.rank === 'A' || hand.isTen(up.rank)) && hand.value(dealer.cards).blackjack) {", 'if (false) {', 'tests/check_game.js'],
  ['最後翻出 Blackjack 沒報事件（畫面不會講）', 'app/js/core/game.js', "if (hand.value(dealer.cards).blackjack) events.push({ type: 'dealerBlackjack' });", '', 'tests/check_game.js'],
  ['荷官 Blackjack 只收原注（預設沒改成全收）', 'app/js/core/game.js', "dealerBlackjackTakes: 'all',", "dealerBlackjackTakes: 'original',", 'tests/check_game.js'],
  ["dealerBlackjackTakes: 'original' 時照樣全收", 'app/js/core/game.js', "if (o.dealerBlackjackTakes === 'all') return { result, returned: 0 };", 'return { result, returned: 0 };', 'tests/check_game.js'],
  ['21 點碰到荷官 Blackjack 照輸（any21 失效）', 'app/js/core/game.js', "(o.dealerBlackjackPush === 'any21' && !v.bust && v.total === 21)", 'false', 'tests/check_game.js'],
  ['分後 Blackjack 碰到荷官 Blackjack 照輸', 'app/js/core/game.js', "const ties = h.status === 'blackjack' ||", "const ties = (h.status === 'blackjack' && !h.split) ||", 'tests/check_game.js'],
  // ---- 阿德的表與另外兩位 ----
  ['A+A 對 6 退回要牌', 'app/js/core/strategy.js', "return d === 6 ? dbl('hit') : 'hit';", "return 'hit';", 'tests/check_odds.js'],
  ['軟 18 對 9 改成停', 'app/js/core/strategy.js', "return d <= 8 ? 'stand' : 'hit';", "return d <= 9 ? 'stand' : 'hit';", 'tests/check_strategy.js'],
  ['阿德 11 對 10 改回加倍（沒照不偷看重算）', 'app/js/core/strategy.js', "if (t === 11) return d <= 9 ? dbl('hit') : 'hit';", "if (t === 11) return d <= 10 ? dbl('hit') : 'hit';", 'tests/check_odds.js'],
  ['阿德的 8 對 10、A 也分（沒照不偷看重算）', 'app/js/core/strategy.js', '8: [2, 3, 4, 5, 6, 7, 8, 9]', '8: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]', 'tests/check_odds.js'],
  ['阿德的 2、3 改回不分（沒照分完照打重算）', 'app/js/core/strategy.js', '2: [2, 3, 4, 5, 6, 7], 3: [2, 3, 4, 5, 6, 7]', '2: [], 3: []', 'tests/check_odds.js'],
  ['阿德的 4 對 5、6 沒分', 'app/js/core/strategy.js', '4: [5, 6],', '4: [],', 'tests/check_odds.js'],
  ['阿德的 9 對 7 也分', 'app/js/core/strategy.js', '9: [2, 3, 4, 5, 6, 8, 9]', '9: [2, 3, 4, 5, 6, 7, 8, 9]', 'tests/check_odds.js'],
  ['阿德只補一張的手又成對、不該再分時要牌', 'app/js/core/strategy.js', "if (!can(legal, 'hit')) return 'stand';", '', 'tests/check_strategy.js'],
  ['莽撞型連 10 點牌也分', 'app/js/core/strategy.js', "if (can(legal, 'split') && v !== 10 && ", "if (can(legal, 'split') && ", 'tests/check_strategy.js'],
  ['膽小型多分了 9', 'app/js/core/strategy.js', '(v === 1 || v === 8)', '(v === 1 || v === 8 || v === 9)', 'tests/check_strategy.js'],
  ['A 算 11 的條件差一', 'app/js/core/hand.js', 'total + 10 <= 21', 'total + 10 < 21', 'tests/check_hand.js'],
  // 牌局裡（有 rng）走 HUMAN、照表（沒 rng）走 DECIDE，兩條路各破一次；只破 DECIDE 的話長跑模擬根本碰不到它
  ['穩健型照表改成永遠停牌', 'app/js/core/strategy.js', 'const DECIDE = { steady: basic,', "const DECIDE = { steady: () => 'stand',", 'tests/check_strategy.js'],
  ['穩健型牌局裡改成永遠停牌', 'app/js/core/strategy.js', 'const base = basic(cards, up, legal);', "const base = 'stand';", 'tests/check_simulation.js'],
  ['人性化隨機失效（牌局裡也照表打）', 'app/js/core/strategy.js', 'if (rng) return HUMAN[personality](cards, up, legal, rng);', '', 'tests/check_strategy.js'],
  ['膽小型偶爾也加倍', 'app/js/core/strategy.js', "if (t <= 11) return 'hit';\n    if (t === 12)", "if (t <= 11) return can(legal, 'double') && chance(rng, 0.2) ? 'double' : 'hit';\n    if (t === 12)", 'tests/check_strategy.js'],
  // ---- 勝率提示 ----
  ['勝率沒算荷官藏著的 Blackjack（不偷看也當成偷看過）', 'app/js/core/odds.js', 'const hole = probs(p.counts, peek ? bjHole : 0);', 'const hole = probs(p.counts, bjHole);', 'tests/check_odds.js'],
  ['偷看的規則下勝率照樣算進荷官 Blackjack', 'app/js/core/odds.js', 'const hole = probs(p.counts, peek ? bjHole : 0);', 'const hole = probs(p.counts, 0);', 'tests/check_odds.js'],
  ['21 點碰到荷官 Blackjack 在勝率裡照輸', 'app/js/core/odds.js', 'tie = push21 && total === 21;', 'tie = false;', 'tests/check_odds.js'],
  ['勝率的加倍、分牌碰到荷官 Blackjack 只輸原注（沒照全收）', 'app/js/core/odds.js', 'const stake = (m, first) => (original ? (first ? 1 : 0) : m);', 'const stake = (m, first) => (first ? 1 : 0);', 'tests/check_odds.js'],
  ['只輸原注時分出來的手碰到 Blackjack 在勝率裡沒退回', 'app/js/core/odds.js', 'const stake = (m, first) => (original ? (first ? 1 : 0) : m);', 'const stake = (m, first) => (original ? 1 : m);', 'tests/check_odds.js'],
  ['勝率沒扣掉亮出的牌', 'app/js/core/odds.js', 'for (const c of seen) counts[hand.rankValue(c.rank)]--;', '', 'tests/check_odds.js'],
  ['勝率的荷官軟 17 改成要牌', 'app/js/core/odds.js', 'if (t >= 17) return { [t]: 1 };', 'if (t >= 18 || (t === 17 && !(ace && hard + 10 === 17))) return { [t]: 1 };', 'tests/check_odds.js'],
  ['建議沒把加倍的期望值算兩倍', 'app/js/core/odds.js', 'if (dbl) result.ev.double = value(dbl, 2, s2);', 'if (dbl) result.ev.double = value(dbl, 1, 1);', 'tests/check_odds.js'],
  ['分牌的期望值只算一手', 'app/js/core/odds.js', 'const r = go(2, hands + 1, C1 !== C0);', 'const r = go(1, hands + 1, C1 !== C0);', 'tests/check_odds.js'],
  ['分牌勝率沒算再分', 'app/js/core/odds.js', 'const more = made < cap ? go(pending + 1, made + 1, lead) : null;', 'const more = null;', 'tests/check_odds.js'],
  ['分牌勝率照一般打法算（splitOneCard: true 沒照只補一張）', 'app/js/core/odds.js', "const oneCard = rules.splitOneCard || first.rank === 'A';", "const oneCard = first.rank === 'A';", 'tests/check_odds.js'],
  ['分 A 的勝率照一般打法算（A 沒限一張）', 'app/js/core/odds.js', "const oneCard = rules.splitOneCard || first.rank === 'A';", 'const oneCard = rules.splitOneCard;', 'tests/check_odds.js'],
  ['分後 Blackjack 在勝率裡只賠 1 倍', 'app/js/core/odds.js', 'ev: 1.5 * (1 - bj), bj: true', 'ev: 1 - bj, bj: true', 'tests/check_odds.js'],
  // ---- 2026-10-28 state() 改成逐層拷貝（P-11）----
  ['state() 給出引擎裡的牌物件（沒拷貝，改回傳值就改到牌局）', 'app/js/core/game.js', 'const copyCard = c => c && { ...c };', 'const copyCard = c => c;', 'tests/check_game.js'],
];

// 失敗清單裡「有名字的」那幾條：載入就擲錯時 node 記的是以檔名命名的一條（tests\check_x.js），不算
function namedFails(stdout, testFile) {
  const asFile = new Set([testFile, testFile.replace(/\//g, '\\')]);
  const fails = (stdout.match(/^✖ .+/gm) || []).filter(l => !/failing tests/.test(l));
  return [...new Set(fails)].filter(l => !asFile.has(l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')));
}

function copyRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-mut-'));
  for (const d of ['app', 'tests']) fs.cpSync(path.join(REPO, d), path.join(tmp, d), { recursive: true });
  return tmp;
}

// 基準：每支會用到的測試檔在沒破壞的複本上都要全綠，否則表上的「紅」分不出是破壞造成的還是本來就紅
const base = copyRepo();
const testFiles = [...new Set(MUTANTS.map(m => m[4]))];
try {
  for (const testFile of testFiles) {
    const r = spawnSync(process.execPath, ['--test', testFile], { cwd: base, encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`✖ 基準就是紅的：${testFile} → ${namedFails(r.stdout, testFile).slice(0, 2).join('｜') || '載入就擲錯'}`);
      process.exitCode = 1;
    }
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`基準：${testFiles.length} 支測試檔在沒破壞的複本上全綠`);
if (process.exitCode) {
  console.log('基準沒有全綠，先修好再跑破壞');
} else {
  for (const [name, file, from, to, testFile] of MUTANTS) {
    const tmp = copyRepo();
    try {
      const p = path.join(tmp, file);
      const before = fs.readFileSync(p, 'utf8');
      const after = before.replace(from, to);
      if (after === before) { console.log(`✖ ${name}：破壞沒有命中，程式改過了就更新這張表`); survived++; continue; }
      fs.writeFileSync(p, after);
      const r = spawnSync(process.execPath, ['--test', testFile], { cwd: tmp, encoding: 'utf8' });
      const named = namedFails(r.stdout, testFile);
      const caught = r.status !== 0 && named.length > 0;
      if (!caught) survived++;
      const why = caught ? named.slice(0, 2).join('｜') : r.status !== 0 ? '只有載入就擲錯，沒有哪一條斷言變紅' : '';
      console.log(`${caught ? '紅（抓到了）' : '綠（沒抓到！）'} ${name} → ${why}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log(survived ? `有 ${survived} 個破壞沒被抓到` : `${MUTANTS.length} 個破壞全部被抓到`);
  process.exitCode = survived ? 1 : 0;
}
