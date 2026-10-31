// 插畫荷官：SVG 畫成平面立牌，站在牌桌直邊後面；五種表情各一張貼圖，換表情就是換貼圖。
// SVG 走 data: URL 轉成 WebGL 貼圖，2026-10-22 實測 file:// 下 Edge／Chrome 都不會被當成跨來源擋掉。
(function () {
  const V = window.BJK.view;
  const MOODS = { idle: '待機', deal: '發牌', surprised: '驚訝', smile: '微笑', sorry: '遺憾' };
  const VB_W = 560, VB_H = 520;          // SVG 座標：比人寬，手勢才張得開
  const H = 3.4, W = H * VB_W / VB_H;    // 立牌在場景裡的大小
  // 臉部外框（含頭髮），給對白泡泡避開用
  const HEAD = { cx: 282, cy: 172, rx: 92, ry: 116 };
  const ASIDE_MS = 1600;                 // 換造型那句話講多久

  // JOJO 動畫的硬光：只有亮面、紫紅暗面、墨黑三階，不用漸層；光從左上來，臉朝畫面右側，所以遠側半張臉整片落進暗面
  const C = {
    ink: '#15131d', skin: '#ffd6a5', skinHi: '#fff0d6', skinDk: '#b2476f', skinDeep: '#5e1f5c',
    hair: '#2e2666', hairHi: '#8f7fe0', hairGloss: '#e4e0ff', hairRim: '#35d6c6',
    coat: '#008080', coatHi: '#35d6c6', coatDk: '#07383f',
    vest: '#a3155a', vestDk: '#470c3c', gold: '#f2c230', goldHi: '#fff2a8', goldDk: '#9a6a10',
    glove: '#f1ecff', gloveDk: '#b7aceb', eye: '#fbf6ea', iris: '#008080', teeth: '#fbf6ea', mouth: '#3d0f2c', sweat: '#bfeaf2',
  };
  const n1 = v => +v.toFixed(1);
  const line = (d, color, width, extra) =>
    `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra || ''}/>`;
  const shape = (d, fill, strokeWidth) =>
    `<path d="${d}" fill="${fill}"${strokeWidth ? ` stroke="${C.ink}" stroke-width="${strokeWidth}" stroke-linejoin="round"` : ''}/>`;
  // 毛筆線：兩頭尖、中間粗（x1 y1 → 控制點 → x2 y2）。線條的粗細變化全靠這支
  const brush = (x1, y1, cx, cy, x2, y2, w, color) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len * w, ny = dx / len * w;
    return `<path d="M${x1} ${y1} Q${n1(cx + nx)} ${n1(cy + ny)} ${x2} ${y2} Q${n1(cx - nx)} ${n1(cy - ny)} ${x1} ${y1} Z" fill="${color || C.ink}"/>`;
  };
  // 排線：同方向一排短筆觸
  const hatch = (x, y, dx, dy, stepX, stepY, count, w, color) => Array.from({ length: count }, (_, i) => {
    const a = x + stepX * i, b = y + stepY * i;
    return brush(a, b, n1(a + dx / 2), n1(b + dy / 2), n1(a + dx), n1(b + dy), w, color);
  }).join('');
  const SPADE = 'M0 -13 C4 -5 12 -2 12 5 C12 10 5 11 2 7 L4 14 L-4 14 L-2 7 C-5 11 -12 10 -12 5 C-12 -2 -4 -5 0 -13 Z';
  const DIAMOND = 'M0 -10 L7 0 L0 10 L-7 0 Z';
  const pip = (d, x, y, s, fill, strokeWidth) => `<g transform="translate(${x} ${y}) scale(${s})">${shape(d, fill, strokeWidth)}</g>`;

  // ── 頭 ──
  const HEAD_PATH = 'M214 130 Q276 66 348 124 L356 176 L346 222 L332 258 Q314 284 292 286 L262 280 L230 250 L216 210 L212 170 Z';
  // id 帶專案前綴：showcase.js 會把同一張 SVG 內嵌進頁面
  const DEFS = `<defs><clipPath id="bjkHead"><path d="${HEAD_PATH}"/></clipPath></defs>`;

  const SKULL = shape(HEAD_PATH, C.skin) + `<g clip-path="url(#bjkHead)">
    ${shape('M318 96 L308 148 L300 180 L316 194 L342 200 L326 230 L318 256 L302 268 L284 296 L372 296 L372 96 Z', C.skinDk)}
    ${shape('M358 168 L340 226 L324 268 L300 292 L360 292 Z', C.ink)}
    ${shape('M214 206 Q232 236 262 244 Q244 246 238 258 L214 240 Z', C.skinDk)}
    ${shape('M246 262 L292 274 L290 292 L252 290 Z', C.skinDk)}
    ${shape('M206 116 Q232 118 240 134 Q262 118 288 150 Q300 124 322 118 L358 150 L358 66 L206 66 Z', C.skinDeep)}
    ${shape('M232 142 Q256 128 278 148 Q256 138 240 150 Z', C.skinHi)}
    ${hatch(236, 200, 9, 7, 8, 3, 3, 2, C.ink)}
    ${hatch(326, 206, -7, 12, 7, 5, 3, 1.8, C.ink)}
    ${hatch(246, 252, 5, 12, 9, 4, 5, 1.7, C.ink)}
    ${brush(244, 204, 262, 208, 278, 200, 2.4, C.skinHi)}
    ${brush(262, 264, 276, 270, 288, 266, 2.4, C.skinHi)}
  </g>${shape(HEAD_PATH, 'none', 4.5)}`;
  const NOSE = shape('M300 170 L326 212 L304 220 Z', C.skinDk) +
    brush(314, 192, 320, 200, 325, 209, 3) + brush(325, 209, 322, 220, 302, 217, 3.6) +
    brush(294, 168, 298, 192, 308, 208, 3.4, C.skinHi) + brush(292, 214, 276, 224, 268, 238, 2.2);
  const CHIN = brush(280, 268, 292, 276, 304, 266, 2.4, C.skinDeep);
  const EAR = shape('M218 164 Q196 156 196 184 Q198 216 222 224 Z', C.skin, 4) + brush(204, 176, 206, 196, 216, 212, 3, C.skinDk);
  const EARRING = line('M207 222 L205 240', C.gold, 3) + pip(SPADE, 205, 254, 1, C.gold, 3);

  // 眉毛粗而尖；疤切過近側的眉毛
  const BROWS = {
    flat: shape('M228 156 L248 142 L290 154 L286 162 L250 153 L232 164 Z M304 154 L338 144 L350 154 L340 154 L308 162 Z', C.ink),
    low: shape('M230 162 L250 150 L292 160 L288 168 L250 159 L234 170 Z M302 160 L338 152 L350 160 L340 160 L306 168 Z', C.ink),
    cocked: shape('M226 150 L248 124 L292 144 L288 152 L250 135 L230 158 Z M304 146 L338 128 L352 140 L340 140 L308 154 Z', C.ink),
    knit: shape('M230 148 L252 152 L292 174 L286 178 L250 162 L232 158 Z M300 174 L334 148 L350 152 L338 158 L306 180 Z', C.ink),
  };
  const SCAR = line('M254 134 L266 184', C.skinHi, 3.5);

  // open＝眼睛開多大；gx gy＝視線往哪看。眼白裁在眼形裡，半瞇時虹膜才不會跑出眼皮
  function eyes(id, { open, gx = 0, gy = 0, r = 7 }) {
    const t = 176 - 30 * open, b = 176 + 16 * open;
    const near = `M238 176 Q258 ${t} 282 178 Q260 ${b} 238 176 Z`, far = `M308 178 Q324 ${t + 4} 340 172 Q326 ${b} 308 178 Z`;
    const iris = (x, y, k) => `<circle cx="${x}" cy="${y}" r="${n1(r * k)}" fill="${C.iris}"/><circle cx="${x}" cy="${y}" r="${n1(r * k * 0.55)}" fill="${C.ink}"/><circle cx="${n1(x - r * k * 0.4)}" cy="${n1(y - r * k * 0.4)}" r="${n1(r * k * 0.28)}" fill="#fff"/>`;
    return `<clipPath id="bjkEye${id}"><path d="${near} ${far}"/></clipPath>` +
      shape(near, C.eye) + shape(far, C.eye) +
      `<g clip-path="url(#bjkEye${id})">${iris(262 + gx, 174 + gy, 1)}${iris(325 + gx * 0.7, 173 + gy, 0.8)}</g>` +
      brush(234, 177, 258, t - 2, 286, 180, 8) + brush(305, 179, 324, t + 2, 344, 170, 6) +
      brush(244, 184, 262, b + 2, 280, 181, 1.8) + brush(312, 182, 326, b, 338, 176, 1.6);
  }
  const LASH = brush(238, 160, 258, 148, 280, 160, 2.2);
  const UNDER = brush(240, 194, 258, 200, 276, 194, 2);
  const LIPS = brush(272, 240, 298, 228, 326, 232, 4.5) +
    shape('M272 240 Q288 230 298 234 Q306 230 324 233 Q300 241 272 240 Z', C.skinDeep) +
    shape('M282 241 Q300 256 318 236 Q304 244 282 241 Z', C.skinDk) + brush(290, 246, 300, 250, 310, 243, 1.8, C.skinHi);

  const FACES = {
    // 待機：半垂眼皮，嘴角一邊勾起
    idle: BROWS.flat + SCAR + eyes('Idle', { open: 0.5 }) + LASH + UNDER + LIPS + brush(324, 232, 334, 228, 338, 220, 3.6) + brush(288, 258, 300, 262, 314, 254, 2.6, C.skinDeep),
    // 發牌：眼神壓低盯著手上的牌，嘴抿緊
    deal: BROWS.low + SCAR + eyes('Deal', { open: 0.34, gx: 6, gy: 3 }) + UNDER +
      brush(274, 240, 298, 234, 326, 238, 4.5) + brush(288, 258, 300, 262, 314, 254, 2.6, C.skinDeep),
    // 驚訝：瞳孔縮小、眼白全露、咬牙，額頭壓下一排陰影線
    surprised: hatch(240, 120, -2, 26, 12, 0, 9, 2.6) + BROWS.cocked + SCAR + eyes('Sup', { open: 1, r: 4 }) + LASH + UNDER +
      shape('M266 234 Q298 222 332 226 L326 258 Q298 268 274 258 Z', C.mouth, 4) +
      shape('M270 238 Q298 228 330 230 L328 240 L272 246 Z', C.teeth) + line('M282 234 L283 245 M294 232 L295 243 M306 231 L307 242 M318 231 L318 241', C.ink, 1.8) +
      shape('M276 254 L326 248 L324 256 Q298 266 278 257 Z', C.teeth) +
      shape('M366 110 Q378 132 366 142 Q354 132 366 110 Z', C.sweat, 2.5) + shape('M196 118 Q205 134 196 142 Q187 134 196 118 Z', C.sweat, 2.5),
    // 微笑：下巴抬起、露齒自信笑，眼尾擠出兩筆
    smile: BROWS.flat + SCAR + eyes('Smile', { open: 0.3, gx: 2 }) + UNDER +
      shape('M262 234 Q300 240 340 218 Q334 254 300 262 Q274 260 262 234 Z', C.teeth, 4) + line('M276 240 L278 256 M290 241 L292 261 M304 240 L306 260 M318 235 L320 254 M267 240 Q300 248 336 226', C.ink, 1.8) +
      brush(254, 226, 252, 242, 260, 254, 3.2) + brush(342, 212, 348, 226, 340, 238, 3) + brush(284, 270, 300, 274, 318, 266, 2.6, C.skinDeep),
    // 遺憾：眉頭揪緊、眼神別開，咬住下唇，額角一滴汗
    sorry: hatch(236, 126, -1, 20, 13, 0, 8, 2.4) + BROWS.knit + SCAR + eyes('Sorry', { open: 0.42, gx: -8, gy: 2 }) + UNDER +
      brush(276, 244, 298, 236, 324, 246, 4.5) + shape('M292 241 L308 241 L306 247 L294 247 Z', C.teeth, 2) + brush(284, 256, 300, 252, 318, 256, 3, C.skinDk) +
      shape('M204 120 Q214 136 204 144 Q194 136 204 120 Z', C.sweat, 2.5),
  };
  // 換表情也換頭的角度：臉是全張畫死的貼圖，這一轉比五官動還有戲
  const TILT = {
    idle: 'rotate(-2 285 270)', deal: 'translate(2 4) rotate(6 285 270)', surprised: 'translate(-4 -6) rotate(-5 285 270)',
    smile: 'translate(0 -4) rotate(-8 285 270)', sorry: 'translate(0 6) rotate(9 285 270)',
  };

  // 油頭：前額往上推出一道髮量再整片往後梳，額頭留美人尖，靠梳痕與一道鋸齒高光顯出油亮；深色頭髮貼著深色牆，靠後緣一道青色輪廓光分開
  const HAIR = 'M218 190 L210 150 Q196 104 222 66 Q256 26 312 30 Q362 36 376 84 Q378 104 358 116 L352 146 L344 124 Q318 102 296 112 L284 134 Q262 104 238 112 Q226 128 226 164 Z';
  const HAIR_ART = shape(HAIR, C.hair) +
    shape('M218 190 L210 150 Q204 128 206 108 Q222 128 230 142 L226 164 Z', C.ink) +
    shape('M358 116 Q378 104 376 84 Q366 50 334 36 Q360 78 344 124 L352 146 Z', C.ink) +
    shape('M292 34 L262 40 L274 50 L246 58 L264 68 L238 78 L258 86 L232 98 L262 98 L274 92 L286 100 L296 84 L308 90 L312 70 L326 72 L320 52 L334 50 Z', C.hairHi) +
    shape('M286 44 L268 48 L278 56 L258 64 L272 70 L256 80 L276 80 L288 72 L298 76 L302 60 L312 58 L306 46 Z', C.hairGloss) +
    brush(366, 74, 300, 28, 226, 62, 2.4, C.ink) + brush(350, 100, 290, 50, 214, 92, 2.6, C.ink) + brush(330, 108, 270, 70, 212, 118, 2.4, C.ink) + brush(296, 112, 258, 88, 212, 140, 2.2, C.ink) +
    shape(HAIR, 'none', 5) + brush(206, 150, 194, 104, 226, 62, 3, C.hairRim);

  const head = mood => `<g transform="${TILT[mood]}">${EAR}${SKULL}${NOSE}${CHIN}<g class="face">${FACES[mood]}</g>${HAIR_ART}${EARRING}</g>`;

  // ── 身體 ──
  const NECK = shape('M236 250 L334 250 L346 330 L224 330 Z', C.skin, 5) +
    shape('M244 258 Q292 304 340 262 L346 330 L300 330 Z', C.skinDk) + shape('M314 262 L342 262 L346 330 L322 330 Z', C.ink) +
    brush(250, 276, 260, 304, 274, 326, 2.6, C.skinDk) + hatch(300, 300, 8, 16, 7, -1, 3, 1.8, C.ink);
  const COLLAR_BACK = shape('M192 226 L172 300 L392 300 L376 226 L338 270 L232 270 Z', C.vestDk, 5);
  const CHOKER = shape('M238 296 Q284 320 336 296 L338 310 Q284 334 236 310 Z', C.ink) + line('M238 303 Q284 327 336 303', C.vest, 3) + pip(SPADE, 286, 330, 1.05, C.gold, 3);
  const CHEST = shape('M226 312 L342 312 L348 400 L314 520 L256 520 L220 400 Z', C.vest, 5) +
    shape('M286 392 L348 400 L314 520 L286 520 Z', C.vestDk) +
    [[252, 430], [270, 470], [252, 506], [304, 430]].map(([x, y]) => pip(DIAMOND, x, y, 0.8, C.gold)).join('') +
    shape('M244 316 L326 316 L286 410 Z', C.skin, 4) +
    shape('M286 340 L326 316 L286 410 Z', C.skinDk) + shape('M250 318 Q286 346 322 318 L326 316 L244 316 Z', C.skinDeep) +
    brush(250, 332, 268, 340, 282, 336, 2.6, C.skinDk) + brush(290, 336, 304, 340, 318, 330, 2.6, C.skinDeep) + brush(286, 352, 285, 374, 286, 402, 2.4, C.skinDeep);
  const JACKET_L = 'M150 520 L170 432 L136 376 Q130 342 178 322 L232 304 L246 332 L222 400 L256 520 Z';
  const JACKET_R = 'M412 520 L394 432 L428 376 Q434 342 386 322 L334 304 L320 332 L346 400 L314 520 Z';
  const JACKET = shape(JACKET_L, C.coat, 5) + shape(JACKET_R, C.coat, 5) +
    shape('M170 432 L214 396 L248 520 L150 520 Z', C.coatDk) +
    shape('M428 376 Q434 342 386 322 L334 304 L320 332 L346 400 L314 520 L412 520 L394 432 Z', C.coatDk) +
    hatch(356, 400, 18, 26, 12, 4, 4, 2.4, C.ink) +
    line('M240 318 L222 400 L256 520', C.ink, 10) + line('M240 318 L222 400 L256 520', C.gold, 5.5) +
    line('M326 318 L346 400 L314 520', C.ink, 10) + line('M326 318 L346 400 L314 520', C.gold, 5.5) +
    [[186, 390], [204, 430]].map(([x, y]) => pip(DIAMOND, x, y, 0.9, C.coatHi)).join('');
  const COLLAR_FRONT = shape('M192 226 L170 302 L208 356 L252 324 L238 278 Z', C.coat, 5) + shape('M376 226 L392 302 L356 356 L316 324 L330 278 Z', C.coatDk, 5) +
    line('M192 226 L170 302 L208 356 L252 324', C.gold, 3.5) + line('M376 226 L392 302 L356 356 L316 324', C.gold, 3.5);
  const CHAIN = `<path d="M180 352 Q250 436 300 404 Q350 378 384 350" fill="none" stroke="${C.ink}" stroke-width="7"/><path d="M180 352 Q250 436 300 404 Q350 378 384 350" fill="none" stroke="${C.gold}" stroke-width="4" stroke-dasharray="7 3"/>`;

  // ── 手與手臂 ──
  // 兩端不同寬的一段（肩到肘、肘到腕、手指的一節）
  const taper = (a, b, wa, wb, dx = 0, dy = 0) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], len = Math.hypot(ux, uy), nx = -uy / len, ny = ux / len;
    const pts = [[a, wa, 1], [b, wb, 1], [b, wb, -1], [a, wa, -1]].map(([p, w, k]) => `${n1(p[0] + dx + nx * w / 2 * k)} ${n1(p[1] + dy + ny * w / 2 * k)}`);
    return 'M' + pts.join(' L') + ' Z';
  };
  // 手指兩節，往指尖收細；暗面貼著一側的邊，不畫在正中間
  const digit = ([a, b, c], w = 15) => {
    const m = w * 0.84, t = w * 0.62, bones = taper(a, b, w, m) + taper(b, c, m, t), round = (fill, grow) => `<circle cx="${b[0]}" cy="${b[1]}" r="${n1(m / 2 + grow)}" fill="${fill}"/><circle cx="${c[0]}" cy="${c[1]}" r="${n1(t / 2 + grow)}" fill="${fill}"/>`;
    return `<path d="${bones}" fill="${C.ink}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/>${round(C.ink, 2.5)}${shape(bones, C.glove)}${round(C.glove, 0)}
      ${shape(taper(a, b, w * 0.34, m * 0.34, w * 0.32, 0), C.gloveDk)}${shape(taper(b, c, m * 0.34, t * 0.34, w * 0.26, 0), C.gloveDk)}`;
  };
  const PALM = shape('M-20 6 L-29 -38 Q0 -50 28 -40 L24 4 Q0 12 -20 6 Z', C.glove, 4) + shape('M8 -44 L28 -40 L24 4 L10 8 Z', C.gloveDk) + pip(SPADE, -2, -19, 0.95, C.gold, 2);
  const HANDS = {
    open: digit([[-22, -38], [-30, -60], [-36, -82]]) + digit([[-7, -44], [-9, -72], [-11, -98]]) + digit([[9, -44], [14, -70], [19, -94]]) + digit([[23, -36], [33, -56], [41, -74]], 13) + PALM + digit([[-24, -8], [-44, -24], [-56, -46]], 16),
    claw: digit([[-22, -38], [-36, -58], [-30, -78]]) + digit([[-7, -44], [-15, -72], [-5, -92]]) + digit([[9, -44], [12, -70], [23, -88]]) + digit([[23, -36], [36, -56], [42, -72]], 13) + PALM + digit([[-24, -8], [-46, -22], [-52, -42]], 16),
    card: digit([[2, -42], [6, -70], [12, -96]]) +
      `<g transform="translate(-2 -118) rotate(9)"><rect x="-29" y="-42" width="58" height="82" rx="6" fill="${C.coat}" stroke="${C.ink}" stroke-width="4"/><rect x="-22" y="-35" width="44" height="68" rx="3" fill="none" stroke="${C.gold}" stroke-width="2.5"/>${pip(SPADE, 0, -2, 1.4, C.gold)}</g>` +
      digit([[-15, -40], [-16, -66], [-14, -92]]) + digit([[15, -40], [23, -50], [13, -60]]) + digit([[25, -30], [32, -40], [22, -50]], 13) + PALM + digit([[-24, -10], [-26, -32], [-10, -46]], 16),
    point: digit([[2, -42], [10, -56], [-2, -62]]) + digit([[15, -40], [23, -50], [11, -58]]) + digit([[25, -30], [32, -40], [20, -48]], 13) + PALM + digit([[-17, -40], [-19, -70], [-18, -102]]) + digit([[-24, -12], [-50, -18], [-74, -14]], 16),
  };
  const hand = (kind, x, y, rot, sx, s = 1.12) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${n1(sx * s)} ${s})">${HANDS[kind]}</g>`;

  // 布料的皺褶：從邊緣切進來的一道尖角。t 是這段上的位置、hw 是那裡的半寬、k 決定從哪一側切入
  const fold = (a, b, t, hw, reach, k) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], len = Math.hypot(ux, uy), tx = ux / len, ty = uy / len, nx = -ty * k, ny = tx * k;
    const x = a[0] + ux * t + nx * hw, y = a[1] + uy * t + ny * hw;
    return shape(`M${n1(x)} ${n1(y)} L${n1(x + tx * 11)} ${n1(y + ty * 11)} L${n1(x - nx * reach + tx * 18)} ${n1(y - ny * reach + ty * 18)} Z`, C.ink);
  };
  // 肩、肘、腕三點；上臂粗、前臂收細，袖口一段金邊翻袖，手接在腕上
  function arm([s, e, w], handArt) {
    const up = taper(s, e, 68, 56), fore = taper(e, w, 56, 40);
    const back = [e[0] - w[0], e[1] - w[1]], blen = Math.hypot(...back), at = k => [n1(w[0] + back[0] / blen * k), n1(w[1] + back[1] / blen * k)];
    return `<g class="arm">${handArt || ''}
      <path d="${up} ${fore}" fill="${C.ink}" stroke="${C.ink}" stroke-width="9" stroke-linejoin="round"/><circle cx="${e[0]}" cy="${e[1]}" r="32" fill="${C.ink}"/>
      ${shape(up, C.coat)}${shape(fore, C.coat)}<circle cx="${e[0]}" cy="${e[1]}" r="28" fill="${C.coat}"/>
      ${shape(taper(s, e, 34, 28, 14, 10), C.coatDk)}${shape(taper(e, w, 28, 18, 11, 8), C.coatDk)}
      ${fold(s, e, 0.62, 30, 34, 1)}${fold(s, e, 0.8, 29, 26, -1)}${fold(e, w, 0.16, 26, 30, 1)}${fold(e, w, 0.36, 24, 22, -1)}
      <path d="${taper(at(32), w, 54, 54)}" fill="${C.gold}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/>${shape(taper(at(20), at(12), 54, 54), C.goldDk)}</g>`;
  }
  const ARM_L = {
    hang: () => arm([[146, 356], [122, 446], [112, 620]]),
    chest: () => arm([[146, 356], [130, 456], [226, 396]], hand('open', 236, 388, 62, -1)),
    head: () => arm([[146, 356], [84, 412], [150, 306]], hand('claw', 158, 292, 24, 1)),
  };
  const ARM_R = {
    hang: () => arm([[418, 356], [442, 446], [452, 620]]),
    card: () => arm([[418, 356], [494, 446], [474, 352]], hand('card', 472, 340, -6, -1)),
    chin: () => arm([[418, 356], [462, 440], [396, 338]], hand('point', 388, 322, 6, 1)),
    brow: () => arm([[418, 356], [500, 350], [430, 190]], hand('open', 420, 170, -64, -1)),
  };
  const POSE = {
    idle: [ARM_L.chest, ARM_R.hang], deal: [ARM_L.hang, ARM_R.card], surprised: [ARM_L.head, ARM_R.hang],
    smile: [ARM_L.hang, ARM_R.chin], sorry: [ARM_L.hang, ARM_R.brow],
  };
  // 肩甲蓋住手臂的起點，舉手、垂手都接得起來
  const CAPS = shape('M116 378 Q106 332 172 316 L212 342 L190 396 Q152 374 116 378 Z', C.coat, 5) + shape('M448 378 Q458 332 392 316 L352 342 L374 396 Q412 374 448 378 Z', C.coatDk, 5) +
    brush(128, 362, 136, 334, 178, 324, 3, C.coatHi) + brush(440, 362, 432, 336, 396, 324, 2.6, C.coat) +
    line('M116 378 Q152 374 190 396', C.gold, 4) + line('M448 378 Q412 374 374 396', C.gold, 4) +
    pip(SPADE, 160, 352, 1.35, C.gold, 3) + pip(SPADE, 404, 352, 1.35, C.gold, 3);

  // ゴ：一筆一筆畫死，不靠系統字型；只放驚訝與得意，沒有動畫
  const GO = 'M8 18 H78 V84 H6 M88 0 L96 15 M104 -4 L112 11';
  const go = (x, y, s, r) => `<g transform="translate(${x} ${y}) rotate(${r}) skewX(-10) scale(${s})" fill="none" stroke-linejoin="miter" stroke-linecap="butt">
    <path d="${GO}" stroke="${C.ink}" stroke-width="27" transform="translate(5 6)"/><path d="${GO}" stroke="${C.goldHi}" stroke-width="27"/><path d="${GO}" stroke="${C.vest}" stroke-width="18"/></g>`;
  const MENACE = { surprised: go(26, 64, 0.62, -8) + go(62, 150, 0.5, -4) + go(30, 226, 0.4, 6), smile: go(24, 96, 0.62, 8) + go(60, 182, 0.5, -6) + go(28, 250, 0.4, -10) };

  // size 是 <svg> 的大小與 viewBox，由下面的 svg() 依造型決定。五官包在 g.face 裡，探針量它畫在畫面哪裡
  function draw(mood, size) {
    const [left, right] = POSE[mood];
    return `<svg xmlns="http://www.w3.org/2000/svg" ${size}>
      ${DEFS}${MENACE[mood] || ''}${COLLAR_BACK}${NECK}${CHEST}${JACKET}${CHAIN}${CHOKER}${COLLAR_FRONT}
      ${head(mood)}${left()}${right()}${CAPS}
    </svg>`;
  }

  // 造型：點荷官時依序循環。立牌大小都一樣，換造型只換貼圖。head 是臉部外框（立牌座標）、crop 是大特寫的裁切、line 是換上時講的話
  if (!V.dealerClassic) throw new Error('載入順序錯：dealer_classic.js 要排在 dealer.js 之前');
  const LOOKS = {
    jojo: { viewBox: `0 0 ${VB_W} ${VB_H}`, head: HEAD, crop: '146 28 290 290', draw, line: '這身才夠氣勢。' },
    classic: V.dealerClassic,
  };
  const LOOK_NAMES = Object.keys(LOOKS);
  let look = LOOK_NAMES[0];   // 整頁只有一位荷官，大特寫也讀這個

  // crop 給了就只畫那一塊、大小跟著外框
  function svg(mood, crop, name = look) {
    const L = LOOKS[name];
    return L.draw(mood, crop ? `width="100%" height="100%" viewBox="${crop}"` : `width="${VB_W * 2}" height="${VB_H * 2}" viewBox="${L.viewBox}"`);
  }
  // showcase.js 的荷官大特寫：跟著目前的造型
  const portrait = mood => svg(mood, LOOKS[look].crop);

  function loadTexture(mood, name) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        resolve(tex);
      };
      img.onerror = () => reject(new Error(`荷官表情「${MOODS[mood]}」的圖載不進來`));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(mood, null, name));
    });
  }
  const loadLook = name => Promise.all(Object.keys(MOODS).map(m => loadTexture(m, name).then(t => [m, t]))).then(Object.fromEntries);

  // SVG 座標 → 立牌本地座標（原點在立牌底邊中央）
  function local(sx, sy) {
    return new THREE.Vector3((sx / VB_W - 0.5) * W, (1 - sy / VB_H) * H, 0);
  }

  // project(世界座標) → 螢幕 CSS 像素 {x, y}；onChange() 讓場景重畫
  function create({ bubble, project, onChange }) {
    const geometry = new THREE.PlaneGeometry(W, H);
    geometry.translate(0, H / 2, 0);
    // 不寫深度：前面的牌與籌碼已經先畫好，擋得住；跟桌上其他透明物共用一支著色器
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, visible: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    let textures = {};
    let masks = {};
    let mood = 'idle';
    let hideTimer = null, asideTimer = null, beforeAside = null;
    let switching = false;

    const saved = V.hud.loadPrefs().look;
    look = LOOK_NAMES.includes(saved) ? saved : LOOK_NAMES[0];
    const ready = loadLook(look)
      .then(set => {
        textures = set;
        material.map = textures[mood];
        material.visible = true;
        material.needsUpdate = true;
        onChange();
      });

    // 新的五張全載好才換，換完放掉舊的：貼圖一直只有一套，點再多次記憶體也不會疊上去
    function nextLook() {
      if (switching) return Promise.resolve(false);
      switching = true;
      const name = LOOK_NAMES[(LOOK_NAMES.indexOf(look) + 1) % LOOK_NAMES.length];
      return loadLook(name).then(set => {
        Object.values(textures).forEach(t => t.dispose());
        textures = set;
        masks = {};
        look = name;
        material.map = textures[mood];
        V.hud.savePref('look', name);
        aside(LOOKS[name].line);
        onChange();
        return true;
      }).catch(e => {
        console.warn(e.message);
        return false;
      }).finally(() => { switching = false; });
    }

    // uv 落在人身上，還是立牌透明的地方（透明度從貼圖縮成的小遮罩讀）
    function opaque(uv) {
      if (!textures[mood]) return false;
      const w = 140, h = 130, x = Math.floor(uv.x * w), y = Math.floor((1 - uv.y) * h);
      try {
        if (!masks[mood]) {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(textures[mood].image, 0, 0, w, h);
          masks[mood] = ctx.getImageData(0, 0, w, h).data;
        }
        return masks[mood][(y * w + x) * 4 + 3] > 40;
      } catch (e) {
        return true;   // 有些瀏覽器不准讀 SVG 畫出來的圖：寧可點透明處也換，不要點到人沒反應
      }
    }

    function setMood(next) {
      if (!MOODS[next]) throw new Error(`沒有這種表情：${next}`);
      mood = next;
      if (textures[next]) {
        material.map = textures[next];
        onChange();
      }
    }

    function toScreen(sx, sy) {
      mesh.updateMatrixWorld();
      return project(mesh.localToWorld(local(sx, sy)));
    }

    function faceRect() {
      const { cx, cy, rx, ry } = LOOKS[look].head;
      const corners = [
        toScreen(cx - rx, cy - ry - 20), toScreen(cx + rx, cy - ry - 20),
        toScreen(cx - rx, cy + ry), toScreen(cx + rx, cy + ry),
      ];
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // 頭的右邊放得下就放右邊；放不下（直式手機）就放頭頂正上方，免得被夾回來蓋住臉
    function placeBubble() {
      if (bubble.hidden) return;
      const face = faceRect();
      const w = bubble.offsetWidth, h = bubble.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 10;
      let left, top;
      if (face.right + gap + w <= vw - 8) {
        left = face.right + gap;
        top = face.top + (face.bottom - face.top) * 0.15 - h / 2;
        bubble.dataset.side = 'right';
      } else {
        left = (face.left + face.right) / 2 - w / 2;
        top = face.top - gap - h;
        bubble.dataset.side = 'top';
      }
      bubble.style.left = `${clamp(left, 8, vw - w - 8)}px`;
      bubble.style.top = `${clamp(top, 8, vh - h - 8)}px`;
    }

    function show(text) {
      bubble.textContent = text;
      bubble.hidden = false;
      placeBubble();
    }

    function say(text, ms) {
      clearTimeout(hideTimer);
      clearTimeout(asideTimer);
      asideTimer = null;
      show(text);
      if (ms) hideTimer = setTimeout(hush, ms);
    }

    function hush() {
      clearTimeout(hideTimer);
      clearTimeout(asideTimer);
      asideTimer = null;
      bubble.hidden = true;
    }

    // 插一句話，講完放回原本那句：輪到你時的提示不能被換造型蓋掉。中途牌局往下走（say）就不放回去
    function aside(text) {
      if (!asideTimer) beforeAside = bubble.hidden ? null : bubble.textContent;
      clearTimeout(asideTimer);
      show(text);
      asideTimer = setTimeout(() => {
        asideTimer = null;
        if (beforeAside === null) bubble.hidden = true;
        else show(beforeAside);
      }, ASIDE_MS);
    }

    return {
      mesh, ready, setMood, say, hush, placeBubble, faceRect, nextLook, opaque,
      get look() { return look; },
      get mood() { return mood; },
      get loaded() { return Object.keys(textures).length; },
    };
  }

  // 讓立牌朝向鏡頭：繞底邊往後仰，仰角跟鏡頭的俯角一樣
  function face(mesh, elevation) {
    mesh.rotation.set(-elevation, 0, 0);
  }

  V.dealer = { MOODS, W, H, ASIDE_MS, create, face, svg, portrait };
})();
