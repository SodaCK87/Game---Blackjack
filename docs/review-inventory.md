# 全面盤點台帳

> 型別：查詢型（一列一個大項，靠「本次」欄過濾）｜由 /蘇-全面盤點 產出｜各組只改自己那段標記之間，手改也照這條

1. 本次盤點：2026-10-22（子代理）
2. 上次盤點：—
3. 細項檔：[缺口清單](probe-gap-list.md)｜[結構落差與搬移計畫](structure-plan.md)｜[效能基準](perf-baseline.md)

## 總覽

<!-- 總覽:開始 -->
1. 燈號：綠 7、黃 11、紅 4、不適用 1（共 23 項）。第一次盤點，沒有上次可比。
2. 紅燈 4 項（R01、R03、R04、R10），主線在組 E 計時（22:37）之前把證據指令原樣重跑一次，結果與子代理一致：K07／K07b 照樣綠（假探針）、K19 對調後 107 綠、`repro_bet.js` 在 Edge 與 Chrome 都卡在 busy、`fail_probe.js` 兩種失敗畫面都沒有訊息。
3. 組 A 的還原已驗：產品原檔 0 次原地破壞，`git status` 只多出盤點產出檔與 `tools\measure_perf.js`。
4. 缺口合計 24 條（A 11、B 2、C 4、D 7），未超過 25；A-11 由主線依組 E 的回報補列。
5. 建議先做：
   1. A-01：預填注沒取整，籌碼尾數 5 時按「發牌」當場卡死；唯一一件「當場卡住 × 常見」。先配 BJK-02 再修。
   2. A-02：加倍後自動停牌是假探針，補一條疊牌 10 分鐘。
   3. B-01 併 D-04：載入失敗要有中文訊息、畫面角落顯示版本號，回報才有線索。
   4. A-04：`index.html` 的大小寫與分頁圖示靜態檢查進 CI，擋住只在 Linux 的 Pages 才壞的錯。
   5. A-03：真的按按鈕跑一局的測試，A-01 這類錯才抓得到。
6. 查不出來的部分：真手機（D-06，只有使用者能做）、離線取得資料夾的走查（D-05）、沒有 WebGL 的公司電腦多常見（B-01 機率，📌 要問使用者）、焦點框實際顏色（R06）。
7. 要使用者決定的（不是缺口）：repo 沒有 LICENSE；歷史 18 個 commit 的作者 email 是個人信箱、repo 是公開的。
<!-- 總覽:結束 -->

## 組 A 探針與測試

<!-- 組A:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R01 | 探針清點與陽性對照 | — | 紅 | ✅ 在 `%TEMP%\盤點A-51892` 的複本（路徑含中文）跑：`npm test` 107/107 綠（Edge＋Chrome，152 秒）、`npm run mutants` 15/15 抓到（23 秒）、`node tools/check_live.js` 線上 4 組綠。檔內 23 條陽性對照隨 `npm test` 本輪全數重跑。另在複本下 27 次破壞（逐支見下表），16 支探針每支至少一次如期變紅。⚠️ 假探針 1 處守在核心規則：拿掉「加倍後自動停牌」（`game.js:138`），整套 107 條照樣全綠（A-02）。交付把關 E1 判 FAIL 是量法錯：它只認 `dotnet test`／`pytest`／`unittest` 與 .py／.ps1／.bat，本專案入口 `npm test` 寫在 `CLAUDE.md:11`、`package.json:6` | A-02、A-05、A-04、A-08 |
| R02 | 回歸缺口 | — | 黃 | ✅ 問題台帳 1 筆 BJK-01（已修）：檔內對照與本輪補做的修正另一半（身體輪廓改回含右袖，K04）都紅；E2 待驗 0、E8 已修 1 筆有寫對照。git 標題 18 筆：參考檔樣式 0 筆（連「修 BJK-01」都漏），加「修 」才中 1 筆。版本紀錄裡修過的：BJK-01、名牌出界（v0.8.1）、A+A 對 6（v0.7.2）、PCFSoftShadowMap 警告（v0.2.0，原樣重做 K05）有探針且本輪會紅；沒人守的 3 處本輪都破壞驗過：分頁圖示 404（K24，A-04）、地板露底（K13，A-09）、臉框常數（K03，A-08）。另 3 處觀感（絨布字被手牌壓到、上唇鬍渣、名牌糊字）只能靠 `shoot.js` 截圖人看。都不會卡住或算錯，所以黃 | A-04、A-09、A-08 |
| R03 | 測試覆蓋 | — | 紅 | ✅ 入口名稱到 tests、`mutants.js`、`check_live.js` 整字搜（對照：`value` 56 筆、假名 0 筆）：core 匯出的函式都有斷言（只有沒人用的 `PERSONALITIES` 沒有），node 內建覆蓋率量 core 行 98.2%、分支 93.2%（沒蓋到的是瀏覽器外殼與一局裡發光重洗 `game.js:34-36`）。畫面入口只有「重新開始」「勝率提示」被按過，下注列 6 顆、動作列 3 顆 0 次 click；要牌停牌對調整套 107 綠（K19）。下注金額的算式（`hud.js:75`）是計算邏輯且零測試，本輪就在那裡量到當場卡住（A-01）。轉向 resize 零測試（A-10） | A-01、A-03、A-10 |
| R04 | 失敗模式 | — | 紅 | ✅ 吞錯掃描（JS 樣式，樣本 4 中 2 不中）：產品碼 6 個 catch，空的 2 個都是 localStorage 寫入（`director.js:65`、`hud.js:30`，有註解），壞存檔照常開局有 `check_ui` 守；沒有 unhandledrejection／onerror。實測：籌碼尾數 5 又少於上一注時按「發牌」，主控台 `Uncaught (in promise) Error: 你 的下注 15 不是 10 的倍數`、操作列停在 busy 只剩勝率開關、只能重新整理（`repro_bet.js`，Edge、Chrome 都重現，A-01）；不給 WebGL（`--disable-3d-apis`）或 three.js 沒載到，一片暗底加按不動的按鈕、沒有中文說明（`repro_nogl.js`，同 B-01，以組 B 為準）。檔案被鎖不適用（只用 localStorage） | A-01；B-01 |
| R05 | 產出檔的消費端 | — | 不適用 | ✅ 不適用：不產出 xlsx／docx／pptx／csv（app、tests、tools 搜 0 筆；同一條搜法對 .png 中 `tools/shoot.js`）。唯一的建置產物 `app/lib/three.js` 由消費端 Edge／Chrome 實際載入（`check_file_protocol`），且與重打包逐位元組相同（K17 會紅） | — |
| R06 | 外觀 | — | 黃 | ✅ 九項見下表，全走 `getComputedStyle` 與 CDP（`CSS.getPlatformFontsForNode`、`Input.dispatchKeyEvent`、`Emulation`），不看截圖判顏色。勝率小字 4.09:1（A-06）、360px 以下操作列換行出界（A-07）。燈號照主表判黃（不卡住、不會看錯結果）；R06 參考檔「對比不足沒探針守是紅」會判紅，兩者衝突依主表 | A-06、A-07 |

R01 逐支（本輪；破壞全做在複本，產品原檔 0 次原地破壞）：

| 探針 | 守什麼 | 本輪 | 檔內對照 | 本輪另做的破壞 |
| --- | --- | --- | --- | --- |
| `check_core_purity` | core 不碰亂數、DOM、計時器、THREE、view | 2/2 | 1 | K01 加 `Math.random` → 紅；K21 讀 localStorage → 綠（禁止清單沒列，node 跑到也會擲錯，不列缺口） |
| `check_dealer` | 泡泡在畫面內、不蓋臉、貼臉；五種表情兩隻手（BJK-01） | 9/9 | 2 | K02 泡泡放到畫面外 → 紅（補上檔內註明缺的那條）；K04 BJK-01 另一半 → 紅；K03 臉框常數縮小 → 綠（A-08） |
| `check_file_protocol` | 雙擊 file:// 載入、繪圖、框景、主控台乾淨、進程收乾淨；app 無 ESM | 13/13 | 7 | K05 改回 `PCFSoftShadowMap` → 紅；K06 檔名大小寫 → 綠；K24 拿掉分頁圖示 → 綠（A-04） |
| `check_game` | 疊牌重現每種結局 | 14/14 | mutants 3 列 | K07 加倍不自動停牌 → 綠，假探針（A-02） |
| `check_hand` | 點數 | 4/4 | mutants 1 列 | K08 三張 21 算 Blackjack → 紅 |
| `check_odds` | 勝率對模擬（最大差 0.35%）、建議對表 540 格 | 6/6 | mutants 5 列 | K09 停牌同點算贏 → 紅 |
| `check_play` | 自動連打 8 局：打完、畫面＝事件＝引擎、帳平 | 5/5 | 3 | K10 操作列籌碼差 5 → 紅；K11 閒家牌蓋著落桌 → 綠（只比點數花色），`check_ui` 接住（K11b 紅） |
| `check_room` | 牆上留大廳、光點在牆後、背景不到絨布四成亮 | 8/8 | 3 | K12 光點砍七成 → 綠（門檻 ≥30 寬，觀感不列）；K13 地板縮窄 → 綠（A-09） |
| `check_shoe` | 張數、種子、75% 重洗、回收 | 5/5 | 0（mutants 沒有一列打 shoe.js） | K14 切牌點差一 → 紅 |
| `check_simulation` | 一萬局帳平、十萬局強弱 | 2/2 | mutants 2 列 | K15 莊家盈虧沒記 → 紅 |
| `check_strategy` | 基本策略逐格、三種個性、隨機比例 | 9/9 | mutants 4 列 | K16 莽撞 9 點不加倍 → 紅 |
| `check_three_bundle` | `lib/three.js` 等於重打包 | 2/2 | — | K17 尾巴多一個空白 → 紅（v0.1.0 原樣重做） |
| `check_ui` | 標籤、按鈕排版、存檔、破產、勝率提示、讓位 | 27/27 | 7 | K18「重新開始」沒接 → 紅；K19 要牌停牌對調 → 整套 107 綠（A-03） |
| `check_version` | `BJK_VER` 是 x.y.z | 1/1 | — | K20 → 紅（只驗格式，煙霧級） |
| `mutants.js` | core 規則 15 種破壞 | 15/15 抓到 | — | K22 等價改寫報沒抓到（對）；語法錯誤報抓到了（錯，A-05） |
| `tools/check_live.js` | 線上版本等於本機、桌機手機各打兩局 | 4/4 組 | — | K23 本機版號改 9.9.9 → 4 組紅 |

R06 九項：

| 項 | 結論 | 本輪量到什麼 |
| --- | --- | --- |
| 1 對比 | A-06 | 勝率小字 `#d6f3f4` 壓 `#008080` 12px 4.09:1；其餘可用文字 4.77–14.88:1（名牌底下畫布取白最壞 8.05:1）；停用鈕 2.17、2.8:1（WCAG 1.4.3 豁免停用元件）；`style.css` 沒有 `:hover`，也沒有輸入框與選取列，那三種狀態不存在 |
| 2 宿主注入樣式 | 不適用 | 網頁不在 Revit／AutoCAD 裡。瀏覽器端的對應是 Windows 對比佈景主題：CDP 模擬 forced-colors，操作列整片改黑字白底，建議、爆牌、開關仍有文字分得出來 |
| 3 深淺色 | 不適用 | 沒有 `prefers-color-scheme` 分支；CDP 模擬 light、dark 各一次，6 個元件的前景、底色、框色取值完全相同 |
| 4 版面 | 已涵蓋 | `check_ui`（按鈕一列、不出界、36px 高、標籤不重疊不出界）、`check_dealer`（泡泡）、`check_file_protocol`（框景）都有檔內對照且本輪重跑；另量 844×390、683×384、1024×600 都沒問題 |
| 5 溢出、最小寬、DPI | A-07 | 320、340 寬時下注列與動作列換行出界，360 以上沒問題；1366×768 縮放 200%（683×384）與 1920×1080 縮放 150%（1280×720）沒問題；轉向見 A-10 |
| 6 字型與 fallback | 本機已查；真手機見 D-06 | CDP 讀實際字型：操作列、泡泡、名牌、橫幅與全形標點樣本（：、，！？（）・…「」）全是微軟正黑體，沒有 fallback；手機沒有這套字，只能實機看 |
| 7 焦點與 Tab | 已查，沒探針（不列缺口） | Tab 順序：勝率開關→+10→+50→+100→+500→清除→發牌；每顆都符合 `:focus-visible`、有瀏覽器預設焦點框（outline auto）；框實際畫出的顏色程式取值量不到 📌 |
| 8 只靠顏色 | 已查，沒問題 | 爆牌標籤帶「爆」字、建議有文字徽章（`check_ui` 斷言徽章內容）、開關寫開／關、輪到你有荷官台詞與動作列；四種花色形狀各異 |
| 9 繁中字串 | 已查，沒問題 | app 19 檔 459 段中文用 Windows StrConv（cp950）比對：簡體 0（對照：簡體樣本 4 字全被標出）；只標出註解裡的「准」「台」（台灣通用）與「・」（U+30FB 不在 Big5，不是簡體）；英文只有刻意的 Blackjack |

組A 完成：2026-10-22 22:23

<!-- 組A:結束 -->

## 組 B 程式碼與安全

<!-- 組B:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R07 | 編碼紅線 | — | 綠 | 交付把關 E5 PASS（沒有 .ps1／.bat）；版控文字檔 55 支逐支以 TextDecoder fatal 解碼，非 UTF-8 0、帶 BOM 0（陽性對照：cp950 位元組檔判成非 UTF-8）；替換字元 U+FFFD 全樹 0 筆（陽性對照抓得到）；tests／tools 的 readFileSync 讀文字檔都帶 'utf8' | 無 |
| R08 | 安全 | — | 綠 | 金鑰三條內容樣式＋檔名樣式：工作樹、未追蹤檔、全歷史檔名都 0 筆（陽性對照：假金鑰 7 行、檔名 3 個全中，RE_TOKEN、get_token() 沒中）。注入：參考檔沒有 JS 樣式，本輪自補 eval／new Function／innerHTML／child_process 四類，命中 director.js:124 innerHTML（名字是常數、籌碼經 Number.isFinite 過濾，壞存檔有 check_ui.js:140 守）與 tests 裡 3 處 child_process（參數全是自己 mkdtemp 的標記與 pid）。覆蓋：fs 寫刪全在 tests 的 mkdtemp 複本；在 %TEMP% 複本跑整套 npm test（107 綠、221 秒），前後 187 檔 SHA256 全同。workflow 權限只開 contents:read、pages、id-token，沒用 secrets | 無 |
| R09 | 設定管理 | — | 黃 | 三條寫死路徑樣式（排除 md／txt）產品碼 app\ 0 筆，只中 tests\browser_util.js:10；同檔第 9 行 Program Files (x86) 樣式漏抓、讀檔才找到。兩行都是瀏覽器安裝位置當起點、existsSync 過濾，全找不到時 check_file_protocol.js:59 以中文訊息變紅。設定＝localStorage 的 bjk.save.v1、bjk.prefs.v1，讀不到或格式不對當新玩家（check_ui.js:140、:312 守）。缺口 B-02：網址版與雙擊版的籌碼分開記，README〈籌碼存在哪〉沒寫 | B-02 |
| R10 | 日誌與診斷輸出 | — | 紅 | 純前端、沒有 log 檔。在 %TEMP% 複本造兩種失敗（getContext 回 null 模擬沒有 WebGL、刪掉 js\view\table.js）用無頭 Edge 開：畫面只剩「籌碼 0 下注 0」與下注按鈕，沒有任何訊息；錯誤原文只寫進 body 的 data-bjk（main.js:5 註明畫面不顯示）。正常情況畫面上也看不到版本號（同 D-04）。見 B-01 | B-01；版本號顯示併 D-04 |
| R11 | git 歷史衛生 | — | 綠 | 18 個 commit、只有 main。兩個秘密樣式檔跑 git log --all -G 都 0 筆（陽性對照：拋棄式 repo 加刪假金鑰，兩條都列出加與刪兩個 commit）；刪除過的檔 0、Office／資料副檔名 0（同一陽性對照抓得到 d/請款.xlsx）；1 MiB 以上 blob 0（對照抓得到 2 MiB 檔），最大是 app/lib/three.js 744,186 bytes 只進過 1 次、理由寫在 CLAUDE.md 第 4 條；倉庫 pack 556 KiB。工地關鍵字只出現在 CLAUDE.md 的規則句本身 | 無 |

組B 完成：2026-10-22 21:46

<!-- 組B:結束 -->

## 組 C 結構與文件

<!-- 組C:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R12 | 目錄結構與檔案落點 | — | 黃 | ✅ 交付把關 E0 PASS（6 份都在）、E10 PASS；根目錄 7 檔剛好等於規範第 10 行；`git ls-files` 53 筆與磁碟逐筆相同。決策樹陽性對照三個真實檔名（`hud.js`、`app\lib\three.js`、`tools\_shots\*.png`）各落唯一且不同位置，但 `tools\check_live.js` 走第 7 問落 `tests\`，與規範第 17 行「tools 放不是驗證的腳本」互相矛盾（S-01）；`dist\` 的重建腳本不存在（S-02）；盤點產出檔不在規範內（S-03）。不會讓人找錯檔，所以黃 | S-01～S-03、S-05～S-07 |
| R13 | 命名與版本化檔名 | — | 綠 | ✅ E9 PASS；已追蹤檔沒有版本化檔名，程式檔全是英文小寫底線；`tools\_shots\` 的 `arm-`／`arm2-` 等前綴是被擋住的暫存截圖。版號唯一來源 `version.js` 與 README、版本紀錄現在都是 0.9.1。git tag 一個都沒有違反規範第 69 行，歸 R21（D-01、D-02），這裡不重判 | — |
| R14 | .gitignore 與版控邊界 | — | 綠 | ✅ E4 PASS、E11 PASS（頂層 13 項）。`git check-ignore -v --no-index` 逐類命中：`**/_*/`（`tools/_shots/`、`tests/_out/`）、`dist/`、`node_modules/`、`Thumbs.db`、`desktop.ini`；反向對照 10 個不該擋的路徑（含 `app/lib/three.js`、三份盤點產出檔）全沒被擋。`git ls-files -ci --exclude-standard` 0 筆，陽性對照加 `-x index.html` 回 1 筆。最大追蹤檔 `three.js` 744 KB、`play.png` 450 KB，沒有憑證或大型二進位 | — |
| R15 | 文件長度 | — | 綠 | ✅ 7 份 `.md` 用 `wc -l` 與 `Get-Content -Encoding UTF8` 交叉量，兩者一致，全在上限內：CLAUDE.md 20/40、README 63/400、路線圖 39/120、規範 110/150、版本紀錄 12/12 個版本（剛好到上限）、問題台帳查詢型。`版本紀錄_歷史.md` 型別只寫在自己檔頭，規範表沒列（S-04）。表二 0 筆 | S-04 |
| R16 | 文件與程式同步 | — | 黃 | ✅ E2、E3、E8 PASS；E7 回「點名 0 支」是空轉，改用自寫的路徑存在檢查：13 個路徑全在，陽性對照抓得到（C-04）。README 抽做：`node tools/check_live.js` 四組全過、線上 v0.9.1；`npm test` 107/107 與狀態行一致；`check_odds.js` 最大差距 0.35% 對得上「0.4% 以內」。問題台帳沒有 🔴／🟡。現在沒有過期描述，但 README 與 CLAUDE.md 的數字沒人算（C-01～C-03）。參考檔判準會給綠，SKILL〈燈號判準〉要求「沒有待處理的缺口」，照後者判黃 | C-01～C-04 |

組C 完成：2026-10-22 21:48

<!-- 組C:結束 -->

## 組 D 交付與相依

<!-- 組D:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R17 | 交付與安裝 | — | 黃 | 從 GitHub clone 到 `%TEMP%\盤點D (測試) 安裝-2168\21點 (同事) 副本`（中文、括號、空白）。同事路線不裝 node 套件：`node --test tests/check_file_protocol.js` 13/13 綠，Edge 155 與 Chrome 155 無頭、全新設定檔（首次啟動、沒有存檔）以 file:// 開 `app\index.html`，桌機與手機尺寸都載入、繪圖、荷官五表情正常，主控台 0 則。`app\` 沒有任何對外請求（Grep 只中 SVG 命名空間）、不需管理員權限。開發路線 `npm ci`→`npm run build:three`→`npm test` 107/107 綠（339 秒），跑完 clone 工作樹乾淨。線上路線 `node tools/check_live.js` 四組全過、線上 v0.9.1。缺口 D-05：README 沒寫離線用的資料夾從哪來 | D-05 |
| R18 | 版本相容面 | — | 黃 | 支援範圍寫在 README 已知限制第 2 條（Windows 11 的 Edge、Chrome；手機只模擬過）。本輪實測 Edge 155.0.4283.62、Chrome 155.0.8059.85 桌機與 CDP 手機尺寸全綠，線上版同。手機實機沒有探針也沒有紀錄（D-06）。repo 沒有 `.ps1`／`.psm1`（`git ls-files` 副檔名過濾 0 筆，陽性對照同一過濾抓 `.png` 1 筆），PowerShell 5.1 那條不適用。`package.json` 沒有 `engines`；開發端只在 node 24.16.0 跑過，CI 也釘主版本 24 | D-06 |
| R19 | 相依版本與弱點 | — | 黃 | npm 相依只有 devDependencies `esbuild 0.28.2`、`three 0.186.1`，都精確釘版；`package-lock.json` v3 共 28 筆，全部有 integrity、全部來自 registry.npmjs.org。`npm audit` 0 筆（陽性對照：暫存資料夾鎖 lodash 4.17.15，報 high）；`npm outdated` 0 筆（同一對照顯示 4.18.1 可升）。沒有隨附的 dll／exe／字型。扣分在 CI：action 只釘可移動的主版本 tag（D-07） | D-07 |
| R20 | 授權 | — | 綠 | 隨網站發出去的第三方元件只有 three 0.186.1（MIT），`tools\build_three.js:16` 把完整 LICENSE 寫進 `app\lib\three.js` 檔頭（本輪讀過前 600 字元）。esbuild 0.28.2（MIT）只在打包時用，不隨網站發出。repo 沒有字型與二進位；Stack Overflow／GitHub 網址樣式 Grep 0 筆（陽性對照：同一條在 esbuild 的 package.json 中 1 筆）。📌 repo 本身沒有 LICENSE（GitHub API `license: null`），公開但未授權他人再用，要不要加由使用者決定 | — |
| R21 | 發佈與版本號流程 | — | 黃 | 唯一來源 `app\js\core\version.js:6`；版號另外手寫在 `README.md:63`、`docs\版本紀錄.md:8`，現在一致、沒有探針比對（D-02）。沒有任何 git tag，違反 `docs\檔案結構規範.md:69`（D-01）。發布是推上 main 自動上傳 `app\`，最近 3 次 workflow 都 success；`npm run build:three` 在 clone 上重建的 `three.js` 與 commit 的那份 SHA256 相同。交付把關 E6 PASS（最新段落引用 BJK-01）。檢查清單六條：問題台帳沒有新 🟡、README 狀態行有數字與時間、`.gitignore` E4 PASS、沒有 ps1／bat；第 1 條（陽性對照）由組 A 判 | D-01、D-02 |
| R22 | 使用者回饋管道 | — | 黃 | README 回饋樣式 Grep 0 行（D-03）；畫面上看不到版本號，`main.js:22` 只寫進 body 的 data 屬性（D-04）。回報有去處：`docs\問題台帳.md` 存在，唯一一筆回報已配 BJK-01。網頁遊戲沒有 log 檔，診斷資料那條不適用 | D-03、D-04 |

組D 完成：2026-10-22 21:45

<!-- 組D:結束 -->

## 組 E 效能

<!-- 組E:開始 -->

| 編號 | 大項 | 上次 | 本次 | 證據 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| R23 | 效能基準與熱點 | — | 黃 | ✅ 22:37–23:26 單獨跑 `node tools/measure_perf.js --live`（Edge、warmup 1 次＋正式 5 次、接電源；量測本身的問題 0 筆）。14 個入口全在使用者門檻內：開頁到可下注最慢 1,317／1,514 ms（門檻 3 秒）；按鈕到有反應最慢 16.8／18.1 ms、長掉格 0（門檻 0.1 秒）；連玩 200 局後 10÷前 10 為 0.97，GC 後 heap 第 150 局起持平（另跑 600 局確認）；npm test 148／152 秒（門檻 5 分鐘）。正表 12 筆熱點等編號（P-01～P-12）。SKILL〈燈號判準〉的綠燈要求沒有待處理項，照它判黃。真手機、GPU 作畫時間量不到 | 使用者回 P 編號（建議先 P-10→P-09、P-01、P-11）；真手機開網址手動計時一次 |

組E 完成：2026-10-22 23:37

<!-- 組E:結束 -->

## 盤點紀錄

| 日期 | 綠 | 黃 | 紅 | 不適用 | 模式 | 備註 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-22 | 7 | 11 | 4 | 1 | 子代理 | 第一次盤點；紅燈證據主線重跑一致；E 計時單獨跑、全部入口在使用者門檻內 |
