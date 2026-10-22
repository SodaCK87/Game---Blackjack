// core 規則的陽性對照總表：在暫存複本上逐一植入錯誤，確認對應的測試會紅。產品檔一個字都不碰。
// 用法：npm run mutants（約 25 秒，不在 npm test 裡；改了 core 的規則或測試之後跑一次）
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
let survived = 0;
const MUTANTS = [
  ['Blackjack 改成 1 賠 1', 'app/js/core/game.js', 'blackjack: s.bet * 2.5', 'blackjack: s.bet * 2', 'tests/check_game.js'],
  ['荷官 16 點就停', 'app/js/core/game.js', 'hand.value(dealer.cards).total < 17', 'hand.value(dealer.cards).total < 16', 'tests/check_game.js'],
  ['荷官不偷看底牌', 'app/js/core/game.js', "(up.rank === 'A' || hand.isTen(up.rank)) && hand.value", 'false && hand.value', 'tests/check_game.js'],
  ['加倍沒扣籌碼', 'app/js/core/game.js', 's.bankroll -= s.bet;\n        s.bet *= 2;', 's.bet *= 2;', 'tests/check_simulation.js'],
  ['軟 18 對 9 改成停', 'app/js/core/strategy.js', "return d <= 8 ? 'stand' : 'hit';", "return d <= 9 ? 'stand' : 'hit';", 'tests/check_strategy.js'],
  ['A 算 11 的條件差一', 'app/js/core/hand.js', 'total + 10 <= 21', 'total + 10 < 21', 'tests/check_hand.js'],
  ['穩健型改成永遠停牌', 'app/js/core/strategy.js', 'const DECIDE = { steady: basic,', "const DECIDE = { steady: () => 'stand',", 'tests/check_simulation.js'],
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
