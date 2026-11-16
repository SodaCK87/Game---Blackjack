// 插畫荷官：平面立牌，站在牌桌直邊後面；五種表情各一張貼圖，換表情就是換貼圖。
// 貼圖一律走 data: URL：file:// 下外部圖檔上傳 WebGL 會被擋（2026-11-07 Edge 實測 SecurityError），
// SVG 與 WebP 的 data: URL 在 file:// 下 Edge／Chrome 都不會被當成跨來源。
(function () {
  const V = window.BJK.view;
  const MOODS = { idle: '待機', deal: '發牌', surprised: '驚訝', smile: '微笑', sorry: '遺憾' };
  const VB_W = 560, VB_H = 520;          // 立牌座標：比人寬，手勢才張得開
  const H = 3.4, W = H * VB_W / VB_H;    // 立牌在場景裡的大小
  const ASIDE_MS = 1600;                 // 換造型那句話講多久

  // 造型：點荷官時依序循環。立牌大小都一樣，換造型只換貼圖。
  // src：表情的貼圖網址；head：臉加頭髮的外框（立牌座標 [左, 上, 右, 下]），對白泡泡避開它；portrait：大特寫；line：換上時講的話
  if (!V.dealerClassic) throw new Error('載入順序錯：dealer_classic.js 要排在 dealer.js 之前');
  if (!V.dealerArt) throw new Error('載入順序錯：dealer_art.js 要排在 dealer.js 之前');
  const ART = V.dealerArt, CLASSIC = V.dealerClassic;
  const classicSvg = (mood, size = `width="${VB_W * 2}" height="${VB_H * 2}" viewBox="${CLASSIC.viewBox}"`) => CLASSIC.draw(mood, size);
  const LOOKS = {
    // 點陣插畫（tools/make_dealer_art.js 產生）：每種表情的頭擺的位置都不同，外框與裁切逐張量
    art: {
      src: mood => ART.images[mood],
      head: mood => ART.marks[mood].head,
      // rect.face 是五官的位置，看不到；探針量大特寫的大字有沒有壓到它
      portrait: mood => {
        const { crop: [x, y, s], face: [x0, y0, x1, y1] } = ART.marks[mood];
        return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${x} ${y} ${s} ${s}">` +
          `<image href="${ART.images[mood]}" width="${VB_W}" height="${VB_H}"/>` +
          `<rect class="face" x="${x0}" y="${y0}" width="${+(x1 - x0).toFixed(1)}" height="${+(y1 - y0).toFixed(1)}" fill="none"/></svg>`;
      },
      line: '這身才夠氣勢。',
    },
    // 舊版：SVG 畫的，臉框是橢圓，往上多留 20 給頭髮
    classic: {
      src: mood => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(classicSvg(mood)),
      head: () => { const { cx, cy, rx, ry } = CLASSIC.head; return [cx - rx, cy - ry - 20, cx + rx, cy + ry]; },
      portrait: mood => classicSvg(mood, `width="100%" height="100%" viewBox="${CLASSIC.crop}"`),
      line: CLASSIC.line,
    },
  };
  const LOOK_NAMES = Object.keys(LOOKS);
  let look = LOOK_NAMES[0];   // 整頁只有一位荷官，大特寫也讀這個

  // showcase.js 的荷官大特寫：跟著目前的造型
  const portrait = (mood, name = look) => LOOKS[name].portrait(mood);

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
      img.src = LOOKS[name].src(mood);
    });
  }
  const loadLook = name => Promise.all(Object.keys(MOODS).map(m => loadTexture(m, name).then(t => [m, t]))).then(Object.fromEntries);

  // 立牌座標 → 立牌本地座標（原點在立牌底邊中央）
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
    // 牌、籌碼、大廳的插畫（textures.js）也一起等：都解碼好了才露面、重畫那一次，開頁只多畫一格
    const ready = Promise.all([loadLook(look), V.textures.ready])
      .then(([set]) => {
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
        return true;   // 有些瀏覽器不准讀 SVG 畫出來的圖（舊版造型）：寧可點透明處也換，不要點到人沒反應
      }
    }

    // 每種表情的頭擺的位置不同：講到一半換表情，泡泡跟著重擺，免得蓋到新的臉
    function setMood(next) {
      if (!MOODS[next]) throw new Error(`沒有這種表情：${next}`);
      mood = next;
      if (textures[next]) {
        material.map = textures[next];
        onChange();
      }
      placeBubble();
    }

    function toScreen(sx, sy) {
      mesh.updateMatrixWorld();
      return project(mesh.localToWorld(local(sx, sy)));
    }

    function faceRect() {
      const [x0, y0, x1, y1] = LOOKS[look].head(mood);
      const corners = [toScreen(x0, y0), toScreen(x1, y0), toScreen(x0, y1), toScreen(x1, y1)];
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

  V.dealer = { MOODS, W, H, ASIDE_MS, create, face, classicSvg, portrait };
})();
