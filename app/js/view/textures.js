// 絨布、牌面、牌背、籌碼、佈景的貼圖都用 canvas 現畫：不帶外部圖檔，公開 repo 也就沒有素材授權的問題。
// 光澤、暗角、高光也一律畫進貼圖：開頁畫一次，之後每一格都不必再算，手機才省電（使用者 2026-10-31 選的做法）
(function () {
  const BJK = (window.BJK = window.BJK || {});
  const V = (BJK.view = BJK.view || {});

  V.COLORS = {
    felt: '#0b6e4f', line: '#e8d9a8', teal: '#008080', dark: '#212c31',
    red: '#b3261e', cardFace: '#f7f4ec', faceFrame: '#e3efee', gold: '#d9ae3c',
  };
  const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  const SERIF = 'Georgia, "Times New Roman", "Noto Serif", serif';

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

  // 燙金：沿 (x0,y0)-(x1,y1) 明暗交錯 times 輪，線條與字看起來才像金屬箔，不是一條淺色。
  // 漸層跟著畫布座標走，translate 過的字吃不到，所以絨布上的金色先畫成白的、再整層上色（見 felt）
  function foil(ctx, x0, y0, x1, y1, times = 1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const stops = ['#b98f2e', '#f4e6ad', '#c9a23f', '#fff3c4', '#b98f2e', '#ecd98f'];
    for (let k = 0; k < times; k++) stops.forEach((c, i) => g.addColorStop((k + i / stops.length) / times, c));
    g.addColorStop(1, stops[0]);
    return g;
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

  // 細顆粒：一塊 256 見方的雜訊鋪滿，比逐顆畫快得多（原本 90,000 顆 fillRect）
  function grain(amount) {
    const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S), rng = V.rng(1021);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rng() < 0.5 ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = rng() * amount;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // 半圓絨布：畫布上緣＝荷官那條直邊，下緣＝最靠近玩家的弧頂；1 單位＝H/R 像素
  function felt(R, seatDeg, seatR, playerSeat) {
    const W = 2048, H = 1024, s = H / R, cx = W / 2, cy = 0;
    const c = canvas(W, H), ctx = c.getContext('2d');
    // 燈照到的中央偏亮、往桌緣沉下去
    const base = ctx.createRadialGradient(cx, H * 0.42, R * s * 0.1, cx, H * 0.42, R * s * 1.1);
    base.addColorStop(0, '#118460'); base.addColorStop(0.5, V.COLORS.felt); base.addColorStop(1, '#05402f');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ctx.createPattern(grain(26), 'repeat');
    ctx.fillRect(0, 0, W, H);

    // 押注圈裡的底色在金線下面
    seatDeg.forEach((deg, i) => {
      const a = deg * Math.PI / 180, x = cx + seatR * s * Math.cos(a), y = cy + seatR * s * Math.sin(a), r = 0.42 * s;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      const inner = ctx.createRadialGradient(x, y, 0, x, y, r);
      if (i === playerSeat) { inner.addColorStop(0, 'rgba(0,160,160,0.7)'); inner.addColorStop(1, 'rgba(0,128,128,0.35)'); } else { inner.addColorStop(0, 'rgba(0,0,0,0.16)'); inner.addColorStop(1, 'rgba(0,0,0,0.02)'); }
      ctx.fillStyle = inner; ctx.fill();
    });

    // 金色一層：先全畫成白的，整層上燙金漸層，再帶一點暗影蓋到布上，字和線看起來是壓進布裡的
    const layer = canvas(W, H), g = layer.getContext('2d');
    g.strokeStyle = g.fillStyle = '#fff';
    // 外圈雙線，兩端各收一顆菱形
    const A0 = 0.08 * Math.PI, A1 = 0.92 * Math.PI;
    g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, 4.3 * s, A0, A1); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, 4.2 * s, A0, A1); g.stroke();
    for (const a of [A0, A1]) drawSuit(g, 'D', cx + 4.25 * s * Math.cos(a), cy + 4.25 * s * Math.sin(a), 46, false, '#fff');
    seatDeg.forEach(deg => {
      const a = deg * Math.PI / 180, x = cx + seatR * s * Math.cos(a), y = cy + seatR * s * Math.sin(a);
      g.beginPath(); g.arc(x, y, 0.42 * s, 0, 2 * Math.PI);
      g.lineWidth = 5; g.stroke();
      g.beginPath(); g.arc(x, y, 0.36 * s, 0, 2 * Math.PI);
      g.lineWidth = 2.5; g.setLineDash([3, 9]); g.stroke(); g.setLineDash([]);
    });
    // 兩行字夾在荷官的牌（到 z≈1.6）與玩家的牌（從 r≈2.45 起）之間，主標兩端各一顆花色收尾
    arcText(g, 'BLACKJACK 賠 3 比 2', cx, cy, 2.2 * s, 90, `bold 56px ${FONT}`, '#fff');
    arcText(g, '荷官 16 點以下要牌・17 點以上停牌', cx, cy, 1.85 * s, 90, `40px ${FONT}`, 'rgba(255,255,255,0.88)');
    [['S', 136], ['H', 44]].forEach(([suit, deg]) => {
      const a = deg * Math.PI / 180;
      drawSuit(g, suit, cx + 2.2 * s * Math.cos(a), cy + 2.2 * s * Math.sin(a), 46, false, '#fff', a - Math.PI / 2);
    });
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = foil(g, 0, 0, W, H, 5);
    g.fillRect(0, 0, W, H);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowOffsetY = 2.5;
    ctx.drawImage(layer, 0, 0);
    ctx.shadowColor = 'transparent';
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
  function drawSuit(ctx, suit, x, y, size, flip, color, angle) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (flip) ctx.rotate(Math.PI);
    ctx.scale(size, size);
    ctx.fillStyle = color || suitColor(suit);
    ctx.beginPath();
    if (suit === 'D') {
      ctx.moveTo(0, -0.5); ctx.quadraticCurveTo(0.14, -0.2, 0.37, 0); ctx.quadraticCurveTo(0.14, 0.2, 0, 0.5);
      ctx.quadraticCurveTo(-0.14, 0.2, -0.37, 0); ctx.quadraticCurveTo(-0.14, -0.2, 0, -0.5); ctx.closePath();
    } else if (suit === 'H') {
      ctx.moveTo(0, 0.46);
      ctx.bezierCurveTo(-0.15, 0.28, -0.5, 0.08, -0.5, -0.18);
      ctx.bezierCurveTo(-0.5, -0.42, -0.2, -0.5, 0, -0.26);
      ctx.bezierCurveTo(0.2, -0.5, 0.5, -0.42, 0.5, -0.18);
      ctx.bezierCurveTo(0.5, 0.08, 0.15, 0.28, 0, 0.46);
    } else if (suit === 'S') {
      ctx.moveTo(0, -0.5);
      ctx.bezierCurveTo(-0.15, -0.32, -0.5, -0.12, -0.5, 0.12);
      ctx.bezierCurveTo(-0.5, 0.36, -0.2, 0.42, -0.04, 0.22);
      ctx.quadraticCurveTo(-0.06, 0.4, -0.18, 0.5); ctx.lineTo(0.18, 0.5); ctx.quadraticCurveTo(0.06, 0.4, 0.04, 0.22);
      ctx.bezierCurveTo(0.2, 0.42, 0.5, 0.36, 0.5, 0.12);
      ctx.bezierCurveTo(0.5, -0.12, 0.15, -0.32, 0, -0.5);
    } else {
      for (const [px, py] of [[0, -0.24], [-0.24, 0.08], [0.24, 0.08]]) {
        ctx.moveTo(px + 0.22, py); ctx.arc(px, py, 0.22, 0, 2 * Math.PI);
      }
      ctx.moveTo(0.12, 0.02); ctx.arc(0, 0.02, 0.12, 0, 2 * Math.PI);
      ctx.moveTo(0.04, 0.05); ctx.quadraticCurveTo(0.06, 0.4, 0.18, 0.5); ctx.lineTo(-0.18, 0.5); ctx.quadraticCurveTo(-0.06, 0.4, -0.04, 0.05); ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  // 牌面鋪滿畫布，只有四個圓角透明：四邊留透明的話，牌緣要靠貼圖挖出來，斜著看是一圈鋸齒
  function cardShape(ctx, fill) {
    ctx.beginPath(); ctx.roundRect(0, 0, CW, CH, 22);
    ctx.fillStyle = fill; ctx.fill();
  }

  // 紙面微微的光澤：左上亮、右下暗，貼在牌面與牌背最上層
  function sheen(ctx) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0, 0, CW, CH, 22); ctx.clip();
    const g = ctx.createLinearGradient(0, 0, CW, CH);
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(33,44,49,0.1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
    ctx.restore();
  }

  // ---- J、Q、K 的人物 ----
  // 照傳統撲克牌上下對稱：畫上半身，轉 180 度再畫一次，中間一條斜帶接起來。座標原點在牌中央，人物框 ±70 × ±115
  const COURT_PALETTE = {
    H: { robe: '#b3261e', robe2: '#861a14', sash: '#008080' },
    D: { robe: '#c9731f', robe2: '#9c5413', sash: '#6c3483' },
    S: { robe: '#2b4a60', robe2: '#1d3444', sash: '#b3261e' },
    C: { robe: '#0f6b5c', robe2: '#0a4d42', sash: '#b3261e' },
  };
  const INK = '#212c31', GOLD = '#d9ae3c', SKIN = '#f2d2ae', SKIN2 = '#dcae88', CREAM = '#f7f4ec';

  function courtHalf(ctx, rank, p) {
    const draw = (d, fill, lw) => {
      const path = new Path2D(d);
      if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
      if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke(path); }
    };
    const dot = (x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill(); };

    // 拿的東西畫在人的後面：K 長劍、Q 花、J 長戟
    if (rank === 'K') {
      draw('M48 -110 L54 -118 L60 -110 L60 -32 L48 -32 Z', '#d7e0e3', 1.5);
      draw('M54 -112 L54 -34', null, 0.8);
      draw('M38 -34 L70 -34 L70 -27 L38 -27 Z', GOLD, 1.5);
    } else if (rank === 'Q') {
      draw('M52 -70 Q48 -48 44 -22', null, 2.5);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; dot(53 + 9 * Math.cos(a), -82 + 9 * Math.sin(a), 6.5, p.sash); }
      dot(53, -82, 5, GOLD);
    } else {
      draw('M53 -116 L53 -14', null, 3.5);
      draw('M53 -118 L62 -98 L53 -90 L44 -98 Z', GOLD, 1.5);
    }

    // 袍子：兩色分出受光面，中間一條綬帶綴金色小菱形
    draw('M-72 24 L-72 -14 Q-48 -32 -20 -36 L20 -36 Q48 -32 72 -14 L72 24 Z', p.robe, 2);
    draw('M0 -36 L20 -36 Q48 -32 72 -14 L72 24 L0 24 Z', p.robe2);
    draw('M-72 -2 Q-44 -20 -24 -20 M72 -2 Q44 -20 24 -20', null, 0);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
    ctx.stroke(new Path2D('M-70 2 Q-46 -18 -22 -20 M70 2 Q46 -18 22 -20'));
    draw('M-13 -36 L13 -36 L18 24 L-18 24 Z', p.sash, 1.5);
    for (const y of [-22, -6, 10]) draw(`M0 ${y - 6} L5 ${y} L0 ${y + 6} L-5 ${y} Z`, GOLD);

    // 領子：K 白毛領帶黑點、Q 金邊領、J 立領
    draw('M-30 -38 Q0 -18 30 -38 L35 -28 Q0 -8 -35 -28 Z', rank === 'K' ? CREAM : rank === 'Q' ? GOLD : CREAM, 1.5);
    if (rank === 'K') for (const x of [-22, -8, 8, 22]) dot(x, -24 - Math.abs(x) * 0.1, 1.8, INK);

    draw('M-9 -46 L9 -46 L10 -33 Q0 -28 -10 -33 Z', SKIN2, 1.5);
    // 頭髮在臉的後面
    if (rank === 'Q') draw('M-21 -74 Q-33 -46 -25 -22 L-13 -30 Q-20 -50 -15 -70 Z M21 -74 Q33 -46 25 -22 L13 -30 Q20 -50 15 -70 Z', '#c58f2e', 1.5);
    if (rank === 'J') draw('M-20 -72 Q-28 -54 -21 -40 L-12 -44 L-14 -70 Z M20 -72 Q28 -54 21 -40 L12 -44 L14 -70 Z', '#8a5a2b', 1.5);
    if (rank === 'K') draw('M-20 -70 Q-26 -50 -17 -38 L-12 -50 Z M20 -70 Q26 -50 17 -38 L12 -50 Z', '#6b4a2a', 1.5);

    ctx.beginPath(); ctx.ellipse(0, -62, 18, 22, 0, 0, 2 * Math.PI);
    ctx.fillStyle = SKIN; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    draw('M4 -83 Q18 -78 18 -62 Q18 -46 4 -40 Q12 -60 4 -83 Z', SKIN2);
    if (rank === 'K') {
      draw('M-17 -58 Q-18 -36 0 -30 Q18 -36 17 -58 Q11 -49 3 -51 Q0 -49 -3 -51 Q-11 -49 -17 -58 Z', '#6b4a2a', 1.5);
    }
    // 五官
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    ctx.stroke(new Path2D('M-12 -69 Q-7 -72 -3 -69 M12 -69 Q7 -72 3 -69'));
    dot(-7, -65, 1.9, INK); dot(7, -65, 1.9, INK);
    ctx.lineWidth = 1.4;
    ctx.stroke(new Path2D('M0 -64 L-2 -55 L2 -54'));
    ctx.strokeStyle = rank === 'K' ? CREAM : '#a5302a'; ctx.lineWidth = 2;
    ctx.stroke(new Path2D('M-6 -47 Q0 -44 6 -47'));
    ctx.lineCap = 'butt';

    // 頭上：K 高冠、Q 小冠、J 羽毛帽
    if (rank === 'K') {
      draw('M-20 -80 L-25 -106 L-12 -94 L0 -112 L12 -94 L25 -106 L20 -80 Z', GOLD, 2);
      draw('M-21 -84 L21 -84 L21 -78 L-21 -78 Z', p.sash, 1.5);
      dot(0, -100, 3, p.robe); dot(-25, -107, 2.6, CREAM); dot(25, -107, 2.6, CREAM); dot(0, -113, 2.6, CREAM);
    } else if (rank === 'Q') {
      draw('M-17 -79 L-19 -97 L-9 -88 L0 -102 L9 -88 L19 -97 L17 -79 Z', GOLD, 2);
      for (const [x, y] of [[-19, -98], [0, -103], [19, -98]]) dot(x, y, 2.8, CREAM);
      dot(0, -86, 3, p.sash);
    } else {
      draw('M14 -92 Q36 -116 44 -92 Q32 -98 20 -84 Z', GOLD, 1.5);
      draw('M-21 -76 Q-20 -98 4 -97 Q22 -96 22 -76 Z', p.sash, 2);
      draw('M-23 -80 L23 -80 L23 -73 L-23 -73 Z', GOLD, 1.5);
    }
  }

  function courtFigure(ctx, rank, suit) {
    const p = COURT_PALETTE[suit];
    ctx.save();
    ctx.translate(CW / 2, CH / 2);
    ctx.beginPath(); ctx.roundRect(-70, -115, 140, 230, 8);
    ctx.fillStyle = V.COLORS.faceFrame; ctx.fill();
    ctx.save();
    ctx.clip();
    // 底紋：細斜線，人物才不是貼在白紙上
    ctx.strokeStyle = 'rgba(0,128,128,0.13)'; ctx.lineWidth = 1.5;
    for (let d = -230; d < 230; d += 11) { ctx.beginPath(); ctx.moveTo(d - 115, -115); ctx.lineTo(d + 115, 115); ctx.stroke(); }
    for (const turn of [0, Math.PI]) {
      ctx.save();
      ctx.rotate(turn);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(-72, 11); ctx.lineTo(72, -11); ctx.lineTo(72, -120); ctx.lineTo(-72, -120); ctx.closePath(); ctx.clip();
      courtHalf(ctx, rank, p);
      ctx.restore();
      drawSuit(ctx, suit, -49, -92, 36, false);
      ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(-72, 11); ctx.lineTo(72, -11);
    ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(-70, -115, 140, 230, 8);
    ctx.strokeStyle = V.COLORS.teal; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }

  function cardFace(rank, suit) {
    const c = canvas(CW, CH), ctx = c.getContext('2d');
    cardShape(ctx, V.COLORS.cardFace);
    ctx.strokeStyle = 'rgba(33,44,49,0.3)'; ctx.lineWidth = 5; ctx.stroke();
    const color = suitColor(suit);
    for (const flip of [false, true]) {
      ctx.save();
      if (flip) { ctx.translate(CW, CH); ctx.rotate(Math.PI); }
      ctx.fillStyle = color;
      // 手機上一張牌只有約 55 CSS 像素寬，角標要大才看得出點數；10 擠成一樣寬
      ctx.font = `bold 62px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(rank, 32, 40, 48);
      drawSuit(ctx, suit, 32, 88, 36, false);
      ctx.restore();
    }
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
      courtFigure(ctx, rank, suit);
    } else if (rank === 'A') {
      ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 74, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,128,128,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([2, 7]); ctx.stroke(); ctx.setLineDash([]);
      drawSuit(ctx, suit, CW / 2, CH / 2, 120, false);
    } else {
      PIPS[rank].forEach(([px, py]) => drawSuit(ctx, suit, CW / 2 + px * 50, CH / 2 + py * 96, 46, py > 0));
    }
    sheen(ctx);
    return toTexture(c);
  }

  function cardBack() {
    const c = canvas(CW, CH), ctx = c.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, CW, CH);
    base.addColorStop(0, '#0a9090'); base.addColorStop(1, '#005f5f');
    cardShape(ctx, base);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(18, 18, CW - 36, CH - 36, 10); ctx.clip();
    ctx.strokeStyle = 'rgba(244,230,173,0.42)'; ctx.lineWidth = 1.5;
    for (let d = -CH; d < CW + CH; d += 20) {
      ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + CH, CH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d, CH); ctx.lineTo(d + CH, 0); ctx.stroke();
    }
    // 格線每個交點一顆金點
    ctx.fillStyle = 'rgba(244,230,173,0.75)';
    for (let d = -CH; d < CW + CH; d += 20) {
      for (let e = -CH; e < CW + CH; e += 20) {
        const x = (d + e + CH) / 2, y = (e - d + CH) / 2;
        if (y > 0 && y < CH && x > 0 && x < CW) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 2 * Math.PI); ctx.fill(); }
      }
    }
    ctx.restore();
    const gold = foil(ctx, 0, 0, CW, CH);
    ctx.beginPath(); ctx.roundRect(11, 11, CW - 22, CH - 22, 15);
    ctx.strokeStyle = gold; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(18, 18, CW - 36, CH - 36, 10);
    ctx.lineWidth = 1.5; ctx.stroke();
    // 中央徽章：放射狀金瓣圍一圈，中間深底 21
    ctx.save();
    ctx.translate(CW / 2, CH / 2);
    ctx.fillStyle = gold;
    for (let i = 0; i < 24; i++) {
      ctx.rotate(Math.PI / 12);
      ctx.beginPath(); ctx.moveTo(-6, -50); ctx.lineTo(0, -66); ctx.lineTo(6, -50); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 52, 0, 2 * Math.PI);
    ctx.fillStyle = V.COLORS.dark; ctx.fill(); ctx.strokeStyle = gold; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 44, 0, 2 * Math.PI);
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = gold;
    ctx.font = `bold 46px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('21', CW / 2, CH / 2 + 2);
    sheen(ctx);
    return toTexture(c);
  }

  // 整疊牌的側面：一層層紙邊
  function deckEdge() {
    const c = canvas(32, 32), ctx = c.getContext('2d');
    ctx.fillStyle = '#efeadd'; ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = 'rgba(90,80,60,0.28)';
    for (let y = 0; y < 32; y += 3) ctx.fillRect(0, y, 32, 1);
    return toTexture(c);
  }

  // ---- 籌碼 ----
  V.CHIP_COLORS = { 5: '#b3261e', 25: '#1e7f4f', 100: '#212c31', 500: '#6c3483', 1000: '#c9a227' };

  function chipSide(value) {
    const c = canvas(256, 32), ctx = c.getContext('2d');
    ctx.fillStyle = V.CHIP_COLORS[value]; ctx.fillRect(0, 0, 256, 32);
    ctx.fillStyle = V.COLORS.cardFace;
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 32 + 10, 0, 12, 32);
    // 上下緣壓暗、內側一道亮線：疊起來一片一片分得開
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, 256, 4); ctx.fillRect(0, 28, 256, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(0, 4, 256, 2);
    return c;
  }

  // 籌碼會隨機轉角度、還會飛，高光畫成一圈圈同心的，轉到哪個角度都說得通
  function chipTop(value) {
    const c = canvas(256, 256), ctx = c.getContext('2d');
    const color = V.CHIP_COLORS[value], ink = value === 1000 ? V.COLORS.dark : V.COLORS.cardFace;
    ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256);
    ctx.beginPath(); ctx.arc(128, 128, 127, 0, 2 * Math.PI);
    ctx.fillStyle = color; ctx.fill();
    // 外圈八塊嵌片，一塊兩條金邊
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath(); ctx.arc(128, 128, 111, a, a + 0.3);
      ctx.strokeStyle = V.COLORS.cardFace; ctx.lineWidth = 26; ctx.stroke();
    }
    // 凹槽：一道暗線配一道亮線
    ctx.beginPath(); ctx.arc(128, 128, 94, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(128, 128, 91, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke();
    // 中央面額嵌片
    const inlay = ctx.createRadialGradient(128, 128, 20, 128, 128, 76);
    inlay.addColorStop(0, 'rgba(255,255,255,0.2)'); inlay.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.beginPath(); ctx.arc(128, 128, 76, 0, 2 * Math.PI);
    ctx.fillStyle = inlay; ctx.fill();
    ctx.strokeStyle = value === 1000 ? V.COLORS.dark : foil(ctx, 40, 40, 216, 216); ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `bold ${value >= 1000 ? 54 : 66}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(value), 128, 132, 132);
    // 外緣一圈高光
    ctx.beginPath(); ctx.arc(128, 128, 124, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.34)'; ctx.lineWidth = 3; ctx.stroke();
    return toTexture(c);
  }

  // 頂面與側面畫在同一張：一片籌碼一種材質、一個 draw call。top、side 是各自佔整張貼圖高度的比例（chips.js 拿去算 UV）
  const ATLAS_H = 292;
  function chipAtlas(value) {
    const c = canvas(256, ATLAS_H), ctx = c.getContext('2d');
    ctx.fillStyle = V.CHIP_COLORS[value]; ctx.fillRect(0, 0, 256, ATLAS_H);
    ctx.drawImage(V.textures.chipTop(value).image, 0, 0);
    ctx.drawImage(chipSide(value), 0, ATLAS_H - 32);
    return toTexture(c);
  }

  // ---- 桌緣（table.js）----
  // 皮革扶手：v＝0.75 是頂上、0.5 是朝桌內。高光畫在頂上偏桌內那側，兩條縫線跟著走
  function leather() {
    const W = 512, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d120c'); g.addColorStop(0.15, '#3b261a'); g.addColorStop(0.24, '#6a4630');
    g.addColorStop(0.32, '#38241a'); g.addColorStop(0.5, '#1a100b'); g.addColorStop(0.75, '#0f0906'); g.addColorStop(1, '#1d120c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ctx.createPattern(grain(22), 'repeat');
    ctx.fillRect(0, 0, W, H);
    for (const y of [H * 0.09, H * 0.41]) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, y - 1, W, 3);
      ctx.fillStyle = 'rgba(214,190,140,0.75)';
      for (let x = 0; x < W; x += 24) ctx.fillRect(x, y, 15, 1);
    }
    const t = toTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(10, 1);
    return t;
  }

  // 桌身木頭：紅木紋，上緣一道亮漆
  function wood() {
    const W = 512, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6a4128'); g.addColorStop(0.14, '#b98054'); g.addColorStop(0.3, '#6e4429'); g.addColorStop(1, '#2e1a10');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rng = V.rng(53);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(${rng() < 0.6 ? '20,8,2' : '200,140,90'},${0.06 + rng() * 0.12})`;
      ctx.lineWidth = 0.6 + rng() * 1.6;
      const y = rng() * H, b = rng() * 8 - 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(W / 3, y + b, 2 * W / 3, y - b, W, y); ctx.stroke();
    }
    const t = toTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(6, 1);
    return t;
  }

  // 棄牌盒的壓克力：幾乎透明，四邊一道亮線、一道斜反光
  function glass() {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(207,232,234,0.14)'; ctx.fillRect(0, 0, S, S);
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0.3, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,0.22)'); g.addColorStop(0.54, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(235,250,250,0.7)'; ctx.lineWidth = 5; ctx.strokeRect(0, 0, S, S);
    return toTexture(c);
  }

  // ---- 佈景（room.js）：使用者要求整體壓暗，花紋只比底色亮一點點 ----
  // 牌桌在地毯上的影子：畫布上緣＝桌子直邊，下緣＝弧頂再往外 pad 單位
  function tableShadow(R, pad) {
    const H = 256, s = H / (R + pad), W = 2 * H, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(W / 2, 0, (R - 0.2) * s, W / 2, 0, (R + pad) * s);
    g.addColorStop(0, 'rgba(0,0,0,0.82)'); g.addColorStop(0.3, 'rgba(0,0,0,0.6)'); g.addColorStop(0.7, 'rgba(0,0,0,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    return toTexture(c);
  }

  // 地毯一格：四邊的圖案對得上，鋪滿地板看不出接縫
  function carpet() {
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#1b1115'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(201,162,39,0.1)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S, S / 2); ctx.lineTo(S / 2, S); ctx.lineTo(0, S / 2); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(201,162,39,0.05)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(S / 2, 24); ctx.lineTo(S - 24, S / 2); ctx.lineTo(S / 2, S - 24); ctx.lineTo(24, S / 2); ctx.closePath(); ctx.stroke();
    for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]]) {
      ctx.beginPath(); ctx.arc(x, y, 58, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,128,128,0.13)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.fillStyle = 'rgba(201,162,39,0.1)';
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        ctx.beginPath(); ctx.ellipse(x + 36 * Math.cos(a), y + 36 * Math.sin(a), 13, 5, a, 0, 2 * Math.PI); ctx.fill();
      }
    }
    const t = toTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // 隔間木牆板一段：兩塊凸起的鑲板，左右接起來是連續的；一段一盞壁燈，暖光畫進木頭裡
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
      ctx.strokeStyle = 'rgba(255,214,170,0.14)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0, y0); ctx.lineTo(x0 + w, y0); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.moveTo(x0 + w, y0); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, H - 28, W, 28);
    ctx.fillStyle = 'rgba(255,214,170,0.1)'; ctx.fillRect(0, 12, W, 6);
    ctx.globalCompositeOperation = 'lighter';
    for (const x of [0, W]) {
      const g = ctx.createRadialGradient(x, 0, 0, x, 0, 260);
      g.addColorStop(0, 'rgba(255,180,100,0.3)'); g.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    const t = toTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  // 黃銅扶手：環繞圓柱一圈的明暗，u＝0 朝鏡頭、0.25 朝上，亮帶落在前上方
  function brass() {
    const c = canvas(128, 4), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, '#8a6a2a'); g.addColorStop(0.1, '#e9cf83'); g.addColorStop(0.17, '#fff0bd');
    g.addColorStop(0.27, '#a8842f'); g.addColorStop(0.5, '#3a2a12'); g.addColorStop(0.8, '#3a2a12'); g.addColorStop(1, '#8a6a2a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 4);
    return toTexture(c);
  }

  function hexColor(n) { return `${n >> 16},${(n >> 8) & 255},${n & 255}`; }

  // 牆後的大廳：照實際畫面大小畫（光點直徑才是 CSS 像素），圖本身不大、不做 mipmap，它不會被縮小看
  function hall() {
    const t = toTexture(canvas(1024, 512));
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  }
  function paintHall(tex, plan, w, h, voidColor) {
    const c = tex.image, ctx = c.getContext('2d');
    ctx.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // 上方是大廳的暗處，往牆頭漸漸染上老虎機的暖光
    const v = hexColor(voidColor), sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `rgb(${v})`); sky.addColorStop(0.55, `rgb(${v})`); sky.addColorStop(1, '#33201a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of plan) {
      const x = (b.x + 1) / 2 * w, y = (1 - b.v) * h, r = b.px / 2, rgb = hexColor(b.color), a = b.opacity;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      if (b.soft) {
        g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      } else {
        // 失焦光點中間略暗、外緣一圈亮邊，最外面柔柔地收掉
        g.addColorStop(0, `rgba(${rgb},${a * 0.55})`); g.addColorStop(0.72, `rgba(${rgb},${a * 0.7})`);
        g.addColorStop(0.88, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    }
    tex.needsUpdate = true;
  }

  function white() {
    const c = canvas(1, 1), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
    return toTexture(c);
  }

  const cache = new Map();
  function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  V.textures = {
    felt, paintHall,
    CHIP_ATLAS: { top: 256 / ATLAS_H, side: 32 / ATLAS_H },
    cardFace: (rank, suit) => cached(`face-${rank}${suit}`, () => cardFace(rank, suit)),
    cardBack: () => cached('back', cardBack),
    deckEdge: () => cached('deckEdge', deckEdge),
    chipAtlas: value => cached(`atlas-${value}`, () => chipAtlas(value)),
    chipTop: value => cached(`top-${value}`, () => chipTop(value)),
    leather: () => cached('leather', leather),
    wood: () => cached('wood', wood),
    glass: () => cached('glass', glass),
    white: () => cached('white', white),
    carpet: () => cached('carpet', carpet),
    woodPanel: () => cached('woodPanel', woodPanel),
    tableShadow: (R, pad) => cached('tableShadow', () => tableShadow(R, pad)),
    brass: () => cached('brass', brass),
    hall: () => cached('hall', hall),
  };
})();
