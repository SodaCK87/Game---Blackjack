// 牌桌以外的佈景：拉斯維加斯大廳。荷官背後一道木牆板隔間、上緣一條黃銅扶手，
// 牆後是遠處吃角子老虎與水晶燈的失焦光點，地上鋪地毯。
// 靜態：不開動畫迴圈，跟著既有的重畫一起畫（使用者 2026-10-22 選靜態，手機省電）
(function () {
  const V = window.BJK.view;
  const FLOOR_Y = -0.82;
  const WALL_Z = -5, WALL_H = 1.3, WALL_W = 200;
  const VOID = 0x0d1215;   // 牆後大廳的暗處，也是場景底色

  // 光點照「畫面位置」排，不照世界座標：鏡頭依螢幕比例換角度，照世界座標擺的話手機和桌機看到的會差很多。
  // x 是畫面左右（−1…1），v 是牆上緣到畫面頂端之間的高度（0…1），px 是直徑（CSS 像素）
  function bokehPlan() {
    const rng = V.rng(31), out = [];
    const SLOT = [0xe0a040, 0xc0392b, 0xd4a017, 0x008080, 0x9b59b6];
    const pick = n => SLOT[Math.floor(rng() * n)];
    // 吃角子老虎：一排排小光點，越上面的排越遠，所以越小、越密
    for (let row = 0; row < 6; row++) {
      for (let i = 0; i < 16 + row * 4; i++) {
        out.push({ x: -1.05 + rng() * 2.1, v: 0.03 + row * 0.1 + rng() * 0.06, px: (13 - row * 1.5) * (0.6 + rng() * 0.6), color: pick(SLOT.length), opacity: 0.18 + rng() * 0.14 });
      }
    }
    // 水晶燈：最上面幾團暖白小光點
    for (let k = 0; k < 4; k++) {
      const cx = -0.8 + k * 0.53 + (rng() - 0.5) * 0.2, cv = 0.78 + rng() * 0.14;
      for (let i = 0; i < 9; i++) {
        out.push({ x: cx + (rng() - 0.5) * 0.18, v: cv + (rng() - 0.5) * 0.1, px: 3 + rng() * 5, color: 0xffe2a8, opacity: 0.2 + rng() * 0.12 });
      }
    }
    // 近一點的大光斑：稀疏、很淡
    for (let i = 0; i < 14; i++) {
      out.push({ x: -1 + rng() * 2, v: rng(), px: 28 + rng() * 40, color: pick(3), opacity: 0.05 + rng() * 0.05 });
    }
    return out;
  }

  function build() {
    const group = new THREE.Group();

    // 地板要夠大：直式螢幕鏡頭往上平移後，小地板的左右邊緣會露出來。遠端停在牆腳，牆後只剩大廳的暗處與光點
    const carpet = V.textures.carpet();
    carpet.repeat.set(140, 140);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, WALL_Z + 200);
    floor.receiveShadow = true;

    const panel = V.textures.woodPanel();
    panel.repeat.set(WALL_W / 4, 1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(WALL_W, WALL_H, 0.3), new THREE.MeshStandardMaterial({ map: panel, roughness: 0.7 }));
    wall.position.set(0, FLOOR_Y + WALL_H / 2, WALL_Z - 0.15);
    wall.receiveShadow = true;

    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, WALL_W, 16),
      new THREE.MeshStandardMaterial({ color: 0xb08d3a, metalness: 0.5, roughness: 0.35 }));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, FLOOR_Y + WALL_H + 0.05, WALL_Z);
    group.add(floor, wall, rail);

    const tex = V.textures.bokeh();
    const plan = bokehPlan();
    const sprites = plan.map(b => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: b.color, opacity: b.opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      s.userData.kind = 'bokeh';
      group.add(s);
      return s;
    });

    const top = new THREE.Vector3(0, FLOOR_Y + WALL_H + 0.12, WALL_Z);
    // 鏡頭定好之後呼叫：把光點擺到牆後、落在牆上緣與畫面頂端之間。回傳牆上緣在畫面上的高度（−1 底、1 頂）
    function layout(camera, heightPx) {
      camera.updateMatrixWorld();
      const base = top.clone().project(camera).y;
      const fwd = camera.getWorldDirection(new THREE.Vector3());
      const frustumH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      plan.forEach((b, i) => {
        const dir = new THREE.Vector3(b.x, base + b.v * (1 - base), 0.5).unproject(camera).sub(camera.position).normalize();
        // 沿視線走到牆後 3–15 單位：一定在牆後面，被牆擋住的部分就看不到
        const t = (WALL_Z - 3 - (i % 7) * 2 - camera.position.z) / dir.z;
        const s = sprites[i];
        s.visible = t > 0;
        if (!s.visible) return;
        s.position.copy(camera.position).addScaledVector(dir, t);
        s.scale.setScalar(b.px / heightPx * frustumH * s.position.clone().sub(camera.position).dot(fwd));
      });
      return base;
    }

    return { group, layout };
  }

  V.room = { build, VOID, WALL_Z };
})();
