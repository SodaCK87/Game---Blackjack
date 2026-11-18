// 絨布、牌面、牌背、籌碼、佈景的貼圖都用 canvas 畫；J、Q、K 的人物、牌背、籌碼頂面、牆後的大廳、地毯、牆板、桌身木頭、
// 皮革扶手、絨布的質感貼的是使用者用 GPT 生的點陣插畫（table_art.js），角標、面額、牌背中央的 21、明暗、縫線、亮漆、
// 壁燈暖光、絨布上的金線與字仍由這裡畫上去。
// 光澤、暗角、高光也一律畫進貼圖：開頁畫一次，之後每一格都不必再算，手機才省電（使用者 2026-10-31 選的做法）
(function () {
  const BJK = (window.BJK = window.BJK || {});
  const V = (BJK.view = BJK.view || {});
  if (!V.tableArt) throw new Error('載入順序錯：table_art.js 要排在 textures.js 之前');
  const ART = V.tableArt;

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

  // ---- 點陣插畫 ----
  // 開頁就開始解碼（img.decode() 不佔主執行緒）。插畫解碼好之前要用到它的貼圖先畫成純色版，解碼完補畫一次、標記重傳；
  // dealer.js 的 ready 等這裡跟荷官的圖都好了才重畫那一次，所以開頁只多補畫一次、不開迴圈。
  // WebP 解不開（iOS 14 以前）就一直是純色版，牌照樣玩得下去
  const art = {};
  const later = [];
  let artDone = false;
  function decode(name, url) {
    const img = new Image();
    const loaded = new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; });
    img.src = url;
    return (img.decode ? img.decode() : loaded).then(() => { art[name] = img; return null; }, () => name);
  }
  const ready = Promise.all([
    ...Object.entries(ART.court.images).map(([name, url]) => decode(name, url)),
    decode('back', ART.back.image),
    ...Object.entries(ART.chips.values).map(([value, c]) => decode(`chip${value}`, c.image)),
    decode('lobby', ART.lobby.image),
    ...Object.entries(ART.scene).map(([name, s]) => decode(`scene_${name}`, s.image)),
  ]).then(failed => {
    failed = failed.filter(Boolean);
    if (failed.length) console.warn(`這台瀏覽器解不開插畫（${failed.join('、')}），改用純色`);
    artDone = true;
    later.splice(0).forEach(fn => fn());
  });

  function drawn(w, h, draw) {
    const c = canvas(w, h);
    draw(c.getContext('2d'));
    return toTexture(c);
  }
  // 用到插畫的貼圖：先畫一次；插畫還沒解碼好就登記，解碼完清掉重畫、重傳。
  // 重傳前先 dispose 掉 GPU 上那一份：sRGB 貼圖原地重傳時，縮小看用的那幾層 mipmap 還是舊的純色版
  // （2026-11-16 這台 Edge 量到：原尺寸對、縮成 4×4 時紅籌碼的綠色道 37.7 → 12），遠一點的籌碼與牌背就髒了
  function painted(w, h, draw) {
    const c = canvas(w, h), t = toTexture(c);
    draw(c.getContext('2d'));
    if (!artDone) later.push(() => { const ctx = c.getContext('2d'); ctx.clearRect(0, 0, w, h); draw(ctx); t.dispose(); t.needsUpdate = true; });
    return t;
  }

  // 佈景插畫的亮度倍數（canvas 的 sRGB 值相乘）：使用者要佈景壓暗、不搶牌桌，畫面上每種材質跟 canvas 版同一級——
  // 亮度（luma）不比 canvas 版亮、最亮那個色道不比它暗。木頭是深紅，照亮度對齊要乘 10 倍、紅色道整片爆掉，所以只對齊最亮的色道。
  // 2026-11-18 照 tests/check_textures.js 的量法（只留那一種材質再畫一次）調的，數字見 docs\版本紀錄.md v0.22.0
  const TONE = { carpet: 0.75, wall: 1, leather: 2.8, wood: 3.7 };
  // 插畫從原點起鋪滿，亮度乘 k：k < 1 蓋一層黑，k > 1 用 lighter 再疊
  function fillArt(ctx, img, w, h, k) {
    const p = ctx.createPattern(img, 'repeat');
    ctx.save();
    ctx.fillStyle = p; ctx.fillRect(0, 0, w, h);
    if (k < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - k})`; ctx.fillRect(0, 0, w, h); }
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = p;
    for (let r = k - 1; r > 0; r--) { ctx.globalAlpha = Math.min(1, r); ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  }
  // 舊版漸層的明暗搬到插畫上：每一站換成灰階（那一站的亮度 ÷ 最亮那一站），用 multiply 乘上去
  function shade(ctx, w, h, stops, mode) {
    const g = ctx.createLinearGradient(0, 0, 0, h), top = Math.max(...stops.map(([, c]) => luma(c)));
    stops.forEach(([at, c]) => { const v = Math.round(255 * luma(c) / top); g.addColorStop(at, mode ? `rgb(${v},${v},${v})` : c); });
    ctx.save();
    if (mode) ctx.globalCompositeOperation = mode;
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function luma(hex) { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); }

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
  const FELT = [2048, 1024];
  function felt(ctx, R, seatDeg, seatR, playerSeat) {
    const [W, H] = FELT, s = H / R, cx = W / 2, cy = 0;
    // 燈照到的中央偏亮、往桌緣沉下去
    const base = ctx.createRadialGradient(cx, H * 0.42, R * s * 0.1, cx, H * 0.42, R * s * 1.1);
    base.addColorStop(0, '#118460'); base.addColorStop(0.5, V.COLORS.felt); base.addColorStop(1, '#05402f');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    // 絨布插畫是正綠的，只拿它的明暗（灰階，128＝不變）用 overlay 疊上去，顏色維持原本的青綠、跟桌緣 0x08503a 接得起來
    ctx.save();
    if (art.scene_felt) ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(art.scene_felt || grain(26), 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

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
    // 紙的厚度：四邊往外一圈漸暗、內側一道亮線。牌每個座位轉的角度不同，亮線四邊都畫，不分哪邊朝燈
    ctx.strokeStyle = 'rgba(33,44,49,0.22)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.roundRect(0, 0, CW, CH, 22); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(6, 6, CW - 12, CH - 12, 17); ctx.stroke();
    ctx.restore();
  }

  // 牌與籌碼底下墊的軟影子：開頁畫一次，代替逐像素算的即時陰影。CARD_SHADOW 是影子比牌多出來的邊（牌寬的比例）
  const CARD_SHADOW = 0.14;
  function cardShadow() {
    const pad = Math.round(CW * CARD_SHADOW), c = canvas(CW + 2 * pad, CH + 2 * pad), ctx = c.getContext('2d');
    // 圖形畫在畫布外、只把模糊的影子偏移進來：shadowBlur 每台瀏覽器都有，ctx.filter 舊 Safari 沒有
    // 圖形比牌大一圈 e：只照牌的大小畫，牌緣外的影子只剩兩三成，桌機斜看幾乎看不到（check_shadow.js 量到）
    const e = Math.round(pad * 0.15);
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = pad * 0.7; ctx.shadowOffsetX = 4000;
    ctx.beginPath(); ctx.roundRect(pad - 4000 - e, pad - e, CW + 2 * e, CH + 2 * e, 22 + e);
    ctx.fillStyle = '#000'; ctx.fill();
    return toTexture(c);
  }
  // 籌碼的影子：半徑 1＝籌碼邊，外面再暈開 CHIP_SHADOW
  const CHIP_SHADOW = 0.35;
  function chipShadow() {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d'), r = S / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    const edge = 1 / (1 + CHIP_SHADOW);
    g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(edge * 0.85, 'rgba(0,0,0,0.5)');
    g.addColorStop(edge, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return toTexture(c);
  }

  // ---- J、Q、K 的人物 ----
  // 插畫鋪滿牌面中間（四周留紙緣），左上、右下各挖一角給角標：角標在手機上只有十幾個像素高，壓在插畫的斜線底紋上
  // 就讀不出來。原圖的武器與花拿在左上、右下，產生器已經左右鏡像過，挖掉的兩角是素底
  const COURT_FILE = { K: 'king', Q: 'queen', J: 'jack' };
  const NOTCH = [62, 112];   // 挖掉的角從牌角量到這裡（牌面像素），角標的字與花色都在裡面
  function courtPath(ctx) {
    const [w, h] = ART.court.size, x0 = (CW - w) / 2, y0 = (CH - h) / 2, x1 = x0 + w, y1 = y0 + h;
    const nx = NOTCH[0], ny = NOTCH[1], r = 9;
    ctx.beginPath();
    ctx.moveTo((nx + x1) / 2, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, CH - ny, x0, CH - ny, r);
    ctx.arcTo(CW - nx, CH - ny, CW - nx, y1, r);
    ctx.arcTo(CW - nx, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, ny, x1, ny, r);
    ctx.arcTo(nx, ny, nx, y0, r);
    ctx.arcTo(nx, y0, x1, y0, r);
    ctx.closePath();
  }
  function courtFigure(ctx, rank, suit) {
    const img = art[`${COURT_FILE[rank]}_${suit === 'H' || suit === 'D' ? 'red' : 'black'}`];
    const [w, h] = ART.court.size;
    ctx.save();
    courtPath(ctx);
    if (img) {
      ctx.save(); ctx.clip(); ctx.drawImage(img, (CW - w) / 2, (CH - h) / 2); ctx.restore();
    } else {
      ctx.fillStyle = V.COLORS.faceFrame; ctx.fill();
      drawSuit(ctx, suit, CW / 2, CH / 2, 110, false);
      courtPath(ctx);
    }
    // 框線：深色描邊外面一道燙金，跟插畫的黑線金邊同一套
    ctx.strokeStyle = 'rgba(33,44,49,0.85)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = foil(ctx, 0, 0, CW, CH, 2); ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  function cardFace(ctx, rank, suit) {
    cardShape(ctx, V.COLORS.cardFace);
    ctx.strokeStyle = 'rgba(33,44,49,0.3)'; ctx.lineWidth = 5; ctx.stroke();
    if (rank === 'J' || rank === 'Q' || rank === 'K') courtFigure(ctx, rank, suit);
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
    if (rank === 'A') {
      ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 74, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,128,128,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([2, 7]); ctx.stroke(); ctx.setLineDash([]);
      drawSuit(ctx, suit, CW / 2, CH / 2, 120, false);
    } else if (PIPS[rank]) {
      PIPS[rank].forEach(([px, py]) => drawSuit(ctx, suit, CW / 2 + px * 50, CH / 2 + py * 96, 46, py > 0));
    }
    sheen(ctx);
  }

  // 牌背：插畫縮成牌的大小（產生器做的），中央那個空圓寫 21
  function cardBack(ctx) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0, 0, CW, CH, 22); ctx.clip();
    const [cx, cy, rx, ry] = ART.back.hole;
    if (art.back) {
      ctx.drawImage(art.back, 0, 0, CW, CH);
    } else {
      const base = ctx.createLinearGradient(0, 0, CW, CH);
      base.addColorStop(0, '#0a9090'); base.addColorStop(1, '#005f5f');
      ctx.fillStyle = base; ctx.fillRect(0, 0, CW, CH);
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.fillStyle = V.COLORS.dark; ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = foil(ctx, cx - rx, cy - ry, cx + rx, cy + ry);
    ctx.font = `bold ${Math.round(Math.min(rx, ry) * 1.3)}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowOffsetY = 1.5; ctx.shadowBlur = 2;
    ctx.fillText('21', cx, cy + 1.5);
    ctx.shadowColor = 'transparent';
    sheen(ctx);
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
  // 頂面是插畫（產生器裁到盤面、量好中央空白與邊環），面額字寫在中央；側面照插畫量到的底色與嵌片色畫條紋，
  // 條紋對齊頂面的嵌片，疊起來看是同一片嵌片從頂面延伸到側邊
  const CHIP = ART.chips.values;
  V.CHIP_COLORS = Object.fromEntries(Object.entries(CHIP).map(([value, c]) => [value, c.base]));

  function chipSide(value) {
    const C = CHIP[value], c = canvas(256, 32), ctx = c.getContext('2d');
    ctx.fillStyle = C.base; ctx.fillRect(0, 0, 256, 32);
    // 畫布的 x 就是繞圓柱一圈的角度（0＝頂面貼圖的右邊、逆時針），跟頂面的嵌片方位同一套
    ctx.fillStyle = C.stripe;
    const w = C.duty * 32;
    for (let i = 0; i < 8; i++) {
      const x = (C.phase + i * 45) / 360 * 256 - w / 2;
      for (const shift of [-256, 0, 256]) ctx.fillRect(x + shift, 0, w, 32);
    }
    // 側面是圓弧倒角：上半迎光、下半背光（畫布第 0 列是籌碼的上緣）
    const bevel = ctx.createLinearGradient(0, 4, 0, 28);
    bevel.addColorStop(0, 'rgba(255,255,255,0.22)'); bevel.addColorStop(0.4, 'rgba(255,255,255,0)'); bevel.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = bevel; ctx.fillRect(0, 4, 256, 24);
    // 上下緣壓暗、內側一道亮線：疊起來一片一片分得開
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, 256, 4); ctx.fillRect(0, 28, 256, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 4, 256, 2);
    return c;
  }

  // 插畫的光從左上打。籌碼只在一個小角度內隨機轉（chips.js 的 jitter），光的方向在每一片上都差不多，面額字也大致是正的
  function chipTop(ctx, value) {
    const C = CHIP[value], S = 256;
    if (art[`chip${value}`]) {
      ctx.drawImage(art[`chip${value}`], 0, 0, S, S);
    } else {
      ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 2 * Math.PI);
      ctx.fillStyle = C.base; ctx.fill();
    }
    // 面額字：最寬撐到中央空白的八成；淺色的金籌碼寫深色字
    ctx.save();
    ctx.fillStyle = luma(C.center) > 140 ? V.COLORS.dark : V.COLORS.cardFace;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowOffsetX = 1.5; ctx.shadowOffsetY = 2; ctx.shadowBlur = 3;
    ctx.font = `bold ${value >= 1000 ? 54 : 66}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(value), S / 2, S / 2 + 4, C.inner * S * 0.8);
    ctx.restore();
  }

  // 頂面與側面畫在同一張：一片籌碼一種材質、一個 draw call。top、side 是各自佔整張貼圖高度的比例（chips.js 拿去算 UV）
  const ATLAS_H = 292;
  function chipAtlas(ctx, value) {
    ctx.fillStyle = CHIP[value].base; ctx.fillRect(0, 0, 256, ATLAS_H);
    chipTop(ctx, value);
    ctx.drawImage(chipSide(value), 0, ATLAS_H - 32);
  }

  // ---- 桌緣（table.js）----
  // 平鋪的貼圖：插畫解碼前先畫 canvas 版，好了補畫（painted）
  function tiling(w, h, draw, repeat, both) {
    const t = painted(w, h, draw);
    t.wrapS = THREE.RepeatWrapping;
    if (both) t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(...repeat);
    return t;
  }

  // 皮革扶手：v＝0.75 是頂上、0.5 是朝桌內（畫布由上往下是 v 從 1 到 0，上下接得起來）。高光畫在頂上偏桌內那側，兩條縫線跟著走。
  // 一個重複是半圈弧長的 1/12（1.34 單位）乘管的一圈（1.38 單位），畫布用正方形，皮紋才不會被拉長
  const LEATHER_REPEAT = 12;
  const LEATHER_STOPS = [[0, '#1d120c'], [0.15, '#3b261a'], [0.24, '#6a4630'], [0.32, '#38241a'], [0.5, '#1a100b'], [0.75, '#0f0906'], [1, '#1d120c']];
  function leather(ctx) {
    const [W, H] = ART.scene.leather.size, img = art.scene_leather;
    if (img) fillArt(ctx, img, W, H, TONE.leather);
    shade(ctx, W, H, LEATHER_STOPS, img && 'multiply');
    if (!img) { ctx.fillStyle = ctx.createPattern(grain(22), 'repeat'); ctx.fillRect(0, 0, W, H); }
    // 一圈 16 針、針距 16 像素：落在整數像素上，接回來那一針跟其他針一樣利，不會多一道邊
    for (const y of [H * 0.09, H * 0.41]) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, y - H / 128, W, 3 * H / 128);
      ctx.fillStyle = 'rgba(214,190,140,0.75)';
      for (let i = 0; i < 16; i++) ctx.fillRect(i * W / 16, y, Math.round(0.62 * W / 16), H / 128);
    }
  }

  // 桌身木頭：紅木紋，上緣一道亮漆
  const WOOD_STOPS = [[0, '#6a4128'], [0.14, '#b98054'], [0.3, '#6e4429'], [1, '#2e1a10']];
  function wood(ctx) {
    const [W, H] = ART.scene.wood.size, img = art.scene_wood;
    if (img) {
      fillArt(ctx, img, W, H, TONE.wood);
      shade(ctx, W, H, WOOD_STOPS, 'multiply');
      // 亮漆：明暗只會壓暗，那一道反光另外用 screen 提亮
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0.04, 'rgba(255,225,195,0)'); g.addColorStop(0.14, 'rgba(255,225,195,0.28)'); g.addColorStop(0.26, 'rgba(255,225,195,0)');
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      return;
    }
    shade(ctx, W, H, WOOD_STOPS);
    const rng = V.rng(53);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(${rng() < 0.6 ? '20,8,2' : '200,140,90'},${0.06 + rng() * 0.12})`;
      ctx.lineWidth = 0.6 + rng() * 1.6;
      const y = rng() * H, b = rng() * 8 - 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(W / 3, y + b, 2 * W / 3, y - b, W, y); ctx.stroke();
    }
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

  // ---- 佈景（room.js）：使用者要求整體壓暗；插畫的亮度照 canvas 版調（TONE），canvas 版的花紋只比底色亮一點點 ----
  // 牌桌在地毯上的影子：畫布上緣＝桌子直邊，下緣＝弧頂再往外 pad 單位
  function tableShadow(R, pad) {
    const H = 256, s = H / (R + pad), W = 2 * H, c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(W / 2, 0, (R - 0.2) * s, W / 2, 0, (R + pad) * s);
    g.addColorStop(0, 'rgba(0,0,0,0.82)'); g.addColorStop(0.3, 'rgba(0,0,0,0.6)'); g.addColorStop(0.7, 'rgba(0,0,0,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    return toTexture(c);
  }

  // 地毯一格：四邊的圖案對得上，鋪滿地板看不出接縫（插畫的接縫由產生器處理過）
  function carpet(ctx) {
    const [S] = ART.scene.carpet.size;
    if (art.scene_carpet) { fillArt(ctx, art.scene_carpet, S, S, TONE.carpet); return; }
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
  }

  // 隔間木牆板一段（room.js：4×1.3 單位）：兩塊凸起的鑲板，左右接起來是連續的；一段一盞壁燈，暖光畫進木頭裡、下緣一條暗帶
  function woodPanel(ctx) {
    const [W, H] = ART.scene.wall.size;
    if (art.scene_wall) fillArt(ctx, art.scene_wall, W, H, TONE.wall);
    else { ctx.save(); ctx.scale(W / 1024, H / 320); panelsDrawn(ctx); ctx.restore(); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, H * (1 - 28 / 320), W, H * 28 / 320);
    ctx.globalCompositeOperation = 'lighter';
    for (const x of [0, W]) {
      const g = ctx.createRadialGradient(x, 0, 0, x, 0, W * 260 / 1024);
      g.addColorStop(0, 'rgba(255,180,100,0.3)'); g.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // 插畫解不開時的鑲板：程式畫的木紋與兩塊凸起的板（1024×320 的座標）
  function panelsDrawn(ctx) {
    const W = 1024, H = 320;
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
    ctx.fillStyle = 'rgba(255,214,170,0.1)'; ctx.fillRect(0, 12, W, 6);
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

  // 牆後的大廳：插畫直接當貼圖，room.js 照畫面比例調 UV 裁一塊，換螢幕比例不必重畫。不做 mipmap：桌機約一比一、手機是放大看。
  // 解碼好之前沒有圖，three 綁一張全黑的空貼圖，跟場景的暗底看不出差別；材質一開始就帶著這張貼圖，換上圖不必重編著色器
  function lobby() {
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    const set = () => { if (art.lobby) { t.image = art.lobby; t.needsUpdate = true; } };
    if (artDone) set(); else later.push(set);
    return t;
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
    // 同一張桌子只有一張絨布，第二次呼叫拿到的是同一張（探針靠它取絨布）
    felt: (R, seatDeg, seatR, playerSeat) => cached('felt', () => painted(...FELT, ctx => felt(ctx, R, seatDeg, seatR, playerSeat))),
    // 插畫全解碼完（解不開的已經改用純色）、要補畫的都補畫好了
    ready,
    CHIP_ATLAS: { top: 256 / ATLAS_H, side: 32 / ATLAS_H },
    CARD_SHADOW, CHIP_SHADOW,
    cardShadow: () => cached('cardShadow', cardShadow),
    chipShadow: () => cached('chipShadow', chipShadow),
    cardFace: (rank, suit) => cached(`face-${rank}${suit}`, () => (COURT_FILE[rank] ? painted : drawn)(CW, CH, ctx => cardFace(ctx, rank, suit))),
    cardBack: () => cached('back', () => painted(CW, CH, cardBack)),
    deckEdge: () => cached('deckEdge', deckEdge),
    chipAtlas: value => cached(`atlas-${value}`, () => painted(256, ATLAS_H, ctx => chipAtlas(ctx, value))),
    // showcase.js 的大特效拿它的畫布當噴出來的籌碼
    chipTop: value => cached(`top-${value}`, () => painted(256, 256, ctx => chipTop(ctx, value))),
    leather: () => cached('leather', () => tiling(...ART.scene.leather.size, leather, [LEATHER_REPEAT, 1], true)),
    wood: () => cached('wood', () => tiling(...ART.scene.wood.size, wood, [6, 1])),
    glass: () => cached('glass', glass),
    white: () => cached('white', white),
    carpet: () => cached('carpet', () => tiling(...ART.scene.carpet.size, carpet, null, true)),
    woodPanel: () => cached('woodPanel', () => tiling(...ART.scene.wall.size, woodPanel)),
    tableShadow: (R, pad) => cached('tableShadow', () => tableShadow(R, pad)),
    brass: () => cached('brass', brass),
    lobby: () => cached('lobby', lobby),
  };
})();
