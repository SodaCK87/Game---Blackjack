// 籌碼模型：扁圓柱，側面是色塊條紋、上下面印面額。兩者畫在同一張貼圖上，一片籌碼只要一個 draw call
(function () {
  const V = window.BJK.view;
  const R = 0.2, H = 0.05;
  const DENOMS = [1000, 500, 100, 25, 5];
  const geometry = new THREE.CylinderGeometry(R, R, H, 40);
  {
    const { uv, normal } = geometry.attributes, { top, side } = V.textures.CHIP_ATLAS;
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, Math.abs(normal.getY(i)) > 0.5 ? 1 - (1 - uv.getY(i)) * top : uv.getY(i) * side);
    }
    geometry.clearGroups();
  }
  const materials = new Map();

  function chipMaterial(value) {
    if (!materials.has(value)) materials.set(value, new THREE.MeshLambertMaterial({ map: V.textures.chipAtlas(value) }));
    return materials.get(value);
  }

  function make(value) {
    const mesh = new THREE.Mesh(geometry, chipMaterial(value));
    mesh.castShadow = true;
    mesh.userData = { kind: 'chip', value };
    return mesh;
  }

  // 每片轉個角度、稍微錯開，看起來才像手疊的
  function jitter(i, rng) {
    return { x: (rng() - 0.5) * 0.02, y: H / 2 + i * H, z: (rng() - 0.5) * 0.02, rot: rng() * Math.PI * 2 };
  }

  // 大面額在下
  function stackOf(values, rng) {
    const group = new THREE.Group();
    values.forEach((value, i) => {
      const chip = make(value), j = jitter(i, rng);
      chip.position.set(j.x, j.y, j.z);
      chip.rotation.y = j.rot;
      group.add(chip);
    });
    return group;
  }

  function breakdown(amount) {
    const values = [];
    for (const d of DENOMS) while (amount >= d) { values.push(d); amount -= d; }
    return values;
  }

  // 籌碼架不會動：同面額併成一個網格一次畫完。原本近百片各畫一次，連陰影那輪一格 500 多個 draw call。
  // 不用 InstancedMesh：它要多編譯兩支著色器，手機開頁多等一截，這裡又用不到逐片移動
  function merged(matrices) {
    const src = geometry.attributes, n = src.position.count, tri = geometry.index.array, count = matrices.length;
    const pos = new Float32Array(n * count * 3), nor = new Float32Array(n * count * 3), uv = new Float32Array(n * count * 2);
    const index = new Uint32Array(tri.length * count), v = new THREE.Vector3(), nm = new THREE.Matrix3();
    matrices.forEach((m, k) => {
      nm.getNormalMatrix(m);
      for (let i = 0; i < n; i++) {
        const at = k * n + i;
        v.fromBufferAttribute(src.position, i).applyMatrix4(m).toArray(pos, at * 3);
        v.fromBufferAttribute(src.normal, i).applyMatrix3(nm).toArray(nor, at * 3);
        uv[at * 2] = src.uv.getX(i); uv[at * 2 + 1] = src.uv.getY(i);
      }
      tri.forEach((a, j) => { index[k * tri.length + j] = a + k * n; });
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    return out;
  }

  function rack(columns, rng) {
    const group = new THREE.Group(), byValue = new Map(), q = new THREE.Quaternion(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const { value, count, x } of columns) {
      if (!byValue.has(value)) byValue.set(value, []);
      for (let i = 0; i < count; i++) {
        const j = jitter(i, rng);
        byValue.get(value).push(new THREE.Matrix4().compose(p.set(x + j.x, j.y, j.z), q.setFromAxisAngle(up, j.rot), one));
      }
    }
    for (const [value, list] of byValue) {
      const mesh = new THREE.Mesh(merged(list), chipMaterial(value));
      mesh.castShadow = true;
      mesh.userData = { kind: 'chip', value, count: list.length };
      group.add(mesh);
    }
    return group;
  }

  V.chips = {
    R, H, DENOMS,
    make, rack,
    stack: (amount, rng) => stackOf(breakdown(amount), rng),
  };
})();
