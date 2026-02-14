// filename: js/view-shopping.js
'use strict';

/**
 * 採購清單 view（外觀與 view-schedule.js 完全一致）
 *
 * 差異行為：
 * - 不依 +/@ 變色：左側時間欄固定中性灰（不代表狀態）
 * - 點卡片背景：選取 / 取消選取（選中高亮）
 * - 點圖片 / 按鈕 / 連結 / 複製地址：不會誤觸選取
 * - 分享：只分享已選取；優先 Web Share，不支援則複製分享文字
 * - 匯出/匯入：round-trip（header/data/meta 一起帶）
 *   - 匯出永遠包含「全部可見資料」，並額外帶 selectedIds（用於匯入後還原選取）
 * - 自動剪貼簿匯入：focus / visibilitychange 時嘗試讀取；僅在 shopping 模式生效
 *
 * 注意：
 * - escapeHtml 由 csv-parser.js 提供（window.escapeHtml）。本檔不重複定義以避免遞迴爆棧。
 */

(function () {
  const ROUNDTRIP_MAGIC = 'sheet_viewer_roundtrip_v1';
  const esc = (typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : (s) => String(s ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function t(v) { return String(v ?? '').trim(); }

  function pickField(header, candidates) {
    const lower = header.map((h) => t(h).toLowerCase());
    for (const c of candidates) {
      const q = t(c).toLowerCase();
      const idx = lower.indexOf(q);
      if (idx >= 0) return header[idx];
    }
    return '';
  }

  function collectReviewKeys(header) {
    const keys = [];
    header.forEach((h) => {
      const s = t(h);
      if (!s) return;
      if (s === '評論' || /^評論\d+$/.test(s) || /^review\d*$/i.test(s)) keys.push(h);
    });
    // 確保「評論」在前，評論1/2/3... 依序
    keys.sort((a, b) => {
      const A = t(a); const B = t(b);
      if (A === '評論') return -1;
      if (B === '評論') return 1;
      return A.localeCompare(B, 'en', { numeric: true });
    });
    return keys;
  }

  function hasNonEmptyValue(v) {
    if (v == null) return false;
    const s = String(v).trim();
    return s !== '' && s !== '-' && s !== '—';
  }

  function normalizeUrl(v) {
    const s = t(v);
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return `https:${s}`;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return `https://${s}`;
    return s;
  }

  async function copyTextToClipboard(text) {
    const s = String(text ?? '');
    if (!s) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(s);
        return true;
      }
    } catch {
      // fallthrough
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch {
      return false;
    }
  }

  function toast(msg) {
    // 沿用 schedule 的 toast class
    let el = document.querySelector('.copy-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'copy-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function ensureImageModal() {
    if (document.getElementById('imgModal')) return;

    const modal = document.createElement('div');
    modal.id = 'imgModal';
    modal.className = 'img-modal';
    modal.innerHTML = `
      <div class="img-modal-backdrop"></div>
      <div class="img-modal-panel">
        <button class="img-modal-close" type="button" aria-label="Close">×</button>
        <img class="img-modal-img" alt="">
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('show');
      document.documentElement.classList.remove('no-scroll');
      document.body.classList.remove('no-scroll');
    };

    modal.querySelector('.img-modal-backdrop')?.addEventListener('click', close);
    modal.querySelector('.img-modal-close')?.addEventListener('click', close);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function showImageModal(src, alt) {
    ensureImageModal();
    const modal = document.getElementById('imgModal');
    if (!modal) return;

    const img = modal.querySelector('.img-modal-img');
    if (img) {
      img.src = src;
      img.alt = alt || '';
    }
    modal.classList.add('show');
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
  }

  function ensureScheduleStylesSameAsScheduleView() {
    const styleId = 'schedule-style-v10';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
    .schedule-container{ --sched-img-w: 480px; }
    .schedule-title{ margin:0 0 4px 0; font-size:20px; text-align:center; }
    .schedule-date{ text-align:center; margin:2px 0 8px; font-weight:700; }
    .schedule-meta-note{ margin:6px 0 10px; color:#6b7280; font-size:13px; }
    .schedule-legend{ margin-top:8px; text-align:center; color:#6b7280; }
    .schedule-legend em{ font-style:italic; font-weight:700; }
    .schedule-legend .legend-blue{ color:#2563eb; font-weight:700; }
    .schedule-legend .legend-red{ color:#ef4444; font-weight:700; }

    .schedule-layout{ display:flex; flex-direction:column; gap:12px; }

    .schedule-topbar{
      grid-column:1 / -1;
      display:flex; justify-content:flex-end; align-items:center;
      padding:4px 6px 6px; font-size:12px; color:#374151;
      border-bottom:2px solid rgba(0,0,0,.15);
    }
    .schedule-topbar .topbar-label{ color:#6b7280; margin-right:4px; }
    .schedule-topbar.is-empty .topbar-label,
    .schedule-topbar.is-empty .topbar-value{ visibility:hidden; }

    .schedule-info{ display:flex; flex-direction:column; gap:4px; min-width:0; }
    .schedule-type{ font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:.05em; }
    .schedule-name{ font-size:17px; font-weight:700; }
    .schedule-name.is-required{ color:#2563eb; }
    .schedule-name.is-optional{ color:#ef4444; }
    .schedule-location{ font-size:13px; color:#374151; }
    .schedule-price{ color:#2563eb; font-weight:700; line-height:1.25; }
    .schedule-note{ color:#ef4444; font-size:13px; }

    .copy-addr{ cursor:pointer; position:relative; }
    .copy-addr:active{ transform:scale(0.99); }

    .sched-btn{
      display:inline-flex; align-items:center; justify-content:center;
      min-width:40px; height:32px;
      padding:0 10px;
      border:1px solid #e5e7eb; border-radius:10px;
      background:#fff; color:#111827; text-decoration:none;
      font-size:14px; font-weight:700;
      line-height:1;
      box-sizing:border-box;
      user-select:none;
      transform: translateY(1px);
    }
    .sched-btn:hover{ background:#f9fafb; }
    .sched-img{ cursor:zoom-in; }

    .copy-toast{
      position:fixed; z-index:9999; top:14px; right:14px;
      background:rgba(17,24,39,.92); color:#fff;
      padding:8px 12px; border-radius:10px; font-size:13px;
      box-shadow:0 8px 20px rgba(0,0,0,.18);
      opacity:0; transform:translateY(-6px);
      transition:opacity .2s, transform .2s;
    }
    .copy-toast.show{ opacity:1; transform:translateY(0); }

    .no-scroll{ overflow:hidden; }
    .img-modal{ position:fixed; inset:0; z-index:10000; display:none; }
    .img-modal.show{ display:block; }
    .img-modal-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.62); }
    .img-modal-panel{
      position:absolute; left:50%; top:50%;
      transform:translate(-50%,-50%);
      width:min(92vw, 980px);
      max-height:88vh;
      background:#111827;
      border-radius:14px;
      box-shadow:0 16px 44px rgba(0,0,0,.38);
      overflow:hidden;
      display:flex; align-items:center; justify-content:center;
    }
    .img-modal-img{
      width:100%; height:100%;
      max-height:88vh;
      object-fit:contain;
      display:block;
      background:#111827;
    }
    .img-modal-close{
      position:absolute; top:10px; right:12px;
      width:36px; height:36px;
      padding:0;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.18);
      background:rgba(0,0,0,.35);
      color:#fff;

      display:flex;
      align-items:center;
      justify-content:center;

      font-size:22px;
      line-height:1;
      cursor:pointer;
    }
    .img-modal-close:hover{ background:rgba(0,0,0,.5); }

    @media (min-width: 769px) {
      .schedule-item{
        display:grid !important;
        grid-template-columns:100px 1fr !important;
        gap:14px; padding:12px;
        border:1px solid #eee; border-radius:12px; background:#fff;
        color:inherit; text-decoration:none;
      }
      .schedule-item.is-clickable:hover{
        box-shadow:0 6px 16px rgba(0,0,0,.08);
        transform:translateY(-1px);
        transition:.2s;
      }

      .schedule-time-section{ display:flex; align-items:center; justify-content:center; border-radius:8px; background:#2563eb; color:#fff; }
      .schedule-time-section.has-plus{ background:#ef4444; color:#fff; }
      .schedule-time-section.has-at{ background:#9ca3af; color:#fff; }
      .schedule-time{ font-weight:700; font-size:18px; padding:6px 10px; }
      .schedule-time{ display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.15; }
      .schedule-time > span{ display:block; }
      .schedule-time .t1,.schedule-time .t2{ font-weight:700; }
      .schedule-time .tsep{ opacity:.95; margin:2px 0; }

      .schedule-content-section{
        display:grid !important;
        grid-template-columns:1fr var(--sched-img-w) !important;
        gap:12px; align-items:stretch !important;
      }

      .schedule-image{
        flex:unset !important;
        width:auto !important;
        height:auto !important;
        max-height:none !important;
      }

      .schedule-item .schedule-content-section .schedule-image{
        aspect-ratio:4 / 3;
        border-radius:10px;
        overflow:hidden;
        position:relative;
        background:#111827;
        width:100% !important;
        min-width:0 !important;
        max-width:none !important;
        height:auto !important;
      }

      .schedule-item .schedule-content-section .schedule-image.img-error::after{
        content:'圖片載入失敗';
        color:#999;
        font-size:12px;
      }

      .schedule-item .schedule-content-section .schedule-image .img-bg{
        position:absolute; inset:0;
        background-size:cover;
        background-position:center;
        filter: blur(14px);
        transform: scale(1.08);
        opacity: .95;
      }

      .schedule-item .schedule-content-section .schedule-image img.img-fg{
        position:absolute; inset:0;
        width:100% !important;
        height:100% !important;
        object-fit:cover !important;
        object-position:center center;
        display:block;
      }

      .schedule-media{ display:flex; flex-direction:column; gap:8px; min-width:0; }
      .schedule-actions{ display:flex; gap:10px; align-items:center; justify-content:flex-start; padding-left:2px; flex-wrap:wrap; }
    }
    `;
      document.head.appendChild(s);
    }

    // Shopping 覆蓋：固定灰色時間欄 + 選取高亮 + 工具列
    const sid = 'shopping-style-v3';
    if (!document.getElementById(sid)) {
      const s = document.createElement('style');
      s.id = sid;
      s.textContent = `
        .mode-shopping .schedule-time-section,
        .mode-shopping .schedule-time-section.has-plus,
        .mode-shopping .schedule-time-section.has-at {
          background: #9ca3af !important;
          color: #fff !important;
        }

        .shopping-toolbar {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin: 8px 0 10px;
          padding: 8px 10px;
          border: 1px solid rgba(0,0,0,.10);
          border-radius: 12px;
          background:#fff;
        }
        .shopping-hint { color:#6b7280; font-size:13px; }
        .shopping-actions { display:flex; gap:8px; align-items:center; }

        .mode-shopping .schedule-item.is-selected {
          border-color: rgba(37,99,235,.55) !important;
          box-shadow: 0 10px 24px rgba(37,99,235,.16) !important;
          background: rgba(37,99,235,.06) !important;
        }

        @media (max-width: 768px) {
          .shopping-toolbar { flex-direction:column; align-items:flex-start; }
          .shopping-actions { width:100%; }
        }
      `;
      document.head.appendChild(s);
    }
  }

  function setModeLabel() {
    window.__SHEET_VIEW_MODE__ = 'shopping';
    document.documentElement.classList.add('mode-shopping');
    const el = document.getElementById('debug-mode');
    if (el) el.textContent = '模式：shopping';
    console.log('[sheet-viewer] mode=shopping');
  }

  function buildShareText(meta, keyTime, keyType, keyName, keyLoc, keyAddr, keyPrice, keyPriceNt, keySite, keyNote, rows) {
    const title = t(meta?.['標題'] || meta?.['title'] || '採購清單');
    const date = t(meta?.['日期'] || meta?.['date'] || '');
    let out = `【${title}】${date ? ' ' + date : ''}\n\n`;

    rows.forEach((row, i) => {
      const time = t(row[keyTime] || '');
      const typ = t(row[keyType] || '');
      const name = t(row[keyName] || '');
      const locAlias = t(row[keyLoc] || '');
      const addr = t(row[keyAddr] || '');
      const site = normalizeUrl(row[keySite] || '');
      const note = t(row[keyNote] || '');

      const priceNt = t(row[keyPriceNt] || '');
      const price = t(row[keyPrice] || '');
      const priceText = priceNt || price;

      const place = (addr && locAlias) ? `${addr}（${locAlias}）` : (addr || locAlias);

      const head = [time, typ, name].filter(Boolean).join('｜') || '(未命名)';
      out += `${i + 1}. ${head}\n`;
      if (place) out += `   地點：${place}\n`;
      if (priceText) out += `   金額：${priceText}\n`;
      if (site) out += `   官網：${site}\n`;
      if (note) out += `   備註：${note}\n`;
      out += `\n`;
    });

    return out.trim();
  }

  async function shareOrCopy(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        toast('已呼叫系統分享');
        return;
      } catch (e) {
        // 使用者取消 share 也會 throw
      }
    }
    const ok = await copyTextToClipboard(text);
    toast(ok ? '已複製分享文字' : '複製失敗');
  }

  // 32-bit FNV-1a（用於產生穩定 id；避免依賴 idx 導致匯入後選取對不上）
  function fnv1a32(input) {
    const s = String(input ?? '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function getStableId(row, keyTime, keyName, keyType, keyAddr, keyLocAlias, keySite) {
    const time = t(row?.[keyTime]);
    const name = t(row?.[keyName]);
    const typ  = t(row?.[keyType]);
    const addr = t(row?.[keyAddr]);
    const alias = t(row?.[keyLocAlias]);
    const site = normalizeUrl(row?.[keySite]);
    const sig = [time, typ, name, addr, alias, site].join('|');
    return `shop_${fnv1a32(sig)}`;
  }

  function buildRoundTrip(cached, allRows, selectedIds) {
    return {
      magic: ROUNDTRIP_MAGIC,
      kind: 'shopping',
      header: Array.isArray(cached?.header) ? cached.header : [],
      data: Array.isArray(allRows) ? allRows : [],
      meta: (cached && typeof cached.meta === 'object') ? cached.meta : {},
      selectedIds: Array.isArray(selectedIds) ? selectedIds : [],
      exportedAt: new Date().toISOString(),
    };
  }

  function parseRoundTrip(text) {
    const obj = (() => {
      try { return JSON.parse(String(text || '').trim()); } catch { return null; }
    })();
    if (!obj || typeof obj !== 'object') return null;
    if (!Array.isArray(obj.header) || !Array.isArray(obj.data) || typeof obj.meta !== 'object') return null;

    // 避免把「行程」誤當採購：只要 meta.模式 明確包含「行程」，就拒絕自動匯入
    const mode = t(obj.meta?.模式 || obj.meta?.mode).toLowerCase();
    if (mode && (mode.includes('行程') || mode.includes('schedule'))) return null;

    const selectedIds = Array.isArray(obj.selectedIds)
      ? obj.selectedIds.map((x) => t(x)).filter(Boolean)
      : [];

    return { header: obj.header, data: obj.data, meta: obj.meta, selectedIds };
  }

  async function applyImported(imported) {
    const next = {
      header: imported.header,
      data: imported.data,
      meta: imported.meta,
    };

    if (window.AppState && typeof window.AppState === 'object') {
      window.AppState.cached = next;
      window.AppState.currentView = 'shopping';
    }

    // 先渲染，再用 selectedIds 還原選取（渲染時會讀 renderShopping._selectedSet）
    renderShopping._selectedSet = new Set(imported.selectedIds || []);
    renderShopping(next);
  }

  async function tryAutoImportFromClipboard() {
    // 僅在 shopping 模式才自動匯入
    if (window.__SHEET_VIEW_MODE__ !== 'shopping') return;
    if (!navigator.clipboard?.readText) return;

    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return; }
    const imported = parseRoundTrip(text);
    if (!imported) return;

    const sig = `${text.length}:${text.slice(0, 32)}`;
    if (tryAutoImportFromClipboard._sig === sig) return;
    tryAutoImportFromClipboard._sig = sig;

    await applyImported(imported);
    toast(`已自動匯入（${imported.data.length} 筆）`);
  }

  function bindAutoImport() {
    if (window.__shoppingAutoImportBound) return;
    window.__shoppingAutoImportBound = true;

    window.addEventListener('focus', () => {
      tryAutoImportFromClipboard();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        tryAutoImportFromClipboard();
      }
    });
  }

  function renderShopping(cached) {
    ensureScheduleStylesSameAsScheduleView();
    bindAutoImport();
    setModeLabel();

    const out = document.getElementById('out');
    if (!out) return;

    const header = Array.isArray(cached?.header) ? cached.header : [];
    const data = Array.isArray(cached?.data) ? cached.data : [];
    if (!header.length || !data.length) {
      out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
      return;
    }

    const meta = (cached && typeof cached.meta === 'object') ? cached.meta : {};

    // key mapping（完全沿用 schedule 的欄位策略）
    const keyTime = header[0];
    const keyType = pickField(header, ['類型', 'type', '分類', 'category']);
    const keyName = pickField(header, ['名稱', 'name', 'title', '主題', '景點']) || header[1] || header[0];

    const keyLocation = pickField(header, ['地址', 'address']);
    const keyLocationAlias = pickField(header, ['地點別稱', '地點', 'location', '別稱', 'alias', 'location alias']);
    const keySite = pickField(header, ['官網', '網站', '官方網站', 'website', 'official', 'url']);

    const keyPrice = pickField(header, ['金額', 'price', '費用']);
    const keyPriceNt = pickField(header, [
      '換算金額(NT)', '換算金額', '換算金額nt', '換算金額(nt)',
      '換算金額twd', 'twd', 'ntd', 'converted', 'converted nt', 'converted ntd',
    ]);
    const keyHours = pickField(header, ['營業時間', '營業時段', 'hours', 'opening hours', 'open hours']);
    const keyReviews = collectReviewKeys(header);

    const keyImage = pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
    const keyNote = pickField(header, ['備註', 'note']);

    // 隱藏欄位（沿用 schedule）
    const keyHide = pickField(header, ['隱藏', 'hide', 'hidden']);
    const visibleData = keyHide
      ? data.filter((row) => !hasNonEmptyValue(row[keyHide]))
      : data;

    // 排序（沿用 schedule 的字串排序；但不做 ?/! 規則以免影響採購）
    const sorted = [...visibleData].sort((a, b) => {
      const ta = String(a[keyTime] || '').trim();
      const tb = String(b[keyTime] || '').trim();
      if (ta && tb && ta !== tb) return ta.localeCompare(tb, 'zh-Hant');
      return 0;
    });

    // selection state（以 stable id 記錄）
    const selectedSet = renderShopping._selectedSet || (renderShopping._selectedSet = new Set());

    // toolbar buttons
    const title = t(meta['標題'] || meta['title'] || '採購清單');
    const date = t(meta['日期'] || meta['date'] || '');

    let html = '';
    html += `<div class="schedule-container shopping-container">`;
    html += `<h2 class="schedule-title">${esc(title)}</h2>`;
    if (date) html += `<div class="schedule-date">日期：${esc(date)}</div>`;

    html += `
      <div class="shopping-toolbar">
        <div class="shopping-hint"><span id="debug-mode">模式：shopping</span>｜點卡片背景可選取/取消選取；點圖片/按鈕/連結不會誤觸；選取後可分享/匯出。</div>
        <div class="shopping-actions">
          <button class="sched-btn shop-share" type="button" disabled>分享</button>
          <button class="sched-btn shop-export" type="button">匯出</button>
          <button class="sched-btn shop-import" type="button">匯入</button>
        </div>
      </div>
    `;

    html += `<div class="schedule-layout">`;

    const idByIndex = [];
    sorted.forEach((row, idx) => {
      const itemId = getStableId(row, keyTime, keyName, keyType, keyLocation, keyLocationAlias, keySite);
      idByIndex.push(itemId);

      const timeText = String(row[keyTime] || '').trim();
      const typeText = String(row[keyType] || '').trim();
      const nameText = String(row[keyName] || '').trim();

      const addr = String(row[keyLocation] || '').trim();
      const alias = String(row[keyLocationAlias] || '').trim();
      const locationText = (addr && alias) ? `${addr}（${alias}）` : (addr || alias);

      const priceText = String(row[keyPriceNt] || row[keyPrice] || '').trim();
      const hoursText = String(row[keyHours] || '').trim();
      const noteText = String(row[keyNote] || '').trim();

      const site = normalizeUrl(row[keySite] || '');

      // reviews
      const reviewUrls = keyReviews
        .map((k) => normalizeUrl(row[k] || ''))
        .filter((u) => !!u);

      const firstReview = reviewUrls[0] || '';

      const imgUrl = normalizeUrl(row[keyImage] || '');

      const selectedCls = selectedSet.has(itemId) ? ' is-selected' : '';

      html += `<div class="schedule-item is-clickable shopping-item${selectedCls}" data-itemid="${esc(itemId)}" data-site="${esc(site)}" data-reviews="${esc(firstReview)}">`;

      // topbar（與 schedule 一樣：永遠存在，沒值就隱藏字但留線）
      const topbarValue = hoursText ? hoursText : '';
      const topbarEmpty = topbarValue ? '' : ' is-empty';
      html += `<div class="schedule-topbar${topbarEmpty}"><span class="topbar-label">營業時間</span><span class="topbar-value">${esc(topbarValue)}</span></div>`;

      // time（固定灰色背景由 CSS 覆蓋）
      html += `<div class="schedule-time-section">${formatTimeHtml(timeText)}</div>`;

      html += `<div class="schedule-content-section">`;
      html += `<div class="schedule-info">`;
      if (typeText) html += `<div class="schedule-type">${esc(typeText)}</div>`;
      html += `<div class="schedule-name">${esc(nameText || '(未命名)')}</div>`;
      if (locationText) {
        html += `<div class="schedule-location">地點：<span class="copy-addr" data-copy="${esc(locationText)}">${esc(locationText)}</span></div>`;
      }
      if (priceText) html += `<div class="schedule-price">${esc(priceText)}</div>`;
      if (noteText) html += `<div class="schedule-note">${esc(noteText)}</div>`;
      html += `</div>`;

      html += `<div class="schedule-media">`;

      if (imgUrl) {
        html += `
          <div class="schedule-image sched-img" data-full="${esc(imgUrl)}" title="點擊放大">
            <div class="img-bg" style="background-image:url('${esc(imgUrl)}')"></div>
            <img class="img-fg" src="${esc(imgUrl)}" alt="${esc(nameText)}" />
          </div>
        `;
      }

      // actions：官網 + 評論按鈕
      const actions = [];
      if (site) actions.push({ text: '官網', url: site });
      reviewUrls.forEach((u, i) => {
        actions.push({ text: (i === 0 ? '評' : `評${i + 1}`), url: u });
      });

      if (actions.length) {
        html += `<div class="schedule-actions">`;
        actions.forEach((a) => {
          html += `<a class="sched-btn" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.text)}</a>`;
        });
        html += `</div>`;
      }

      html += `</div>`; // media
      html += `</div>`; // content
      html += `</div>`; // item
    });

    html += `</div></div>`;

    out.innerHTML = html;

    // store for share/export
    renderShopping._last = {
      cached,
      sorted,
      header,
      meta,
      keys: {
        keyTime, keyType, keyName,
        keyLocationAlias,
        keyLocation,
        keyPrice,
        keyPriceNt,
        keySite,
        keyNote,
      },
      idByIndex,
    };

    // bind events once
    bindEvents(out);
    updateShareBtn(out);
  }

  function formatTimeHtml(timeText) {
    // 與 schedule 類似：換行顯示
    const s = String(timeText || '').trim();
    if (!s) return '';
    const compact = s.replace(/\s+/g, '');
    if (compact.includes('-')) {
      const parts = compact.split('-').filter(Boolean);
      if (parts.length >= 2) {
        return `<div class="schedule-time"><span class="t1">${esc(parts[0])}</span><span class="tsep">-</span><span class="t2">${esc(parts.slice(1).join('-'))}</span></div>`;
      }
    }
    return `<div class="schedule-time"><span class="t1">${esc(compact)}</span></div>`;
  }

  function updateShareBtn(out) {
    const btn = out.querySelector('.shop-share');
    if (!btn) return;
    const selCount = out.querySelectorAll('.shopping-item.is-selected').length;
    btn.disabled = selCount <= 0;
    btn.textContent = selCount > 0 ? `分享（${selCount}）` : '分享';
  }

  function bindEvents(out) {
    if (out._shoppingBound) return;
    out._shoppingBound = true;

    // 複製地址（不觸發選取）
    out.addEventListener('click', async (e) => {
      const el = e.target.closest('.copy-addr');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();

      const text = t(el.getAttribute('data-copy') || el.textContent || '');
      if (!text) return;

      const ok = await copyTextToClipboard(text);
      toast(ok ? '已複製' : '複製失敗');
    });

    // 圖片放大（不觸發選取）
    out.addEventListener('click', (e) => {
      const img = e.target.closest('.sched-img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();

      const src = img.getAttribute('data-full') || '';
      if (!src) return;
      showImageModal(src, '');
    });

    // 連結/按鈕不觸發選取
    out.addEventListener('click', (e) => {
      const a = e.target.closest('a,button,input,textarea,select,label');
      if (!a) return;
      e.stopPropagation();
    });

    // 背景點擊：切換選取
    out.addEventListener('click', (e) => {
      const item = e.target.closest('.shopping-item');
      if (!item) return;

      const interactiveSel = '.sched-img, .sched-btn, .copy-addr, a, button, input, textarea, select, label';
      if (e.target.closest(interactiveSel)) return;

      const id = t(item.getAttribute('data-itemid') || '');
      if (!id) return;

      const set = renderShopping._selectedSet || (renderShopping._selectedSet = new Set());
      if (item.classList.contains('is-selected')) {
        item.classList.remove('is-selected');
        set.delete(id);
      } else {
        item.classList.add('is-selected');
        set.add(id);
      }
      updateShareBtn(out);
    });

    // 分享
    out.addEventListener('click', async (e) => {
      const btn = e.target.closest('.shop-share');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;

      const last = renderShopping._last;
      if (!last) return;

      const set = renderShopping._selectedSet || new Set();
      const picked = [];
      last.sorted.forEach((row, idx) => {
        const id = last.idByIndex[idx];
        if (set.has(id)) picked.push(row);
      });

      const k = last.keys;
      const text = buildShareText(
        last.meta,
        k.keyTime, k.keyType, k.keyName,
        k.keyLocationAlias, k.keyLocation,
        k.keyPrice, k.keyPriceNt,
        k.keySite, k.keyNote,
        picked
      );
      await shareOrCopy(text);
    });

    // 匯出（round-trip JSON -> clipboard）
    // 精簡：永遠匯出「全部可見資料」，並附帶 selectedIds 用於匯入後還原選取
    out.addEventListener('click', async (e) => {
      const btn = e.target.closest('.shop-export');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      const last = renderShopping._last;
      if (!last) return;

      const set = renderShopping._selectedSet || new Set();
      const selectedIds = Array.from(set);

      const payload = buildRoundTrip(last.cached, last.sorted, selectedIds);
      const text = JSON.stringify(payload, null, 2);
      const ok = await copyTextToClipboard(text);
      toast(ok ? `已匯出（共 ${last.sorted.length} 筆，選取 ${selectedIds.length}）` : '匯出失敗');
    });

    // 匯入（prompt）
    out.addEventListener('click', async (e) => {
      const btn = e.target.closest('.shop-import');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      let clip = '';
      try {
        if (navigator.clipboard?.readText) clip = await navigator.clipboard.readText();
      } catch {}

      const input = window.prompt('貼上匯入內容（round-trip JSON）', clip || '');
      if (!input) return;

      const imported = parseRoundTrip(input);
      if (!imported) {
        toast('格式不符（或被判定為行程）');
        return;
      }

      await applyImported(imported);
      toast(`已匯入（${imported.data.length} 筆，已還原選取 ${imported.selectedIds.length}）`);
    });
  }

  window.renderShopping = renderShopping;
})();
