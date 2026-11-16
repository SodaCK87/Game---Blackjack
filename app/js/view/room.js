// 牌桌以外的佈景：拉斯維加斯大廳。荷官背後一道木牆板隔間、上緣一條黃銅扶手，
// 牆後是遠處吃角子老虎與水晶燈的失焦照片（插畫），地上鋪地毯。
// 靜態：不開動畫迴圈，跟著既有的重畫一起畫（使用者 2026-10-22 選靜態，手機省電）
(function () {
  const V = window.BJK.view;
  const FLOOR_Y = -0.82;
  const WALL_Z = -5, WALL_H = 1.3, WALL_W = 200;
  const VOID = 0x0d1215;   // 場景底色：大廳的圖解碼好之前、圖以外的地方
  // 大廳那張圖壓到三分之一亮：原圖那一帶平均亮度跟絨布差不多（2026-11-16 量到 65～97 對 93），
  // 壓暗後 18～29，跟舊版光點的 20～29 同一級（tests/check_room.js 守不到絨布的四成）
  const DIM = 0x555555;
  // 大廳那張圖離鏡頭的距離：要在牆後面、又在鏡頭 far（100）以內
  const BACK_DIST = 60;

  function build() {
    const group = new THREE.Group();

    // 地板要夠大：直式螢幕鏡頭往上平移後，小地板的左右邊緣會露出來。遠端停在牆腳，牆後只剩大廳的暗處與光點
    const carpet = V.textures.carpet();
    carpet.repeat.set(140, 140);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ map: carpet }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, WALL_Z + 200);

    // 牌桌落在地毯上的影子畫成一張圖：比即時陰影柔，地毯這麼大一片也不必每個像素查陰影貼圖
    const R = V.table.R, PAD = 2.2;
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(2 * (R + PAD), R + PAD),
      new THREE.MeshBasicMaterial({ map: V.textures.tableShadow(R, PAD), transparent: true, depthWrite: false }));
    shade.rotation.x = -Math.PI / 2;
    shade.position.set(0, FLOOR_Y + 0.01, (R + PAD) / 2);

    // 牆離所有會投影的東西都很遠，不收陰影，省掉每個像素查一次陰影貼圖
    const panel = V.textures.woodPanel();
    panel.repeat.set(WALL_W / 4, 1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(WALL_W, WALL_H, 0.3), new THREE.MeshLambertMaterial({ map: panel }));
    wall.position.set(0, FLOOR_Y + WALL_H / 2, WALL_Z - 0.15);

    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, WALL_W, 16), new THREE.MeshLambertMaterial({ map: V.textures.brass() }));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, FLOOR_Y + WALL_H + 0.05, WALL_Z);
    group.add(floor, shade, wall, rail);

    // 牆後的大廳是一張插畫（table_art.js），一個 draw call、每個像素只畫一層。使用者要背景壓暗、不跟牌桌搶眼，顏色乘上 DIM
    const lobby = V.textures.lobby();
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: lobby, color: DIM, depthWrite: false }));
    backdrop.userData.kind = 'backdrop';
    group.add(backdrop);

    const top = new THREE.Vector3(0, FLOOR_Y + WALL_H + 0.12, WALL_Z);
    const fwd = new THREE.Vector3(), up = new THREE.Vector3();
    const { size: [iw, ih], wall: line, focus } = V.tableArt.lobby;
    // 鏡頭定好之後呼叫：把大廳那張圖貼在牆上緣與畫面頂端之間。回傳牆上緣在畫面上的高度（−1 底、1 頂）
    function layout(camera, heightPx) {
      camera.updateMatrixWorld();
      const base = top.clone().project(camera).y;
      const low = base - 0.06;   // 往下多留一點，壓在牆後面，上緣不會露縫
      const frustumH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * BACK_DIST;
      camera.getWorldDirection(fwd);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      backdrop.quaternion.copy(camera.quaternion);
      backdrop.scale.set(frustumH * camera.aspect, frustumH * (1 - low) / 2, 1);
      backdrop.position.copy(camera.position).addScaledVector(fwd, BACK_DIST).addScaledVector(up, (1 + low) / 2 * frustumH / 2);
      // 照畫面位置裁圖、只調 UV 不重畫：圖的牆線對著牆上緣，寬要蓋滿畫面、高要蓋滿牆上那一帶，取兩者較大的倍率，不拉變形。
      // 直式手機那一帶高，水晶燈到整排老虎機都看得到、左右裁掉；桌機那一帶矮，只看得到構圖中心附近那一條
      const W = camera.aspect * heightPx, band = (1 - base) / 2 * heightPx, below = (base - low) / 2 * heightPx;
      const k = Math.max(W / iw, band / (line * ih));   // 畫面像素／圖的像素
      const win = band / k;
      const bottom = Math.min(Math.max(focus * ih + win / 2, win), line * ih);
      const rowTop = bottom - win, rowLow = bottom + below / k;
      lobby.repeat.set(W / k / iw, (rowLow - rowTop) / ih);
      lobby.offset.set((1 - W / k / iw) / 2, 1 - rowLow / ih);
      return base;
    }

    return { group, layout, backdrop };
  }

  V.room = { build, VOID, WALL_Z };
})();
