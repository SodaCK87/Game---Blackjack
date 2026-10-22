// 組場景：牌桌、燈光、鏡頭，與階段 2 的展示牌局（階段 4 接上規則引擎後換成真的發牌）
(function () {
  const V = window.BJK && window.BJK.view;
  const status = { three: 'missing', ver: 'missing', render: 'not-run', scene: null };
  try {
    status.three = THREE.REVISION;
    status.ver = BJK.version.BJK_VER;

    const canvas = document.getElementById('table');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x212c31);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const T = V.table.build();
    scene.add(T.group);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1a2327, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.82;
    floor.receiveShadow = true;
    scene.add(floor);

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

    dealDemo(T);

    // 鏡頭框景只框牌桌本身，地板不算
    const tableBox = new THREE.Box3().setFromObject(T.group);
    const target = new THREE.Vector3(0, 0, 2.3);

    function layout() {
      const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
      renderer.setSize(w, h, false);
      camera.aspect = aspect;
      camera.fov = aspect < 1 ? 55 : 38;
      camera.updateProjectionMatrix();
      // 直式螢幕改成較俯視的角度，桌子才不會縮成一條
      const elev = (aspect < 1 ? 64 : 40) * Math.PI / 180;
      const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
      camera.position.copy(target).addScaledVector(dir, 12);
      camera.lookAt(target);
      fitCamera(camera, tableBox, target, dir);
      status.scene.fit = inView(camera, tableBox, 1);
      status.scene.viewport = [w, h];
      renderer.render(scene, camera);
    }

    let cards = 0, chips = 0;
    scene.traverse(o => { if (o.userData.kind === 'card') cards++; if (o.userData.kind === 'chip') chips++; });
    status.scene = { seats: T.seats.length, cards, chips, fit: false };
    window.addEventListener('resize', layout);
    layout();
    status.render = 'ok';
  } catch (e) {
    status.render = 'fail: ' + e.message;
  }
  // 給 tests/check_file_protocol.js 讀的狀態，畫面上不顯示
  document.body.dataset.bjk = JSON.stringify(status);

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

  function inView(camera, box, margin) {
    camera.updateMatrixWorld();
    const { min, max } = box;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      if (Math.abs(p.x) > margin || Math.abs(p.y) > margin || p.z < -1 || p.z > 1) return false;
    }
    return true;
  }

  function placeHand(parent, list, at, rotY) {
    const n = list.length;
    list.forEach(([rank, suit, faceUp], i) => {
      const card = V.cards.make(rank, suit, faceUp !== false);
      // 往右錯開疊牌、露出左上角的點數；不往圓心推，否則會壓到絨布上的字。每張墊高一點避免穿插閃爍
      const offset = new THREE.Vector3((i - (n - 1) / 2) * 0.22, 0.006 + i * V.cards.T * 1.5, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      card.position.copy(at).add(offset);
      card.rotation.y = rotY;
      parent.add(card);
    });
  }

  function dealDemo(T) {
    const rng = V.rng(7);
    const hands = {
      0: [['K', 'S'], ['7', 'H']],
      1: [['9', 'D'], ['9', 'C']],
      2: [['A', 'H'], ['Q', 'S']],
      3: [['5', 'C'], ['6', 'D'], ['8', 'H']],
    };
    const bets = { 0: 100, 1: 75, 2: 625, 3: 50 };
    for (const seat of T.seats) {
      if (hands[seat.index]) placeHand(T.group, hands[seat.index], seat.hand, seat.rotY);
      if (bets[seat.index]) {
        const stack = V.chips.stack(bets[seat.index], rng);
        stack.position.copy(seat.circle);
        T.group.add(stack);
      }
    }
    placeHand(T.group, [['10', 'S'], ['4', 'D', false]], T.dealer.hand, T.dealer.rotY);
  }
})();
