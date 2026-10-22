// core 的 node 測試範本：直接 require app/js/core/ 底下的檔，不開瀏覽器。
const test = require('node:test');
const assert = require('node:assert');
const { BJK_VER } = require('../app/js/core/version.js');

test('BJK_VER 是 x.y.z 格式', () => {
  assert.match(BJK_VER, /^\d+\.\d+\.\d+$/);
});
