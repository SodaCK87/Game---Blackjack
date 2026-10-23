// core 的每支檔都用這個外殼：瀏覽器以 classic script 載入時掛到 window.BJK，node 測試時走 module.exports
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BJK = root.BJK || {}).version = factory();
})(globalThis, function () {
  return { BJK_VER: '0.12.0' };
});
