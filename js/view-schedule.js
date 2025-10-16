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

// 將 "20:00~21:30" 轉成三行的 HTML（開始 / ~ / 結束）
function formatTimeMultiline(raw) {
  const s = String(raw || '');
  if (!s.includes('~')) return escapeHtml(s);        // 沒有 ~ 維持原樣
  const [start, end] = s.split('~').map(x => x.trim());
  const a = escapeHtml(start || '');
  const b = escapeHtml(end || '');
  return `<span class="t1">${a}</span><span class="tsep">~</span><span class="t2">${b}</span>`;
}

function formatPrice(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // 已含幣別就不再加：$, NT$, NT＄, ¥/￥, €, £
  const hasSymbol = /^(\$|€|£|¥|￥|NT\$?|NT[＄$]?)/i.test(s);
  return hasSymbol ? s : `$${s}`;
}


  // 欄位對應
  const timeKey   = header[0]; // 左側時間 / 時刻表
  const typeKey   = pickField(header, ['類型','type','分類','category']);
  const nameKey   = pickField(header, ['名稱','name','title','主題']) || header[1] || header[0];
  const locKey    = pickField(header, ['地點','location','地址']);
  const priceKey  = pickField(header, ['金額','price','費用']);
  const hoursKey  = pickField(header, ['營業時間','營業時段','hours','opening hours','open hours']);
  const cmtKey    = pickField(header, ['評論','review','reviews','評價']);
  const imgKey    = pickField(header, ['圖片','圖片網址','照片','image','img','thumbnail','photo','pic','圖']);
  const noteKey   = pickField(header, ['備註','note']); // 行內備註（非 meta）

  // 依時間字串排序（字典序即可）
  const sorted = [...data].sort((a, b) =>
    String(a[timeKey]||'').localeCompare(String(b[timeKey]||''))
  );

  const metaNote = (cached?.meta && (cached.meta['備註'] || cached.meta['note'])) || '';
  let html = '<div class="schedule-container"><h2 class="schedule-title">行程</h2>';
  const metaDate = (cached?.meta && (cached.meta['日期'] || cached.meta['date'])) || '';
  if (metaDate) html += `<div class="schedule-date">日期：${escapeHtml(String(metaDate))}</div>`;
  if (metaNote) {
      const lines = String(metaNote).split(/\n+/).map(s => s.trim()).filter(Boolean);
      const bullets = lines.map(s => `*.${escapeHtml(s)}`).join('<br>');
      html += `<div class="schedule-meta-note"><div class="meta-label">備註：</div>${bullets}</div>`;
  }
  html += '<div class="schedule-layout">';
  sorted.forEach(item => {
    const time   = item[timeKey] || '';
    const typ    = typeKey ? (item[typeKey] || '') : '';
    const name   = item[nameKey] || '';
    const loc    = locKey ? (item[locKey] || '') : '';
    const price  = priceKey ? (item[priceKey] || '') : '';
    const hours  = hoursKey ? (item[hoursKey] || '') : '';
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

    // 頂欄：營業時間（靠右），底下黑色實線
    if (hours) {
      html += `<div class="schedule-topbar"><span class="topbar-label">營業時間：</span>${escapeHtml(String(hours))}</div>`;
    }

    // 左：時間
    html += `<div class="${timeSectionClasses.join(' ')}">`;
    html += `<div class="${timeClasses.join(' ')}">${formatTimeMultiline(time)}</div>`;
    html += '</div>';

    // 右：內容 + 更大圖片（加寬）
    html += '<div class="schedule-content-section">';
    html += '  <div class="schedule-info">';
    if (typ)   html += `    <div class="schedule-type">${escapeHtml(String(typ))}</div>`;
    if (name)  html += `    <div class="${nameClasses.join(' ')}">${escapeHtml(String(name))}</div>`;
    if (loc) html += `    <div class="schedule-location copy-addr"
                                  data-copy="${escapeHtml(String(loc))}"
                                  title="點一下複製地點">${escapeHtml(String(loc))}</div>`;
    if (price) html += `    <div class="schedule-price"><strong>${escapeHtml(formatPrice(price))}</strong></div>`; // 藍色粗體（前加 $
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
  html += `<div class="schedule-legend"><em>／ <span class="legend-blue">藍色</span>為必有行程．<span class="legend-red">紅色</span>為選擇行程 ／</em></div>`;
  html += '</div>'; // schedule-container

  out.insertAdjacentHTML('beforeend', html);
  // 只綁一次的事件代理，點 .copy-addr 就複製地址
if (!out._bindCopyAddr) {
     out.addEventListener('click', async (e) => {
        const el = e.target.closest('.copy-addr');
        if (!el) return;
       // ★ 關鍵：避免點到父層 <a> 導航（評論網址）
       e.preventDefault();
       e.stopPropagation();
    
        const text = (el.dataset.copy || el.textContent || '').trim();
        if (!text) return;
    
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          }
          showCopyToast('已複製地點');
        } catch {
          showCopyToast('複製失敗');
        }
  });
}

// 小提示
function showCopyToast(msg){
  let t = document.getElementById('copy-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'copy-toast';
    t.className = 'copy-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg || '已複製';
  t.classList.add('show');
  clearTimeout(showCopyToast._timer);
  showCopyToast._timer = setTimeout(() => t.classList.remove('show'), 1200);
}


  // 樣式（一次性）
  const styleId = 'schedule-style-v3';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
    /* ========= 基本排版 ========= */
    .schedule-container{ --sched-img-w: 480px; }          /* 桌面右欄寬：想更大改這裡 */
    .schedule-title{ margin:0 0 4px 0; font-size:20px; text-align:center; }
    .schedule-date{ text-align:center; margin:2px 0 8px; font-weight:700; }
    .schedule-meta-note{ margin:6px 0 10px; color:#6b7280; font-size:13px; }
    .schedule-legend{ margin-top:8px; text-align:center; color:#6b7280; }
    .schedule-legend em{ font-style:italic; font-weight:700; }
    .schedule-legend .legend-blue{ color:#2563eb; font-weight:700; }
    .schedule-legend .legend-red{ color:#ef4444; font-weight:700; }
  
    .schedule-layout{ display:flex; flex-direction:column; gap:12px; }
    .schedule-item{
      display:grid;
      grid-template-columns:100px 1fr;     /* 左：時間  右：內容 */
      gap:14px; padding:12px;
      border:1px solid #eee; border-radius:12px; background:#fff;
      color:inherit; text-decoration:none;
    }
    .schedule-item.link:hover{ box-shadow:0 6px 16px rgba(0,0,0,.08); transform:translateY(-1px); transition:.2s; }
  
    /* ========= 左側時間 ========= */
    .schedule-time-section{ display:flex; align-items:center; justify-content:center; border-radius:8px; background:#2563eb; color:#fff; }
    .schedule-time-section.has-plus{ background:#ef4444; color:#fff; }
    .schedule-time{ font-weight:700; font-size:18px; padding:6px 10px; }
    .schedule-time{ display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.15; }
    .schedule-time > span{ display:block; }
    .schedule-time .t1,.schedule-time .t2{ font-weight:700; }
    .schedule-time .tsep{ opacity:.95; margin:2px 0; }
  
    /* ========= 頂欄（營業時間） ========= */
    .schedule-topbar{
      grid-column:1 / -1;
      display:flex; justify-content:flex-end; align-items:center;
      padding:4px 6px 6px; font-size:12px; color:#374151;
      border-bottom:2px solid rgba(0,0,0,.15);  /* 高透明度灰色 */
    }
    .schedule-topbar .topbar-label{ color:#6b7280; margin-right:4px; }
  
    /* ========= 右側內容 + 圖片（桌面） ========= */
    .schedule-content-section{
      display:grid;
      grid-template-columns:1fr var(--sched-img-w);  /* 右圖欄寬 */
      gap:12px; align-items:stretch;
    }
    .schedule-info{ display:flex; flex-direction:column; gap:4px; min-width:0; }
    .schedule-type{ font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:.05em; }
    .schedule-name{ font-size:17px; font-weight:700; }
    .schedule-name.is-required{ color:#2563eb; }
    .schedule-name.is-optional{ color:#ef4444; }
    .schedule-location{ font-size:13px; color:#374151; }
    .schedule-price{ color:#2563eb; font-weight:700; }   /* 金額藍色粗體 */
    .schedule-note{ color:#ef4444; font-size:13px; }     /* 行內備註紅色 */
  
    /* 右側圖片容器（桌面）：4:3 比例，解鎖任何 80px 限制 */
    .schedule-item .schedule-content-section .schedule-image{
      aspect-ratio:4 / 3;
      background:#f3f4f6; border-radius:10px; overflow:hidden;
      display:flex; align-items:center; justify-content:center;
      width:100% !important; min-width:0 !important; max-width:none !important; height:auto !important;
    }
    .schedule-item .schedule-content-section .schedule-image.img-error::after{ content:'圖片載入失敗'; color:#999; font-size:12px; }
    .schedule-item .schedule-content-section .schedule-image .img-placeholder{ color:#9aa0a6; font-size:12px; letter-spacing:.1em; }
    .schedule-item .schedule-content-section .schedule-image img{
      width:100% !important; height:100% !important; object-fit:cover; display:block;
      max-width:none !important; max-height:none !important;
    }

    /* 可點複製的地點樣式與提示 */
    .copy-addr{ cursor:pointer; position:relative; }
    .copy-addr:active{ transform:scale(0.99); }

    /* 複製完成的小提示 */
    .copy-toast{
      position:fixed; z-index:9999; top:14px; right:14px;
      background:rgba(17,24,39,.92); color:#fff;
      padding:8px 12px; border-radius:10px; font-size:13px;
      box-shadow:0 8px 20px rgba(0,0,0,.18);
      opacity:0; transform:translateY(-6px);
      transition:opacity .2s, transform .2s;
    }
    .copy-toast.show{ opacity:1; transform:translateY(0); }
  
    /* ========= RWD：你指定的手機版樣式維持不變 ========= */
    @media (max-width: 640px) {
      .schedule-item { grid-template-columns: 84px 1fr; }
      .schedule-content-section { grid-template-columns: 1fr 180px; }  /* ★ 這段照你的要求「不變」 */
      .schedule-time { font-size: 16px; padding: 4px 8px; }
    }
  `;
    document.head.appendChild(s);
  }
}

window.renderSchedule = renderSchedule;
