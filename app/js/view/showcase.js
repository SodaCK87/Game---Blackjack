// 大特效：你拿 Blackjack、荷官翻出 Blackjack、你按加倍時蓋滿整個畫面播的那一段（研究 session 做原型，使用者 2026-10-23 看過定案）。
// 導演照事件 await 它。時間一律除以 anim.speed：探針用 40 倍速連打時才不會疊在一起、整套也不會變慢。
// 播完把元素、body 上的震動 class 與時間變數收乾淨才 resolve，探針靠 .bigfx 的數量判斷有沒有收。
(function () {
  const V = window.BJK.view;
  const A = V.anim;
  const SHOW_MS = 2000, DOUBLE_MS = 2400;
  // 加倍：彈出、落桌、停下的時間點（佔全長的比例）。CSS 與 Web Animations 都照這三個數排，所以 CSS 寫在這支裡
  const LAUNCH = 0.28, LAND = 0.5, STOP = 0.8;
  const at = (x, d = 0) => `${Math.round(x * 100 + d)}%`;
  const PRESETS = {
    player: { mood: 'surprised', title: 'BLACKJACK!', sub: '賠 1.5 倍！', theme: 'gold' },
    dealer: { mood: 'smile', title: 'BLACKJACK', sub: '莊家通殺！', theme: 'red' },
  };

  // 荷官的臉直接拿 dealer.js 畫立牌的那張 SVG，只裁到頭肩，表情跟桌上一模一樣。
  // 直接嵌進頁面、不轉成圖檔：探針才量得到五官（g.face）實際畫在畫面哪裡
  const faceSvg = mood => V.dealer.portrait(mood);

  // 尺寸多夾一個 vh：橫拿的手機（844×390）照原型的大小，副標會掉出畫面底下。桌機 1280×720 與直式 390×844 算出來跟原型一樣
  const FACE = 'min(58vmin, 380px, 53vh)', TITLE = 'clamp(52px, min(14vw, 21vh), 150px)', TITLE2 = 'clamp(56px, min(15vw, 21vh), 150px)';
  const css = `
  .bigfx, .bigfx-warm { position: fixed; inset: 0; z-index: 50; overflow: hidden; pointer-events: none;
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif;
    --ray: rgba(224, 184, 58, 0.5); --frame: #e0b83a; --glow: rgba(224, 184, 58, 0.75);
    animation: bigfx-fade var(--bigfx-d) linear forwards; }
  /* 預演（rehearse）的外框：幾乎透明。透明度 0 時瀏覽器不作畫，預演就沒有用 */
  .bigfx-warm { opacity: 0.004 !important; }
  :is(.bigfx, .bigfx-warm).red { --ray: rgba(179, 38, 30, 0.6); --frame: #b3261e; --glow: rgba(179, 38, 30, 0.85); }
  :is(.bigfx, .bigfx-warm).teal { --ray: rgba(0, 128, 128, 0.55); --frame: #008080; --glow: rgba(0, 170, 170, 0.7); }
  :is(.bigfx, .bigfx-warm) svg { display: block; }
  .bigfx-dim { position: absolute; inset: 0; background: radial-gradient(circle at 50% 40%, rgba(33, 44, 49, 0.35), rgba(12, 16, 18, 0.92) 70%); }
  /* 加倍這一幕自己畫了牌桌，底下真的牌桌（另一個荷官、對白泡泡）幾乎全遮掉，免得畫面上出現兩個荷官 */
  :is(.bigfx, .bigfx-warm).teal .bigfx-dim { background: radial-gradient(circle at 50% 40%, rgba(24, 33, 38, 0.94), rgba(12, 16, 18, 0.98) 70%); }
  .bigfx-rays { position: absolute; left: 50%; top: 40%; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax;
    background: repeating-conic-gradient(from 0deg, var(--ray) 0deg 6deg, transparent 6deg 15deg);
    -webkit-mask-image: radial-gradient(circle, #000 8%, transparent 45%); mask-image: radial-gradient(circle, #000 8%, transparent 45%);
    animation: bigfx-spin var(--bigfx-d) linear forwards; }
  .bigfx-chips { position: absolute; inset: 0; }
  .bigfx-chip { position: absolute; left: 0; top: 0; width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
    border-radius: 50%; box-shadow: 0 3px 0 #161c1f, 0 6px 10px rgba(0, 0, 0, 0.5); will-change: transform, opacity; }
  .bigfx-flash { position: absolute; inset: 0; background: #fff; animation: bigfx-flash var(--bigfx-d) ease-out forwards; }
  .bigfx-face { position: absolute; left: 50%; top: 40%; width: ${FACE}; aspect-ratio: 1; transform: translate(-50%, -50%);
    border-radius: 50%; overflow: hidden; background: #212c31;
    border: 8px solid var(--frame); box-shadow: 0 0 0 4px #161c1f, 0 0 60px 18px var(--glow);
    animation: bigfx-face var(--bigfx-d) cubic-bezier(.2, .9, .3, 1.2) forwards; }
  /* 大標壓在大頭框的下緣，但不碰到嘴：荷官笑開的下唇離框底只有約 0.4 個字高，大標又斜 3 度、右半邊比較高 */
  .bigfx-title { position: absolute; left: 0; right: 0; top: calc(40% + ${FACE} / 2 - 0.25em); text-align: center;
    font: 900 ${TITLE} / 1 Impact, "Arial Black", sans-serif; letter-spacing: 0.02em; color: #e0b83a;
    -webkit-text-stroke: 3px #161c1f; text-shadow: 0 6px 0 #6b4f10, 0 0 30px var(--glow);
    animation: bigfx-title var(--bigfx-d) ease-out forwards; }
  .bigfx-sub { position: absolute; left: 0; right: 0; top: calc(40% + ${FACE} / 2 + 0.85 * ${TITLE});
    text-align: center; color: #f7f4ec; font-size: clamp(22px, min(5.5vw, 8vh), 44px); font-weight: bold;
    text-shadow: 0 3px 0 #161c1f, 0 0 16px var(--glow); animation: bigfx-sub var(--bigfx-d) ease-out forwards; }
  body.bigfx-shake #table, body.bigfx-shake #overlay { animation: bigfx-shake var(--bigfx-d) linear; }

  .bigfx-stage { position: absolute; inset: 0; animation: bigfx-zoom var(--bigfx-d) cubic-bezier(.5, 0, .2, 1) forwards; }
  /* 桌面畫成 SVG：用 CSS 圓角＋邊框的話，手機上鏡頭推近時 Chrome 會畫出一大塊米色色帶（2026-10-23 截圖看到） */
  .bigfx-felt { position: absolute; left: -15%; right: -15%; top: 46%; bottom: -30%; width: 130%; height: 84%;
    filter: drop-shadow(0 -6px 20px rgba(0, 0, 0, 0.6)); animation: bigfx-felt var(--bigfx-d) ease-out forwards; }
  .bigfx-mini { position: absolute; left: 4vw; top: 11vh; width: min(24vmin, 170px); aspect-ratio: 1; border-radius: 50%; overflow: hidden;
    background: #212c31; border: 6px solid var(--frame); box-shadow: 0 0 0 3px #161c1f, 0 0 30px 8px var(--glow);
    animation: bigfx-mini var(--bigfx-d) cubic-bezier(.2, .9, .3, 1.3) forwards; }
  .bigfx-say { position: absolute; left: calc(4vw + min(24vmin, 170px) + 8px); top: calc(11vh + 4px); padding: 6px 12px; border-radius: 12px;
    background: #f7f4ec; color: #212c31; border: 3px solid #161c1f; font-size: clamp(16px, 4vw, 26px); font-weight: bold;
    animation: bigfx-say var(--bigfx-d) ease-out forwards; }
  .bigfx-hand { position: absolute; right: -2vmin; bottom: -4vmin; width: min(58vmin, 440px); aspect-ratio: 1; transform-origin: 75% 75%;
    animation: bigfx-hand var(--bigfx-d) ease-in-out forwards; }
  .bigfx-pose-loaded { animation: bigfx-pose-a var(--bigfx-d) step-end forwards; }
  .bigfx-pose-flicked { animation: bigfx-pose-b var(--bigfx-d) step-end forwards; }
  /* 厚度用外層的 drop-shadow 畫：放在內層會跟著籌碼一起轉，厚度就跑到側面去 */
  .bigfx-coin { position: absolute; left: 0; top: 0; width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
    perspective: calc(var(--s) * 8); filter: drop-shadow(0 4px 0 #161c1f); }
  .bigfx-coin img { width: 100%; height: 100%; display: block; }
  .bigfx-shadow { position: absolute; width: var(--s); height: calc(var(--s) * 0.3); margin: calc(var(--s) * 0.18) 0 0 calc(var(--s) / -2);
    border-radius: 50%; background: rgba(0, 0, 0, 0.45); filter: blur(3px); animation: bigfx-shadow var(--bigfx-d) linear forwards; }
  .bigfx-title2 { position: absolute; left: 0; right: 0; top: 13%; text-align: center; color: #e0b83a;
    font: 900 ${TITLE2} / 1 "Microsoft JhengHei", "Noto Sans TC", sans-serif; -webkit-text-stroke: 3px #161c1f;
    text-shadow: 0 6px 0 #6b4f10, 0 0 30px var(--glow); animation: bigfx-title2 var(--bigfx-d) ease-out forwards; }
  .bigfx-sub2 { position: absolute; left: 0; right: 0; top: calc(13% + ${TITLE2} + 10px); text-align: center; color: #f7f4ec;
    font-size: clamp(20px, min(5vw, 7vh), 40px); font-weight: bold; text-shadow: 0 3px 0 #161c1f, 0 0 16px var(--glow); animation: bigfx-sub2 var(--bigfx-d) ease-out forwards; }
  body.bigfx-clack #table, body.bigfx-clack #overlay { animation: bigfx-clack var(--bigfx-d) linear; }

  @keyframes bigfx-fade { 0%, 86% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes bigfx-flash { 0% { opacity: 0.9; } 8% { opacity: 0; } 100% { opacity: 0; } }
  @keyframes bigfx-spin { 0% { opacity: 0; transform: rotate(0) scale(0.6); } 10% { opacity: 1; transform: rotate(6deg) scale(1); } 100% { opacity: 1; transform: rotate(40deg) scale(1.1); } }
  /* 最後推近時以嘴的高度為準往上長（-66%），臉才不會長到大標底下 */
  @keyframes bigfx-face {
    0% { transform: translate(-50%, -50%) scale(0.15) rotate(-20deg); }
    16% { transform: translate(-50%, -50%) scale(1.12) rotate(4deg); }
    24% { transform: translate(-50%, -50%) scale(1) rotate(0); }
    80% { transform: translate(-50%, -50%) scale(1.04) rotate(0); }
    100% { transform: translate(-50%, -66%) scale(1.5) rotate(0); } }
  @keyframes bigfx-title {
    0%, 20% { opacity: 0; transform: scale(3.5) rotate(-6deg); }
    30% { opacity: 1; transform: scale(0.92) rotate(-3deg); }
    33% { transform: translate(-6px, 4px) scale(1) rotate(-3deg); }
    36% { transform: translate(6px, -4px) scale(1) rotate(-3deg); }
    39%, 100% { opacity: 1; transform: scale(1) rotate(-3deg); } }
  @keyframes bigfx-sub { 0%, 38% { opacity: 0; transform: translateY(24px); } 48%, 100% { opacity: 1; transform: none; } }
  @keyframes bigfx-shake {
    0%, 28% { transform: none; } 30% { transform: translate(-10px, 6px); } 32% { transform: translate(9px, -7px); }
    34% { transform: translate(-7px, -5px); } 36% { transform: translate(6px, 5px); } 38% { transform: translate(-3px, 2px); } 40%, 100% { transform: none; } }

  @keyframes bigfx-zoom { 0%, 48% { transform: scale(1); } 60% { transform: scale(2.3); } 100% { transform: scale(2.45); } }
  @keyframes bigfx-felt { 0% { transform: translateY(40%); } 10%, 100% { transform: none; } }
  @keyframes bigfx-mini { 0%, 3% { transform: scale(0) rotate(-30deg); } 12% { transform: scale(1.15) rotate(6deg); } 18%, 100% { transform: none; } }
  @keyframes bigfx-say { 0%, 14% { opacity: 0; transform: scale(0.5); } 20%, 100% { opacity: 1; transform: none; } }
  @keyframes bigfx-hand {
    0% { transform: translate(60%, 60%) rotate(20deg); }
    10% { transform: translate(0, 0) rotate(0); }
    ${at(LAUNCH, -3)} { transform: rotate(9deg); }
    ${at(LAUNCH, 1)} { transform: rotate(-13deg); }
    ${at(LAUNCH, 8)}, 100% { transform: rotate(-4deg); } }
  @keyframes bigfx-pose-a { 0% { opacity: 1; } ${at(LAUNCH)}, 100% { opacity: 0; } }
  @keyframes bigfx-pose-b { 0% { opacity: 0; } ${at(LAUNCH)}, 100% { opacity: 1; } }
  @keyframes bigfx-shadow { 0%, ${at(LAND)} { opacity: 0; } ${at(LAND, 2)}, 100% { opacity: 1; } }
  @keyframes bigfx-title2 { 0%, 56% { opacity: 0; transform: scale(3) rotate(4deg); } 63% { opacity: 1; transform: scale(0.94) rotate(-2deg); }
    66% { transform: translate(-5px, 3px) rotate(-2deg); } 69% { transform: translate(5px, -3px) rotate(-2deg); } 72%, 100% { opacity: 1; transform: rotate(-2deg); } }
  @keyframes bigfx-sub2 { 0%, 66% { opacity: 0; transform: translateY(20px); } 74%, 100% { opacity: 1; transform: none; } }
  @keyframes bigfx-clack { 0%, ${at(LAND)} { transform: none; } ${at(LAND, 1)} { transform: translateY(6px); }
    ${at(LAND, 3)} { transform: translateY(-3px); } ${at(LAND, 5)}, 100% { transform: none; } }`;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  // 籌碼的圖直接拿桌上籌碼的頂面貼圖（textures.js 用 canvas 畫的），面額顏色跟桌上一樣
  const chipUrls = {};
  function chipUrl(value) {
    if (!chipUrls[value]) chipUrls[value] = V.textures.chipTop(value).image.toDataURL();
    return chipUrls[value];
  }

  // 置中的是排版寬度，不是看得到的字：全形「！」字形偏左、右半邊是空白，整行就往左偏（原型量到最多 28 px）。
  // 用同一個字型量墨水範圍，把元素左右挪回去，讓大標與副標看得到的字對在同一條中線上
  const inkCtx = document.createElement('canvas').getContext('2d');
  function centerInk(el) {
    const cs = getComputedStyle(el);
    inkCtx.font = cs.font;
    inkCtx.letterSpacing = cs.letterSpacing;
    const m = inkCtx.measureText(el.textContent);
    const off = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 - m.width / 2;
    el.style.left = `${-off}px`;
    el.style.right = `${off}px`;
  }

  // 兩波籌碼從荷官大頭後面往外噴：先往上、往兩側飛，再被重力拉下來掉出畫面，一邊轉一邊翻面。
  // 軌跡照沒加速的秒數算（乘回 anim.speed），加速時只是播得快，形狀不變
  const WAVES = [{ at: 0.16, count: 26 }, { at: 0.34, count: 14 }];
  function spray(box, ms) {
    const rng = V.rng(Date.now() & 0xffff);
    const W = innerWidth, H = innerHeight, unit = Math.min(W, H);
    const cx = W / 2, cy = H * 0.4;
    const values = Object.keys(V.CHIP_COLORS).map(Number);
    for (const wave of WAVES) {
      for (let i = 0; i < wave.count; i++) {
        const img = document.createElement('img');
        img.className = 'bigfx-chip';
        img.alt = '';
        img.src = chipUrl(values[Math.floor(rng() * values.length)]);
        img.style.setProperty('--s', `${Math.round(unit * (0.07 + rng() * 0.05))}px`);
        img.style.opacity = '0';
        box.appendChild(img);
        // 角度集中在上半圈（-170°～-10°），少數往斜下噴；橫向跟畫面寬、縱向跟畫面高成比例，
        // 直式手機才不會全部從兩側飛出去、上下空著
        const a = (rng() < 0.85 ? -170 + rng() * 160 : 10 + rng() * 160) * Math.PI / 180;
        const v = 1.1 + rng() * 0.9, g = 2.6, sx = W * 0.45, sy = H * 0.75;
        // 晚出發的那一點（jitter）從壽命扣掉，最後一片也在特效結束前落幕
        const jitter = rng() * 0.04;
        const life = Math.min(1 - wave.at - jitter, 0.55 + rng() * 0.25) * ms;
        const spin = (rng() < 0.5 ? -1 : 1) * (360 + rng() * 540), flips = 1 + rng() * 2.5;
        // 翻面用 scaleX 的絕對值：籌碼兩面都印面額，翻到背面看到的字照樣是正的（直接用 cos 會把字左右翻過來）。
        // 壓扁成一條線的那一刻另外補一格，取樣點剛好跨過去時才看得出翻面
        const ts = Array.from({ length: 13 }, (_, k) => k / 12);
        for (let n = 0; (2 * n + 1) / (4 * flips) < 1; n++) ts.push((2 * n + 1) / (4 * flips));
        const frames = ts.sort((p, q) => p - q).map(t => {
          const sec = t * life / 1000 * A.speed;
          const x = cx + Math.cos(a) * v * sec * sx, y = cy + (Math.sin(a) * v * sec + 0.5 * g * sec * sec) * sy;
          return {
            offset: t,
            transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * t).toFixed(1)}deg) scaleX(${Math.abs(Math.cos(t * flips * Math.PI * 2)).toFixed(3)}) scale(${(0.4 + Math.min(t * 4, 1) * 0.6).toFixed(3)})`,
            opacity: t < 0.05 ? t * 20 : t > 0.85 ? (1 - t) / 0.15 : 1,
          };
        });
        img.animate(frames, { duration: life, delay: (wave.at + jitter) * ms, easing: 'linear', fill: 'both' });
      }
    }
  }

  // ---- 加倍 ----
  // 手照荷官的畫風：粗黑描邊、單一硬陰影；袖口用青色，跟荷官的白襯衫分得出是「你」的手。
  // 兩個姿勢疊在一起：loaded 食指扣在拇指後面蓄力，flicked 食指彈出去，CSS 在彈的那一刻切換
  const C = { ink: '#161c1f', skin: '#e2ad86', shade: '#b9835f', teal: '#008080', cream: '#f4efe6' };
  const path = (d, fill) => `<path d="${d}" fill="${fill}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round"/>`;
  const finger = d => `<path d="${d}" stroke="${C.ink}" stroke-width="34" fill="none" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="${C.skin}" stroke-width="24" fill="none" stroke-linecap="round"/>`;
  const crease = d => `<path d="${d}" stroke="${C.ink}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  const HAND = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 400 400">
    ${path('M400 330 L318 268 L262 345 L330 400 L400 400 Z', C.teal)}
    ${path('M318 268 L298 252 L242 330 L262 345 Z', C.cream)}
    <g class="bigfx-pose-flicked">${finger('M176 190 Q146 150 116 114')}</g>
    ${path('M300 255 Q305 205 260 185 L205 168 Q165 160 150 195 L140 235 Q140 280 185 300 L245 325 Q290 300 300 255 Z', C.skin)}
    <path d="M300 255 Q305 205 260 185 L252 200 Q282 216 278 262 Q268 296 240 312 L245 325 Q290 300 300 255 Z" fill="${C.shade}"/>
    ${crease('M166 212 Q150 236 160 262')}${crease('M186 226 Q170 252 182 280')}${crease('M210 238 Q196 264 208 292')}
    <g class="bigfx-pose-loaded">${finger('M178 196 Q138 186 146 156 Q152 140 168 146')}</g>
    ${path('M222 176 Q206 140 176 132 Q160 130 158 146 Q172 156 190 182 Z', C.skin)}
  </svg>`;
  // 彈出去那一刻食指指尖在手的 SVG 裡的位置，換算成螢幕座標當籌碼的起點
  const TIP = { x: 116 / 400, y: 114 / 400 };
  const FELT = `<svg class="bigfx-felt" viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs><radialGradient id="bigfx-felt-g" cx="50%" cy="15%" r="80%"><stop offset="0" stop-color="#12855f"/><stop offset="0.45" stop-color="#0b6e4f"/><stop offset="1" stop-color="#074a35"/></radialGradient></defs>
    <path d="M0 22 Q50 -8 100 22 L100 100 L0 100 Z" fill="url(#bigfx-felt-g)"/>
    <path d="M0 22 Q50 -8 100 22" fill="none" stroke="#e8d9a8" stroke-width="5" vector-effect="non-scaling-stroke"/></svg>`;
  const DOUBLE_HTML = '<div class="bigfx-dim"></div><div class="bigfx-rays"></div>' +
    `<div class="bigfx-stage">${FELT}<div class="bigfx-mini">${faceSvg('surprised')}</div><div class="bigfx-say">加倍？！</div>` +
    `<div class="bigfx-hand">${HAND}</div></div>` +
    '<div class="bigfx-flash"></div><div class="bigfx-title2 bigfx-ink">加倍！</div><div class="bigfx-sub2 bigfx-ink">押兩倍・只再發一張</div>';

  // 這一注最大的面額當彈出去的那片籌碼
  const topChip = amount => V.chips.DENOMS.find(v => v <= amount) || V.chips.DENOMS[V.chips.DENOMS.length - 1];
  const lerp = (a, b, t) => a + (b - a) * t;

  // 一片籌碼：外層沿拋物線飛到落點；內層用 CSS 3D 轉，看起來是真的躺在斜看的桌面上
  function flick(stage, ms, amount) {
    const W = innerWidth, H = innerHeight, unit = Math.min(W, H);
    // 手這時還在滑進來的動畫起點，getBoundingClientRect 會量到變形後的位置；offset 量的是沒變形的版面位置
    const hand = stage.querySelector('.bigfx-hand');
    const from = { x: hand.offsetLeft + TIP.x * hand.offsetWidth, y: hand.offsetTop + TIP.y * hand.offsetHeight };
    const to = { x: W * 0.42, y: H * 0.62 };
    stage.style.transformOrigin = `${to.x}px ${to.y}px`;
    const size = `${Math.round(Math.min(unit * 0.11, 80))}px`;
    const coin = document.createElement('div');
    coin.className = 'bigfx-coin';
    coin.style.setProperty('--s', size);
    coin.innerHTML = `<img alt="" src="${chipUrl(topChip(amount))}">`;
    const shadow = document.createElement('div');
    shadow.className = 'bigfx-shadow';
    shadow.style.cssText = `--s:${size};left:${to.x}px;top:${to.y}px`;
    stage.appendChild(shadow);
    stage.appendChild(coin);

    const flight = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const x = lerp(from.x, to.x, t), y = lerp(from.y, to.y, t) - Math.sin(Math.PI * t) * H * 0.28;
      flight.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${lerp(1.3, 1, t).toFixed(3)})`, opacity: t < 0.04 ? 0 : 1 });
    }
    coin.animate(flight, { duration: (LAND - LAUNCH) * ms, delay: LAUNCH * ms, fill: 'both', easing: 'linear' });

    // 每一格都是同一串函式，Web Animations 才會逐項內插、不會改走矩陣內插轉錯方向（改別的寫法會出現直立的橢圓）：
    //   rotateX(TABLE) 桌面斜著看（平躺的籌碼是橫的橢圓）
    //   rotateZ(φ) rotateX(α) rotateZ(ψ) 在桌面座標裡：α 是籌碼面離開桌面的傾角，φ 是傾斜方向繞著轉（搖晃），φ＋ψ 是面額字轉到哪
    // 飛行：α 一路往前翻（只繞水平軸翻），落桌時剛好剩 25° 的傾角；
    // 落桌後：傾角從 25° 收到 0，傾斜方向越繞越快（像硬幣快倒下時嗡嗡轉），面額字慢慢轉一圈停在正的
    const TABLE = 60, TILT = 25;
    const frame = (phi, alpha, psi) => ({ transform: `rotateX(${TABLE}deg) rotateZ(${phi.toFixed(1)}deg) rotateX(${alpha.toFixed(1)}deg) rotateZ(${psi.toFixed(1)}deg)` });
    const spin = [], N = 90, span = STOP - LAUNCH, landAt = (LAND - LAUNCH) / span;
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      if (u <= landAt) {
        spin.push(frame(0, (720 + TILT) * (u / landAt), 0));
      } else {
        const p = (u - landAt) / (1 - landAt);
        const phi = 360 * 4 * Math.pow(p, 1.8), face = 360 * (1 - Math.pow(1 - p, 2));
        spin.push(frame(phi, TILT * Math.pow(1 - p, 1.5), face - phi));
      }
    }
    coin.firstChild.animate(spin, { duration: span * ms, delay: LAUNCH * ms, fill: 'both', easing: 'linear' });
  }

  // 共用的開場與收尾。時間放在 body 的 --bigfx-d（底下牌桌的震動也讀它）；speed = Infinity 時直接完成
  async function play(total, kind, theme, html, start) {
    const ms = total / A.speed;
    if (!(ms > 0)) return;
    const body = document.body;
    const el = document.createElement('div');
    el.className = `bigfx ${theme}`;
    el.dataset.kind = kind;
    el.innerHTML = html;
    body.style.setProperty('--bigfx-d', `${ms}ms`);
    body.appendChild(el);
    try {
      el.querySelectorAll('.bigfx-ink').forEach(centerInk);
      start(el, ms);
      body.classList.add(kind === 'double' ? 'bigfx-clack' : 'bigfx-shake');
      await A.wait(total);
    } finally {
      el.remove();
      body.classList.remove('bigfx-shake', 'bigfx-clack');
      body.style.removeProperty('--bigfx-d');
    }
  }

  const showHtml = p => '<div class="bigfx-dim"></div><div class="bigfx-rays"></div><div class="bigfx-chips"></div><div class="bigfx-flash"></div>' +
    `<div class="bigfx-face">${faceSvg(p.mood)}</div><div class="bigfx-title bigfx-ink">${p.title}</div><div class="bigfx-sub bigfx-ink">${p.sub}</div>`;

  // kind：'player' 你拿 Blackjack（荷官驚訝臉、金色），'dealer' 荷官翻出 Blackjack（荷官得意的笑臉、紅色）。
  // 閃白 → 放射光芒 → 荷官大頭彈出 → 兩波籌碼從大頭後面噴出 → 大標砸下來、牌桌震一下 → 副標 → 淡出
  function showcase(kind) {
    const p = PRESETS[kind];
    return play(SHOW_MS, kind, p.theme, showHtml(p), (el, ms) => spray(el.querySelector('.bigfx-chips'), ms));
  }

  // 你按加倍：左上角荷官挑眉，右下角你的手把這一注最大的那片籌碼彈上桌，鏡頭推近看它斜躺著嗡嗡搖晃、停下。
  // amount 是加倍多押的那一份
  function doubleDown(amount) {
    return play(DOUBLE_MS, 'double', 'teal', DOUBLE_HTML, (el, ms) => flick(el.querySelector('.bigfx-stage'), ms, amount));
  }

  // 預演：開頁閒下來時，你拿 Blackjack 與加倍兩段用幾乎透明的外框各快播一次。每段第一次作畫都要先建一堆東西
  // （籌碼圖轉成圖檔、放射光芒、濾鏡、大字），2026-10-28 量到開頁後第一次播每段頓 1～3 格、每格 55–230 ms，
  // 第二次就 0 格；預演過的話真的播時 0 格。荷官 Blackjack 跟你拿 Blackjack 用的是同一套，不必另外預演。
  // 外框叫 bigfx-warm 不叫 bigfx（探針與量測都靠 .bigfx 數播了幾段、有沒有收乾淨），時間照真實時間、不跟 anim.speed，
  // 也不算進 anim.busy：探針把 speed 調慢量大字位置時，預演不會跟著拖成好幾秒
  const WARM_MS = 300;
  async function warmUp(theme, html, start) {
    const el = document.createElement('div');
    el.className = `bigfx-warm ${theme}`;
    el.innerHTML = html;
    el.style.setProperty('--bigfx-d', `${WARM_MS}ms`);
    document.body.appendChild(el);
    try {
      el.querySelectorAll('.bigfx-ink').forEach(centerInk);
      start(el, WARM_MS);
      await new Promise(r => setTimeout(r, WARM_MS));
    } finally {
      el.remove();
    }
  }
  async function rehearse() {
    Object.keys(V.CHIP_COLORS).forEach(v => chipUrl(Number(v)));
    await warmUp(PRESETS.player.theme, showHtml(PRESETS.player), el => spray(el.querySelector('.bigfx-chips'), WARM_MS));
    await warmUp('teal', DOUBLE_HTML, el => flick(el.querySelector('.bigfx-stage'), WARM_MS, V.chips.DENOMS[0]));
  }

  Object.assign(V.fx, { showcase, doubleDown, rehearse });
})();
