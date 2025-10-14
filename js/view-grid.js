// filename: js/view-grid.js
'use strict';

/**
 * 圖片九宮格（依「區」自動分組；抓不到則退回「類型」）
 * 顯示：圖片、名稱、地點、營業時間、金額
 * 點擊：評論網址（若無則不開新頁）
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
function isHttpUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v.trim()); }

function formatPrice(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const hasSymbol = /^(\$|€|£|¥|￥|NT\$?|NT[＄$]?)/i.test(s);
  return hasSymbol ? s : `$${s}`;
}

/** 從地址中抓出「XX區」（優先; 退回 null） */
function extractDistrict(addr = '') {
  const s = String(addr || '').trim();
  if (!s) return null;
  // 常見全名先處理
  const common = /(西屯區|南屯區|北屯區|北區|中區|西區|南區|東區|大里區|太平區|潭子區|烏日區|大雅區|龍井區|清水區|沙鹿區|后里區|外埔區|大肚區|霧峰區|神岡區|梧棲區|石岡區|新社區)/;
  let m = s.match(common);
  if (m) return m[1];

  // 一般規則：抓出最後一個以「區」結尾且 1-3 個中文字的片段
  const all = s.match(/([\u4e00-\u9fa5]{1,3}區)/g);
  if (all && all.length) return all[all.length - 1];

  return null;
}

/** 依「區」分組；抓不到則用類型；都沒有則「未分類」 */
function groupForItem(item, keys) {
  const loc = keys.locationKey ? item[keys.locationKey] : '';
  const district = extractDistrict(loc);
  if (district) return district;

  const t = keys.typeKey ? String(item[keys.typeKey] || '').trim() : '';
  return t || '未分類';
}

function groupData(data, keys) {
  const map = new Map();
  data.forEach(it => {
    const g = groupForItem(it, keys);
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(it);
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
  const typeKey    = pickField(header, ['類型', 'type', '分類', 'category']) || header[0];
  const imageKey   = pickField(header, ['圖片','圖片網址','照片','image','img','thumbnail','photo','pic','圖']);
  const titleKey   = pickField(header, ['名稱','name','title','主題']) || header[0];
  const reviewKey  = pickField(header, ['評論','review','reviews','評價']); // 點擊用
  const hoursKey   = pickField(header, ['營業時間','營業時段','hours','opening hours','open hours']);
  const priceKey   = pickField(header, ['金額','price','費用','價錢','價格']);
  const locationKey= pickField(header, ['地點','地址','location','address']);

  const keys = { typeKey, imageKey, titleKey, reviewKey, hoursKey, priceKey, locationKey };

  const grouped = groupData(data, keys);

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

      const hours   = hoursKey ? String(item[hoursKey] || '').trim() : '';
      const price   = priceKey ? String(item[priceKey] || '').trim() : '';
      const loc     = locationKey ? String(item[locationKey] || '').trim() : '';

      const clickableStart = hasLink
        ? `<a class="grid-item link" href="${escapeHtml(review)}" target="_blank" rel="noopener">`
        : `<div class="grid-item">`;
      const clickableEnd   = hasLink ? `</a>` : `</div>`;

      html += clickableStart;

      // 圖片
      html += `  <div class="grid-img ${imgUrl ? '' : 'img-empty'}">`;
      if (imgUrl) {
        html += `    <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" loading="lazy" draggable="false" onerror="this.onerror=null;this.src='';this.closest('.grid-img').classList.add('img-error');">`;
      } else {
        html += `    <div class="img-placeholder">無圖</div>`;
      }
      html += `  </div>`;

      // 文字區：名稱
      html += `  <div class="grid-caption" title="${escapeHtml(title)}">${escapeHtml(title)}</div>`;

      // 地點 / 營業時間 / 金額
      if (loc || hours || price) {
        html += `  <div class="grid-meta">`;
        if (loc)   html += `    <div class="meta-line meta-location" title="地點">${escapeHtml(loc)}</div>`;
        html += `    <div class="meta-line meta-row">`;
        if (hours) html += `      <span class="meta-hours" title="營業時間">${escapeHtml(hours)}</span>`;
        if (price) html += `      <span class="meta-price"><strong>${escapeHtml(formatPrice(price))}</strong></span>`;
        html += `    </div>`;
        html += `  </div>`;
      }

      html += clickableEnd;
    });

    html += `</div></div>`;
  });

  out.insertAdjacentHTML('beforeend', html);

  // 內嵌樣式（一次性）
  const styleId = 'grid-style-v4';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .grid-img, .grid-img * { pointer-events: none; } /* 點擊走外層連結（評論） */
      .group > h3 { margin: 16px 0 10px; font-size: 16px; }

      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .grid-item { border: 1px solid #eee; border-radius: 12px; overflow: hidden; background: #fff; text-decoration: none; color: inherit; display: flex; flex-direction: column; }
      .grid-item.link:hover { box-shadow: 0 6px 16px rgba(0,0,0,0.08); transform: translateY(-1px); transition: box-shadow .2s, transform .2s; }

      .grid-img { aspect-ratio: 1 / 1; background: #f3f4f6; display: flex; align-items: center; justify-content: center; }
      .grid-img img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
      .grid-img.img-error::after { content: '圖片載入失敗'; color: #999; font-size: 12px; }
      .grid-img.img-empty { background: repeating-linear-gradient(45deg, #f6f7f8, #f6f7f8 10px, #f0f1f2 10px, #f0f1f2 20px); }
      .grid-img .img-placeholder { color: #9aa0a6; font-size: 12px; letter-spacing: .1em; }

      .grid-caption { padding: 10px 10px 4px; font-size: 14px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* 地點 / 營業時間 / 金額 */
      .grid-meta { display: flex; flex-direction: column; gap: 4px; padding: 0 10px 10px; font-size: 12px; color: #374151; }
      .grid-meta .meta-line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .grid-meta .meta-location { color: #4b5563; white-space: normal; word-break: break-word; }
      .grid-meta .meta-hours { color: #374151; }
      .grid-meta .meta-price { color: #2563eb; } /* 金額藍色；粗體在 strong */

      /* 手機：單欄、圖片 16:9、文字不遮罩 */
      @media (max-width: 640px) {
        .grid { grid-template-columns: 1fr; }
        .grid-img { aspect-ratio: 16 / 9; }
        .grid-caption { white-space: normal; overflow: visible; text-overflow: unset; }
        .grid-item { border-radius: 12px; }
      }
    `;
    document.head.appendChild(s);
  }
}

window.renderGrid = renderGrid;
