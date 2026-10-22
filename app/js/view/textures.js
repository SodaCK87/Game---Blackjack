// 絨布、牌面、牌背、籌碼、佈景的貼圖都用 canvas 現畫：不帶外部圖檔，公開 repo 也就沒有素材授權的問題
(function () {
  const BJK = (window.BJK = window.BJK || {});
  const V = (BJK.view = BJK.view || {});

  V.COLORS = {
    felt: '#0b6e4f', line: '#e8d9a8', teal: '#008080', dark: '#212c31',
    red: '#b3261e', cardFace: '#f7f4ec', faceFrame: '#e3efee',
  };
  const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';

  // 固定種子的亂數：每次開頁的絨布顆粒、籌碼歪斜都一樣，前後兩張截圖才比得出差別
  V.rng = function (seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function toTexture(c) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // 沿圓弧寫字，字頭朝圓心（荷官那側），玩家從下方看是正的、由左讀到右
  function arcText(ctx, text, cx, cy, r, centerDeg, font, color) {
    ctx.save();
    ctx.font = font; ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const chars = Array.from(text);
    const widths = chars.map(ch => ctx.measureText(ch).width);
    let phi = centerDeg * Math.PI / 180 + widths.reduce((a, b) => a + b, 0) / (2 * r);
    chars.forEach((ch, i) => {
      phi -= widths[i] / (2 * r);
      ctx.save();
      ctx.translate(cx + r * Math.cos(phi), cy + r * Math.sin(phi));
      ctx.rotate(phi - Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      phi -= widths[i] / (2 * r);
    });
    ctx.restore();
  }

  // 半圓絨布：畫布上緣＝荷官那條直邊，下緣＝最靠近玩家的弧頂；1 單位＝H/R 像素
  function felt(R, seatDeg, seatR, playerSeat) {
    const W = 2048, H = 1024, s = H / R, cx = W / 2, cy = 0;
    const c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = V.COLORS.felt;
    ctx.fillRect(0, 0, W, H);
    const rng = V.rng(1021);
    for (let i = 0; i < 90000; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      ctx.fillRect(rng() * W, rng() * H, 2, 2);
    }
    const vignette = ctx.createRadialGradient(cx, cy, R * s * 0.3, cx, cy, R * s);
    vignette.addColorStop(0, 'rgba(255,255,255,0.06)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = V.COLORS.line;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 4.3 * s, 0.08 * Math.PI, 0.92 * Math.PI); ctx.stroke();
    seatDeg.forEach((deg, i) => {
      const a = deg * Math.PI / 180, x = cx + seatR * s * Math.cos(a), y = cy + seatR * s * Math.sin(a);
      ctx.beginPath(); ctx.arc(x, y, 0.42 * s, 0, 2 * Math.PI);
      if (i === playerSeat) { ctx.fillStyle = 'rgba(0,128,128,0.45)'; ctx.fill(); }
      ctx.lineWidth = 5; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 0.36 * s, 0, 2 * Math.PI);
      ctx.lineWidth = 2; ctx.stroke();
    });
    // 兩行字夾在荷官的牌（到 z≈1.6）與玩家的牌（從 r≈2.45 起）之間
    arcText(ctx, 'BLACKJACK 賠 3 比 2', cx, cy, 2.2 * s, 90, `bold 56px ${FONT}`, V.COLORS.line);
    arcText(ctx, '荷官 16 點以下要牌・17 點以上停牌', cx, cy, 1.85 * s, 90, `40px ${FONT}`, 'rgba(232,217,168,0.85)');
    return toTexture(c);
  }

  // ---- 牌 ----
  const CW = 256, CH = 358;
  const PIPS = {
    2: [[0, -1], [0, 1]],
    3: [[0, -1], [0, 0], [0, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    7: [[-1, -1], [1, -1], [0, -0.5], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    8: [[-1, -1], [1, -1], [0, -0.5], [-1, 0], [1, 0], [0, 0.5], [-1, 1], [1, 1]],
    9: [[-1, -1], [1, -1], [-1, -1 / 3], [1, -1 / 3], [0, 0], [-1, 1 / 3], [1, 1 / 3], [-1, 1], [1, 1]],
    10: [[-1, -1], [1, -1], [0, -2 / 3], [-1, -1 / 3], [1, -1 / 3], [-1, 1 / 3], [1, 1 / 3], [0, 2 / 3], [-1, 1], [1, 1]],
  };
  function suitColor(suit) { return suit === 'H' || suit === 'D' ? V.COLORS.red : V.COLORS.dark; }

  // 花色畫成路徑而不用 ♠♥ 字元：字元在某些電腦會被換成彩色 emoji
  function drawSuit(ctx, suit, x, y, size, flip) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.scale(size, size);
    ctx.fillStyle = suitColor(suit);
    ctx.beginPath();
    if (suit === 'D') {
      ctx.moveTo(0, -0.5); ctx.lineTo(0.36, 0); ctx.lineTo(0, 0.5); ctx.lineTo(-0.36, 0); ctx.closePath();
    } else if (suit === 'H') {
      ctx.moveTo(0, 0.42);
      ctx.bezierCurveTo(-0.15, 0.28, -0.5, 0.08, -0.5, -0.18);
      ctx.bezierCurveTo(-0.5, -0.42, -0.2, -0.5, 0, -0.26);
      ctx.bezierCurveTo(0.2, -0.5, 0.5, -0.42, 0.5, -0.18);
      ctx.bezierCurveTo(0.5, 0.08, 0.15, 0.28, 0, 0.42);
    } else if (suit === 'S') {
      ctx.moveTo(0, -0.46);
      ctx.bezierCurveTo(-0.15, -0.32, -0.5, -0.12, -0.5, 0.12);
      ctx.bezierCurveTo(-0.5, 0.36, -0.2, 0.42, 0, 0.2);
      ctx.bezierCurveTo(0.2, 0.42, 0.5, 0.36, 0.5, 0.12);
      ctx.bezierCurveTo(0.5, -0.12, 0.15, -0.32, 0, -0.46);
      ctx.moveTo(0, 0.12); ctx.lineTo(0.14, 0.5); ctx.lineTo(-0.14, 0.5); ctx.closePath();
    } else {
      for (const [px, py] of [[0, -0.24], [-0.23, 0.08], [0.23, 0.08]]) {
        ctx.moveTo(px + 0.21, py); ctx.arc(px, py, 0.21, 0, 2 * Math.PI);
      }
      ctx.moveTo(0.12, 0.02); ctx.arc(0, 0.02, 0.12, 0, 2 * Math.PI);
      ctx.moveTo(0, 0.05); ctx.lineTo(0.14, 0.5); ctx.lineTo(-0.14, 0.5); ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  function cardShape(ctx, fill) {
    ctx.beginPath(); ctx.roundRect(2, 2, CW - 4, CH - 4, 22);
    ctx.fillStyle = fill; ctx.fill();
  }

  function cardFace(rank, suit) {
    const c = canvas(CW, CH), ctx = c.getContext('2d');
    cardShape(ctx, V.COLORS.cardFace);
    ctx.strokeStyle = 'rgba(33,44,49,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    const color = suitColor(suit);
    for (const flip of [false, true]) {
      ctx.save();
      if (flip) { ctx.translate(CW, CH); ctx.rotate(Math.PI); }
      ctx.fillStyle = color;
      ctx.font = `bold 46px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(rank, 32, 38);
      drawSuit(ctx, suit, 32, 78, 30, false);
      ctx.restore();
    }
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
      ctx.beginPath(); ctx.roundRect(58, 64, 140, 230, 10);
      ctx.fillStyle = V.COLORS.faceFrame; ctx.fill();
      ctx.strokeStyle = V.COLORS.teal; ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `bold 110px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(rank, CW / 2, CH / 2 + 4);
      drawSuit(ctx, suit, CW / 2, 98, 34, false);
      drawSuit(ctx, suit, CW / 2, 260, 34, true);
    } else if (rank === 'A') {
      drawSuit(ctx, suit, CW / 2, CH / 2, 120, false);
    } else {
      PIPS[rank].forEach(([px, py]) => drawSuit(ctx, suit, CW / 2 + px * 50, CH / 2 + py * 96, 46, py > 0));
    }
    return toTexture(c);
  }

  function cardBack() {
    const c = canvas(CW, CH), ctx = c.getContext('2d');
    cardShape(ctx, V.COLORS.teal);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(16, 16, CW - 32, CH - 32, 12); ctx.clip();
    ctx.strokeStyle = 'rgba(232,217,168,0.35)'; ctx.lineWidth = 2;
    for (let d = -CH; d < CW + CH; d += 22) {
      ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + CH, CH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d, CH); ctx.lineTo(d + CH, 0); ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(16, 16, CW - 32, CH - 32, 12);
    ctx.strokeStyle = V.COLORS.line; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 42, 0, 2 * Math.PI);
    ctx.fillStyle = V.COLORS.dark; ctx.fill(); ctx.stroke();
    ctx.fillStyle = V.COLORS.line;
    ctx.font = `bold 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('21', CW / 2, CH / 2 + 2);
    return toTexture(c);
  }

  // ---- 籌碼 ----
  V.CHIP_COLORS = { 5: '#b3261e', 25: '#1e7f4f', 100: '#212c31', 500: '#6c3483', 1000: '#c9a227' };

  function chipSide(value) {
    const c = canvas(512, 32), ctx = c.getContext('2d');
    ctx.fillStyle = V.CHIP_COLORS[value]; ctx.fillRect(0, 0, 512, 32);
    ctx.fillStyle = V.COLORS.cardFace;
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 64 + 20, 0, 24, 32);
    return toTexture(c);
  }

  function chipTop(value) {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    const ink = value === 1000 ? V.COLORS.dark : V.COLORS.cardFace;
    ctx.beginPath(); ctx.arc(128, 128, 127, 0, 2 * Math.PI);
    ctx.fillStyle = V.CHIP_COLORS[value]; ctx.fill();
    ctx.strokeStyle = V.COLORS.cardFace; ctx.lineWidth = 22;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath(); ctx.arc(128, 128, 112, a, a + 0.28); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(128, 128, 78, 0, 2 * Math.PI);
    ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `bold ${value >= 1000 ? 50 : 62}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(value), 128, 132);
    return toTexture(c);
  }

  // ---- 佈景（room.js）：使用者要求整體壓暗，花紋只比底色亮一點點 ----
  // 地毯一格：四邊的圖案對得上，鋪滿地板看不出接縫
  function carpet() {
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#1b1115'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(201,162,39,0.09)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S, S / 2); ctx.lineTo(S / 2, S); ctx.lineTo(0, S / 2); ctx.closePath(); ctx.stroke();
    for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]]) {
      ctx.beginPath(); ctx.arc(x, y, 64, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,128,128,0.16)'; ctx.lineWidth = 8; ctx.stroke();
      ctx.fillStyle = 'rgba(201,162,39,0.11)';
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath(); ctx.ellipse(x + 34 * Math.cos(a), y + 34 * Math.sin(a), 14, 6, a, 0, 2 * Math.PI); ctx.fill();
      }
    }
    const rng = V.rng(7);
    ctx.fillStyle = 'rgba(179,38,30,0.13)';
    for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.arc(rng() * S, rng() * S, 3 + rng() * 4, 0, 2 * Math.PI); ctx.fill(); }
    const t = toTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // 隔間木牆板一段：兩塊凸起的鑲板，左右接起來是連續的
  function woodPanel() {
    const W = 1024, H = 320, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#2e1c13'; ctx.fillRect(0, 0, W, H);
    const rng = V.rng(11);
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '120,80,50'},${0.08 + rng() * 0.1})`;
      ctx.lineWidth = 1 + rng() * 2;
      const x = rng() * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 6, H / 3, x - 6, 2 * H / 3, x + rng() * 8 - 4, H); ctx.stroke();
    }
    for (const x0 of [32, W / 2 + 32]) {
      const w = W / 2 - 64, y0 = 48, h = H - 104;
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = 'rgba(255,214,170,0.07)'; ctx.fillRect(x0 + 10, y0 + 10, w - 20, h - 20);
      ctx.strokeStyle = 'rgba(255,214,170,0.10)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0, y0); ctx.lineTo(x0 + w, y0); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.moveTo(x0 + w, y0); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, H - 28, W, 28);
    const t = toTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  // 失焦光點：邊緣稍亮的圓盤，白色，顏色由 SpriteMaterial 上色
  function bokeh() {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return toTexture(c);
  }

  const cache = new Map();
  function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  V.textures = {
    felt,
    cardFace: (rank, suit) => cached(`face-${rank}${suit}`, () => cardFace(rank, suit)),
    cardBack: () => cached('back', cardBack),
    chipSide: value => cached(`side-${value}`, () => chipSide(value)),
    chipTop: value => cached(`top-${value}`, () => chipTop(value)),
    carpet: () => cached('carpet', carpet),
    woodPanel: () => cached('woodPanel', woodPanel),
    bokeh: () => cached('bokeh', bokeh),
  };
})();
