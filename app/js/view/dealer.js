// 插畫荷官：SVG 畫成平面立牌，站在牌桌直邊後面；五種表情各一張貼圖，換表情就是換貼圖。
// SVG 走 data: URL 轉成 WebGL 貼圖，2026-10-22 實測 file:// 下 Edge／Chrome 都不會被當成跨來源擋掉。
(function () {
  const V = window.BJK.view;
  const MOODS = { idle: '待機', deal: '發牌', surprised: '驚訝', smile: '微笑', sorry: '遺憾' };
  const VB_W = 400, VB_H = 520;          // SVG 座標
  const H = 3.4, W = H * VB_W / VB_H;    // 立牌在場景裡的大小
  // 臉部外框（含頭髮），給對白泡泡避開用
  const HEAD = { cx: 200, cy: 190, rx: 84, ry: 114 };

  // 美式硬派：粗黑描邊、單一硬陰影（光從左上來，陰影落在右側）、方下巴、鬍渣、油頭、眉上一道疤
  const C = {
    ink: '#161c1f', skin: '#e2ad86', shade: '#b9835f', scar: '#f2c9a8', stubble: '#2b2723',
    hair: '#1f1a17', hairHi: '#6b625c', shirt: '#f4efe6', shirtShade: '#cfc7b8',
    vest: '#232b30', vestHi: '#3a464d', garter: '#9b1c14', brass: '#c9a227', teal: '#008080',
    mouth: '#3a1f1a', sweat: '#cfe9ef', eye: '#f6f1e6', iris: '#5a3a24',
    tie: 'url(#bjkTie)', tieHi: '#c2453a',
  };
  // 插畫的明暗：荷官只畫一次就變成貼圖，漸層與細紋再多，每一格也不多花。id 帶專案前綴：showcase.js 會把同一張 SVG 內嵌進頁面
  const DEFS = `<defs>
    <linearGradient id="bjkSkin" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="#f2c8a2"/><stop offset="0.75" stop-color="#e0a980"/></linearGradient>
    <linearGradient id="bjkVest" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#36444d"/><stop offset="1" stop-color="#171d21"/></linearGradient>
    <linearGradient id="bjkShirt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#dcd4c5"/></linearGradient>
    <linearGradient id="bjkHair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#40352e"/><stop offset="0.6" stop-color="#191412"/></linearGradient>
    <linearGradient id="bjkBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e29b"/><stop offset="0.5" stop-color="#c9a227"/><stop offset="1" stop-color="#8f7118"/></linearGradient>
    <linearGradient id="bjkTie" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a22a22"/><stop offset="1" stop-color="#5e120d"/></linearGradient>
    <pattern id="bjkStripe" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(5)"><line x1="1" y1="0" x2="1" y2="9" stroke="#7d8d96" stroke-width="1"/></pattern>
    <pattern id="bjkStubble" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="0.8" fill="#2b2723"/><circle cx="4.5" cy="4.2" r="0.7" fill="#2b2723"/></pattern>
    <radialGradient id="bjkBlush"><stop offset="0" stop-color="#d9674f" stop-opacity="0.13"/><stop offset="1" stop-color="#d9674f" stop-opacity="0"/></radialGradient>
  </defs>`;
  const line = (d, color, width, extra) =>
    `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra || ''}/>`;
  const shape = (d, fill, strokeWidth) =>
    `<path d="${d}" fill="${fill}"${strokeWidth ? ` stroke="${C.ink}" stroke-width="${strokeWidth}" stroke-linejoin="round"` : ''}/>`;

  const BROWS = {
    flat: shape('M146 170 L188 163 L189 173 L149 179 Z M212 163 L254 170 L251 179 L211 173 Z', C.hair),
    low: shape('M146 175 L188 170 L188 179 L148 184 Z M212 170 L254 175 L252 184 L212 179 Z', C.hair),
    cocked: shape('M146 158 Q166 140 189 152 L188 162 Q166 152 148 168 Z M212 163 L254 170 L251 179 L211 173 Z', C.hair),
    knit: shape('M146 177 L186 163 L188 172 L150 185 Z M212 163 L254 177 L250 185 L212 172 Z', C.hair),
  };
  // 疤畫在眉毛之後，把左眉切出一道缺口
  const SCAR = line('M162 154 L171 186', C.scar, 3.5);
  // 眼白、虹膜、一點反光：瞳孔不再是貼在皮膚上的黑點
  const WHITES = (l, r) => shape(`M157 ${l} Q171 ${l - 6} 185 ${l - 1} Q171 ${l + 8} 157 ${l} Z M215 ${r - 1} Q229 ${r - 6} 243 ${r} Q229 ${r + 8} 215 ${r - 1} Z`, C.eye);
  const IRIS = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r + 1.5}" fill="${C.iris}"/><circle cx="${x}" cy="${y}" r="${r - 1}" fill="${C.ink}"/><circle cx="${x - 1.6}" cy="${y - 1.8}" r="1.2" fill="#fff"/>`;
  const EYES = {
    hard: WHITES(191, 191) + line('M154 190 Q170 182 186 188 M214 188 Q230 182 246 190', C.ink, 5) +
      IRIS(172, 192, 4.5) + IRIS(230, 192, 4.5) +
      line('M160 198 L182 197 M218 197 L240 198 M150 201 L144 204 M250 201 L256 204', C.shade, 2),
    down: WHITES(195, 195) + line('M154 192 Q170 188 186 192 M214 192 Q230 188 246 192', C.ink, 5) +
      IRIS(174, 197, 4) + IRIS(232, 197, 4),
    wide: `<ellipse cx="171" cy="190" rx="13" ry="9" fill="${C.shirt}" stroke="${C.ink}" stroke-width="3"/>
      <ellipse cx="229" cy="190" rx="13" ry="9" fill="${C.shirt}" stroke="${C.ink}" stroke-width="3"/>
      ${IRIS(171, 190, 5)}${IRIS(229, 190, 5)}`,
    squint: line('M154 190 Q170 184 186 190 M214 190 Q230 184 246 190', C.ink, 5) +
      line('M158 196 Q170 200 182 196 M218 196 Q230 200 242 196', C.ink, 3) +
      IRIS(172, 193, 3.5) + IRIS(230, 193, 3.5) +
      line('M150 186 L143 181 M150 193 L142 193 M250 186 L257 181 M250 193 L258 193', C.shade, 2),
    aside: WHITES(194, 194) + line('M154 192 Q170 186 186 191 M214 191 Q230 186 246 192', C.ink, 5) +
      IRIS(164, 195, 4) + IRIS(222, 195, 4),
  };

  const FACES = {
    // 待機：面無表情、嘴角一邊微微上勾
    idle: BROWS.flat + SCAR + EYES.hard +
      line('M178 258 L212 257 Q222 255 228 248', C.ink, 4.5) + line('M188 267 L214 267', C.shade, 3),
    // 發牌：眼睛往下盯著牌，嘴抿成一直線
    deal: BROWS.low + SCAR + EYES.down + line('M182 259 L220 259', C.ink, 4.5),
    // 驚訝：單邊挑眉、眼睛睜大、嘴微張，額頭擠出兩條紋
    surprised: BROWS.cocked + SCAR + EYES.wide +
      line('M168 136 Q190 130 212 136 M172 146 Q190 141 208 146', C.shade, 2.5) +
      `<ellipse cx="203" cy="261" rx="9" ry="7" fill="${C.mouth}" stroke="${C.ink}" stroke-width="3"/>`,
    // 微笑：露齒的自信咧嘴笑，眼角擠出魚尾紋
    smile: BROWS.flat + SCAR + EYES.squint +
      shape('M174 250 Q200 264 230 246 Q226 270 202 273 Q182 271 174 250 Z', C.shirt, 4) +
      line('M180 257 Q202 265 226 253', C.shirtShade, 2) +
      line('M166 244 Q162 256 168 268 M238 240 Q244 254 238 266', C.shade, 3),
    // 遺憾：眉頭揪緊、眼神別開、嘴角一邊往下撇，額角一滴汗
    sorry: BROWS.knit + SCAR + EYES.aside +
      line('M196 160 L198 175 M204 160 L202 175', C.shade, 2) +
      line('M178 262 Q192 254 206 260 Q216 265 226 259', C.ink, 4.5) +
      shape('M262 128 Q271 143 262 150 Q253 143 262 128 Z', C.sweat, 2),
  };

  // 發牌時右手（畫面右側）伸出來捏著一張牌；袖子先畫一道粗黑再疊白，就是描邊
  const ARM = 'M282 362 Q312 372 330 398';
  const FOREARM = 'M330 398 L344 414';
  const DEAL_ARM = line(ARM, C.ink, 44) + line(ARM, C.shirt, 36) + line('M304 372 L318 392', C.garter, 9) +
    line(FOREARM, C.ink, 30) + line(FOREARM, C.skin, 23) +
    `<g transform="rotate(14 358 383)"><rect x="336" y="352" width="44" height="62" rx="5" fill="${C.teal}" stroke="${C.ink}" stroke-width="3"/>
      <rect x="341" y="357" width="34" height="52" rx="3" fill="none" stroke="${C.shirt}" stroke-width="2"/></g>
    <circle cx="346" cy="414" r="11" fill="${C.skin}" stroke="${C.ink}" stroke-width="3"/>`;

  // 右袖（畫面右側）垂著的那一段：發牌時這隻手舉起來了，不能再畫，不然會多出一隻手
  const TORSO = 'M70 520 L76 404 Q82 356 132 342 L172 332 L228 332 L268 342 Q318 356 324 404 L330 520 Z';
  const TORSO_ARM_UP = 'M70 520 L76 404 Q82 356 132 342 L172 332 L228 332 L268 342 Q298 350 302 382 L306 520 Z';
  const RIGHT_SLEEVE = shape('M268 342 Q318 356 324 404 L330 520 L292 520 L288 400 Q284 370 262 350 Z', C.shirtShade) +
    shape('M324 430 L288 436 L290 452 L325 446 Z', C.garter, 3) + line('M288 380 Q296 450 292 520', C.ink, 4);

  const VEST = 'M112 372 Q118 348 150 342 L200 452 L250 342 Q282 348 288 372 L296 520 L104 520 Z';
  const STUBBLE = 'M126 236 Q138 288 172 304 L228 304 Q262 288 274 236 Q256 262 230 266 Q214 272 200 272 Q186 272 170 266 Q144 262 126 236 Z';
  const HEAD_PATH ='M130 118 Q200 66 270 118 L280 196 L272 252 Q258 290 228 304 L172 304 Q142 290 128 252 L120 196 Z';

  // crop 給了就只畫那一塊、大小跟著外框（showcase.js 的荷官大特寫）。五官包在 g.face 裡，探針量它畫在畫面哪裡
  function svg(mood, crop) {
    const size = crop ? `width="100%" height="100%" viewBox="${crop}"` : `width="${VB_W * 2}" height="${VB_H * 2}" viewBox="0 0 ${VB_W} ${VB_H}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" ${size}>
      ${DEFS}
      ${shape('M164 296 L236 296 L242 350 L158 350 Z', C.skin, 5)}
      ${shape('M200 300 L236 300 L240 346 L210 346 Z', C.shade)}
      <path d="M164 300 Q200 330 236 300 L238 318 Q200 342 162 318 Z" fill="${C.shade}" opacity="0.75"/>
      ${shape(mood === 'deal' ? TORSO_ARM_UP : TORSO, 'url(#bjkShirt)', 5)}
      ${mood === 'deal' ? '' : RIGHT_SLEEVE}
      ${line('M96 396 Q90 420 94 428 M84 470 Q92 490 86 516', C.shirtShade, 3)}
      ${shape('M76 430 L112 436 L110 452 L75 446 Z', C.garter, 3)}
      ${line('M80 436 L108 441 M79 444 L107 449', '#c9443a', 1.5, ' opacity="0.7"')}
      ${line('M112 380 Q104 450 108 520', C.ink, 4)}
      ${line('M200 352 L200 452', C.shirtShade, 2)}
      <circle cx="200" cy="392" r="2.6" fill="#fff" stroke="${C.shirtShade}"/><circle cx="200" cy="424" r="2.6" fill="#fff" stroke="${C.shirtShade}"/>
      ${shape(VEST, 'url(#bjkVest)', 5)}
      <path d="${VEST}" fill="url(#bjkStripe)" opacity="0.3"/>
      ${line('M122 382 L150 354 L195 446', C.vestHi, 3)}
      ${line('M278 382 L250 354 L205 446', '#2c363c', 3)}
      ${line('M200 454 L200 520', '#0f1417', 2.5)}
      ${line('M232 444 L276 438', C.vestHi, 3)}
      <path d="M204 474 Q226 502 262 442" fill="none" stroke="url(#bjkBrass)" stroke-width="2" stroke-dasharray="3 2.5"/>
      ${[472, 500].map(y => `<circle cx="200" cy="${y}" r="4.5" fill="url(#bjkBrass)" stroke="${C.ink}" stroke-width="2"/><circle cx="198.6" cy="${y - 1.4}" r="1.2" fill="#fff6d6"/>`).join('')}
      <rect x="236" y="404" width="40" height="14" rx="2" fill="url(#bjkBrass)" stroke="${C.ink}" stroke-width="2"/>
      ${line('M242 409 L268 409 M242 413 L260 413', '#6f5612', 1.5)}
      ${shape('M170 332 L186 356 L200 340 L214 356 L230 332 L214 338 L200 336 L186 338 Z', 'url(#bjkShirt)', 3)}
      ${shape('M200 344 L176 332 L178 358 Z M200 344 L224 332 L222 358 Z', C.tie, 2.5)}
      ${line('M182 339 L194 343 M182 352 L194 346 M218 339 L206 343 M218 352 L206 346', C.tieHi, 1.5, ' opacity="0.8"')}
      <rect x="194" y="338" width="12" height="12" rx="2" fill="${C.tie}" stroke="${C.ink}" stroke-width="2"/>
      ${shape('M124 172 Q100 168 102 200 Q104 232 126 234 Z', 'url(#bjkSkin)', 4)}
      ${line('M112 184 Q106 200 116 218', C.shade, 2.5)}
      ${shape('M276 172 Q300 168 298 200 Q296 232 274 234 Z', C.shade, 4)}
      ${line('M288 184 Q294 200 284 218', '#94643f', 2.5)}
      ${shape(HEAD_PATH, 'url(#bjkSkin)')}
      <ellipse cx="150" cy="232" rx="26" ry="18" fill="url(#bjkBlush)"/><ellipse cx="238" cy="232" rx="22" ry="16" fill="url(#bjkBlush)"/>
      ${shape('M232 108 Q258 112 270 120 L280 196 L272 252 Q258 290 228 304 L218 304 Q248 268 250 204 Q250 150 232 108 Z', C.shade)}
      <path d="M142 176 Q170 164 192 176 L190 200 Q170 208 146 204 Z M208 176 Q230 164 258 176 L254 204 Q230 208 210 200 Z" fill="${C.shade}" opacity="0.32"/>
      <path d="${STUBBLE}" fill="${C.stubble}" opacity="0.14"/>
      <path d="${STUBBLE}" fill="url(#bjkStubble)" opacity="0.5"/>
      ${shape('M201 180 L214 226 L206 230 Z', C.shade)}
      ${line('M198 176 L188 228 Q198 234 210 229', C.ink, 3.5)}
      ${line('M193 192 L190 216', '#ffe6cc', 2.5, ' opacity="0.7"')}
      ${line('M140 222 Q150 238 160 240', C.shade, 3)}
      ${line('M200 286 L200 298', C.shade, 3)}
      ${line('M124 200 L132 250 Q146 284 172 298', '#ffe6cc', 2.5, ' opacity="0.55"')}
      <path d="${HEAD_PATH}" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/>
      ${shape('M120 170 Q108 66 200 54 Q296 62 282 170 Q276 122 254 110 Q230 100 212 116 L200 132 L188 116 Q168 100 146 110 Q124 122 120 170 Z', 'url(#bjkHair)', 4)}
      ${line('M150 110 Q166 78 210 64 M178 112 Q198 80 244 70 M226 108 Q246 84 270 94 M134 136 Q140 104 166 86', C.hairHi, 3, ' opacity="0.85"')}
      ${line('M164 104 Q182 80 224 68 M196 110 Q214 86 256 80 M140 124 Q150 98 182 80', '#8c8279', 1.5, ' opacity="0.55"')}
      ${shape('M120 168 L124 212 L132 212 L130 168 Z M282 168 L278 212 L270 212 L272 168 Z', C.hair)}
      <g class="face">${FACES[mood]}</g>
      ${mood === 'deal' ? DEAL_ARM : ''}
    </svg>`;
  }

  function loadTexture(mood) {
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
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(mood));
    });
  }

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
    const textures = {};
    let mood = 'idle';
    let hideTimer = null;

    const ready = Promise.all(Object.keys(MOODS).map(m => loadTexture(m).then(t => { textures[m] = t; })))
      .then(() => {
        material.map = textures[mood];
        material.visible = true;
        material.needsUpdate = true;
        onChange();
      });

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
      const corners = [
        toScreen(HEAD.cx - HEAD.rx, HEAD.cy - HEAD.ry - 20), toScreen(HEAD.cx + HEAD.rx, HEAD.cy - HEAD.ry - 20),
        toScreen(HEAD.cx - HEAD.rx, HEAD.cy + HEAD.ry), toScreen(HEAD.cx + HEAD.rx, HEAD.cy + HEAD.ry),
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

    function say(text, ms) {
      clearTimeout(hideTimer);
      bubble.textContent = text;
      bubble.hidden = false;
      placeBubble();
      if (ms) hideTimer = setTimeout(hush, ms);
    }

    function hush() {
      clearTimeout(hideTimer);
      bubble.hidden = true;
    }

    return {
      mesh, ready, setMood, say, hush, placeBubble, faceRect,
      get mood() { return mood; },
      get loaded() { return Object.keys(textures).length; },
    };
  }

  // 讓立牌朝向鏡頭：繞底邊往後仰，仰角跟鏡頭的俯角一樣
  function face(mesh, elevation) {
    mesh.rotation.set(-elevation, 0, 0);
  }

  V.dealer = { MOODS, W, H, create, face, svg };
})();
