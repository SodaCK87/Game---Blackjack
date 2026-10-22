// 補間動畫：每段動畫是一個 Promise，播完才 resolve；有動畫在跑時每一格都重畫一次場景。
// speed 調大整體變快（探針用它在幾秒內打完好幾局），Infinity 則一律立即完成。
(function () {
  const V = window.BJK.view;
  const active = new Set();
  let render = () => {};
  let frameId = null;

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
    for (const job of [...active]) job.tick(now);
    render();
    if (active.size) kick();
  }

  const anim = {
    speed: 1,
    ease,
    setRender(fn) { render = fn; },
    tween(ms, update, easing) {
      const fn = easing || ease.inOut;
      const duration = ms / anim.speed;
      return new Promise(resolve => {
        const t0 = performance.now();
        const job = {
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
    },
    wait(ms) { return anim.tween(ms, () => {}); },
    get busy() { return active.size > 0; },
  };

  V.anim = anim;
})();
