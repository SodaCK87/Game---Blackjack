// 組場景：牌桌、荷官、燈光、鏡頭，再交給導演（director.js）把規則引擎接上畫面
(function () {
  const V = window.BJK && window.BJK.view;
  const status = { three: 'missing', ver: 'missing', render: 'not-run', scene: null, core: 'not-run', dealer: null };
  // 給 tests/ 的探針讀的狀態，畫面上不顯示。荷官貼圖是非同步載入，載完會再寫一次
  const publish = () => { document.body.dataset.bjk = JSON.stringify(status); };
  // 先在瀏覽器裡用 core 跑一局全 AI 牌局，確認四支 core 在 classic script 下載得起來、接得上
  try {
    const g = BJK.game.createGame({
      rng: V.rng(99),
      seats: ['steady', 'reckless', 'timid'].map(p => ({ id: p, name: p, personality: p, bankroll: 1000 })),
    });
    g.startRound({ steady: 50, reckless: 200, timid: 10 });
    while (g.state().phase === 'player') { const id = g.state().turn; g.act(id, g.aiChoice(id)); }
    if (g.state().phase === 'dealer') g.finishRound();
    status.core = g.state().phase === 'idle' ? 'ok' : `stuck: ${g.state().phase}`;
  } catch (e) {
    status.core = 'fail: ' + e.message;
  }
  try {
    status.three = THREE.REVISION;
    status.ver = BJK.version.BJK_VER;

    const canvas = document.getElementById('table');
    const hudEl = document.getElementById('hud');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(V.room.VOID);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const T = V.table.build();
    scene.add(T.group);
    const room = V.room.build();
    scene.add(room.group);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.0));
    const lamp = new THREE.SpotLight(0xfff1dc, 220, 30, 0.75, 0.5, 2);
    lamp.position.set(0, 10, 2.5);
    lamp.target.position.set(0, 0, 2.2);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0005;
    scene.add(lamp, lamp.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(0, 5, 10);
    scene.add(fill);

    const render = () => renderer.render(scene, camera);
    V.anim.setRender(render);
    // 畫布從畫面頂端開始，所以畫布座標就是視窗座標
    const project = p => {
      const v = p.clone().project(camera);
      return { x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight };
    };
    const dealer = V.dealer.create({ bubble: document.getElementById('bubble'), project, onChange: render });
    // 站在直邊後面、腰部以下被桌子擋住；籌碼架在它前面
    dealer.mesh.position.set(0, -0.6, -0.6);
    scene.add(dealer.mesh);

    let director = null;
    const hud = V.hud.create({
      minBet: BJK.game.DEFAULTS.minBet,
      maxBet: BJK.game.DEFAULTS.maxBet,
      onDeal: bet => director.runRound(bet),
      onReset: () => director.resetBankroll(),
    });

    function layout() {
      // 畫布只用操作列上方那一塊，牌桌才不會被按鈕蓋住
      const w = window.innerWidth, h = window.innerHeight - hudEl.offsetHeight, aspect = w / h;
      canvas.style.height = `${h}px`;
      renderer.setSize(w, h, false);
      camera.aspect = aspect;
      camera.fov = aspect < 1 ? 55 : 38;
      camera.updateProjectionMatrix();
      // 直式螢幕改成較俯視的角度，桌子才不會縮成一條
      const elev = (aspect < 1 ? 64 : 40) * Math.PI / 180;
      const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
      V.dealer.face(dealer.mesh, elev);
      // 直式螢幕是寬度先頂到：牌桌大小已經定了，上方多出來的高度讓荷官放大來撐
      dealer.mesh.scale.setScalar(aspect < 1 ? 2.2 : 1);
      scene.updateMatrixWorld();
      // 框景框牌桌加荷官，地板不算
      const tableBox = new THREE.Box3().setFromObject(T.group).union(new THREE.Box3().setFromObject(dealer.mesh));
      const target = tableBox.getCenter(new THREE.Vector3());
      camera.position.copy(target).addScaledVector(dir, 12);
      camera.lookAt(target);
      fitCamera(camera, tableBox, target, dir);
      alignBottom(camera, tableBox, target);
      status.scene.fit = inView(camera, tableBox, 1);
      status.scene.wallTop = room.layout(camera, h);
      status.scene.viewport = [window.innerWidth, window.innerHeight];
      render();
      dealer.placeBubble();
      if (director) director.layout();
    }

    let chips = 0;
    scene.traverse(o => { if (o.userData.kind === 'chip') chips++; });
    status.scene = { seats: T.seats.length, chips, fit: false };
    layout();
    director = V.director.create({ scene, table: T, dealer, project, render, hud });
    V.stage = { scene, camera, renderer, room, dealer, render, director };
    window.addEventListener('resize', layout);
    layout();
    status.render = 'ok';
    dealer.ready.then(() => {
      status.dealer = { loaded: dealer.loaded, mood: dealer.mood };
      publish();
    }, e => {
      status.dealer = { error: e.message };
      publish();
    });
  } catch (e) {
    status.render = 'fail: ' + e.message;
  }
  publish();

  // 沿著視線方向前後移動鏡頭，找出牌桌八個角都還在畫面裡的最近距離
  function fitCamera(camera, box, target, dir) {
    let lo = 2, hi = 60;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      camera.position.copy(target).addScaledVector(dir, mid);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      if (inView(camera, box, 0.94)) hi = mid; else lo = mid;
    }
    camera.position.copy(target).addScaledVector(dir, hi);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  // 框住之後若上下還有空（直式螢幕寬度先頂到），把整組往下貼齊畫布底，空間留在上方給對白泡泡。
  // 鏡頭沿自己的上方向平移；透視會讓一次平移不準，所以多修兩輪
  function alignBottom(camera, box, target) {
    const up = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      const ys = corners(box).map(p => p.project(camera).y);
      const slack = Math.min(...ys) + 0.94;
      if (slack <= 0.001) return;
      const worldH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(target);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(up, slack / 2 * worldH);
      target.addScaledVector(up, slack / 2 * worldH);
      camera.updateMatrixWorld();
    }
  }

  function corners(box) {
    const { min, max } = box, out = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }

  function inView(camera, box, margin) {
    camera.updateMatrixWorld();
    const { min, max } = box;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      if (Math.abs(p.x) > margin || Math.abs(p.y) > margin || p.z < -1 || p.z > 1) return false;
    }
    return true;
  }
})();
