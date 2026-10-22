// 守 app/lib/three.js 是 node_modules/three 原樣打包出來的：沒被手改、升級 three 後沒忘了重打包。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, OUT, THREE_DIR } = require('../tools/build_three');

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('node_modules 裡的 three 就是 package.json 釘的版本', () => {
  assert.ok(fs.existsSync(THREE_DIR), '沒有 node_modules/three，先跑 npm ci');
  const installed = JSON.parse(fs.readFileSync(path.join(THREE_DIR, 'package.json'), 'utf8')).version;
  assert.strictEqual(installed, PKG.devDependencies.three);
});

test('app/lib/three.js 與現場重打包的一份逐位元組相同', () => {
  const tmp = path.join(os.tmpdir(), `bjk-three-${process.pid}.js`);
  try {
    build(tmp);
    const committed = fs.readFileSync(OUT);
    const fresh = fs.readFileSync(tmp);
    assert.ok(committed.equals(fresh), `不一致（${committed.length} vs ${fresh.length} bytes）：跑 npm run build:three 後一起 commit`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
