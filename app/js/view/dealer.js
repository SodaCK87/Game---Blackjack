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
  if (!V.bubbleFont) throw new Error('載入順序錯：lib/bubble_font.js 要排在 dealer.js 之前');
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
      // 橫式畫面放大幾倍、裁掉下半身：到腰的半身像整張塞進立牌，桌機上臉太小（使用者 2026-11-16 要 1.2 倍）
      zoom: 1.2,
    },
    // 舊版：SVG 畫的，臉框是橢圓，往上多留 20 給頭髮
    classic: {
      src: mood => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(classicSvg(mood)),
      head: () => { const { cx, cy, rx, ry } = CLASSIC.head; return [cx - rx, cy - ry - 20, cx + rx, cy + ry]; },
      portrait: mood => classicSvg(mood, `width="100%" height="100%" viewBox="${CLASSIC.crop}"`),
      line: CLASSIC.line,
      // 舊版的頭在立牌偏下，頭頂對齊放大的話整個人往下沉，肩膀躲到籌碼架後面只剩一顆頭
      zoom: 1,
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

  // 立牌座標 → 立牌本地座標（原點在立牌底邊中央）。zoom 見 standee()
  function local(sx, sy, zoom = 1) {
    return new THREE.Vector3((sx / VB_W - 0.5) * W * zoom, (1 - sy / VB_H * zoom) * H, 0);
  }

  // 立牌的幾何。zoom > 1：人放大 zoom 倍、頭頂對齊，下半身從底邊裁掉（貼圖只取上面 1／zoom）；
  // 立牌只變寬、高與頂端不動，桌機照「牌桌加荷官」框景時鏡頭不會因此拉遠
  function standee(zoom) {
    const g = new THREE.PlaneGeometry(W * zoom, H);
    g.translate(0, H / 2, 0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (1 - uv.getY(i)) / zoom);
    return g;
  }

  // 泡泡的框（金邊深底，尖角跟框是同一條線）、壓在框線上的「荷官」名牌、對白。
  // 名牌的字寫在 CSS 的 content：泡泡的 textContent 只有對白，測試與 aside() 都讀它
  const SVG = 'http://www.w3.org/2000/svg';
  function bubbleParts(bubble) {
    const frame = document.createElementNS(SVG, 'svg'), edge = document.createElementNS(SVG, 'path'), inner = document.createElementNS(SVG, 'rect');
    frame.setAttribute('class', 'bubble-frame');
    frame.setAttribute('aria-hidden', 'true');
    edge.setAttribute('class', 'edge');
    inner.setAttribute('class', 'inner');
    frame.append(edge, inner);
    const plate = document.createElement('span'), words = document.createElement('span');
    plate.className = 'bubble-plate';
    plate.setAttribute('aria-hidden', 'true');
    words.className = 'bubble-text';
    bubble.replaceChildren(frame, plate, words);
    return { frame, edge, inner, plate, words };
  }

  // 框的外形：圓角矩形，side 那一邊挖出尖角指向臉。at 是要指的點（泡泡內的座標），尖角底邊夾在圓角以內、
  // 尖端最多斜一個尖角長；線畫在框內半個線寬，外緣才剛好是泡泡的邊
  const R = 6, TAIL = 8, BASE = 7, INSET = 3;
  function framePath(w, h, side, at, line) {
    const o = line / 2, x0 = o, y0 = o, x1 = w - o, y1 = h - o;
    const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const arc = (x, y) => `A${R} ${R} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
    const p = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`;
    if (side === 'top') {
      const c = clampTo(at.x, x0 + R + BASE, x1 - R - BASE), tip = clampTo(at.x, c - TAIL, c + TAIL);
      return `M${p(x0 + R, y0)}H${(x1 - R).toFixed(2)}${arc(x1, y0 + R)}V${(y1 - R).toFixed(2)}${arc(x1 - R, y1)}` +
        `H${(c + BASE).toFixed(2)}L${p(tip, y1 + TAIL)}L${p(c - BASE, y1)}H${(x0 + R).toFixed(2)}${arc(x0, y1 - R)}V${(y0 + R).toFixed(2)}${arc(x0 + R, y0)}Z`;
    }
    const c = clampTo(at.y, y0 + R + BASE, y1 - R - BASE), tip = clampTo(at.y, c - TAIL, c + TAIL);
    // right：泡泡在臉的右邊，尖角在左緣；left 反過來
    const left = side === 'right' ? `V${(c + BASE).toFixed(2)}L${p(x0 - TAIL, tip)}L${p(x0, c - BASE)}` : '';
    const right = side === 'left' ? `V${(c - BASE).toFixed(2)}L${p(x1 + TAIL, tip)}L${p(x1, c + BASE)}` : '';
    return `M${p(x0 + R, y0)}H${(x1 - R).toFixed(2)}${arc(x1, y0 + R)}${right}V${(y1 - R).toFixed(2)}${arc(x1 - R, y1)}` +
      `H${(x0 + R).toFixed(2)}${arc(x0, y1 - R)}${left}V${(y0 + R).toFixed(2)}${arc(x0 + R, y0)}Z`;
  }

  // project(世界座標) → 螢幕 CSS 像素 {x, y}；onChange() 讓場景重畫
  function create({ bubble, project, onChange }) {
    let zoom = 1, landscape = false;
    const parts = bubbleParts(bubble);
    // 不寫深度：前面的牌與籌碼已經先畫好，擋得住；跟桌上其他透明物共用一支著色器
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, visible: false });
    const mesh = new THREE.Mesh(standee(zoom), material);
    mesh.renderOrder = 1;
    let textures = {};
    let masks = {};
    let mood = 'idle';
    let hideTimer = null, asideTimer = null, beforeAside = null;
    let switching = false;

    const saved = V.hud.loadPrefs().look;
    look = LOOK_NAMES.includes(saved) ? saved : LOOK_NAMES[0];
    // 對白字型是非同步載入的：開頁第一句在它載好之前就擺了，量到的是系統字的寬度，載好後照新的字寬重擺一次。
    // 載不起來時 ready 是 false，泡泡一直用系統字，不必重擺
    V.bubbleFont.ready.then(ok => { if (ok) placeBubble(); });
    // 牌、籌碼、大廳的插畫（textures.js）與對白字型也一起等：都好了才露面、重畫那一次，開頁只多畫一格
    const ready = Promise.all([loadLook(look), V.textures.ready, V.bubbleFont.ready])
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
        applyZoom();
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
      return project(mesh.localToWorld(local(sx, sy, zoom)));
    }

    // 橫式畫面照造型的 zoom 放大裁掉下半身；直式手機整張（那裡靠 mesh.scale 撐滿上方）。換造型時跟著重建。
    // 點透明處的判斷讀的是貼圖 UV，不必跟著改
    function applyZoom() {
      const z = landscape ? LOOKS[look].zoom : 1;
      if (z === zoom) return;
      zoom = z;
      const old = mesh.geometry;
      mesh.geometry = standee(z);
      old.dispose();
    }
    // main.js 每次排版時給：畫面是不是橫的
    function setLandscape(on) {
      landscape = on;
      applyZoom();
    }

    function faceRect() {
      const [x0, y0, x1, y1] = LOOKS[look].head(mood);
      const corners = [toScreen(x0, y0), toScreen(x1, y0), toScreen(x0, y1), toScreen(x1, y1)];
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // 頭的右邊放得下就放右邊；放不下（直式手機）就放頭頂正上方；頭頂也放不下（矮的直式手機，頭頂離畫面頂不到一行字），
    // 改放臉旁邊比較寬的那一側、寬度縮到那一側放得下，字多就多排幾行。不夾回頭頂：那樣會蓋到臉
    // 尖角長 TAIL（8）要比 gap 短，尖端才不會戳進臉框
    function placeBubble() {
      if (bubble.hidden) return;
      const face = faceRect();
      const vw = window.innerWidth, vh = window.innerHeight, gap = 10, m = 8;
      const lift = -parts.plate.offsetTop;   // 名牌壓在框線上，凸出泡泡頂端這麼多：頂端要多留這一截，名牌才不會被畫面切掉
      // 先回到 CSS 的寬度上限、擺到左上角再量：擺在右緣附近時瀏覽器會把它擠窄，量到的就不是它本來的寬
      bubble.style.maxWidth = '';
      delete bubble.dataset.narrow;
      bubble.style.left = '0px';
      bubble.style.top = '0px';
      let w = bubble.offsetWidth, h = bubble.offsetHeight, left, top;
      const beside = side => {
        left = side === 'right' ? face.right + gap : face.left - gap - w;
        top = face.top + (face.bottom - face.top) * 0.15 - h / 2;
        bubble.dataset.side = side;
      };
      if (face.right + gap + w <= vw - m) {
        beside('right');
      } else if (face.top - gap - h >= m + lift) {
        left = (face.left + face.right) / 2 - w / 2;
        top = face.top - gap - h;
        bubble.dataset.side = 'top';
      } else {
        const room = { right: vw - m - face.right - gap, left: face.left - gap - m };
        const side = room.left > room.right ? 'left' : 'right';
        const extra = w - parseFloat(getComputedStyle(bubble).width);   // max-width 只管字那一塊，內距與邊框另外算
        bubble.style.maxWidth = `${Math.floor(Math.min(room[side], w) - extra)}px`;
        bubble.dataset.narrow = '';
        w = bubble.offsetWidth;
        h = bubble.offsetHeight;
        beside(side);
      }
      left = clamp(left, m, vw - w - m);
      top = clamp(top, m + lift, vh - h - m);
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      // 尖角指向臉的中段（旁邊）或正中（頭頂）；泡泡被夾回畫面內時尖角跟著移，仍對著臉
      const box = bubble.getBoundingClientRect();
      const at = { x: (face.left + face.right) / 2 - box.left, y: (face.top + face.bottom) / 2 - box.top };
      const line = parseFloat(getComputedStyle(parts.edge).strokeWidth) || 1;
      parts.frame.style.width = `${box.width}px`;
      parts.frame.style.height = `${box.height}px`;
      parts.frame.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      parts.edge.setAttribute('d', framePath(box.width, box.height, bubble.dataset.side, at, line));
      for (const [k, v] of Object.entries({ x: INSET, y: INSET, width: box.width - 2 * INSET, height: box.height - 2 * INSET, rx: R - 2 })) parts.inner.setAttribute(k, v);
    }

    function show(text) {
      parts.words.textContent = text;
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
      if (!asideTimer) beforeAside = bubble.hidden ? null : parts.words.textContent;
      clearTimeout(asideTimer);
      show(text);
      asideTimer = setTimeout(() => {
        asideTimer = null;
        if (beforeAside === null) bubble.hidden = true;
        else show(beforeAside);
      }, ASIDE_MS);
    }

    return {
      mesh, ready, setMood, say, hush, placeBubble, faceRect, nextLook, opaque, setLandscape,
      get zoom() { return zoom; },
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
