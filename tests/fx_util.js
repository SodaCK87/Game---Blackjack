// 探針共用：量大特效（app/js/view/showcase.js）。前三個是塞進頁面裡跑的程式碼片段，最後一個在 node 這邊判重疊。

// 記下每一段大特效：哪一種、出現與收掉的時間、同時最多幾段；出現那一刻它的動畫最晚幾毫秒播完（時間有沒有除以 speed）；
// 播的期間桌上的牌與籌碼有沒有變（變了就是特效還在畫面上，牌局已經往下演，疊在一起了）；收掉那一刻你每一手有幾疊籌碼。
// 「變」看數量也看每一個的世界座標：只看數量的話，結算的籌碼還在飛、還沒收走的那幾格看不出來，
// 機器忙時一格就超過 40 倍速的特效長度，特效常常就在那幾格裡收掉（2026-10-28 全套平行跑時陽性對照漏抓過一次）
const FX_WATCH = `
  const fxLog = [];
  let fxLive = 0, fxMaxLive = 0;
  const fxPos = new THREE.Vector3();
  const fxSig = () => { let s = ''; BJK.view.stage.scene.traverse(o => { if (o.userData.kind === 'card' || o.userData.kind === 'chip') { o.getWorldPosition(fxPos); s += fxPos.toArray().map(v => v.toFixed(3)) + ';'; } }); return s; };
  const fxTable = () => { let n = 0; BJK.view.stage.scene.traverse(o => { if (o.userData.kind === 'card' || o.userData.kind === 'chip') n++; }); return n; };
  // 開頁後的預演（.bigfx-warm，照真實時間播 0.3 秒）不算：它本來就不跟 speed
  const fxEnd = el => Math.max(0, ...document.getAnimations()
    .filter(a => !(a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.bigfx-warm')))
    .filter(a => (a.effect && a.effect.target && el.contains(a.effect.target)) || /^bigfx/.test(a.animationName || ''))
    .map(a => a.effect.getComputedTiming().endTime));
  new MutationObserver(list => {
    for (const m of list) {
      for (const n of m.addedNodes) if (n.classList && n.classList.contains('bigfx')) {
        fxLive++;
        fxMaxLive = Math.max(fxMaxLive, fxLive);
        fxLog.push({ kind: n.dataset.kind, node: n, t0: performance.now(), end: fxEnd(n), table0: fxTable(), sig0: fxSig(), moved: false });
      }
      for (const n of m.removedNodes) if (n.classList && n.classList.contains('bigfx')) {
        fxLive--;
        const x = fxLog.find(x => x.node === n);
        Object.assign(x, { t1: performance.now(), table1: fxTable(), stacks: BJK.view.stage.director.hands('me').map(h => h.stacks.length) });
        if (fxSig() !== x.sig0) x.moved = true;
      }
    }
  }).observe(document.body, { childList: true });
  (function fxTick() {
    for (const x of fxLog) if (x.t1 === undefined && fxSig() !== x.sig0) x.moved = true;
    requestAnimationFrame(fxTick);
  })();
  const fxReport = () => ({
    log: fxLog.map(({ node, sig0, ...x }) => Object.assign(x, { life: x.t1 === undefined ? null : Math.round(x.t1 - x.t0), end: Math.round(x.end * 10) / 10 })),
    maxLive: fxMaxLive, left: document.querySelectorAll('.bigfx').length,
    bodyClass: [...document.body.classList].filter(c => /^bigfx/.test(c)), bodyVar: document.body.style.getPropertyValue('--bigfx-d'),
  });`;

// 暫停所有動畫、跳到第 f 成，等兩格畫面再量。直接等時間量會被量測本身（截圖要 0.4 秒）拖到而錯位
const FX_SEEK = `
  const seek = async (f, total) => {
    document.getAnimations().forEach(a => { a.pause(); a.currentTime = f * total; });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };`;

// 看得到的字的四個角（畫面座標）：canvas 用同一個字型量字形範圍（含描邊），再套上元素現在的 transform（大標斜 3 度）。
// 排版的框比字大（全形「！」右半邊是空白、Impact 的行高比大寫字母高），量框會量到假重疊或假置中
const FX_INK = `
  const inkCtx = document.createElement('canvas').getContext('2d');
  const inkQuad = el => {
    const cs = getComputedStyle(el);
    inkCtx.font = cs.font;
    inkCtx.letterSpacing = cs.letterSpacing;
    const m = inkCtx.measureText(el.textContent);
    const w = el.offsetWidth, h = el.offsetHeight, pad = (parseFloat(cs.webkitTextStrokeWidth) || 0) / 2;
    const base = (h - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
    const x0 = (w - m.width) / 2 - m.actualBoundingBoxLeft - pad, x1 = (w - m.width) / 2 + m.actualBoundingBoxRight + pad;
    const y0 = base - m.actualBoundingBoxAscent - pad, y1 = base + m.actualBoundingBoxDescent + pad;
    const M = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
    const o = cs.transformOrigin.split(' ').map(parseFloat);
    // offsetParent 是蓋滿畫面的 .bigfx，所以 offsetLeft／offsetTop 就是畫面座標
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
      const p = M.transformPoint(new DOMPoint(x - o[0], y - o[1]));
      return [el.offsetLeft + o[0] + p.x, el.offsetTop + o[1] + p.y];
    });
  };`;

// 凸四邊形與矩形有沒有重疊（分離軸定理）；只碰到邊、重疊不到 0.5px 的不算
function quadHitsRect(quad, r) {
  const rect = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]];
  for (const poly of [quad, rect]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2, len = Math.hypot(nx, ny) || 1;
      const pa = quad.map(p => (p[0] * nx + p[1] * ny) / len), pb = rect.map(p => (p[0] * nx + p[1] * ny) / len);
      if (Math.max(...pa) <= Math.min(...pb) + 0.5 || Math.max(...pb) <= Math.min(...pa) + 0.5) return false;
    }
  }
  return true;
}

module.exports = { FX_WATCH, FX_SEEK, FX_INK, quadHitsRect };
