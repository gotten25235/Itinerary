// filename: js/view-list.js
'use strict';

/**
 * 詳細清單（可點連結版）
 * - 自動將儲存格中的 http/https URL 轉為 <a>（新分頁開啟）
 * - 其他文字仍做 HTML escape；換行 -> <br>
 */

function linkify(text) {
  if (text == null) return '';
  const s = String(text);

  // 把 URL 抓出來，其餘文字做 escape
  // 注意：這個簡化規則可能包含末尾標點；已做基本修剪
  const URL_RE = /(https?:\/\/[^\s<>"']+)/gi;
  const parts = s.split(URL_RE);

  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    if (!chunk) continue;

    if (i % 2 === 1) {
      // 這段是 URL：嘗試去掉常見尾端標點
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
  header.forEach(h => html += `<th>${escapeHtml(String(h))}</th>`);
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    header.forEach(h => {
      const raw = row[h] != null ? String(row[h]) : '';
      const linked = linkify(raw).replace(/\n/g, '<br>');
      html += `<td>${linked}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  out.insertAdjacentHTML('beforeend', html);

  // 可選：加一點基本樣式（只注入一次）
  const styleId = 'list-autolink-style';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .table-wrap table { width: 100%; border-collapse: collapse; }
      .table-wrap th, .table-wrap td { border: 1px solid #eee; padding: 8px; vertical-align: top; }
      .table-wrap a { color: #2563eb; text-decoration: underline; }
      .table-wrap a:hover { text-decoration: none; }
    `;
    document.head.appendChild(s);
  }
}

window.renderList = renderList;
