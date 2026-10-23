// 動畫積木：物件沿弧線飛、抖動、金幣雨，以及疊在畫面上的橫幅與座位旁的小對白
(function () {
  const V = window.BJK.view;
  const A = V.anim;

  // 沿拋物線從目前位置飛到 to；rot 給了就同時把 rotation 各軸線性轉過去
  function arc(obj, to, { ms = 400, lift = 0.6, rot = null, easing } = {}) {
    const from = obj.position.clone();
    const r0 = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
    return A.tween(ms, t => {
      obj.position.lerpVectors(from, to, t);
      obj.position.y += Math.sin(Math.PI * t) * lift;
      if (rot) {
        obj.rotation.set(r0.x + (rot.x - r0.x) * t, r0.y + (rot.y - r0.y) * t, r0.z + (rot.z - r0.z) * t);
      }
    }, easing);
  }

  // 沿 dir（世界座標的單位向量）左右抖，幅度遞減，最後回到原位
  function shake(objs, dir, ms = 420) {
    const homes = objs.map(o => o.position.clone());
    return A.tween(ms, t => {
      const d = Math.sin(t * Math.PI * 8) * 0.06 * (1 - t);
      objs.forEach((o, i) => o.position.copy(homes[i]).addScaledVector(dir, d));
    }, A.ease.linear);
  }

  const coinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.03, 20);

  // 金幣從桌面上方灑下來、落桌後淡出
  async function coinRain(scene, count = 36) {
    const rng = V.rng(Date.now() & 0xffff);
    const material = new THREE.MeshStandardMaterial({ color: 0xe0b83a, metalness: 0.8, roughness: 0.3, transparent: true });
    const coins = Array.from({ length: count }, () => {
      const c = new THREE.Mesh(coinGeo, material);
      c.userData = { x: (rng() - 0.5) * 8, z: 0.8 + rng() * 3.8, y0: 6 + rng() * 4, spin: (rng() - 0.5) * 20, delay: rng() * 0.35 };
      c.position.set(c.userData.x, c.userData.y0, c.userData.z);
      scene.add(c);
      return c;
    });
    await A.tween(1300, t => {
      for (const c of coins) {
        const k = Math.max(0, Math.min(1, (t - c.userData.delay) / (1 - c.userData.delay)));
        c.position.y = c.userData.y0 + (0.05 - c.userData.y0) * k * k;
        c.rotation.set(c.userData.spin * k, c.userData.spin * k * 0.5, 0);
      }
    }, A.ease.linear);
    await A.tween(400, t => { material.opacity = 1 - t; });
    coins.forEach(c => scene.remove(c));
    material.dispose();
  }

  // 畫面正中央的大字（Blackjack、爆牌…），播完自己收掉。avoid 是不能蓋住的範圍（荷官的臉）：
  // 直式手機荷官放大 2.2 倍，臉正好落在 38% 那一帶，壓到就整條移到臉的下方
  async function banner(text, ms = 1400, avoid = null) {
    const el = document.getElementById('banner');
    el.textContent = text;
    el.style.top = '';
    el.hidden = false;
    if (avoid) {
      const h = el.offsetHeight, mid = el.offsetTop;
      if (mid - h / 2 < avoid.bottom && mid + h / 2 > avoid.top) el.style.top = `${avoid.bottom + 8 + h / 2}px`;
    }
    el.classList.remove('show');
    void el.offsetWidth;   // 重新觸發 CSS 動畫
    el.classList.add('show');
    await A.wait(ms);
    el.hidden = true;
  }

  // 疊在牌桌上的字（中心對齊）夾回畫布範圍內：直式手機的牌桌放大到桌緣超出畫面，邊上座位的名牌會跟著出去
  function keepInView(el) {
    const hw = el.offsetWidth / 2 + 4, hh = el.offsetHeight / 2 + 4;
    const W = window.innerWidth, H = document.getElementById('table').clientHeight;
    el.style.left = `${Math.min(Math.max(parseFloat(el.style.left), hw), W - hw)}px`;
    el.style.top = `${Math.min(Math.max(parseFloat(el.style.top), hh), H - hh)}px`;
  }

  // 座位旁冒出一句小對白，往上飄、淡出；不擋流程，回傳的 Promise 播完才 resolve
  async function pop(text, at, kind) {
    const el = document.createElement('div');
    el.className = `pop ${kind || ''}`;
    el.textContent = text;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    document.getElementById('overlay').appendChild(el);
    keepInView(el);
    await A.wait(1600);
    el.remove();
  }

  V.fx = { arc, shake, coinRain, banner, pop, keepInView };
})();
