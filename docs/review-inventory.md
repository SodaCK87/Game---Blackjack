# 全面盤點台帳

> 型別：查詢型（一列一個大項，靠「本次」欄過濾）｜由 /蘇-全面盤點 產出｜各組只改自己那段標記之間，手改也照這條

1. 本次盤點：2026-10-27（子代理）
2. 上次盤點：2026-10-22
3. 細項檔：[缺口清單](probe-gap-list.md)｜[結構落差與搬移計畫](structure-plan.md)｜[效能基準](perf-baseline.md)

## 總覽

<!-- 總覽:開始 -->
1. 燈號：綠 7、黃 15、紅 0、不適用 1（共 23 項）。上一輪是綠 7、黃 11、紅 4、不適用 1。
2. 跟上次比：
   1. 變好：R01 紅→黃（假探針與沒人按的按鈕都補了）、R03 紅→黃、R04 紅→黃（BJK-02 修掉）、R10 紅→黃（開頁失敗有訊息了）、R22 黃→綠（回報方式與畫面版本號）。
   2. 變差：R08 綠→黃，`docs\版本紀錄_歷史.md:84` 一處「5 元籌碼」（B-03），主線重跑 grep 確認還在。
   3. R10 組 B 判紅，主線改判黃：理由寫在 R10 證據欄，與 R04 同一判準。
3. 複核：本輪沒有紅燈；R10 的證據（`probe_r10.js`）與 R08 的證據主線原樣重跑，與子代理一致。組 A 的還原已驗：`git status` 只多出四份盤點產出檔與 `tools\measure_perf.js`（組 E 的量測腳本），產品檔 0 處變動。
4. 缺口合計 23 條（A 11、B 3、C 4、D 5），未超過 25；D-06 併進 A-03。
5. 建議先做：
   1. B-01：牌局中途擲錯會靜默卡死、只能重新整理。BJK-02 就是這一型，下一個同類錯誤一樣會卡；接住 rejection 沿用現成的 `showFatal`，30 分鐘。
   2. A-01 併 A-02 的靜態那半：新增進 CI 的 `check_index.js`，守 `index.html` 路徑大小寫、分頁圖示與籌碼面額。錯了是所有用網址的同事一開就壞，現在只能上線後才發現。
   3. A-03：無頭瀏覽器收尾在機器忙時假紅，本輪四組都撞到。不修的話紅燈會被習慣性重跑掉，E 的計時也會受干擾。
   4. A-10：大特效等 54 條只在 Edge 跑，用 Chrome 的同事碰到分岔時測試全綠。
   5. C-01、C-03、C-04、D-02 合成一支純讀檔、進 CI 的 `check_docs.js`：測試數、突變數、網址三處、版號三處、線上驗過的版本，全是手寫同步，本輪已有一處對不上（C-04）。
6. 查不出來的部分：
   1. R23 已於 2026-10-28 計時（黃）：#15 大特效與 #9 npm test 超過使用者門檻，熱點 P-09～P-14 見 [效能基準](perf-baseline.md)〈第 2 輪〉。#15 照組 E 參考檔第 3 條會是紅、照主表是黃，主線照主表判黃。
   2. 真手機（D-05）與離線取得資料夾的走查（D-04），只有使用者能做。
   3. 焦點框實際顏色、大特效文字疊在漸層上的對比（R06），程式取不到值。
7. 要使用者決定的（不是缺口）：repo 沒有 LICENSE；25 個 commit 的作者 email 是個人信箱、repo 公開；B-03 的「原文照搬」與「不出現真錢字眼」兩條規則衝突。
8. 結構：S-01～S-08 都是規範文字缺口（R12 黃），照規則只列不排批次，見 [structure-plan.md](structure-plan.md)。
<!-- 總覽:結束 -->

## 組 A 探針與測試

<!-- 組A:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R01 | 探針清點與陽性對照 | 紅 | 黃 | ✅ 在 `%TEMP%\盤點A-31064\repo` 的複本（路徑含中文）跑 `npm test`：198 條 195 綠 3 紅（1,071 秒；同時另有 3 套 `npm test` 在跑、CPU 100%），3 條紅全是 Edge 收尾的 `leftover` 1，原樣重跑 5/5 綠，低負載時整套 198/198（369 秒），是量法錯（A-03）。檔內 53 條陽性對照本輪全綠；`npm run mutants` 60/60 抓到（174 秒，基準 5 支全綠），兩道關卡原樣重做都對：語法錯誤那列報沒抓到、基準弄紅就不跑破壞（上一輪 A-05 關閉）。另在複本下 31 處破壞（逐支見下表）；18 支探針每支本輪至少一次如期變紅（檔內對照、mutants 或本組的破壞）。上一輪的假探針（拿掉加倍自動停牌）與沒人按的按鈕（要牌停牌對調）本輪都會紅：mutants 第 3 列、`check_ui.js:422` 那條。核心路徑沒有假探針；非核心只守一半的三處：臉框常數（A-06）、只在 Edge 跑（A-10）、README 只比關鍵詞（A-11）；`index.html` 的靜態檢查仍不在 CI（A-01）。交付把關 E1 PASS（上一輪是量法錯的 FAIL） | A-01、A-03、A-06、A-10、A-11 |
| R02 | 回歸缺口 | 黃 | 黃 | ✅ 問題台帳 7 筆（BJK-01～07）全是 ✅ 已修，每筆寫的陽性對照都是檔內可執行的對照，本輪隨 `npm test` 全綠；另原樣重做三筆：BJK-01 的另一半（發牌也用垂手的身體輪廓 → 紅，D11）、BJK-02 的 mutants 列（紅）、BJK-04 的橫式夾值（拿掉 vh → 844×390「賠 1.5 倍！」跑出畫面，D18a）。E2 待驗 0、E8 已修 7 筆都寫了陽性對照。git 標題：參考檔的樣式 0 筆，陽性對照失敗（漏掉「修 BJK-01」「修 BJK-02」），加「修」才中 3 筆（21a2426、072a486、738315e），都對得到台帳。版本紀錄：v0.12.0 跟原型不一樣的五處行為，四處有探針會紅（大標位置、橫式 vh、籌碼晚出發 D18b、鏡像），大頭框置中沒有（A-09）；v0.9.0 分頁圖示 404（A-01）、v0.6.0 地板露底（A-08）、v0.4.1 臉框常數（A-06）仍沒人守；v0.2.0 `PCFSoftShadowMap`（D12 紅）、v0.8.1 名牌出界、v0.7.2 A+A 對 6、v0.10.0 量法三件都有探針。README 已知限制 4 條都是功能限制，第 3 條由 `check_ui.js:667` 起的 6／8 手版面守。沒守的都是畫面觀感、不會算錯，所以黃 | A-01、A-06、A-08、A-09 |
| R03 | 測試覆蓋 | 紅 | 黃 | ✅ 入口名稱到 tests、`mutants.js`、`check_live.js` 整字搜（陽性 `value` 179 筆、陰性 `zzNoSuchEntry` 0 筆）：core 31 個匯出都有測試碰到，只有沒人用的 `PERSONALITIES` 0 筆，`SPLIT` 表由 `decide` 逐格斷言；抽查 `topUp`、`aiChoice`、`declutter`、`faceRect` 四個只被提到幾次的都有斷言（`check_simulation.js:45`、`:77`，`check_ui.js:273`，`check_dealer.js:45`）。node 內建覆蓋率（CI 那 10 支、78 條）core 行 98.79%、分支 95.35%，沒蓋到的是瀏覽器外殼與一局裡牌發光的回收（`game.js:68-70`，缺口清單 A 段末判不值得做）。畫面 12 顆鈕有 10 顆被按過（上一輪 2 顆），要牌停牌對調本輪會紅（D17，上一輪 A-03 關閉）；+10、+50 仍 0 次 click，把 +50 面額寫成 55 整套照樣綠、實測按發牌就卡住（A-02）。轉向 0 條，拿掉 resize 監聽整套照樣綠（A-07）。核心邏輯都有會紅的測試，所以不到紅 | A-02、A-07 |
| R04 | 失敗模式 | 紅 | 黃 | ✅ 吞錯掃描（Grep 樣式 `\bcatch\s*(\([^)]*\))?\s*\{`，樣本 3 個 catch 全中、`mycatch`／`catchy` 不中）：產品碼 6 個 catch，存檔讀寫（`director.js:69`、`:87`）與偏好讀寫（`hud.js:11`、`:30`）退回預設且有註解，開頁自檢兩個（`main.js:20`、`:141`）走 `showFatal`；沒有 error／unhandledrejection 監聽。實測（無頭 Edge）：localStorage 一碰就擲 SecurityError、7 種壞存檔（bankrolls 是 null、字串、負數、不是 5 的倍數、v:2、整份是陣列、AI 存 3）都照常開局、打完一局、主控台 0 行；放在「同事 的 下載 (1)」這種含中文、空白、括號的資料夾也正常。牌局中途擲錯（讓 `startRound` 擲一次）則操作列停在 busy、荷官停在「下注結束，發牌！」、畫面沒有訊息，只能重新整理，同 B-01（以組 B 為準）；本組另找到一個真的會觸發它的入口：+50 面額寫錯（A-02）。檔案被鎖不適用（只用 localStorage）。目前程式裡沒有已知會擲錯的路徑，所以黃 | B-01；A-02 |
| R05 | 產出檔的消費端 | 不適用 | 不適用 | ✅ 不適用：不產出 xlsx／docx／pptx／csv，也沒有下載功能（app、tests、tools 搜 0 筆；同一條搜法對 `.png` 中 `tools/shoot.js:36`、`:74`；`app\js` 搜 download／Blob 只中 `showcase.js:126` 給頁面自己用的籌碼圖）。唯一的建置產物 `app/lib/three.js` 由消費端 Edge／Chrome 實際載入（`check_file_protocol` 本輪綠），且與重打包逐位元組相同（D06 尾巴多一個空白就紅） | — |
| R06 | 外觀 | 黃 | 黃 | ✅ 九項見下表，全走 `getComputedStyle`、`readPixels` 與 CDP，不看截圖判顏色。勝率小字 4.09:1（A-04）、360px 以下下注列換行（A-05）、轉向（A-07）、大頭框置中（A-09）；其餘已涵蓋或不適用。燈號照主表判黃（不卡住、不會看錯結果）；參考檔「對比不足而沒有探針守是紅」會判紅，兩者衝突依主表 | A-04、A-05 |

R01 逐支（本輪；破壞全做在 `%TEMP%` 複本，產品原檔 0 次原地破壞；D、M 是預期紅，G 是預期綠，G 的 8 處合在一次整套跑）：

| 探針 | 守什麼 | 本輪 | 檔內對照 | 本輪另做的破壞 |
| --- | --- | --- | --- | --- |
| `check_core_purity` | core 不碰亂數、DOM、計時器、THREE、view | 2/2 | 1 | D01 加 `Math.random()` → 紅；G6 加 `crypto.getRandomValues` → 綠（禁止清單只列 Math.random，缺口清單 A 段末判不值得做） |
| `check_dealer` | 泡泡在畫面內、不蓋臉、貼臉；五種表情兩隻手（BJK-01） | 9/9 | 2 | D10 泡泡推出畫面 → 6 條紅；D11 發牌也用垂手的輪廓 → 紅；G1b 臉框常數縮 25% → 9 條全綠（A-06），縮到 5×5 才只有檔內對照紅 |
| `check_file_protocol` | 雙擊 file:// 載入、繪圖、框景、主控台乾淨、進程收乾淨；app 無 ESM | 13/13（基準 Edge 手機 1 條 leftover，重跑綠） | 7 | D12 改回 `PCFSoftShadowMap` → 2 條紅；G2 `Hud.js` 大小寫、G3 拿掉分頁圖示 → 綠（A-01） |
| `check_fx` | 三段大特效各播一次、播完收乾淨、對齊、籌碼不直立不鏡像、少 showcase.js 開頁就說（只在 Edge） | 13/13 | 6 | D19 拿掉播完的 `el.remove()` → 3 條紅；G5 大頭框偏右 8 px → 綠（A-09） |
| `check_game` | 疊牌重現每種結局與每個規則參數 | 34/34 | mutants 29 列 | D09 分牌事件的 amount 變兩倍 → 紅 |
| `check_hand` | 點數 | 4/4 | mutants 1 列 | D02 三張 21 算 Blackjack → 2 條紅 |
| `check_odds` | 勝率對模擬（最大差 0.37%、分牌每手 0.45%）、建議對表 540＋540＋100 格 | 11/11 | mutants 19 列 | mutants 19 列本輪全紅 |
| `check_play` | 自動連打 8 局：打完、畫面＝事件＝引擎、帳平、大特效不拖慢不疊 | 12/12（基準 Edge 1 條 leftover，重跑綠） | 10 | D13 操作列籌碼多 5 → 2 條紅；D18b 籌碼晚出發不扣壽命 → 2 條紅；D14 閒家的牌蓋著落桌 → 綠（只比點數花色），`check_ui` 那條接住 |
| `check_readme` | 〈籌碼存在哪〉〈遇到問題〉、〈規則〉十句對 DEFAULTS | 4/4 | 2 | D08 DEFAULTS 改 `peek: true` → 紅；G7 規則句改成否定但留關鍵詞 → 綠（A-11） |
| `check_room` | 五種比例：牆上留大廳、光點在牆後、背景不到絨布四成亮 | 8/8（基準 Edge 直式 1 條 leftover，重跑綠） | 3 | G4 地板縮成 14 寬 → 綠（A-08） |
| `check_shoe` | 張數、種子、75% 重洗、回收 | 5/5 | 0（mutants 沒有一列打 shoe.js） | D03 切牌點 `>=` 改 `>` → 紅 |
| `check_simulation` | 一萬局帳平、十萬局三種個性的強弱 | 2/2 | mutants 3 列 | D04 拿掉莊家盈虧記帳 → 紅 |
| `check_strategy` | 基本策略逐格、三種個性、隨機比例、下注 | 13/13 | mutants 8 列 | mutants 8 列本輪全紅 |
| `check_three_bundle` | `lib/three.js` 等於重打包 | 2/2 | — | D06 尾巴多一個空白 → 紅 |
| `check_ui` | 標籤與按鈕排版、存檔、破產、勝率提示、讓位、BJK-02～07、分牌按鈕流程、分成 8 手的版面 | 65/65 | 22 | D14 → 紅；D16「重新開始」沒接 → 2 條紅；D17 要牌停牌對調 → 紅；D18a 拿掉橫式 vh 夾值 → 紅；G8 +50 面額 55、G9 拿掉 resize 監聽 → 綠（A-02、A-07） |
| `check_version` | `BJK_VER` 是 x.y.z | 1/1 | — | D07 → 紅（只驗格式，煙霧級；版號一致性由 `check_file_protocol`、`check_live` 守） |
| `mutants.js` | core 規則 60 種破壞 | 60/60 抓到 | — | M1 語法錯誤那列報沒抓到、等價改寫那列報沒抓到；M2 基準弄紅就不跑破壞 |
| `tools/check_live.js` | 線上版本＝本機、桌機手機各打兩局 | 4/4 組（線上 v0.12.0） | — | D20 本機版號改 9.9.9 → 4 組紅 |

R06 九項：

| 項 | 結論 | 本輪量到什麼 |
| --- | --- | --- |
| 1 對比 | A-04 | 桌機、手機 × 下注、輪到你四個狀態共量 121 筆：勝率小字 `#d6f3f4` 壓 `#008080` 12px 20 筆都是 4.09:1；其餘 101 筆 4.77–14.88:1，疊在畫布上的 28 筆（名牌、版本號）拿 `readPixels` 的最亮像素算，最壞 7.72:1；「建議」小牌 7.55:1、爆牌標籤 6.54:1。這四個狀態沒有停用鈕（照 WCAG 1.4.3 豁免）；`app` 搜 `:hover`、`:focus` 0 筆，也沒有輸入框與選取列，那幾種狀態不存在 |
| 2 宿主注入樣式 | 不適用 | 網頁不在 Revit／AutoCAD 裡。瀏覽器端的對應是強制色：CDP 模擬 `forced-colors: active`，操作列整片黑字白底，六顆下注鈕的字都在 |
| 3 深淺色 | 不適用 | 只有一套深色配色，`app` 搜 `prefers-color-scheme` 0 筆（同一條搜法對 `--hud-h` 中 3 筆）；CDP 模擬 light、dark 各一次，6 個元件的前景、底色、框色取值完全相同 |
| 4 版面 | 已涵蓋 | `check_ui`（按鈕一列、不出界、36px 高、標籤不重疊不出界、四顆鈕、分成 6／8 手）、`check_dealer`（泡泡）、`check_fx`（大標副標對齊）、`check_file_protocol`（框景）本輪全綠，檔內對照都紅；大頭框置中沒人守（A-09） |
| 5 溢出、最小寬、DPI | A-05、A-07 | 320×568、340×640 下注列「發牌」掉到第二列、內容高 116 > 110、下緣切掉 6 px；動作列四顆在 320 也排得下；360×640、683×384（1366×768 縮放 200%）、1280×720（1920×1080 縮放 150%）、844×390 都沒問題；轉向見 A-07 |
| 6 字型與 fallback | 本機已查；真手機見 D-05 | CDP `CSS.getPlatformFontsForNode`：泡泡（含全形標點樣本「：，！？（）・…「」、。；」17 字）、操作列、勝率小字、名牌、點數、版本號、大特效的副標與加倍那一幕全是微軟正黑體，大標 BLACKJACK! 是 Impact，沒有 fallback；手機沒有這兩套字，只能實機看 |
| 7 焦點與 Tab | 已查，沒探針（不列缺口） | 下注時 勝率開關 → +10 → +50 → +100 → +500 → 清除 → 發牌，輪到你時 勝率開關 → 要牌 → 停牌 → 加倍 → 分牌；每顆都符合 `:focus-visible`、瀏覽器預設焦點框（outline auto 1px）；框實際畫出的顏色程式取值量不到 📌 |
| 8 只靠顏色 | 已查，沒問題 | 爆牌標籤帶「爆」字（`director.js:199`、`:201`）、建議有文字小牌（`check_ui.js:218` 斷言）、開關寫開／關、加倍反灰時勝率字一起清掉（`check_ui.js:209` 斷言）、輪到你有荷官台詞與動作列；三段大特效的大標文字各不同；四種花色形狀各異 |
| 9 繁中字串 | 已查，沒問題 | `app`（排除 lib）20 檔 9,628 個中日韓字元、792 種，用 cp950 來回轉換比對：簡體 0（陽性對照：簡體 6 字全被標出、對應的繁體 0 字）；唯一不在 Big5 的是「・」U+30FB（5 處，不是簡體）；畫面上的英文只有刻意的 Blackjack 與載不起來時附的原因原文 |

組A 完成：2026-10-27 21:31

<!-- 組A:結束 -->

## 組 B 程式碼與安全

<!-- 組B:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R07 | 編碼紅線 | 綠 | 綠 | 交付把關 E5 PASS（沒有 .ps1／.bat）；版控文字檔 65 支逐支 TextDecoder fatal 解碼：非 UTF-8 0、帶 BOM 0（陽性對照：cp950 位元組檔判成非 UTF-8、BOM 檔抓得到）；U+FFFD 全樹 0 筆（陽性對照造兩個替換字元的檔抓得到）；tests／tools 讀文字檔的 readFileSync 都帶 'utf8'，不帶的只有 check_three_bundle.js:21-22 逐位元組比對 | 無 |
| R08 | 安全 | 綠 | 黃 | 金鑰三條內容樣式＋檔名樣式：工作樹、未追蹤檔、全歷史檔名都 0 筆（陽性對照：假金鑰 8 行全中，RE_TOKEN、get_token() 沒中；檔名 3 個全中）。注入：自補 JS 樣式（eval、new Function、innerHTML、insertAdjacentHTML、document.write、字串 setTimeout、child_process、動態 src；陽性對照 9 行全中、evaluate／myeval／obj.eval／textContent 沒中），產品碼命中 director.js:220、showcase.js:231、:275 的 innerHTML 與 dealer.js:134、showcase.js:156 的 src，來源全是常數座位名、Number.isFinite 過濾過的籌碼（director.js:67）、canvas 貼圖；tests／tools 的 child_process 參數是自己 mkdtemp 的標記。覆蓋：產品不寫檔（只寫 localStorage）；tests／tools 的寫刪全落在 mkdtemp 複本或 tools\_shots；%TEMP% 複本跑整套 npm test 前後 211 檔 SHA256 全同。workflow 權限 contents:read、pages、id-token，沒用 secrets。公開內容：app\ 真錢字眼 0、工地關鍵字只在 CLAUDE.md 規則句；文件剩 1 處見 B-03 | B-03 |
| R09 | 設定管理 | 黃 | 黃 | 三條寫死路徑樣式（排除 md／txt）產品碼 app\ 0 筆（陽性對照 5 行全中，Program Files (x86) 那行照舊漏抓，補搜磁碟代號才找到）；只在 tests\browser_util.js:9-10、tools\measure_perf.js:28-29 的瀏覽器安裝位置，existsSync 過濾。上輪 B-02 已關：README.md:64 寫明兩份籌碼、check_readme.js:21 守、:71 陽性對照。設定＝localStorage 的 bjk.save.v1（director.js:62）、bjk.prefs.v1（hud.js:6），讀寫都包 try、格式不對當新玩家（check_ui.js:138 起）。新缺口 B-02：少一支瀏覽器時那支的測試靜默消失 | B-02 |
| R10 | 日誌與診斷輸出 | 紅 | 黃 | 主線複核 2026-10-27：原樣重跑 `probe_r10.js`，牌局中途擲錯照樣停在 busy、`#fatal` 隱藏、主控台一筆 exception，少 table.js 照樣顯示「載不起來（v0.12.0）」，與組 B 一致（這次對照組取樣時還在發牌、停在 busy，紅燈情境停在「下注 0」沒發出牌，仍分得出來）。組 B 判紅；主線改判黃，與 R04 同一判準：目前沒有已知會在實際使用中擲錯的路徑（A-02 是假設面額改錯才觸發），不符合主表「同事實際使用時會當場卡住」。缺口本身照舊排第一（BJK-02 就是這一型）。以下為組 B 原證據：純前端、沒有 log 檔。上輪 B-01 的開頁載入失敗已修：本輪 %TEMP% 複本刪掉 js\view\table.js，無頭 Edge 畫面顯示「這台電腦載不起來 21 點（v0.12.0）」與原因、主控台也有一筆 console.error；角落常駐 v0.12.0。但牌局中途擲錯仍是靜默卡死：讓 BJK.strategy.bet 擲錯後按發牌，hud 停在 busy、#fatal 隱藏、畫面沒有任何按鈕與訊息（對照組不破壞時回到 act）。探針 %TEMP%\盤點B-1511\probe_r10.js，見 B-01 | B-01 |
| R11 | git 歷史衛生 | 綠 | 綠 | 25 個 commit、只有 main。兩個 ERE 樣式檔 git log --all -G 都 0 筆（陽性對照：拋棄式 repo 加刪假金鑰，兩條都列出加與刪兩個 commit，拿掉 -i 就撈不到 API_KEY）；刪除過的檔 0、Office／資料副檔名 0（同一對照抓得到 d/請款.xlsx）；1 MiB 以上 blob 0（對照抓得到 2 MiB 檔），最大 app/lib/three.js 744,186 bytes 只進過 1 次、docs/img/play.png 進過 2 次；pack 1.19 MiB。歷史裡真錢字眼只在 game.js 舊註解（已改）與 CLAUDE.md 規則句。📌 25 個 commit 的作者與提交者 email 全是同一個個人 gmail 信箱（值遮掉；git log --all --format='%ae' 可查），repo 為 PUBLIC（gh repo view），改不改由使用者決定，本組沒動歷史 | 📌 個人信箱是否改用 GitHub noreply，等使用者決定 |

組B 完成：2026-10-27 21:08

<!-- 組B:結束 -->

## 組 C 結構與文件

<!-- 組C:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R12 | 目錄結構與檔案落點 | 黃 | 黃 | ✅ 交付把關 E0 PASS（6 份都在）、E10 PASS；根目錄 7 檔剛好等於規範第 10 行；`git ls-files` 66 筆與 `git status --porcelain --ignored` 對得上。決策樹陽性對照三個真實檔名（`showcase.js`、`app\lib\three.js`、`tools\_shots\arm-after.png`）各落唯一且不同位置。上一輪 S-01～S-07 一筆沒關（規範與 `.gitignore` 自 06b0bfb 沒改過）：`check_live.js` 位置與決策樹第 7 問矛盾（S-01）、`dist\` 沒有重建腳本（S-02）、四份盤點產出檔不在規範內（S-03）；新增 S-08（`app\.gitkeep` 與「`app\` 根只放兩個檔」矛盾）。都是規範文字缺口，不會讓人找錯檔，所以黃 | S-01～S-08（規範修訂批） |
| R13 | 命名與版本化檔名 | 綠 | 綠 | ✅ E9 PASS；`git ls-files` 掃版本化檔名樣式 0 筆，陽性對照 `Core_v1.7.lsp`、`report_20260401.md` 都中；新檔 `check_fx.js`、`check_readme.js`、`fx_util.js`、`rig_util.js`、`showcase.js` 都合〈命名〉表。版號唯一來源 `version.js` 0.12.0；README 與版本紀錄手寫的版號歸 D-02，git tag 0 個歸 D-01 | — |
| R14 | .gitignore 與版控邊界 | 綠 | 綠 | ✅ E4 PASS（擋住 2/2、誤殺無）、E11 PASS（頂層 13 項）。`git check-ignore -v --no-index` 逐類命中 `**/_*/`（`tools/_shots/`、`tests/_out/`）、`dist/`、`node_modules/`、`Thumbs.db`、`desktop.ini`（含子資料夾）；反向對照 15 個不該擋的路徑（含 `app/lib/three.js`、四份盤點產出檔、`tools/measure_perf.js`）退出碼 1、0 筆。`git ls-files -ci --exclude-standard` 0 筆，陽性對照加 `-x index.html` 回 1。最大追蹤檔 `three.js` 744 KB（`npm test` 逐位元組比對綠）、`play.png` 450 KB，沒有憑證或大型二進位 | — |
| R15 | 文件長度 | 綠 | 綠 | ✅ 11 份 `.md` 用 `wc -l` 與 `Get-Content -Encoding UTF8` 交叉量，逐份一致，全在上限內：CLAUDE.md 20/40、README 81/400、路線圖 40/120、規範 110/150、版本紀錄 12/12 個版本（217 行，剛好到上限，下一版要先搬 v0.7.1）、問題台帳查詢型、歷史檔與盤點產出檔的型寫在各自檔頭。表二 0 筆 | 下一版發布前把 v0.7.1 搬進歷史檔 |
| R16 | 文件與程式同步 | 黃 | 黃 | ✅ E2、E3、E8 PASS；E7 這一輪認得 `.js` 了（「文件點名 12 支」，自我對照有 `.js` 的陽性與陰性），上一輪 C-04 關閉；另用組 C 的路徑檢查補掃路線圖與規範，19 個路徑全在、陽性對照回 MISSING。README 抽做：`node tools/check_live.js` 第二次四組全過、線上 v0.12.0（第一次 Edge 兩組假紅，見 A-03）；`npm test` 198/198 與狀態行一致；`MUTANTS` 60 列與 CLAUDE.md 一致；勝率最大差距 0.37%／0.45% 對得上 README。問題台帳 7 列全 ✅，沒有 🔴／🟡。數字沒人算（C-01～C-03），README 與路線圖對「線上驗過哪一版」互相矛盾（C-04），不會讓人操作錯，所以黃 | C-01～C-04 |

組C 完成：2026-10-27 21:08

<!-- 組C:結束 -->

## 組 D 交付與相依

<!-- 組D:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R17 | 交付與安裝 | 黃 | 黃 | 從 GitHub clone 到 `%TEMP%\盤點D (測試) 安裝-41608\21點 (同事) 副本`（中文、括號、空白），HEAD a8af0d7。同事路線不裝 node 套件（`node_modules` 不存在時跑）：`check_file_protocol.js` 以 file:// 開 `app\index.html`，Edge 156 與 Chrome 156 無頭、全新設定檔（首次啟動、沒有存檔），桌機與手機尺寸的載入、繪圖、框景、荷官五表情、主控台 0 則全部通過；唯一紅的是收尾的「進程沒收乾淨」（量法，A-03）。`app\`（排除 lib）對外網址只中 SVG 命名空間與 data URI，離線可玩、不需管理員權限。開發路線 `npm ci`（exit 0）→`npm run build:three`（雜湊不變）→`npm test` 198 條中 197 綠（689 秒，別組同時在跑），唯一紅的又是 Edge 橫式手機那條的 `leftover: 1`，其餘欄位都在門檻內；跑完 clone 工作樹乾淨。線上 `node tools/check_live.js` 四組中三組 v0.12.0 打完兩局沒錯，Edge 手機紅在殘留 1 個。README 離線路線沒寫資料夾從哪來 | D-04、A-03 |
| R18 | 版本相容面 | 黃 | 黃 | 支援範圍寫在 `README.md:75`（Windows 11 的 Edge、Chrome；iPhone 的 LINE 內建瀏覽器玩過、Android 沒有）。本機瀏覽器已自動升到 Edge 156.0.4314.42、Chrome 156.0.8078.48（上一輪 155），本輪在這兩版上桌機與 CDP 手機尺寸都載入、繪圖、框景通過（R17 那幾輪），線上版 Chrome 兩組、Edge 桌機通過。repo 沒有 `.ps1`／`.psm1`（`git ls-files` 副檔名過濾 0 筆，同一過濾抓 js＋png 46 筆），PowerShell 5.1 那條不適用。`package.json` 沒有 `engines`；本機 node 24.16.0，CI 最近一次裝到 24.21.0。真手機只驗了一部分 | D-05 |
| R19 | 相依版本與弱點 | 黃 | 黃 | npm 相依只有 devDependencies `esbuild 0.28.2`、`three 0.186.1`，精確釘版；`package-lock.json` v3 共 28 筆（其中 26 筆是 esbuild 各平台的選用套件），0 筆缺 integrity，來源只有 registry.npmjs.org。clone 上 `npm audit` 0 筆、`npm outdated` 0 筆；陽性對照：`%TEMP%` 對照資料夾鎖 lodash 4.17.15，audit 報 high 1、outdated 列出 4.18.1。沒有隨附的 dll／exe／msi／字型（副檔名過濾 0 筆）。扣分仍在 CI：action 只釘可移動的主版本 tag | D-03 |
| R20 | 授權 | 綠 | 綠 | 隨網站發出的第三方元件只有 three 0.186.1（MIT），`tools\build_three.js:14-23` 把完整 LICENSE 寫進 `app\lib\three.js` 檔頭（本輪讀過前 700 字元：MIT 全文與版權行）；esbuild 0.28.2（`package.json` 的 license＝MIT，LICENSE.md 版權 Evan Wallace）只在打包時用、不隨網站發出。沒有字型與二進位；Stack Overflow／gist／GitHub blob 網址樣式在 repo（排除 three.js 與 lock）Grep 0 筆，陽性對照：同一條在 `node_modules\three\src\math` 中 2 筆。📌 repo 本身仍沒有 LICENSE（GitHub API `license: null`）：公開但沒授權別人再用，要不要加由使用者決定 | — |
| R21 | 發佈與版本號流程 | 黃 | 黃 | 標準八條版本樣式在 repo 0 筆（陽性對照檔 9 行中 8 行、`$versionInfo` 那行沒中）；版號實際寫在 `app\js\core\version.js:6`、`README.md:81`、`docs\版本紀錄.md:8`，三處都是 0.12.0，沒有探針比對（D-02）。仍沒有任何 git tag，上一輪之後又發了六版（D-01）。發布＝推上 main 由 CI 上傳 `app\`，最近 8 次 workflow 全 success；clone 上 `npm run build:three` 重建的 `three.js` 與 commit 的那份 SHA256 相同（BA3A84E4…）。交付把關 E6 PASS（最新段落引用 BJK-03、BJK-04、BJK-05）。檢查清單六條：問題台帳 7 筆全是 ✅ 已修、0 個 🟡；README 狀態行 E3 PASS；`.gitignore` E4 PASS；沒有 ps1／bat；第 1 條（陽性對照）由組 A 判。⚠️ `README.md:81` 寫「上一次在網址上…各打兩局是 v0.10.0」，`目標路線圖.md:24` 寫 v0.11.1 驗過，兩處不一致（文件一致性歸組 C）；本輪 `check_live.js` 實測線上是 v0.12.0 | D-01、D-02 |
| R22 | 使用者回饋管道 | 黃 | 綠 | 上一輪 D-03、D-04 已關：`README.md:66-70`〈遇到問題〉寫了看右上角版本號、附截圖、GitHub issues 網址與沒帳號時找誰，回饋樣式 Grep 中 3 行（本輪讀過，都是回報說明），`tests\check_readme.js` 守這一節且有刪節的陽性對照；畫面角落顯示版本號（`app\index.html:15`、`main.js:9`），`check_ui.js:725-731` 斷言桌機與手機看得到，`:755` 起有拿掉那行的陽性對照。網頁遊戲沒有 log 檔，診斷靠「載不起來」訊息加截圖（README 第 3 條）。回報去處：`docs\問題台帳.md` BJK-01～07 都已配號；GitHub issues 至今 0 則 | — |

組D 完成：2026-10-27 21:11

<!-- 組D:結束 -->

## 組 E 效能

<!-- 組E:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R23 | 效能基準與熱點 | 黃 | 黃 | ✅ 2026-10-28 06:46–08:37 單獨計時（`node tools/measure_perf.js --live --keep --tmp <暫存> --json <暫存>\run2.json`，warmup 1＋5 次，接電源，開跑前 CPU 8–14%），結果追加在 [效能基準](perf-baseline.md)〈第 2 輪〉。19 個入口裡 2 個超過使用者門檻：#15 大特效（P-14）第一段你拿 Blackjack 每次 2 格長掉格（最長一格中位 146 ms 桌機、189 ms 手機，門檻容許 1 格），你加倍每次 2–3 格（99–106 ms，門檻 0 格），10 次全中；#9 npm test 中位 458,552 ms（7.6 分鐘），沒有測試失敗的兩次也要 313 秒，門檻 5 分鐘、超過兩倍才算紅。其餘入口都在門檻內：冷開 1.1–1.7 秒、按鈕反應 ≤24 ms、加倍 16 ms、分牌 7–9 ms、連玩後段÷開頭 1.00、heap 平。⚠ 照 `references/組E-效能.md`〈R23 的燈號〉第 3 條，#15 中位數超過門檻會是紅；照 SKILL.md〈燈號判準〉主表，紅是「當場卡住或看到錯的結果」，0.1–0.2 秒的頓一下不到這一級，兩者對不起來時照主表判黃。量測本身的問題 5 筆：npm test 6 次裡 4 次各有一條不同的測試失敗（全部平行跑時隨機紅，見效能基準〈量測本身的問題〉），`shoot.js --round` 一次 CDP 逾時 | 使用者回編號決定做哪幾項（建議 P-14、P-09＋P-10、P-11、P-13＋P-06）；npm test 隨機紅交給 R01 |

組E 完成：2026-10-28 08:43

<!-- 組E:結束 -->

## 盤點紀錄

| 日期 | 綠 | 黃 | 紅 | 不適用 | 模式 | 備註 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-22 | 7 | 11 | 4 | 1 | 子代理 | 第一次盤點；紅燈證據主線重跑一致；E 計時單獨跑、全部入口在使用者門檻內 |
| 2026-10-27 | 7 | 15 | 0 | 1 | 子代理 | 四紅轉黃、R08 綠轉黃；R10 組 B 判紅、主線依主表改黃；R23 於 2026-10-28 補計時、維持黃 |
