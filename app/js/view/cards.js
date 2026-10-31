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
