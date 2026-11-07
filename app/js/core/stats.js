// 玩家的戰績：一局的事件丟進 record() 累積，每次輪到玩家做決定就丟一次 decide()（有沒有照基本策略）。
// 全部是純函式、回傳新物件；存讀由畫面層負責，讀回來的東西先過 parse()，格式不對就當新玩家（CLAUDE.md 第 8 條）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BJK = root.BJK || {}).stats = factory();
})(globalThis, function () {
  // hands 以「手」計：分牌後一局可能有好幾手。rounds、streak、bestStreak 以「局」計：一局各手淨輸贏加起來是正的才算贏一局，
  // 是負的連勝歸零，剛好打平連勝不變。peak 是結算後籌碼最高到過多少。decisions／basic：做過幾次決定、其中幾次跟基本策略一樣
  const FIELDS = ['rounds', 'hands', 'wins', 'losses', 'pushes', 'blackjacks', 'busts', 'doubles', 'splits',
    'net', 'streak', 'bestStreak', 'peak', 'decisions', 'basic'];
  const V = 1;

  function empty(bankroll) {
    const s = { v: V };
    for (const f of FIELDS) s[f] = 0;
    s.peak = Number.isFinite(bankroll) ? bankroll : 0;
    return s;
  }

  // 每個欄位都要是整數，net 可以是負的、其他不行；任何一欄不對整筆不認
  function parse(raw, bankroll) {
    if (!raw || typeof raw !== 'object' || raw.v !== V) return empty(bankroll);
    for (const f of FIELDS) {
      const n = raw[f];
      if (!Number.isInteger(n) || (f !== 'net' && n < 0)) return empty(bankroll);
    }
    if (raw.basic > raw.decisions || raw.wins + raw.losses + raw.pushes !== raw.hands || raw.streak > raw.bestStreak) return empty(bankroll);
    const s = { v: V };
    for (const f of FIELDS) s[f] = raw[f];
    return s;
  }

  // events：這一局引擎吐出的全部事件；seat：玩家座位；bankroll：結算後的籌碼
  function record(stats, events, { seat, bankroll }) {
    const s = Object.assign({}, stats);
    let net = 0, settled = 0;
    for (const e of events) {
      if (e.seat !== seat) continue;
      if (e.type === 'double') s.doubles++;
      if (e.type === 'split') s.splits++;
      if (e.type !== 'settle') continue;
      settled++;
      s.hands++;
      net += e.net;
      if (e.result === 'win' || e.result === 'blackjack') s.wins++;
      else if (e.result === 'push') s.pushes++;
      else s.losses++;
      if (e.result === 'blackjack') s.blackjacks++;
      if (e.result === 'bust') s.busts++;
    }
    if (!settled) return stats;   // 這一局沒下注（或還沒結算）：不算一局
    s.rounds++;
    s.net += net;
    if (net > 0) s.streak++;
    else if (net < 0) s.streak = 0;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (Number.isFinite(bankroll)) s.peak = Math.max(s.peak, bankroll);
    return s;
  }

  function decide(stats, matchedBasic) {
    return Object.assign({}, stats, { decisions: stats.decisions + 1, basic: stats.basic + (matchedBasic ? 1 : 0) });
  }

  // 照基本策略的比例，四捨五入到整數百分比；還沒做過決定回 null
  const basicRate = s => (s.decisions ? Math.round((s.basic / s.decisions) * 100) : null);

  return { empty, parse, record, decide, basicRate, FIELDS };
});
