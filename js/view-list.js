// filename: js/view-list.js
'use strict';

/**
 * 詳細清單（全部欄位「完整顯示」）
 * - 表格容器支援水平/垂直卷軸（max-height: 70vh）
 * - 任何欄位都會換行顯示完整（含網址、地點、備註…）
 * - 自動將 http/https 字串轉成可點擊連結（新分頁）
 * 備註：全域需已有 escapeHtml()
 */

function linkify(text) {
  if (text == null) return '';
  const s = String(text);

  // 把 URL 抓出來，其餘文字做 escape；尾端常見標點會被修剪
  const URL_RE = /(https?:\/\/[^\s<>"']+)/gi;
  const parts = s.split(URL_RE);

  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    if (!chunk) continue;

    if (i % 2 === 1) {
      // URL 片段
      let url = chunk.replace(/[),.;!?]+$/g, '');
      const tail = chunk.slice(url.length);
      out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>${escapeHtml(tail)}`;
    } else {
      // 普通文字
      out += escapeHtml(chunk);
    }
  }
  return out;
}

function renderList(cached) {
  const out = document.getElementById('out');
  if (!out) return;
  out.innerHTML = '';

  const header = Array.isArray(cached?.header) ? cached.header : [];
  const data   = Array.isArray(cached?.data)   ? cached.data   : [];

  if (!header.length || !data.length) {
    out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
    return;
  }

  let html = '<div class="group"><h3>詳細清單</h3><div class="table-wrap"><table><thead><tr>';
  header.forEach(h => html += `<th title="${escapeHtml(String(h))}">${escapeHtml(String(h))}</th>`);
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    header.forEach(h => {
      const raw    = row[h] != null ? String(row[h]) : '';
      const linked = linkify(raw).replace(/\n/g, '<br>');
      // 全欄位都完整顯示（換行/斷行），不做單行省略
      html += `<td class="cell-wrap" title="${escapeHtml(raw)}">${linked}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  out.insertAdjacentHTML('beforeend', html);

  // 樣式（只注入一次）
  const styleId = 'list-fullwrap-style-v1';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .table-wrap { width: 100%; overflow: auto; max-height: 70vh; }
      /* 固定表格佈局，欄寬平均；內容很多時可水平/垂直卷軸 */
      .table-wrap table { width: max(100%, 1200px); border-collapse: collapse; table-layout: fixed; }
      .table-wrap th, .table-wrap td { border: 1px solid #eee; padding: 8px; vertical-align: top; }

      /* ★ 全欄位：完整顯示（可換行、不截斷） */
      .table-wrap td.cell-wrap {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        word-break: break-word;   /* 中文/長字串可斷 */
        overflow-wrap: anywhere;  /* 長網址可斷 */
        line-height: 1.35;
      }

      /* 表頭可保留單行以節省空間 */
      .table-wrap th {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 連結樣式 */
      .table-wrap a { color: #2563eb; text-decoration: underline; }
      .table-wrap a:hover { text-decoration: none; }
    `;
    document.head.appendChild(s);
  }
}

window.renderList = renderList;
