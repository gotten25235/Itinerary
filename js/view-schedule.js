// filename: js/view-schedule.js
'use strict';

/**
 * 行程（右側大圖 + 時間含「+」紅底 + 底部斜線說明）
 * - 有評論網址 → 整卡可點（新分頁）
 * - 金額：藍色粗體；備註：紅色
 * - 時間包含「+」→ 時間區塊紅底白字
 * - 依「類型」文字判斷：含「必」→ 名稱藍色；含「選」→ 名稱紅色（其餘維持預設）
 * - 底部加入斜體說明：藍色為必有行程、紅色為選擇行程
 */

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}
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

function renderSchedule(cached) {
  const out = document.getElementById('out');
  if (!out) return;
  out.innerHTML = '';

  const header = Array.isArray(cached?.header) ? cached.header : [];
  const data   = Array.isArray(cached?.data)   ? cached.data   : [];
  if (!header.length || !data.length) {
    out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
    return;
  }

  // 欄位對應
  const timeKey   = header[0]; // 左側時間 / 時刻表
  const typeKey   = pickField(header, ['類型','type','分類','category']);
  const nameKey   = pickField(header, ['名稱','name','title','主題']) || header[1] || header[0];
  const locKey    = pickField(header, ['地點','location','地址']);
  const priceKey  = pickField(header, ['金額','price','費用']);
  const cmtKey    = pickField(header, ['評論','review','reviews','評價']);
  const imgKey    = pickField(header, ['圖片','圖片網址','照片','image','img','thumbnail','photo','pic','圖']);
  const noteKey   = pickField(header, ['備註','note']); // 行內備註（非 meta）

  // 依時間字串排序（字典序即可）
  const sorted = [...data].sort((a, b) =>
    String(a[timeKey]||'').localeCompare(String(b[timeKey]||''))
  );

  let html = '<div class="schedule-container"><h2 class="schedule-title">行程</h2><div class="schedule-layout">';
  sorted.forEach(item => {
    const time   = item[timeKey] || '';
    const typ    = typeKey ? (item[typeKey] || '') : '';
    const name   = item[nameKey] || '';
    const loc    = locKey ? (item[locKey] || '') : '';
    const price  = priceKey ? (item[priceKey] || '') : '';
    const review = cmtKey ? (item[cmtKey] || '') : '';
    const note   = noteKey ? (item[noteKey] || '') : '';
    const img    = imgKey ? firstImageUrl(item[imgKey]) : '';
    const clickable = isHttpUrl(review);

    // 名稱顏色（類型含「必」→ 藍；含「選」→ 紅）
    const nameClasses = ['schedule-name'];
    if (/\u5fc5/.test(String(typ))) nameClasses.push('is-required');   // 必
    if (/\u9078/.test(String(typ))) nameClasses.push('is-optional');   // 選

    // 時間含「+」→ 紅底
    const timeClasses = ['schedule-time'];
    const timeSectionClasses = ['schedule-time-section'];
    if (String(time).includes('+')) timeSectionClasses.push('has-plus');

    const start = clickable
      ? `<a class="schedule-item link" href="${escapeHtml(review)}" target="_blank" rel="noopener">`
      : `<div class="schedule-item">`;
    const end   = clickable ? `</a>` : `</div>`;

    html += start;

    // 左：時間
    html += `<div class="${timeSectionClasses.join(' ')}">`;
    html += `  <div class="${timeClasses.join(' ')}">${escapeHtml(String(time))}</div>`;
    html += '</div>';

    // 右：內容 + 更大圖片（加寬）
    html += '<div class="schedule-content-section">';
    html += '  <div class="schedule-info">';
    if (typ)   html += `    <div class="schedule-type">${escapeHtml(String(typ))}</div>`;
    if (name)  html += `    <div class="${nameClasses.join(' ')}">${escapeHtml(String(name))}</div>`;
    if (loc)   html += `    <div class="schedule-location">${escapeHtml(String(loc))}</div>`;
    if (price) html += `    <div class="schedule-price"><strong>${escapeHtml(String(price))}</strong></div>`; // 藍色粗體
    if (note)  html += `    <div class="schedule-note">${escapeHtml(String(note))}</div>`;                   // 紅色
    html += '  </div>';

    html += '  <div class="schedule-image">';
    if (img) {
      html += `    <img src="${escapeHtml(img)}" alt="${escapeHtml(String(name||''))}" loading="lazy" onerror="this.onerror=null;this.src='';this.closest('.schedule-image').classList.add('img-error');">`;
    } else {
      html += `    <div class="img-placeholder">無圖</div>`;
    }
    html += '  </div>';

    html += '</div>'; // content-section
    html += end;
  });
  html += '</div>'; // schedule-layout

  // 底部斜線說明
  html += `<div class="schedule-legend"><em>／ 藍色為必有行程．紅色為選擇行程 ／</em></div>`;
  html += '</div>'; // schedule-container

  out.insertAdjacentHTML('beforeend', html);

  // 樣式（一次性）
  const styleId = 'schedule-style-v3';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .schedule-layout { display: flex; flex-direction: column; gap: 12px; }
      .schedule-item { display: grid; grid-template-columns: 100px 1fr; gap: 14px; padding: 12px; border: 1px solid #eee; border-radius: 12px; background: #fff; color: inherit; text-decoration: none; }
      .schedule-item.link:hover { box-shadow: 0 6px 16px rgba(0,0,0,0.08); transform: translateY(-1px); transition: box-shadow .2s, transform .2s; }

      .schedule-time-section { display: flex; align-items: center; justify-content: center; }
      .schedule-time-section { display: flex; align-items: center; justify-content: center; border-radius: 8px; }
      .schedule-time-section.has-plus { background: #ef4444; color: #fff; } /* 含「+」→ 整個時間區塊紅底 */

      /* 右側內容 + 更大圖：把右側圖片欄放大到 220px（手機時縮小） */
      .schedule-content-section { display: grid; grid-template-columns: 1fr 320px; gap: 14px; align-items: stretch; }
      .schedule-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .schedule-type { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
      .schedule-name { font-size: 17px; font-weight: 700; }
      .schedule-name.is-required { color: #2563eb; }  /* 藍色：必有行程 */
      .schedule-name.is-optional { color: #ef4444; }  /* 紅色：選擇行程 */
      .schedule-location { font-size: 13px; color: #374151; }
      .schedule-price { color: #2563eb; font-weight: 700; }  /* 既有規則：金額藍色粗體 */
      .schedule-note { color: #ef4444; font-size: 13px; }    /* 既有規則：行內備註紅色 */

      .schedule-image { aspect-ratio: 1 / 1; background: #f3f4f6; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
      .schedule-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .schedule-image.img-error::after { content:'圖片載入失敗'; color:#999; font-size:12px; }
      .schedule-image .img-placeholder { color:#9aa0a6; font-size:12px; letter-spacing:.1em; }

      .schedule-legend { margin-top: 8px; text-align: center; color: #6b7280; }
      .schedule-legend em { font-style: italic; }

      @media (max-width: 640px) {
        .schedule-item { grid-template-columns: 84px 1fr; }
        .schedule-content-section { grid-template-columns: 1fr 180px; }
        .schedule-time { font-size: 16px; padding: 4px 8px; }
      }
    `;
    document.head.appendChild(s);
  }
}

window.renderSchedule = renderSchedule;
