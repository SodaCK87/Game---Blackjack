// 半圓牌桌：直邊在荷官那側（z = 0），弧頂朝玩家（+z）。座位、手牌、下注圈的位置都從這裡拿
(function () {
  const V = window.BJK.view;
  const R = 5;
  const SEAT_DEG = [150, 120, 90, 60, 30];   // 從玩家看過去由左到右
  const PLAYER_SEAT = 2;
  const SEAT_R = 3.55, HAND_R = 2.85;

  function polar(r, deg, y) {
    const a = deg * Math.PI / 180;
    return new THREE.Vector3(r * Math.cos(a), y || 0, r * Math.sin(a));
  }
  // 全部用 Lambert：鏡面反光畫進貼圖，每個像素不必再算 PBR 的高光，桌面佔滿手機大半個畫面。
  // 單色的也掛一張白貼圖，跟有貼圖的共用同一支著色器，開頁少編譯一支
  function std(color, extra) {
    return new THREE.MeshLambertMaterial(Object.assign({ color, map: V.textures.white() }, extra));
  }

  function build() {
    const group = new THREE.Group();
    const wood = std(0xffffff, { map: V.textures.wood() });
    const leather = std(0xffffff, { map: V.textures.leather() });
    const leatherCap = std(0x3a2619);

    // 即時陰影只留給絨布與籌碼架的底盤：陰影一個像素要取樣 5 次，桌身與地毯的暗處都畫進貼圖
    // 絨布：自己重算 UV，讓畫布上緣對到直邊、下緣對到弧頂（見 textures.js 的 felt）
    const feltGeo = new THREE.CircleGeometry(R, 128, Math.PI, Math.PI);
    const pos = feltGeo.attributes.position, uv = feltGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) / R + 1) / 2, 1 + pos.getY(i) / R);
    const felt = new THREE.Mesh(feltGeo, std(0xffffff, { map: V.textures.felt(R, SEAT_DEG, SEAT_R, PLAYER_SEAT) }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    group.add(felt);

    const feltEdge = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.1, 128, 1, true, -Math.PI / 2, Math.PI), std(0x08503a));
    feltEdge.position.y = -0.05;
    group.add(feltEdge);

    const apron = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.1, 0.7, 128, 1, false, -Math.PI / 2, Math.PI), wood);
    apron.position.y = -0.45;
    group.add(apron);

    // 荷官那條直邊：一塊木板順便把桌身的切面蓋起來
    const back = new THREE.Mesh(new THREE.BoxGeometry(2 * R + 0.6, 0.84, 0.3), wood);
    back.position.set(0, -0.4, -0.15);
    group.add(back);

    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, 0.22, 24, 128, Math.PI), leather);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.04;
    rail.castShadow = true;
    group.add(rail);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), leatherCap);
      cap.position.set(sx * (R + 0.12), 0.04, 0);
      group.add(cap);
    }

    // 籌碼架
    const rng = V.rng(21);
    const rack = new THREE.Group();
    const tray = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.1, 0.6), std(0x1f1611));
    tray.position.y = 0.05;
    tray.castShadow = tray.receiveShadow = true;
    rack.add(tray);
    const columns = [1000, 500, 100, 100, 25, 25, 5].map((value, i) => ({ value, count: 10 + Math.floor(rng() * 6), x: -1.14 + i * 0.38 }));
    const chips = V.chips.rack(columns, rng);
    chips.position.y = 0.1;
    rack.add(chips);
    rack.position.set(0, 0, 0.42);
    group.add(rack);

    // 發牌盒（玩家看過去的右邊）與棄牌盒（左邊），開口都朝桌面中央
    const aimAt = new THREE.Vector3(0, 0, 2.2);
    function facing(obj) { obj.rotation.y = Math.atan2(aimAt.x - obj.position.x, aimAt.z - obj.position.z); }

    const shoe = new THREE.Group();
    const shoeBody = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.95), std(0x151c20));
    shoeBody.position.y = 0.17;
    shoeBody.castShadow = true;
    shoe.add(shoeBody);
    const shoeCards = V.cards.deck(0.24);
    shoeCards.position.set(0, 0.24, 0.12);
    shoeCards.rotation.x = -0.12;
    shoe.add(shoeCards);
    shoe.position.set(3.35, 0, 0.85);
    facing(shoe);
    group.add(shoe);

    const discard = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.95),
      new THREE.MeshBasicMaterial({ map: V.textures.glass(), transparent: true, depthWrite: false }));
    glass.position.y = 0.21;
    discard.add(glass);
    const used = V.cards.deck(0.14);
    used.position.y = 0.07;
    discard.add(used);
    discard.position.set(-3.35, 0, 0.85);
    facing(discard);
    group.add(discard);

    const seats = SEAT_DEG.map((deg, index) => ({
      index, deg,
      circle: polar(SEAT_R, deg, 0),
      hand: polar(HAND_R, deg, 0),
      // 牌的上緣朝圓心，坐在這個座位的人看到的是正的
      rotY: Math.PI / 2 - deg * Math.PI / 180,
    }));
    const dealer = { hand: new THREE.Vector3(0, 0, 1.2), rotY: 0 };

    return { group, seats, dealer, playerSeat: PLAYER_SEAT, shoe, discard };
  }

  V.table = { R, build };
})();
