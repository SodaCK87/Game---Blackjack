// 籌碼模型：扁圓柱，側面是色塊條紋、上下面印面額
(function () {
  const V = window.BJK.view;
  const R = 0.2, H = 0.05;
  const DENOMS = [1000, 500, 100, 25, 5];
  const geometry = new THREE.CylinderGeometry(R, R, H, 40);
  const materials = new Map();

  function chipMaterials(value) {
    if (!materials.has(value)) {
      const side = new THREE.MeshStandardMaterial({ map: V.textures.chipSide(value), roughness: 0.45 });
      const top = new THREE.MeshStandardMaterial({ map: V.textures.chipTop(value), roughness: 0.45 });
      materials.set(value, [side, top, top]);
    }
    return materials.get(value);
  }

  function make(value) {
    const mesh = new THREE.Mesh(geometry, chipMaterials(value));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'chip', value };
    return mesh;
  }

  // 大面額在下；每片轉個角度、稍微錯開，看起來才像手疊的
  function stackOf(values, rng) {
    const group = new THREE.Group();
    values.forEach((value, i) => {
      const chip = make(value);
      chip.position.set((rng() - 0.5) * 0.02, H / 2 + i * H, (rng() - 0.5) * 0.02);
      chip.rotation.y = rng() * Math.PI * 2;
      group.add(chip);
    });
    return group;
  }

  function breakdown(amount) {
    const values = [];
    for (const d of DENOMS) while (amount >= d) { values.push(d); amount -= d; }
    return values;
  }

  V.chips = {
    R, H, DENOMS,
    make,
    stack: (amount, rng) => stackOf(breakdown(amount), rng),
    column: (value, count, rng) => stackOf(new Array(count).fill(value), rng),
  };
})();
