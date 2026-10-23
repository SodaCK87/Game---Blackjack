// core 規則的陽性對照總表：在暫存複本上逐一植入錯誤，確認對應的測試會紅。產品檔一個字都不碰。
// 用法：npm run mutants（約 1 分半，不在 npm test 裡；改了 core 的規則或測試之後跑一次）
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
let survived = 0;
const MUTANTS = [
  ['Blackjack 改成 1 賠 1', 'app/js/core/game.js', 'blackjack: h.bet * 2.5', 'blackjack: h.bet * 2', 'tests/check_game.js'],
  ['荷官 16 點就停', 'app/js/core/game.js', 'hand.value(dealer.cards).total < 17', 'hand.value(dealer.cards).total < 16', 'tests/check_game.js'],
  ['荷官不偷看底牌', 'app/js/core/game.js', "(up.rank === 'A' || hand.isTen(up.rank)) && hand.value", 'false && hand.value', 'tests/check_game.js'],
  ['加倍後沒自動停牌（沒到 21 還能要牌）', 'app/js/core/game.js', "} else if (action === 'double' || v.total === 21) {", '} else if (v.total === 21) {', 'tests/check_game.js'],
  ['預填的注沒對齊 step（BJK-02）', 'app/js/core/game.js', 'const bet = cap - (cap % o.step);', 'const bet = cap;', 'tests/check_game.js'],
  ['加倍沒扣籌碼', 'app/js/core/game.js', 's.bankroll -= h.bet;\n        h.bet *= 2;', 'h.bet *= 2;', 'tests/check_simulation.js'],
  // ---- v0.10.0 加倍只准 10、11 點，分牌看點數、分完每手只補一張、不限手數 ----
  ['加倍沒照點數（頭兩張任何點數都能加倍）', 'app/js/core/game.js', 'return !v.soft && o.doubleOn.includes(v.total);', 'return true;', 'tests/check_game.js'],
  ['有 A 的軟牌當硬點數加倍（A+9 當 10 點）', 'app/js/core/game.js', 'return !v.soft && o.doubleOn.includes(v.total);', 'return o.doubleOn.includes(h.cards.reduce((a, c) => a + hand.rankValue(c.rank), 0));', 'tests/check_game.js'],
  ['分牌看牌面（K+Q 不能分）', 'app/js/core/game.js', "return o.splitBy === 'rank' ? a.rank === b.rank : hand.rankValue(a.rank) === hand.rankValue(b.rank);", 'return a.rank === b.rank;', 'tests/check_game.js'],
  ['點數不同也能分', 'app/js/core/game.js', "return o.splitBy === 'rank' ? a.rank === b.rank : hand.rankValue(a.rank) === hand.rankValue(b.rank);", 'return true;', 'tests/check_game.js'],
  ['分牌沒押第二份注', 'app/js/core/game.js', 's.bankroll -= h.bet;\n        const card = h.cards.pop();', 'const card = h.cards.pop();', 'tests/check_game.js'],
  ['籌碼不夠也能分', 'app/js/core/game.js', 'if (h.cards.length !== 2 || s.bankroll < h.bet || s.hands.length >= o.maxHands) return false;', 'if (h.cards.length !== 2 || s.hands.length >= o.maxHands) return false;', 'tests/check_game.js'],
  ['手數上限失效（maxHands: 4 還能分第五手）', 'app/js/core/game.js', 'if (h.cards.length !== 2 || s.bankroll < h.bet || s.hands.length >= o.maxHands) return false;', 'if (h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'tests/check_game.js'],
  ['分完補一張沒自動停（還要問）', 'app/js/core/game.js', 'if ((h.oneCard && !canSplit(s, h)) || hand.value(h.cards).total === 21) {', 'if (hand.value(h.cards).total === 21) {', 'tests/check_game.js'],
  ['分完補到同點數還能要牌', 'app/js/core/game.js', "const out = h.oneCard ? ['stand'] : ['hit', 'stand'];", "const out = ['hit', 'stand'];", 'tests/check_game.js'],
  ['分完補到 10 點還能加倍', 'app/js/core/game.js', 'if (h.oneCard || h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'if (h.cards.length !== 2 || s.bankroll < h.bet) return false;', 'tests/check_game.js'],
  ['分開的 A 照一般的手打（splitOneCard: false 時沒限一張）', 'app/js/core/game.js', "h.oneCard = o.splitOneCard || card.rank === 'A';", 'h.oneCard = o.splitOneCard;', 'tests/check_game.js'],
  ['分出來的 A+10 當 Blackjack 賠 1.5 倍', 'app/js/core/game.js', "if (h.status === 'blackjack') result", "if (h.status === 'blackjack' || v.blackjack) result", 'tests/check_game.js'],
  ['只結算第一手', 'app/js/core/game.js', 's.hands.forEach((h, k) => {', 's.hands.slice(0, 1).forEach((h, k) => {', 'tests/check_simulation.js'],
  ['新的一手放到最後，不是插在這一手後面', 'app/js/core/game.js', 's.hands.splice(k + 1, 0, ', 's.hands.splice(s.hands.length, 0, ', 'tests/check_game.js'],
  ['A+A 對 6 退回要牌', 'app/js/core/strategy.js', "return d === 6 ? dbl('hit') : 'hit';", "return 'hit';", 'tests/check_odds.js'],
  ['軟 18 對 9 改成停','app/js/core/strategy.js', "return d <= 8 ? 'stand' : 'hit';", "return d <= 9 ? 'stand' : 'hit';", 'tests/check_strategy.js'],
  ['阿德的 8 改回一律分（沒照只補一張重算）', 'app/js/core/strategy.js', '8: [2, 3, 4, 5, 6, 7, 8]', '8: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]', 'tests/check_odds.js'],
  ['阿德分完又成對、不該再分時要牌', 'app/js/core/strategy.js', "if (!can(legal, 'hit')) return 'stand';", '', 'tests/check_strategy.js'],
  ['莽撞型連 10 點牌也分', 'app/js/core/strategy.js', "if (can(legal, 'split') && v !== 10 && ", "if (can(legal, 'split') && ", 'tests/check_strategy.js'],
  ['膽小型多分了 9', 'app/js/core/strategy.js', '(v === 1 || v === 8)', '(v === 1 || v === 8 || v === 9)', 'tests/check_strategy.js'],
  ['A 算 11 的條件差一', 'app/js/core/hand.js', 'total + 10 <= 21', 'total + 10 < 21', 'tests/check_hand.js'],
  // 牌局裡（有 rng）走 HUMAN、照表（沒 rng）走 DECIDE，兩條路各破一次；只破 DECIDE 的話長跑模擬根本碰不到它
  ['穩健型照表改成永遠停牌', 'app/js/core/strategy.js', 'const DECIDE = { steady: basic,', "const DECIDE = { steady: () => 'stand',", 'tests/check_strategy.js'],
  ['穩健型牌局裡改成永遠停牌', 'app/js/core/strategy.js', 'const base = basic(cards, up, legal);', "const base = 'stand';", 'tests/check_simulation.js'],
  ['人性化隨機失效（牌局裡也照表打）', 'app/js/core/strategy.js', 'if (rng) return HUMAN[personality](cards, up, legal, rng);', '', 'tests/check_strategy.js'],
  ['勝率沒排除荷官 Blackjack（偷看過的底牌照樣可能是 10 點牌）', 'app/js/core/odds.js', 'const holeExclude = upValue === 1 ? 10 : upValue === 10 ? 1 : 0;', 'const holeExclude = 0;', 'tests/check_odds.js'],
  ['勝率沒扣掉亮出的牌', 'app/js/core/odds.js', 'for (const c of seen) counts[hand.rankValue(c.rank)]--;', '', 'tests/check_odds.js'],
  ['勝率的荷官軟 17 改成要牌', 'app/js/core/odds.js', 'if (t >= 17) return { [t]: 1 };', 'if (t >= 18 || (t === 17 && !(ace && hard + 10 === 17))) return { [t]: 1 };', 'tests/check_odds.js'],
  ['建議沒把加倍的期望值算兩倍', 'app/js/core/odds.js', 'result.ev.double = 2 * ev(result.double);', 'result.ev.double = ev(result.double);', 'tests/check_odds.js'],
  ['分牌的期望值只算一手', 'app/js/core/odds.js', 'total = 2 * (resplit ? again : stop);', 'total = resplit ? again : stop;', 'tests/check_odds.js'],
  ['分牌勝率沒算再分', 'app/js/core/odds.js', 'resplit = q > 0 && again > stop;', 'resplit = false;', 'tests/check_odds.js'],
  ['分牌勝率照一般打法算（沒照只補一張）', 'app/js/core/odds.js', "const oneCard = rules.splitOneCard || first.rank === 'A';", "const oneCard = first.rank === 'A';", 'tests/check_odds.js'],
  ['膽小型偶爾也加倍', 'app/js/core/strategy.js', "if (t <= 11) return 'hit';\n    if (t === 12)", "if (t <= 11) return can(legal, 'double') && chance(rng, 0.2) ? 'double' : 'hit';\n    if (t === 12)", 'tests/check_strategy.js'],
];
for (const [name, file, from, to, testFile] of MUTANTS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bjk-mut-'));
  try {
    for (const d of ['app', 'tests']) fs.cpSync(path.join(REPO, d), path.join(tmp, d), { recursive: true });
    const p = path.join(tmp, file);
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(from, to);
    if (after === before) { console.log(`✖ ${name}：破壞沒有命中，程式改過了就更新這張表`); survived++; continue; }
    fs.writeFileSync(p, after);
    const r = spawnSync(process.execPath, ['--test', testFile], { cwd: tmp, encoding: 'utf8' });
    const fails = (r.stdout.match(/^✖ .+/gm) || []).filter(l => !/failing tests/.test(l));
    if (r.status === 0) survived++;
    console.log(`${r.status !== 0 ? '紅（抓到了）' : '綠（沒抓到！）'} ${name} → ${[...new Set(fails)].slice(0, 2).join('｜')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(survived ? `有 ${survived} 個破壞沒被抓到` : `${MUTANTS.length} 個破壞全部被抓到`);
process.exitCode = survived ? 1 : 0;
