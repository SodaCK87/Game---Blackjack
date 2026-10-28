// 守音效：五種聲音離線算出來聽得到、不爆音、跟著動畫播完就停；瀏覽器的自動播放規定下，真的點過一下才出聲，
// 程式模擬的點擊不建 AudioContext、主控台乾淨；左上角開關關掉就不出聲，重新整理後還記得，也不會洗掉勝率提示的開關。
// 每個事件有沒有叫對的聲音由導演自己核對（director.js 的 SOUND_OF），check_play.js 讀它的不一致清單；這裡做它的陽性對照。
// 驗不到：好不好聽、真喇叭上音量合不合適、iPhone 靜音鍵與 LINE 內建瀏覽器的行為（要真人聽）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP, DESKTOP, PHONE, url, first, copyWith } = require('./ui_util');
const { availableBrowsers, withPage } = require('./browser_util');

// 每種聲音單獨算一次，再算最壞的疊法：四個座位的籌碼同時落下（下注時就是這樣），又剛好發一張牌。
// peak 是波形絕對值最大，end 是最後一個還聽得到（大於 -60 dB）的樣本在第幾秒
const RENDER = `(async () => {
  const S = BJK.view.sfx, RATE = 44100;
  async function render(play) {
    const oc = new OfflineAudioContext(1, RATE * 2, RATE), out = S.chain(oc);
    play(oc, out);
    const d = (await oc.startRendering()).getChannelData(0);
    let peak = 0, last = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; if (v > 0.001) last = i; }
    return { peak, end: last / RATE };
  }
  const out = {};
  for (const name of Object.keys(S.SOUNDS)) out[name] = await render((oc, o) => S.SOUNDS[name](oc, o, 0));
  out.worst = await render((oc, o) => { for (let i = 0; i < 4; i++) S.SOUNDS.chip(oc, o, 0); S.SOUNDS.deal(oc, o, 0); });
  return out;
})()`;
// 每種聲音最晚幾秒要停：跟著的動畫演多久（director.js 傳的 dur 預設值）再多 0.25 秒餘韻
const END_BY = { deal: 0.36, flip: 0.42, shuffle: 0.8, collect: 0.42, chip: 0 };
const AUDIBLE = 0.05, CLIP = 0.9;

function assertLevels(m) {
  const why = JSON.stringify(m);
  assert.deepStrictEqual(Object.keys(m).sort(), [...Object.keys(END_BY), 'worst'].sort(), `音效種類對不上：${why}`);
  for (const [name, r] of Object.entries(m)) {
    assert.ok(r.peak >= AUDIBLE, `${name} 太小聲（峰值 ${r.peak.toFixed(3)}）：${why}`);
    assert.ok(r.peak <= CLIP, `${name} 爆音（峰值 ${r.peak.toFixed(3)}）：${why}`);
    if (END_BY[name] !== undefined) assert.ok(r.end <= END_BY[name] + 0.25, `${name} 拖到 ${r.end.toFixed(2)} 秒才停：${why}`);
  }
}

test(`${first()}：五種聲音離線算出來聽得到、疊在一起也不爆音、跟著動畫播完就停`, async t => {
  const r = await withPage(first(), DESKTOP, page => page.goto(url(APP)).then(() => page.evaluate(RENDER)));
  for (const [name, x] of Object.entries(r.value)) t.diagnostic(`${name}：峰值 ${x.peak.toFixed(3)}、${x.end.toFixed(2)} 秒停`);
  assertLevels(r.value);
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：主音量調成 4 倍要判成爆音、調成 1/60 要判成太小聲', async () => {
  for (const [to, why] of [['2.4', /爆音/], ['0.01', /太小聲/]]) {
    const tmp = copyWith(path.join('js', 'view', 'sfx.js'), 'const MASTER = 0.6;', `const MASTER = ${to};`);
    try {
      const r = await withPage(first(), DESKTOP, page => page.goto(url(tmp)).then(() => page.evaluate(RENDER)));
      assert.throws(() => assertLevels(r.value), why);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

// 先用 el.click() 按 +10、打一局（探針平常就是這樣點），再用 CDP 真的點一下 +10、再打一局
async function gestureRun(browser, dir) {
  return withPage(browser, PHONE, async page => {
    await page.goto(url(dir));
    const synthetic = await page.evaluate(`(async () => {
      await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
      const S = BJK.view.sfx;
      document.querySelector('[data-chip="10"]').click();
      await BJK.view.stage.director.autoplay(1);
      return { state: S.state, played: S.played, requested: Object.values(S.requested).reduce((a, b) => a + b, 0) };
    })()`, 30000);
    const [x, y] = await page.evaluate(`(() => { const r = document.querySelector('[data-chip="10"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await page.click(x, y);
    const real = await page.evaluate(`(async () => {
      const S = BJK.view.sfx, sum = () => Object.values(S.requested).reduce((a, b) => a + b, 0);
      const chipPlayed = S.played - ${synthetic.played}, p0 = S.played, r0 = sum();
      await BJK.view.stage.director.autoplay(1);
      return { state: S.state, chipPlayed, played: S.played - p0, requested: sum() - r0, mismatches: BJK.view.stage.director.mismatches };
    })()`, 30000);
    return { synthetic, real };
  });
}

for (const browser of availableBrowsers()) {
  test(`${browser}：程式模擬的點擊不出聲，真的點一下才開始出聲，之後每一聲都有排進喇叭，主控台乾淨`, async () => {
    const r = await gestureRun(browser, APP);
    const { synthetic, real } = r.value, why = JSON.stringify(r.value);
    assert.strictEqual(synthetic.state, 'locked', `模擬的點擊就建了 AudioContext：${why}`);
    assert.strictEqual(synthetic.played, 0, why);
    assert.ok(synthetic.requested > 10, `打了一局，叫聲音的次數太少：${why}`);
    assert.strictEqual(real.state, 'running', `真的點過之後聲音還沒開：${why}`);
    assert.strictEqual(real.chipPlayed, 1, `真的點 +10 那一下沒有籌碼聲：${why}`);
    assert.ok(real.requested > 10 && real.played === real.requested, `叫了 ${real.requested} 次、出聲 ${real.played} 次：${why}`);
    assert.deepStrictEqual(real.mismatches, []);
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：沒掛上點擊解鎖，真的點過也要判成聲音沒開', async () => {
  const tmp = copyWith(path.join('js', 'view', 'sfx.js'), "for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) document.addEventListener(type, unlock, true);", '');
  try {
    const r = await gestureRun(first(), tmp);
    assert.strictEqual(r.value.real.state, 'locked');
    assert.strictEqual(r.value.real.played, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉發牌聲，導演要記一筆「deal 演完沒有聲音」', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "S.play('deal', { dur: 0.36 / A.speed });", '');
  try {
    const r = await withPage(first(), DESKTOP, page => page.goto(url(tmp)).then(() => page.evaluate(`(async () => {
      await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40;
      return (await BJK.view.stage.director.autoplay(1)).mismatches; })()`, 30000)));
    assert.ok(r.value.some(m => m.includes('deal 演完沒有deal的聲音')), JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 真的點左上角開關（也是第一次點，順便解鎖）關掉音效、模擬點擊關掉勝率提示、打一局；重新整理後看兩個開關，
// 再真的點一次把音效打開
async function toggleRun(dir) {
  return withPage(first(), DESKTOP, async page => {
    const center = `(() => { const r = document.getElementById('soundToggle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`;
    const read = `({ sound: document.getElementById('soundToggle').getAttribute('aria-pressed'), on: BJK.view.sfx.on,
      odds: document.getElementById('oddsToggle').getAttribute('aria-pressed'), prefs: localStorage.getItem('bjk.prefs.v1') })`;
    await page.goto(url(dir));
    await page.evaluate('BJK.view.stage.dealer.ready');
    await page.click(...await page.evaluate(center));
    const off = await page.evaluate(`(async () => {
      BJK.view.anim.speed = 40;
      const S = BJK.view.sfx, sum = () => Object.values(S.requested).reduce((a, b) => a + b, 0), p0 = S.played, r0 = sum();
      document.getElementById('oddsToggle').click();
      await BJK.view.stage.director.autoplay(1);
      return { ...${read}, state: S.state, played: S.played - p0, requested: sum() - r0 };
    })()`, 30000);
    await page.goto(url(dir));
    await page.evaluate('BJK.view.stage.dealer.ready');
    const reloaded = await page.evaluate(read);
    await page.click(...await page.evaluate(center));
    const back = await page.evaluate(read);
    return { off, reloaded, back };
  });
}

test(`${first()}：左上角關掉音效就不出聲；重新整理後還是關的，勝率提示的開關也沒被洗掉`, async () => {
  const r = await toggleRun(APP);
  const { off, reloaded, back } = r.value, why = JSON.stringify(r.value);
  assert.deepStrictEqual([off.sound, off.on, off.odds, off.state], ['false', false, 'false', 'running'], why);
  assert.ok(off.requested > 10 && off.played === 0, `關掉後叫了 ${off.requested} 次、出聲 ${off.played} 次：${why}`);
  assert.deepStrictEqual([reloaded.sound, reloaded.on, reloaded.odds], ['false', false, 'false'], `重新整理後開關沒記住：${why}`);
  assert.deepStrictEqual([back.sound, back.on, back.odds], ['true', true, 'false'], `打開音效時把勝率提示洗掉了：${why}`);
  assert.deepStrictEqual(JSON.parse(back.prefs), { sound: true, odds: false });
  assert.deepStrictEqual(r.console, []);
});

test('陽性對照：存偏好時不保留另一個開關，要判成重新整理後音效又開了', async () => {
  const tmp = copyWith(path.join('js', 'view', 'hud.js'), 'JSON.stringify(Object.assign(loadPrefs(), { [name]: on }))', 'JSON.stringify({ [name]: on })');
  try {
    const r = await toggleRun(tmp);
    assert.strictEqual(r.value.reloaded.sound, 'true', JSON.stringify(r.value));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
