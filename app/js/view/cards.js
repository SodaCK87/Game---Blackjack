// 撲克牌模型：薄盒子，上下兩面各貼牌面與牌背；圓角靠貼圖透明＋alphaToCoverage 挖掉，邊緣跟著抗鋸齒
(function () {
  const V = window.BJK.view;
  const W = 0.55, H = 0.77, T = 0.008;

  // BoxGeometry 六面的 group 順序是 +x −x +y −y +z −z，一面一個 draw call。sets 的每一組面併成一個 group，沒列到的面不畫
  function mergeFaces(geometry, sets) {
    const index = [...geometry.index.array], groups = geometry.groups;
    const merged = sets.map(faces => faces.flatMap(f => index.slice(groups[f].start, groups[f].start + groups[f].count)));
    geometry.setIndex(merged.flat());
    geometry.clearGroups();
    let start = 0;
    merged.forEach((list, i) => { geometry.addGroup(start, list.length, i); start += list.length; });
    return geometry;
  }

  // 牌只畫上下兩面：側邊比一個像素還薄，畫了只會在牌緣留下鋸齒、在疊牌的交界留下斷續的點（2026-10-31 放大才看到）
  const geometry = mergeFaces(new THREE.BoxGeometry(W, T, H), [[2], [3]]);

  function material(map) {
    return new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, alphaToCoverage: true });
  }
  // 陰影那輪不看圓角：不取樣貼圖，也少編譯一支著色器
  const depth = new THREE.MeshDepthMaterial();
  const materials = new Map();
  function cachedMaterial(key, make) {
    if (!materials.has(key)) materials.set(key, material(make()));
    return materials.get(key);
  }

  // 軟影子貼片：燈幾乎在正上方，即時陰影全被牌自己蓋住，疊牌看不出上下層，所以底下墊一片畫好的模糊影子。
  // 法線朝本地 +y、貼在牌底下：疊牌時落在下一張牌上；牌蓋著（rotation.z = π）時背面朝鏡頭被剔除，不會浮到牌背上面。
  // 透明＋貼圖跟棄牌盒的玻璃同一支著色器，不多編譯。最底那張牌的影子離絨布只有一點五毫米，polygonOffset 讓它贏過絨布的深度；
  // 只能用 units 不能用 factor：factor 跟著斜率放大，斜看時影子會穿到自己的牌面上，整張牌變灰（2026-11-07 截圖看到）
  const PAD = W * V.textures.CARD_SHADOW;
  const shadowGeometry = new THREE.PlaneGeometry(W + 2 * PAD, H + 2 * PAD).rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: V.textures.cardShadow(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetUnits: -4,
  });
  const SHADOW_Y = -T / 2 - 0.0005;

  // 牌的上緣（畫布頂端）在本地 -z：rotation.y = 0 時，坐在 +z 的玩家看到的是正的
  function make(rank, suit, faceUp) {
    const face = cachedMaterial(`f-${rank}${suit}`, () => V.textures.cardFace(rank, suit));
    const back = cachedMaterial('back', V.textures.cardBack);
    const up = faceUp ? face : back, down = faceUp ? back : face;
    const mesh = new THREE.Mesh(geometry, [up, down]);
    // 投影到絨布上，但牌自己不收陰影：一格省下每個像素 5 次陰影取樣，疊牌的交界也不會有雜訊點
    mesh.castShadow = true;
    mesh.customDepthMaterial = depth;
    mesh.userData = { kind: 'card', rank, suit, faceUp };
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.position.y = SHADOW_Y;
    shadow.userData.kind = 'shadow';
    mesh.add(shadow);
    return mesh;
  }

  // 一疊蓋著的牌（棄牌盒、發牌盒裡用）：側面是一層層的紙邊
  const deckEdge = new THREE.MeshLambertMaterial({ map: V.textures.deckEdge() });
  function deck(height) {
    const back = cachedMaterial('back', V.textures.cardBack);
    const mesh = new THREE.Mesh(mergeFaces(new THREE.BoxGeometry(W, height, H), [[0, 1, 3, 4, 5], [2]]), [deckEdge, back]);
    mesh.castShadow = true;
    return mesh;
  }

  V.cards = { W, H, T, make, deck };
})();
