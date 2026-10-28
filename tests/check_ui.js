// 守介面：輪到你時桌上的標籤互不重疊也不跑出畫面、手機的牌桌夠大、操作列的按鈕都在列內不換行、
// 下注列的按鈕彼此隔開（桌機一排、手機兩排）、籌碼重新整理後還在、籌碼輸光能一鍵重置。
// 驗不到：真手機（這裡是 CDP 模擬的尺寸）、真人手指點不點得準。
// 打局時的按鈕流程（分牌、BJK-02、分成很多手）在 check_ui_rounds.js；勝率提示、版本號、大字與對白在 check_ui_text.js。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { APP, DESKTOP, PHONE, SMALL_PHONE, url, first, MEASURE_TURN, pairsOverlapping, assertButtonsFit, copyWith } = require('./ui_util');
const { availableBrowsers, withPage } = require('./browser_util');

// seatSpan：最左與最右兩個下注圈的中心在畫面上相距幾成畫面寬，量牌桌放得多大
const MEASURE_BET = `(async () => {
  const s = BJK.view.stage;
  await s.dealer.ready;
  const hud = document.getElementById('hud');
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const x = seat => seat.circle.clone().project(s.camera).x;
  const seats = s.table.seats;
  return { mode: hud.dataset.mode, seatSpan: (x(seats[seats.length - 1]) - x(seats[0])) / 2,
           buttons: [...document.querySelectorAll('#betBar button')].map(el => ({ text: el.textContent, clipped: el.scrollWidth > el.clientWidth, ...rect(el) })),
           hud: { ...rect(hud), scrollH: hud.scrollHeight, clientH: hud.clientHeight }, vw: innerWidth, vh: innerHeight };
})()`;

// 標籤有沒有整個落在畫布裡（畫布底＝操作列頂）
function labelsOutOfView(m) {
  return m.labels.filter(l => l.left < 0 || l.right > m.vw || l.top < 0 || l.bottom > m.hud.top).map(l => l.text);
}

// 2026-10-22 量到直式手機改框景前約 0.45、改後約 0.65（小手機 0.43 → 0.61），門檻取中間
const PHONE_SEAT_SPAN = 0.55;

// 下注列：桌機八顆一排；手機一排放不下，籌碼六顆一排、清除與發牌一排。同一排相鄰兩顆至少隔 BET_GAP
// （2026-10-28 使用者嫌擠，當時是桌機 6px、手機 4px；現在桌機 12px、手機 8px）
const CHIPS = ['+10', '+50', '+100', '+500', '+1000', '+2000'];
const BET_GAP = 8;
function assertBetBar(m, mobile) {
  const why = JSON.stringify(m);
  assert.ok(m.hud.scrollH <= m.hud.clientH + 1, `下注列的操作列內容超出固定高度（按鈕換行了）：${why}`);
  const rows = [];
  for (const b of [...m.buttons].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = rows.find(r => Math.abs(r[0].top - b.top) < 1);
    row ? row.push(b) : rows.push([b]);
  }
  rows.forEach(r => r.sort((a, b) => a.left - b.left));
  assert.deepStrictEqual(rows.map(r => r.map(b => b.text)), mobile ? [CHIPS, ['清除', '發牌']] : [[...CHIPS, '清除', '發牌']], `下注列排法不對：${why}`);
  for (const b of m.buttons) {
    assert.ok(b.left >= m.hud.left && b.right <= m.hud.right && b.top >= m.hud.top && b.bottom <= m.hud.bottom, `下注列的「${b.text}」跑出操作列：${why}`);
    assert.ok(b.bottom - b.top >= 36, `下注列的「${b.text}」太矮，手指不好按：${why}`);
    assert.ok(!b.clipped, `下注列的「${b.text}」字塞不進按鈕：${why}`);
  }
  for (const r of rows) for (let i = 1; i < r.length; i++) {
    const gap = r[i].left - r[i - 1].right;
    assert.ok(gap >= BET_GAP - 0.5, `下注列「${r[i - 1].text}」與「${r[i].text}」只隔 ${gap.toFixed(1)}px：${why}`);
  }
}

for (const browser of availableBrowsers()) {
  for (const [name, vp] of [['桌機', DESKTOP], ['手機', PHONE], ['小手機', SMALL_PHONE]]) {
    test(`${browser}：${name}輪到你時，桌上的標籤互不重疊、都在畫面內，動作按鈕排成一列`, async () => {
      const r = await withPage(browser, vp, page => page.goto(url(APP)).then(() => page.evaluate(MEASURE_TURN, 30000)));
      const m = r.value;
      assert.ok(m.reached, '打了 6 局都沒輪到你');
      assert.ok(m.labels.length >= 6, `標籤太少，量不出東西：${JSON.stringify(m.labels)}`);
      assert.deepStrictEqual(pairsOverlapping(m.labels), [], `標籤重疊：${JSON.stringify(m.labels)}`);
      assert.deepStrictEqual(labelsOutOfView(m), [], `標籤跑出畫面：${JSON.stringify(m.labels)}`);
      assertButtonsFit(m, '動作列');
      assert.deepStrictEqual(r.console, []);
    });

    test(`${browser}：${name}下注列八顆按鈕排成${vp.mobile ? '兩' : '一'}排、彼此隔開、都在操作列內${vp.mobile ? '，牌桌放大到最外兩個下注圈相距過半畫面' : ''}`, async t => {
      const r = await withPage(browser, vp, page => page.goto(url(APP)).then(() => page.evaluate(MEASURE_BET)));
      assert.strictEqual(r.value.mode, 'bet');
      assertBetBar(r.value, vp.mobile);
      t.diagnostic(`最外兩個下注圈相距 ${(r.value.seatSpan * 100).toFixed(0)}% 畫面寬`);
      if (vp.mobile) assert.ok(r.value.seatSpan >= PHONE_SEAT_SPAN, `牌桌太小：${r.value.seatSpan}`);
    });
  }

  test(`${browser}：籌碼存在瀏覽器裡，重新整理後還是同一個數字`, async () => {
    const r = await withPage(browser, DESKTOP, async page => {
      await page.goto(url(APP));
      const before = await page.evaluate(`(async () => {
        await BJK.view.stage.dealer.ready;
        BJK.view.anim.speed = 40;
        const d = BJK.view.stage.director;
        // 平手的局籌碼不變，要打到數字真的變了才量得出有沒有存
        for (let i = 0; i < 10; i++) { await d.autoplay(1); if (d.game.state().seats.find(s => s.id === 'me').bankroll !== 1000) break; }
        return d.game.state().seats.map(s => s.bankroll);
      })()`, 40000);
      await page.goto(url(APP));
      const after = await page.evaluate(`(async () => { await BJK.view.stage.dealer.ready;
        return { banks: BJK.view.stage.director.game.state().seats.map(s => s.bankroll), shown: document.getElementById('bank').textContent,
                 said: document.getElementById('bubble').textContent }; })()`);
      return { before, after };
    });
    const { before, after } = r.value;
    assert.notStrictEqual(before[1], 1000, '打了 10 局玩家籌碼都沒變，量不出有沒有存');
    assert.deepStrictEqual(after.banks, before, '重新整理後四個座位的籌碼對不上');
    assert.strictEqual(after.shown, before[1].toLocaleString('en-US'));
    assert.match(after.said, /歡迎回來/);
    assert.deepStrictEqual(r.console, []);
  });

  test(`${browser}：存檔壞掉時當新玩家開局，不擲錯`, async () => {
    const r = await withPage(browser, DESKTOP, async page => {
      await page.goto(url(APP));
      await page.evaluate(`localStorage.setItem('bjk.save.v1', '{壞掉的 json'); true`);
      await page.goto(url(APP));
      return page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; return BJK.view.stage.director.game.state().seats.map(s => s.bankroll); })()`);
    });
    assert.deepStrictEqual(r.value, [1000, 1000, 1000, 1000]);
    assert.deepStrictEqual(r.console, []);
  });

  test(`${browser}：籌碼輸光時只剩「重新開始」，按下去補回 1,000`, async () => {
    const r = await withPage(browser, PHONE, async page => {
      await page.goto(url(APP));
      await page.evaluate(`localStorage.setItem('bjk.save.v1', JSON.stringify({ v: 1, bankrolls: { me: 5 } })); true`);
      await page.goto(url(APP));
      return page.evaluate(`(async () => {
        await BJK.view.stage.dealer.ready;
        const hud = document.getElementById('hud'), btn = document.getElementById('resetBtn');
        const visible = id => !document.getElementById(id).hidden;
        const broke = { mode: hud.dataset.mode, reset: visible('brokeBar'), bet: visible('betBar'), bank: document.getElementById('bank').textContent };
        const r = btn.getBoundingClientRect();
        broke.inView = r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        btn.click();
        return { broke, after: { mode: hud.dataset.mode, bank: document.getElementById('bank').textContent, bet: visible('betBar'),
                                 saved: JSON.parse(localStorage.getItem('bjk.save.v1')).bankrolls.me } };
      })()`);
    });
    const { broke, after } = r.value;
    assert.deepStrictEqual(broke, { mode: 'broke', reset: true, bet: false, bank: '5', inView: true });
    assert.deepStrictEqual(after, { mode: 'bet', bank: '1,000', bet: true, saved: 1000 });
    assert.deepStrictEqual(r.console, []);
  });
}

test('陽性對照：拿掉手機的兩排下注列，要判成換行超出', async () => {
  const tmp = copyWith('style.css', '@media (max-width: 660px) {', '@media (max-width: 1px) {');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_BET)));
    assert.throws(() => assertBetBar(r.value, true), /換行|排法|跑出/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：下注列間距改回 4px，桌機與手機都要判成隔太近', async () => {
  for (const [vp, css] of [[DESKTOP, ['#betBar {\n  gap: 12px;', '#betBar {\n  gap: 4px;']], [PHONE, ['gap: 8px;\n    width: 100%;', 'gap: 4px;\n    width: 100%;']]]) {
    const tmp = copyWith('style.css', ...css);
    try {
      const r = await withPage(first(), vp, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_BET)));
      assert.throws(() => assertBetBar(r.value, vp.mobile), /只隔 4\.0px/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('陽性對照：手機改回框整張桌子，牌桌要判成太小', async () => {
  const tmp = copyWith(path.join('js', 'view', 'main.js'), 'const pts = aspect < 1', 'const pts = false');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_BET)));
    assert.ok(r.value.seatSpan < PHONE_SEAT_SPAN, `破壞後最外兩個下注圈仍相距 ${r.value.seatSpan}，這條判準沒在分辨`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉名牌夾回畫面，手機上邊座位的名牌要判成跑出畫面', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), '      FX.keepInView(el);\n', '');
  try {
    const r = await withPage(first(), PHONE, page => page.goto(url(tmp)).then(() => page.evaluate(MEASURE_TURN, 30000)));
    assert.ok(labelsOutOfView(r.value).length > 0, `破壞後標籤仍判成都在畫面內：${JSON.stringify(r.value.labels)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('陽性對照：拿掉存檔，重新整理後籌碼要判成回到 1,000', async () => {
  const tmp = copyWith(path.join('js', 'view', 'director.js'), "localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, bankrolls }));", '');
  try {
    const r = await withPage(first(), DESKTOP, async page => {
      await page.goto(url(tmp));
      await page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; BJK.view.anim.speed = 40; const d = BJK.view.stage.director;
        for (let i = 0; i < 10; i++) { await d.autoplay(1); if (d.game.state().seats.find(s => s.id === 'me').bankroll !== 1000) break; } })()`, 40000);
      await page.goto(url(tmp));
      return page.evaluate(`(async () => { await BJK.view.stage.dealer.ready; return BJK.view.stage.director.game.state().seats[1].bankroll; })()`);
    });
    assert.strictEqual(r.value, 1000);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
