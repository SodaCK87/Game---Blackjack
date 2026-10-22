// 階段 0 的煙霧測試：證明 three 與 core 在 file:// 下都載得起來、畫得出第一張圖。階段 2 換成真正的牌桌。
(function () {
  const status = { three: 'missing', ver: 'missing', render: 'not-run' };
  try {
    status.three = THREE.REVISION;
    status.ver = BJK.version.BJK_VER;

    const canvas = document.getElementById('table');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x212c31);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 6, 7);
    camera.lookAt(0, 0, 0);

    // 半圓牌桌：絨布面加一圈木框
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 0.2, 64, 1, false, -Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x0b6e4f, roughness: 0.9 })
    );
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(5, 0.25, 16, 64, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6 })
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.1;
    felt.position.z = rail.position.z = -1.5;
    scene.add(felt, rail);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 1.2));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.5);
    lamp.position.set(2, 8, 4);
    scene.add(lamp);

    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
    window.addEventListener('resize', resize);
    resize();
    status.render = 'ok';
  } catch (e) {
    status.render = 'fail: ' + e.message;
  }
  // 給 tests/check_file_protocol.js 讀的狀態，畫面上不顯示
  document.body.dataset.bjk = JSON.stringify(status);
})();
