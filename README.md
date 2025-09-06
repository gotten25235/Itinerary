# Sheet Viewer — 專案說明 (繁體中文)

**說明**：此 README 使用檔名為英文 `README.md`，內容全部為繁體中文。此專案為一個簡易的試算表檢視器，提供「分組 + 圖片九宮格」與「詳細清單」兩種檢視方式，並支援從 Google Sheets 的 export CSV URL 或本機範例檔載入資料。

## 檔案結構（檔名皆為英文）
- `sheet_viewer.html`：主入口 HTML，引用 CSS 與 JS。
- `css/styles.css`：所有樣式，包含 Grid / Table / 響應式規則。
- `js/csv-parser.js`：CSV 解析與工具函式（parseCSV、escapeHtml、makeSafeUrl、isUrlLike）。
- `js/renderers.js`：DOM 渲染函式（renderGridGrouped、renderListGrouped、detectHeaderIndex 等）。
- `js/app.js`：應用程式控制流程（載入、事件綁定、狀態管理）。
- `data/sample.csv`：本機範例 CSV，作為 fetch 失敗時的 fallback。
- `README.md`：本檔，專案說明（繁體中文）。

## 使用方式（本機測試）
1. 將整個資料夾放在本機。
2. 啟動簡易 HTTP 伺服器（避免 fetch 本機檔案的限制）：
   - Python 3: `python -m http.server 8000`
   - 或使用 `npx http-server -p 8000`
3. 在瀏覽器開啟：`http://localhost:8000/sheet_viewer.html`。
4. 測試項目：
   - 切換「圖片9宮格」與「詳細清單」。
   - 使用輸入框輸入 Google Sheets export URL 範本以及 gid，按「載入資料」。
   - 若遠端載入失敗（CORS / 權限），將回落至 `data/sample.csv`。

## 可調整的參數與擴充建議
- 若需更完整的 CSV 支援，建議使用 PapaParse（替換 `parseCSV`）。
- 若想把 JS 改成 ES module，請把檔案改為 `export` / `import` 並在 `sheet_viewer.html` 使用 `<script type="module">`。
- 若資料量大，建議加入分頁或 lazy-load 圖片以改善效能。
- 若要避免全局 CSS 衝突，請將樣式命名空間化（例如 `.sheet-viewer` 開頭）。

## 開發測試清單
- [ ] Grid 與 List 模式切換無錯誤。
- [ ] 更多（more）按鈕在長文字時正確展開/收合。
- [ ] 測試含雙引號 / 逗號 / 換行的 CSV 行為是否如預期。
- [ ] 測試 Google Sheets export URL（需將試算表設為可公開或使用可讀取的分享連結）。

---
如果你要我把檔名改成特定格式（例如全部小寫、加入版本號），或要我把 ZIP 轉成 RAR，請告訴我。我會直接在這裡重新產生並提供下載連結。
