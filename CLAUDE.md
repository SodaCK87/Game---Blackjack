# 21 點（Game---Blackjack）

網頁 21 點：Three.js 3D 牌桌、SVG 插畫荷官、3 位規則型 AI 同桌，給同事玩，發布在 GitHub Pages。缺陷編號前綴 `BJK`。

職責：只放這個 repo 才成立的規則。型別：從頭讀型，上限 40 行；細節下放到下面指向的文件。跨專案通則在全域 `~\.claude\CLAUDE.md`，不在這裡重複。

1. 檔案放哪、命名、哪些不進版控、文件上限、缺陷編號，一律照 [docs/檔案結構規範.md](docs/檔案結構規範.md)。
2. 里程碑、現在卡在哪、明確不做的事看 [目標路線圖.md](目標路線圖.md)。
3. `app\js\core\` 是純邏輯：不准引用 `app\js\view\`、不准碰 DOM／Three.js／計時器、不准直接呼叫 `Math.random`。亂數由呼叫端傳入，探針才重現得了同一副牌；動畫要等的東西一律在 view 層等。每支 core 檔的外殼照 `app\js\core\version.js`：瀏覽器掛到 `window.BJK.<名稱>`，node 走 `module.exports`；有依賴的照 `game.js`（node 走 `require`、瀏覽器走 `BJK.<名稱>`，缺了當場擲「載入順序錯」），`index.html` 照依賴順序排。`tests\check_core_purity.js` 守這一條。
4. `app\` 一律 classic script，不准 `type="module"`、`import`／`export`。2026-10-22 實測 Edge 與 Chrome 在 file:// 下 ES module 被 CORS 擋（同一頁走 http 正常），同事雙擊會一片空白。Three.js 因此由 `npm run build:three` 打包成全域 `THREE` 的 `app\lib\three.js`，不准手改。
5. 驗證一律 `npm test`（＝`node --test "tests/check_*.js"`；node 24 的 `--test` 給目錄會失敗，要給 glob）。剛 clone 先 `npm ci`。會開無頭 Edge／Chrome，不搶焦點。
   1. 看畫面用 `node tools/shoot.js <前綴>`，桌機 1280×720 與手機 390×844 各一張，落在 `tools\_shots\`；加 `--dealer` 改成荷官五種表情各一張，加 `--round` 改成照正常速度打一局、截下注／輪到你／結算／下一局四張。
   2. 改了 core 的規則或它的測試之後跑 `npm run mutants`：在暫存複本植入 15 種錯誤，每一種都要有測試變紅（不在 `npm test` 裡）。新增規則時也往 `tests\mutants.js` 的表加一列。
   3. 模擬手機尺寸一律走 `tests\browser_util.js` 的 CDP，不要用 `--window-size`：無頭視窗寬度最小被夾在約 500px，要 390 實得 496，截圖只截到左半邊而判準照樣綠。
6. 畫面只照 `game.js` 回傳的事件演，不准自己去讀引擎狀態來擺牌或籌碼。`director.js` 每演完一個事件就拿畫面跟事件累積比、每批事件演完再跟引擎比，不一致記進 `mismatches`，`tests\check_play.js` 讀它。新增事件種類時，`handlers` 與 `checkAfter` 兩處都要加。
7. 勝率提示（`core\odds.js`）只准吃畫面上翻開的牌：`director.js` 的 `computeOdds` 從 `rotation.z === 0` 的牌收，荷官底牌蓋著自然排除。不准改成讀引擎狀態——那裡有底牌。`check_ui.js` 斷言「算的牌數＝翻開的牌數」，對照是把底牌算進去。
8. 籌碼存在 localStorage 的 `bjk.save.v1`（file:// 下整台電腦的本機檔共用同一個 origin，所以 key 帶專案前綴）。改存檔格式就換 key 的版號，不准讓舊存檔被讀成錯的數字；讀不到或格式不對一律當新玩家。
9. 這是公開 repo：不准放任何工地資料、同事真名或照片。AI 同桌的名字用虛構的。
10. 籌碼只是遊戲點數：畫面與文件不出現「元」「NT$」這類真錢字眼。
