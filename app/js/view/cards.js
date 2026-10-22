// 撲克牌模型：薄盒子，上下兩面各貼牌面與牌背；圓角靠貼圖透明＋alphaTest 挖掉
(function () {
  const V = window.BJK.view;
  const W = 0.55, H = 0.77, T = 0.008;
  const geometry = new THREE.BoxGeometry(W, T, H);
  const edge = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.6 });

  function material(map) {
    return new THREE.MeshStandardMaterial({ map, roughness: 0.55, alphaTest: 0.5 });
  }
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
    const mesh = new THREE.Mesh(geometry, [edge, edge, up, down, edge, edge]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'card', rank, suit, faceUp };
    return mesh;
  }

  // 一疊蓋著的牌（棄牌盒、發牌盒裡用）
  function deck(height) {
    const back = cachedMaterial('back', V.textures.cardBack);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, height, H), [edge, edge, back, edge, edge, edge]);
    mesh.castShadow = true;
    return mesh;
  }

  V.cards = { W, H, T, make, deck };
})();
