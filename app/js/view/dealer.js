// 插畫荷官：SVG 畫成平面立牌，站在牌桌直邊後面；五種表情各一張貼圖，換表情就是換貼圖。
// SVG 走 data: URL 轉成 WebGL 貼圖，2026-10-22 實測 file:// 下 Edge／Chrome 都不會被當成跨來源擋掉。
(function () {
  const V = window.BJK.view;
  const MOODS = { idle: '待機', deal: '發牌', surprised: '驚訝', smile: '微笑', sorry: '遺憾' };
  const VB_W = 400, VB_H = 520;          // SVG 座標
  const H = 3.4, W = H * VB_W / VB_H;    // 立牌在場景裡的大小
  const HEAD = { cx: 200, cy: 190, rx: 92, ry: 104 };

  const C = {
    skin: '#f2c9a5', hair: '#3b2a20', ink: '#212c31', lip: '#8a3b2e', shirt: '#f7f4ec',
    vest: '#212c31', teal: '#008080', red: '#b3261e', blush: '#f08a7a', sweat: '#9fd3e0',
  };

  const BROWS_SOFT = `<path d="M150 170 Q165 161 181 168 M219 168 Q235 161 250 170" stroke="${C.hair}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  const EYES_OPEN = `<ellipse cx="165" cy="198" rx="7" ry="9" fill="${C.ink}"/><ellipse cx="235" cy="198" rx="7" ry="9" fill="${C.ink}"/>
    <circle cx="167" cy="195" r="2.5" fill="#fff"/><circle cx="237" cy="195" r="2.5" fill="#fff"/>`;

  const FACES = {
    idle: `${BROWS_SOFT}${EYES_OPEN}
      <path d="M180 242 Q200 254 220 242" stroke="${C.lip}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    deal: `<path d="M150 168 L181 168 M219 168 L250 168" stroke="${C.hair}" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="169" cy="203" rx="7" ry="7" fill="${C.ink}"/><ellipse cx="239" cy="203" rx="7" ry="7" fill="${C.ink}"/>
      <path d="M155 195 L179 197 M223 197 L247 195" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>
      <path d="M188 244 Q200 248 212 244" stroke="${C.lip}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    surprised: `<path d="M148 160 Q165 145 182 157 M218 157 Q235 145 252 160" stroke="${C.hair}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="165" cy="198" r="11" fill="${C.ink}"/><circle cx="235" cy="198" r="11" fill="${C.ink}"/>
      <circle cx="168" cy="194" r="3.5" fill="#fff"/><circle cx="238" cy="194" r="3.5" fill="#fff"/>
      <ellipse cx="200" cy="248" rx="10" ry="14" fill="${C.lip}"/>`,
    smile: `${BROWS_SOFT}
      <path d="M154 202 Q165 188 176 202 M224 202 Q235 188 246 202" stroke="${C.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="146" cy="226" rx="16" ry="9" fill="${C.blush}" opacity="0.55"/><ellipse cx="254" cy="226" rx="16" ry="9" fill="${C.blush}" opacity="0.55"/>
      <path d="M176 234 Q200 272 224 234 Z" fill="${C.lip}"/><path d="M182 237 Q200 243 218 237" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    sorry: `<path d="M150 173 L181 162 M219 162 L250 173" stroke="${C.hair}" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="165" cy="201" rx="7" ry="6" fill="${C.ink}"/><ellipse cx="235" cy="201" rx="7" ry="6" fill="${C.ink}"/>
      <path d="M182 251 Q200 238 218 251" stroke="${C.lip}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M284 140 Q297 162 284 173 Q271 162 284 140 Z" fill="${C.sweat}" stroke="#6fb3c4" stroke-width="1.5"/>`,
  };

  // 發牌時右手（畫面右側）伸出來捏著一張牌
  const DEAL_ARM = `<path d="M262 352 Q322 360 352 404" stroke="${C.shirt}" stroke-width="34" fill="none" stroke-linecap="round"/>
    <g transform="rotate(18 366 392)"><rect x="342" y="358" width="48" height="66" rx="6" fill="${C.teal}" stroke="${C.shirt}" stroke-width="3"/></g>
    <circle cx="354" cy="408" r="17" fill="${C.skin}"/>`;

  function svg(mood) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W * 2}" height="${VB_H * 2}" viewBox="0 0 ${VB_W} ${VB_H}">
      <rect x="181" y="262" width="38" height="70" fill="${C.skin}"/>
      <path d="M90 520 L95 385 Q100 345 135 335 L178 322 L222 322 L265 335 Q300 345 305 385 L310 520 Z" fill="${C.shirt}"/>
      <path d="M118 362 Q122 342 150 337 L200 432 L250 337 Q278 342 282 362 L292 520 L108 520 Z" fill="${C.vest}"/>
      <path d="M150 337 L200 432 L250 337" fill="none" stroke="${C.teal}" stroke-width="6" stroke-linejoin="round"/>
      <path d="M126 372 Q114 440 118 520 M274 372 Q286 440 282 520" fill="none" stroke="#3a4a52" stroke-width="3"/>
      <rect x="236" y="400" width="44" height="20" rx="3" fill="${C.shirt}"/><rect x="242" y="408" width="32" height="4" rx="2" fill="${C.teal}"/>
      <path d="M200 336 L175 323 L175 350 Z M200 336 L225 323 L225 350 Z" fill="${C.red}"/><circle cx="200" cy="336" r="6" fill="#8e1d16"/>
      <ellipse cx="110" cy="202" rx="14" ry="20" fill="${C.skin}"/><ellipse cx="290" cy="202" rx="14" ry="20" fill="${C.skin}"/>
      <ellipse cx="${HEAD.cx}" cy="${HEAD.cy}" rx="${HEAD.rx}" ry="${HEAD.ry}" fill="${C.skin}"/>
      <path d="M106 196 Q98 92 200 84 Q302 92 294 196 Q286 140 252 126 Q206 150 160 118 Q116 136 106 196 Z" fill="${C.hair}"/>
      ${FACES[mood]}
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
    const material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.05, visible: false });
    const mesh = new THREE.Mesh(geometry, material);
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
