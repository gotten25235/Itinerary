// filename: js/view-grid.js
'use strict';

/**
 * 圖片九宮格（依「類型」分組）
 * - 圖片顯示：取「圖片」欄位網址
 * - 點擊行為：只用「評論」欄位網址（沒有評論就不做連結）
 * - 沒有圖片也會顯示卡片（預留佔位）
 */

function pickField(header = [], candidates = []) {
  const keys = header.map(h => (h || '').toString().trim());
  const lower = keys.map(k => k.toLowerCase());
  for (const c of candidates) {
    const ci = c.toLowerCase();
    let idx = lower.indexOf(ci);
    if (idx !== -1) return keys[idx];
    idx = lower.findIndex(k => k.includes(ci));
    if (idx !== -1) return keys[idx];
  }
  return null;
}

function firstImageUrl(value) {
  if (!value) return '';
  const parts = String(value).trim().split(/[\s,;\n\r]+/).filter(Boolean);
  const url = parts.find(p => /^https?:\/\//i.test(p));
  return url || '';
}

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}

function groupByKey(data = [], key) {
  const map = new Map();
  data.forEach(item => {
    const g = (item[key] || '未分類').toString().trim() || '未分類';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(item);
  });
  return map;
}

function renderGrid(cached) {
  const out = document.getElementById('out');
  if (!out) return;
  out.innerHTML = '';

  const header = Array.isArray(cached?.header) ? cached.header : [];
  const data   = Array.isArray(cached?.data)   ? cached.data   : [];

  if (!header.length || !data.length) {
    out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
    return;
  }

  // 欄位探測
  const typeKey   = pickField(header, ['類型', 'type', '分類', 'category']) || header[0];
  const imageKey  = pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
  const titleKey  = pickField(header, ['名稱', 'name', 'title', '主題']) || header[0];
  const reviewKey = pickField(header, ['評論', 'review', 'reviews', '評價']); // ★ 點擊只看這個

  const grouped = groupByKey(data, typeKey);

  let html = '';
  grouped.forEach((items, groupName) => {
    html += `<div class="group">`;
    html += `<h3>${escapeHtml(groupName)}</h3>`;
    html += `<div class="grid">`;

    items.forEach(item => {
      const title   = (item[titleKey] || '').toString().trim() || '(無名稱)';
      const imgUrl  = imageKey ? firstImageUrl(item[imageKey]) : '';
      const review  = reviewKey ? String(item[reviewKey] || '').trim() : '';
      const hasLink = isHttpUrl(review);

      const clickableStart = hasLink
        ? `<a class="grid-item link" href="${escapeHtml(review)}" target="_blank" rel="noopener">`
        : `<div class="grid-item">`;
      const clickableEnd   = hasLink ? `</a>` : `</div>`;

      html += clickableStart;
      html += `  <div class="grid-img ${imgUrl ? '' : 'img-empty'}">`;
      if (imgUrl) {
        html += `    <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" loading="lazy" draggable="false" onerror="this.onerror=null;this.src='';this.closest('.grid-img').classList.add('img-error');">`;
      } else {
        html += `    <div class="img-placeholder">無圖</div>`;
      }
      html += `  </div>`;
      html += `  <div class="grid-caption" title="${escapeHtml(title)}">${escapeHtml(title)}</div>`;
      html += clickableEnd;
    });

    html += `</div></div>`;
  });

  out.insertAdjacentHTML('beforeend', html);

  // 內嵌樣式（一次性）
  const styleId = 'grid-style-v2';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .grid-img, .grid-img * { pointer-events: none; }  /* ★ 讓點擊落到外層卡片連結（評論網址） */
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .grid-item { border: 1px solid #eee; border-radius: 12px; overflow: hidden; background: #fff; text-decoration: none; color: inherit; display: flex; flex-direction: column; }
      .grid-item.link:hover { box-shadow: 0 6px 16px rgba(0,0,0,0.08); transform: translateY(-1px); transition: box-shadow .2s, transform .2s; }
      .grid-img { aspect-ratio: 1 / 1; background: #f3f4f6; display: flex; align-items: center; justify-content: center; }
      .grid-img img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
      .grid-img.img-error::after { content: '圖片載入失敗'; color: #999; font-size: 12px; }
      .grid-img.img-empty { background: repeating-linear-gradient(45deg, #f6f7f8, #f6f7f8 10px, #f0f1f2 10px, #f0f1f2 20px); }
      .grid-img .img-placeholder { color: #9aa0a6; font-size: 12px; letter-spacing: .1em; }
      .grid-caption { padding: 10px; font-size: 14px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .group > h3 { margin: 16px 0 10px; font-size: 16px; }
    `;
    document.head.appendChild(s);
  }
}

window.renderGrid = renderGrid;
