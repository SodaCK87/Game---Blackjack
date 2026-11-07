// 守戰績面板：真的按鈕打一局，戰績記到這一局、記到你這次決定有沒有照基本策略；重新整理後還在、面板照實列出來；
// 存檔壞掉當新玩家，而且不連累籌碼存檔。數字怎麼算在 check_stats.js（不開瀏覽器）。
// 驗不到：真手機手指點戰績鈕（這裡是頁面裡的 click）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP, DESKTOP, PHONE, url, first, copyWith, PLAY_UTIL } = require('./ui_util');
const { withPage } = require('./browser_util');
const { rigInit, deal } = require('./rig_util');

// 你拿 10＋6 對荷官明牌 6：基本策略是停。要牌的話下一張 K，爆牌
const RIG = rigInit([...deal('10', '6'), 'K']);
const PLAY = button => `(async () => {${PLAY_UTIL}
  const before = hud.dataset.mode;
  if (before === 'act') await press('${button}');
  await until(() => hud.dataset.mode === 'bet', 20000);
  return { before, stats: d.stats };
})()`;
const PANEL = `(async () => {
  await BJK.view.stage.dealer.ready;
  document.getElementById('statsBtn').click();
  const p = document.getElementById('statsPanel'), r = p.getBoundingClientRect();
  const rows = Object.fromEntries([...p.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  const inView = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  document.getElementById('statsClose').click();
  return { rows, inView, closed: p.hidden, stats: BJK.view.stage.director.stats };
})()`;

async function playThenReload(appDir, viewport, button) {
  return withPage(first(), { ...viewport, init: RIG }, async page => {
    await page.goto(url(appDir));
    const played = await page.evaluate(PLAY(button), 40000);
    await page.goto(url(appDir));
    return { played, panel: await page.evaluate(PANEL) };
  });
}

for (const [name, viewport] of [['桌機', DESKTOP], ['手機', PHONE]]) {
  test(`${first()}：${name}照基本策略停牌，戰績記一局、一次決定 100%；重新整理後還在，面板照實列出`, async () => {
    const r = await playThenReload(APP, viewport, 'standBtn');
    const { played, panel } = r.value;
    assert.strictEqual(played.before, 'act', '前置不成立：沒有輪到你');
    const s = played.stats;
    assert.deepStrictEqual({ rounds: s.rounds, hands: s.hands, decisions: s.decisions, basic: s.basic, busts: s.busts },
      { rounds: 1, hands: 1, decisions: 1, basic: 1, busts: 0 });
    assert.strictEqual(s.wins + s.losses + s.pushes, 1);
    assert.deepStrictEqual(panel.stats, s, '重新整理後讀回來的跟打完那一刻不一樣');
    assert.strictEqual(panel.rows['打了'], '1 局');
    assert.strictEqual(panel.rows['照基本策略打'], '100%（1 次決定）');
    assert.strictEqual(panel.rows['累計輸贏'], s.net > 0 ? `+${s.net}` : String(s.net));
    assert.ok(panel.inView, '面板超出畫面');
    assert.ok(panel.closed, '按關閉沒有關');
    assert.deepStrictEqual(r.console, []);
  });
}

test(`${first()}：16 點對 6 要牌（不照基本策略）爆牌，記成 0%、爆牌一次`, async () => {
  const r = await playThenReload(APP, DESKTOP, 'hitBtn');
  const s = r.value.played.stats;
  assert.deepStrictEqual({ decisions: s.decisions, basic: s.basic, busts: s.busts, losses: s.losses, streak: s.streak, net: s.net },
    { decisions: 1, basic: 0, busts: 1, losses: 1, streak: 0, net: -100 });
  assert.strictEqual(r.value.panel.rows['照基本策略打'], '0%（1 次決定）');
});

test('陽性對照：決定一律記成照基本策略，要牌那局要判成記錯', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "stats = BJK.stats.decide(stats, action === BJK.strategy.basic(", 'stats = BJK.stats.decide(stats, true || (');
  try {
    assert.strictEqual((await playThenReload(tmp, DESKTOP, 'hitBtn')).value.played.stats.basic, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：戰績沒寫進 localStorage，重新整理後要判成不見了', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), 'try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }', 'try { }');
  try {
    assert.strictEqual((await playThenReload(tmp, DESKTOP, 'standBtn')).value.panel.stats.rounds, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test(`${first()}：戰績存檔壞掉當新玩家、不擲錯，籌碼存檔照常讀到`, async () => {
  for (const bad of ['{"v":1,"rounds":-3}', 'not json', '[]', 'null']) {
    const init = `localStorage.setItem('bjk.stats.v1', ${JSON.stringify(bad)}); localStorage.setItem('bjk.save.v1', '{"v":1,"bankrolls":{"me":500}}');`;
    const r = await withPage(first(), { ...DESKTOP, init }, async page => {
      await page.goto(url(APP));
      return page.evaluate(PANEL);
    });
    assert.strictEqual(r.value.stats.rounds, 0, bad);
    assert.strictEqual(r.value.stats.peak, 500, `${bad}：籌碼最高從讀到的 500 起算`);
    assert.strictEqual(r.value.rows['照基本策略打'], '還沒輪到你做決定', bad);
    assert.deepStrictEqual(r.console, [], bad);
  }
});
