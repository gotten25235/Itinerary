// filename: js/renderers.js
'use strict';

/**
 * renderers.js（保留：Raw / 相容匯出點）
 *
 * 目前此檔主要提供「raw」視圖（用來直接檢視解析後的 meta/header/data），以利除錯與驗證解析結果。
 * 其他視圖（grid/schedule/shopping/note...）已各自拆到對應的 view-*.js，並透過 window.renderXxx 匯出給 handle.js 呼叫。
 *
 * 重要：此檔保留一些空函式匯出，僅為相容舊呼叫點或避免找不到 symbol；實際渲染請以 view-*.js 為準。
 */

/**
 * 原始讀取：直接顯示 meta（模式/備註）、表頭與資料本體
 * - 不做任何欄位推斷或過濾
 * - 先渲染 meta（若存在），再渲染表格預覽，最後附上 JSON 節錄
 * 
 * @param {Object} cached
 * @param {Array<string>} cached.header  CSV 的表頭陣列
 * @param {Array<Object>} cached.data    以表頭鍵組成的資料列陣列
 * @param {Object} [cached.meta]         來自前兩列的「模式 / 備註」等資訊（可選）
 */
function renderRaw(cached) {
  const out = document.getElementById('out');
  if (!out) { console.warn('缺少 #out 容器'); return; }

  const header = Array.isArray(cached?.header) ? cached.header : [];
  const data   = Array.isArray(cached?.data)   ? cached.data   : [];
  const meta   = cached && typeof cached.meta === 'object' ? cached.meta : null;

  // 清空畫面
  out.innerHTML = '';

  // 渲染 meta（模式 / 備註等）
  if (meta && Object.keys(meta).length > 0) {
    let metaHtml = '';
    metaHtml += '<div class="group">';
    metaHtml += '<h3>模式與備註</h3>';
    metaHtml += '<div class="table-wrap"><table><tbody>';
    for (const [k, v] of Object.entries(meta)) {
      metaHtml += `<tr><th>${escapeHtml(String(k))}</th><td>${escapeHtml(String(v))}</td></tr>`;
    }
    metaHtml += '</tbody></table></div>';
    metaHtml += '</div>';
    out.insertAdjacentHTML('beforeend', metaHtml);
  }

  // 基本檢查
  if (header.length === 0) {
    out.insertAdjacentHTML('beforeend', '<div class="no-data">找不到表頭</div>');
    return;
  }
  if (data.length === 0) {
    out.insertAdjacentHTML('beforeend', '<div class="no-data">沒有資料列</div>');
    return;
  }

  // 表格預覽（限制筆數避免 DOM 過大）
  const maxRows = Math.min(100, data.length);
  let html = '';

  html += '<div class="group">';
  html += `<h3>原始表格預覽（顯示前 ${maxRows} / 共 ${data.length} 筆）</h3>`;
  html += '<div class="table-wrap"><table><thead><tr>';

  // 表頭
  header.forEach(h => {
    html += `<th>${escapeHtml(String(h))}</th>`;
  });
  html += '</tr></thead><tbody>';

  // 資料列
  for (let i = 0; i < maxRows; i++) {
    const row = data[i] || {};
    html += '<tr>';
    header.forEach(h => {
      const raw = row[h] != null ? String(row[h]) : '';
      const safe = escapeHtml(raw).replace(/\n/g, '<br>');
      html += `<td>${safe}</td>`;
    });
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  html += '</div>';

  // JSON 節錄（便於核對解析是否正確）
  const jsonPreviewCount = Math.min(20, data.length);
  const jsonText = escapeHtml(JSON.stringify(data.slice(0, jsonPreviewCount), null, 2));
  html += '<div class="group">';
  html += `<h3>JSON（前 ${jsonPreviewCount} 筆）</h3>`;
  html += `<pre style="max-width:100%;overflow:auto;background:#f6f8fa;padding:12px;border-radius:6px;">${jsonText}</pre>`;
  html += '</div>';

  out.insertAdjacentHTML('beforeend', html);
}


/** 以下為保留的空函式（先不實作，避免影響最小可動版本） */
function renderGridGrouped(_cached)   { /* TODO: 未實作 */ }
function renderListGrouped(_cached)   { /* TODO: 未實作 */ }
function renderScheduleMode(_cached)  { /* TODO: 未實作（行程） */ }
function renderInspectView(_cached)   { /* TODO: 未實作（驗收/Inspect） */ }

/** 匯出 */
window.renderRaw = renderRaw;
window.renderGridGrouped   = renderGridGrouped;
window.renderListGrouped   = renderListGrouped;
window.renderScheduleMode  = renderScheduleMode;
window.renderInspectView   = renderInspectView;
