// 補間動畫：每段動畫是一個 Promise，播完才 resolve；有東西在動的那幾格才重畫場景。
// wait() 也算進行中（busy），但它不動任何東西：只在開始時補畫一次，之後不重畫。對白、橫幅、大特效等的那幾秒
// 原本每格都重畫整個 3D 牌桌，大特效時暗幕還把牌桌整個蓋住（P-06、P-13）。
// speed 調大整體變快（探針用它在幾秒內打完好幾局），Infinity 則一律立即完成。
(function () {
  const V = window.BJK.view;
  const active = new Set();
  let render = () => {};
  let frameId = null;
  let dirty = false;
  // 120Hz 手機的 rAF 一秒跑 120 次，補間看起來跟 60 格差不多，電卻多花一倍：離上一格太近的那格跳過。
  // 門檻 10 毫秒：120Hz（8.3）隔格畫，90Hz（11.1）照畫，不會掉到 45 格
  const MIN_GAP = 10;
  let lastDraw = -Infinity;

  const ease = {
    linear: t => t,
    inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
  };

  function kick() {
    if (frameId === null) frameId = requestAnimationFrame(frame);
  }
  function frame(now) {
    frameId = null;
    if (now - lastDraw < MIN_GAP) { kick(); return; }
    lastDraw = now;
    let moved = dirty;
    dirty = false;
    for (const job of [...active]) {
      job.tick(now);
      if (!job.idle) moved = true;
    }
    if (moved) render();
    if (active.size) kick();
  }

  // idle：等待用，不動東西。wait() 不經過 anim.tween：量測腳本會把 tween 換成自己的版本，經過它就分不出是等待
  function run(ms, update, easing, idle) {
    const fn = easing || ease.inOut;
    const duration = ms / anim.speed;
    return new Promise(resolve => {
      const t0 = performance.now();
      const job = {
        idle,
        tick(now) {
          const t = duration > 0 ? Math.min(1, (now - t0) / duration) : 1;
          update(fn(t));
          if (t >= 1) {
            active.delete(job);
            resolve();
          }
        },
      };
      active.add(job);
      job.tick(t0);
      if (active.has(job)) kick();
      else render();
    });
  }

  const anim = {
    speed: 1,
    ease,
    setRender(fn) { render = fn; },
    tween(ms, update, easing) { return run(ms, update, easing, false); },
    // 等之前剛改過場景（擺好藍圈、翻好牌）的話，下一格補畫一次
    wait(ms) {
      dirty = true;
      return run(ms, () => {}, null, true);
    },
    get busy() { return active.size > 0; },
  };

  V.anim = anim;
})();
