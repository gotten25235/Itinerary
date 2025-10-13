// filename: js/view-raw.js
'use strict';

/**
 * 原始讀取：顯示 meta（模式/備註）＋ 表頭＋資料
 * 不做推斷與過濾
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

  // 表格預覽（限制筆數）
  const maxRows = Math.min(100, data.length);
  let html = '';

  html += '<div class="group">';
  html += `<h3>原始表格預覽（顯示前 ${maxRows} / 共 ${data.length} 筆）</h3>`;
  html += '<div class="table-wrap"><table><thead><tr>';
  header.forEach(h => { html += `<th>${escapeHtml(String(h))}</th>`; });
  html += '</tr></thead><tbody>';

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

  // JSON 節錄
  const jsonPreviewCount = Math.min(20, data.length);
  const jsonText = escapeHtml(JSON.stringify(data.slice(0, jsonPreviewCount), null, 2));
  html += '<div class="group">';
  html += `<h3>JSON（前 ${jsonPreviewCount} 筆）</h3>`;
  html += `<pre style="max-width:100%;overflow:auto;background:#f6f8fa;padding:12px;border-radius:6px;">${jsonText}</pre>`;
  html += '</div>';

  out.insertAdjacentHTML('beforeend', html);
}

window.renderRaw = renderRaw;
