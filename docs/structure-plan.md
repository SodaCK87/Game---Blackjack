# 結構落差與搬移計畫

> 型別：查詢型（一列一筆落差，靠「建議動作」欄過濾）｜由 /蘇-全面盤點 組 C 產出，每輪整份重建｜本輪 2026-10-27（上一輪 2026-10-22，commit 06b0bfb）｜基準：[檔案結構規範](檔案結構規範.md)｜我只回編號或批次決定做哪幾項

本輪 R12–R15 沒有紅燈，所以下面的批次**只列不排**：照〈核准後才執行〉，要執行的只有紅燈大項的批次。上一輪的 S-01～S-07 一筆都沒關（`git diff 06b0bfb HEAD -- docs/檔案結構規範.md .gitignore` 空白），本輪沿用原意重編、補上一筆 S-08；全部是規範的文字缺口，沒有一個既有檔需要搬。

## 盤現況

1. ✅ 目錄與索引一致：`git -c core.quotepath=off ls-files` 66 筆，`git status --porcelain --ignored` 只多出被擋住的 `node_modules/`、`tools/_shots/`，以及主線剛重建的兩份盤點產出檔（` M`）。交付把關 E11「頂層 13 項全對得上」。
2. ✅ 根目錄的 7 個檔剛好是規範第 10 行列的 7 個；頂層資料夾 `app`、`docs`、`tests`、`tools`、`.github` 都在〈頂層資料夾〉表上（E10 PASS、E0「6 份，都在」）。`dist\`、`tests\_out\` 磁碟上不存在。
3. ✅ 沒有版本化檔名：E9 PASS；另用樣式檔名掃 `git ls-files`（`_v數字`、`v數字.數字`、`_old`、`_bak`、`最終`、8 位數日期、`copy`、`副本`）0 筆，陽性對照 `Core_v1.7.lsp`、`report_20260401.md` 兩筆都中、`ok.js` 不中。git tag 一個都沒有，歸 R21。
4. ✅ 產出物與來源分開：唯一進版控的產物 `app\lib\three.js` 由規範第 30 行明訂進版控，`tests\check_three_bundle.js` 逐位元組比對（本輪 `npm test` 內，結果見台帳 R14 證據）。
5. ✅ 暫存的實際落點：`tools\_shots\` 145 張、52 MB（上一輪 129 張、44 MB，一直長，S-05）；`tests\` 與 `tools\measure_perf.js` 的破壞複本與瀏覽器設定檔一律 `fs.mkdtempSync(os.tmpdir())`，落在 repo 外的 `%TEMP%\bjk-*`，規範的第 5 問沒寫到這一類（S-05）。
6. ✅ 六個 commit 新增的檔（`tests\check_fx.js`、`check_readme.js`、`fx_util.js`、`rig_util.js`、`app\js\view\showcase.js`）都落在決策樹指的位置、名稱合〈命名〉表。
7. ✅ 落點決策樹的陽性對照，三個真實檔名各落到唯一且不同的位置：
   1. 原始碼 `app\js\view\showcase.js`：第 5 問否、第 6 問是（`index.html:53` 載入）、6d 是（含 7 處 `document.`／`THREE.`），落 `app\js\view\`。
   2. 產出物 `app\lib\three.js`：第 5 問否（刪掉 Pages 就壞）、第 6 問是、6a 是，落 `app\lib\`。
   3. 暫存檔 `tools\_shots\arm-after.png`：第 5 問是，落產生它的 `tools\shoot.js`（第 19 行 `_shots`）旁邊的 `tools\_shots\`。
   4. 多走兩個：`tools\measure_perf.js` 第 7 問否（量時間不是驗證）、第 9 問是，落 `tools\`，與實際相同；`tools\check_live.js` 第 7 問答「是」落 `tests\`，與實際位置不同（S-01，上一輪就有）。

### 文件實量

兩種量法交叉一致：`wc -l` 與 `(Get-Content $p -Encoding UTF8).Count`，11 份 `.md` 逐份相同。

| 檔 | 型 | 行數 | 上限 | 讀法 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `CLAUDE.md` | 從頭讀型 | 20 | 40 行 | 每輪自動載入，從頭讀 | 在上限內 |
| `README.md` | 從頭讀型 | 81 | 400 行 | 同事從頭讀 | 在上限內 |
| `目標路線圖.md` | 從頭讀型 | 40 | 120 行 | 從頭讀 | 在上限內 |
| `docs\檔案結構規範.md` | 從頭讀型 | 110 | 150 行 | 從頭讀 | 在上限內 |
| `docs\版本紀錄.md` | 敘事追加型 | 217（12 個版本，v0.7.1～v0.12.0） | 12 個版本 | 搜版號 | 剛好到上限；下一版發布前要把 v0.7.1 原樣搬到歷史檔 |
| `docs\版本紀錄_歷史.md` | 敘事追加型（只寫在自己檔頭） | 129（10 段，骨架～v0.7.0） | 不設（檔頭自訂） | 搜版號 | 規範〈文件〉表沒有這份（S-04） |
| `docs\問題台帳.md` | 查詢型 | 16（7 列，全 ✅） | 不設，靠「狀態」欄 | 搜編號 | 不適用上限 |
| `docs\review-inventory.md` | 查詢型（檔頭） | 86 | 不設 | 盤點時從頭讀 | 盤點產出檔，規範沒列（S-03） |
| `docs\probe-gap-list.md` | 查詢型（檔頭） | 28 | 不設 | 搜編號 | 同上 |
| `docs\structure-plan.md` | 查詢型（檔頭） | 本檔 | 不設 | 搜編號 | 同上 |
| `docs\perf-baseline.md` | 查詢型、只增不改（檔頭） | 461 | 不設 | 搜編號 | 同上 |

行數是本輪組 C 寫入前量的；三份盤點產出檔各組正在寫，行數會變。

**表二（長度違規）：本輪 0 筆。**

## 表一：位置與命名違規

風險由高到低。引用數拆成程式碼與文件兩欄，用 `git grep -c -F <名稱>` 分別對 `*.js *.json *.html *.yml .gitignore` 與 `*.md` 量；陽性對照是 `shoot`（確定還在用），同一條搜到程式碼 18、文件 17。

| 編號 | 檔案 | 現在位置 | 依規則應在哪 | 建議動作 | 引用數（程式碼／文件） | 風險 |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | `check_live.js` | `tools\` | 決策樹第 7 問「由 node 執行、目的是驗證別的東西」落 `tests\`；規範第 17 行又寫 `tools\` 放「不是在驗證東西的腳本」 | 不搬，改規範：`tools\` 那列與第 7 問加「上線後驗證、要連網、不進 `npm test` 的腳本放 `tools\`」。搬進 `tests\` 而叫 `check_*.js` 會被 `npm test` 的 glob 收進去，推上 main 之前就連不到新版而變紅 | 9／13 | `CLAUDE.md:15`、`目標路線圖.md:17`、`:24`、`app\index.html:7` 的註解、`tools\measure_perf.js:9`、`:26`、`:858`–`:861`（量測腳本直接 spawn 這個路徑）；照現行決策樹新增下一支上線檢查會被放進 `tests\` |
| S-02 | `檔案結構規範.md` 第 18、76 行與 `.gitignore:5` 的註解 | `docs\`、根 | 規範〈定規則〉第 4 題要求寫明重建指令；三處都寫「跑 `tools\` 的打包腳本」，但 `tools\` 只有 `build_three.js`、`check_live.js`、`measure_perf.js`、`shoot.js`，沒有打包單一 HTML 的腳本，`dist\` 也不存在 | 改規範：`dist\` 那列與不進版控表那列改成「腳本寫好時才建；沒有腳本前不准出現 `dist\`」，`.gitignore:5` 註解同步；或刪掉兩列與 `dist/` 那行 | 程式碼 0（`.gitignore` 1 行）／文件 3 | 有人照規範要重建 `dist\` 會找不到腳本；README 的離線路線是複製整個資料夾，沒有用到 `dist\` |
| S-03 | `review-inventory.md`、`probe-gap-list.md`、`structure-plan.md`、`perf-baseline.md`，與量測腳本 `tools\measure_perf.js` | `docs\`、`tools\` | 規範第 16 行 `docs\` 只列「版本紀錄、問題台帳、本檔，與 README 用圖」；第 66 行文件命名要中文；四份 `.md` 走決策樹落到「以上皆非→停下來問」 | 不改名，改規範：`docs\` 那列與〈文件〉表各加一列「盤點產出檔（`/蘇-全面盤點` 產生，檔名固定英文，跨輪對照靠檔名；型別寫在各檔檔頭）」 | 0／2、0／3、0／2、1／1（`measure_perf.js` 引用 `perf-baseline`） | 專案外引用：`蘇-全面盤點` 的 SKILL.md 寫死這四個檔名，改名會讓下一輪對不上；歸第 4 批 |
| S-04 | `版本紀錄_歷史.md` | `docs\` | 位置對，但規範〈文件〉表（第 82–89 行）沒有這一列，型與上限只寫在它自己的檔頭；版本紀錄已到 12 個版本上限，下一版就要往這裡搬 | 改規範：〈文件〉表加一列「`docs\版本紀錄_歷史.md`｜從版本紀錄搬出來的舊版本，原文照搬｜敘事追加型｜不設」 | 0／13 | 之後寫守門腳本照規範表解析上限時會漏掉這份 |
| S-05 | `tools\_shots\`（145 張 52 MB）與 `%TEMP%\bjk-*` | `tools\`、repo 外 | 規範只回答暫存放哪（第 42–43、75 行），沒回答**什麼時候清**（〈定規則〉第 5 題）；第 5 問也沒涵蓋測試寫進 `os.tmpdir()` 的破壞複本 | 改規範：寫死清理時機（例如「`tools\_shots\` 每次 commit 前可整個刪，`shoot.js` 不自動清」），第 5 問補「測試的破壞複本與瀏覽器設定檔一律 `mkdtemp(os.tmpdir())`、跑完自己刪」 | `_shots` 2／1 | 已被 `**/_*/` 擋住，不會進版控；只是磁碟一直長（5 天多 16 張、8 MB） |
| S-06 | `node_modules\` | 根 | 規範〈頂層資料夾〉表沒列，只出現在〈不進版控的東西〉表 | 改規範：頂層表加一列「`node_modules\`｜npm 套件｜`npm ci` 時建｜否」 | npm 預設路徑，不適用 | 照頂層表列舉的人會以為它不該存在 |
| S-07 | `docs\檔案結構規範.md` | `docs\` | 規範沒回答〈定規則〉第 6 題：廢棄檔要封存還是刪除、封存放哪、留多久 | 改規範：加一行，例如「廢棄檔直接 `git rm`，靠 git 歷史保存；不建 `history\`」 | — | 現在沒有廢棄檔；第一次要淘汰檔時沒有規則可照 |
| S-08 | `app\.gitkeep` | `app\` 根 | 規範第 27 行「`app\` 根只放 `index.html`、`style.css` 兩個檔」，同一份第 14 行又要 `app\` 放 `.gitkeep`；`tests\.gitkeep` 同形（第 15 行），只是 `tests\` 沒有「只放幾個檔」的限制 | 二擇一：刪掉 `app\.gitkeep`、`tests\.gitkeep`（兩個資料夾早就有檔，`.gitkeep` 已無作用），規範第 14、15 行的「放 `.gitkeep`」改成「建立時放、有檔後刪」；或第 27 行改成「三個檔，含 `.gitkeep`」 | 0／0（`.gitkeep` 只在規範裡出現） | 只是規範自相矛盾；不會讓人或腳本找錯檔。`pages.yml:33` 上傳整個 `app`，`.gitkeep` 會不會跟著發布出去 📌 沒查 |

## 搬移計畫

本輪沒有紅燈，以下只列不排。每一筆都能單獨執行、單獨回復。

### 規範修訂批（S-01 到 S-08 的「改規範」部分）

只改 `docs\檔案結構規範.md` 與 `.gitignore:5` 的註解，不動任何程式檔，一個 commit。S-08 選「刪 `.gitkeep`」的話另開一個 commit（見第 1 批）。

1. 做法：用 Edit 改文字（含中文，不可用 `Get-Content`／`Set-Content` 轉手）；`.gitignore` 只改註解，不改 `dist/` 那行（除非 S-02 選了「刪掉 `dist`」）。
2. 搬完怎麼驗：
   1. `(Get-Content "docs\檔案結構規範.md" -Encoding UTF8).Count` 與 `wc -l` 都不超過 150。
   2. 交付把關 E0、E4、E10 照舊 PASS：`& "C:\Users\ben12\Downloads\ClaudeOnly\Claude規則研究\探針\交付把關\Probe-Delivery.ps1" -Project "C:\Users\ben12\Downloads\ClaudeOnly\GitHub Desktop\Game---Blackjack"`。
   3. `git check-ignore -v --no-index dist/a.html tools/_shots/x.png` 照舊命中，`git check-ignore -v --no-index app/index.html` 照舊不命中（退出碼 1）。
   4. `docs\問題台帳.md:6` 用標題文字〈缺陷編號、嚴重度與狀態〉指過來，改到那個標題就要一起改；動到任何標題時照 `github-docs-verify` 的消費端驗法驗錨點。
3. 驗不過怎麼退：`git revert <該 commit>`；還沒 commit 就 `git restore -- docs/檔案結構規範.md .gitignore`。

### 第 1 批：零引用的暫存／實驗檔 → 封存

1. 沒有已追蹤的暫存或實驗檔。`tools\_shots\` 是被擋住的暫存，清不清等 S-05 寫進規範後照規則做；刪除由使用者自己執行。
2. S-08 選「刪 `.gitkeep`」時才有這一筆：`git rm app/.gitkeep tests/.gitkeep`，一個 commit。
   1. 搬完怎麼驗：`npm test` 全綠（`check_file_protocol.js`、`check_ui.js` 開的是 `app\index.html`，不讀 `.gitkeep`）；`git -c core.quotepath=off ls-files | grep gitkeep` 0 筆；交付把關 E0、E10、E11 PASS。
   2. 退回：`git revert <該 commit>`。

### 第 2 批：可重建的產出物 → 移出版控

無。`app\lib\three.js` 照規範第 30 行刻意進版控（Pages 與雙擊不經建置），不移出。

### 第 3 批：有引用、引用全在專案內 → 搬移 ＋ 改引用

只在 S-01 選「搬」而不是「改規範」時才有，不建議：

1. 做法：`git mv tools/check_live.js tests/live_check.js`（不能叫 `check_*.js`，否則被 `npm test` 收進去），同一個 commit 改 `CLAUDE.md:15`、`目標路線圖.md:17`、`:24`、`app\index.html:7` 的路徑，以及 `tools\measure_perf.js:860` spawn 的路徑；`docs\版本紀錄.md`、`docs\版本紀錄_歷史.md` 是歷史敘事不改；規範〈命名〉驗證腳本那列加 `live_check.js` 例外。
2. 搬完怎麼驗：`node tests/live_check.js` 四組全過；`npm test` 的測試數與搬之前相同（沒有把它收進去）；交付把關 E7 PASS。
3. 退回：`git revert <該 commit>`。

### 第 4 批：有專案外引用或引用不明

S-03 的四份盤點產出檔與 `tools\measure_perf.js`：本輪不搬、不改名，只做規範修訂批裡那一列。`蘇-全面盤點` 的 SKILL.md 寫死這些檔名，是專案外引用，grep 搜不到，要改名先問使用者。
