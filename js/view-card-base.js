// filename: js/view-card-base.js
'use strict';

/**
 * view-card-base.js（Card View Base / 共通模板）
 *
 * 目的：
 * - 將 schedule/shopping/note 等「卡片式視圖」共用的欄位映射、DOM 結構與事件綁定集中管理
 * - 各視圖只需要提供差異化設定（config），避免重複堆疊 UI 與互動細節
 *
 * 提供：
 * - SheetCardBase.createCardRenderer(config)：產生 renderer(cached)
 * - 共用能力：欄位挑選、URL 正規化、評論按鈕拆分、顯示模式解析、圖片 modal、toast、Google Maps 連結
 *
 * 顯示模式（由 parseDisplayModeFlags 解析，允許以逗號/空白分隔複數）：
 * - 0：hide（整列不渲染）
 * - 1：strike（刪除線）
 * - 2：grayBottom（灰色並排到最後；排序由各 view 控制）
 * - 3：requireCode1912（變數名保留歷史命名；實際 gate 為「需要 URL code 含 666」才顯示）
 *
 * URL code（支援逗號多值）：?code=1912,666
 * - 個人模式是否可見：由 handle.js 決策（依模式 + code set）
 * - Card 顯示模式=3：此 base 只檢查 code 是否包含「666」
 */

(function () {
  const esc = (typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  function t(v) { return String(v ?? '').trim(); }

  function isHttpUrl(v) {
    return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
  }

  function normalizeUrl(v) {
    const s = t(v);
    if (!s) return '';
    if (isHttpUrl(s)) return s;

    if (typeof window.makeSafeUrl === 'function') {
      const u = window.makeSafeUrl(s);
      return isHttpUrl(u) ? u : '';
    }

    if (/^\/\//.test(s)) return `https:${s}`;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return `https://${s}`;
    return '';
  }

  /* ============ Money / Exchange (use utils-money.js) ============ */
  function mustGetUtilsMoney() {
    const um = (typeof window !== "undefined") ? window.UtilsMoney : null;
    if (!um || typeof um.buildPriceDisplayHtml !== "function") {
      throw new Error("UtilsMoney is required but not loaded. Please include js/utils-money.js before view-card-base.js");
    }
    return um;
  }

  function buildGoogleMapsSearchUrl(addr) {
    const s = t(addr);
    if (!s) return '';
    // Google Maps 搜尋：最通用（地址 / 店名 / 座標都吃）
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s)}`;
  }

  function pickField(header = [], candidates = []) {
    const keys = header.map(h => t(h));
    const lower = keys.map(k => k.toLowerCase());

    for (const c of candidates) {
      const ci = String(c).toLowerCase();

      let idx = lower.indexOf(ci);
      if (idx !== -1) return keys[idx];

      idx = lower.findIndex(k => k.includes(ci));
      if (idx !== -1) return keys[idx];
    }
    return null;
  }

  function collectReviewKeys(header = []) {
    const keys = header.map(h => t(h)).filter(Boolean);
    const out = [];

    for (const k of keys) {
      const kl = k.toLowerCase();

      if (k === '評論' || /^評論\d+$/u.test(k)) { out.push(k); continue; }
      if (kl === 'review' || /^review\d+$/.test(kl) || kl === 'reviews') { out.push(k); continue; }
      if (kl.includes('review')) { out.push(k); continue; }
    }

    return out.filter((k, i) => out.indexOf(k) === i);
  }

  function firstImageUrl(value) {
    if (!value) return '';
    const parts = String(value).trim().split(/[\s,;\n\r]+/).filter(Boolean);
    const url = parts.find(p => /^https?:\/\//i.test(p));
    return url || '';
  }

  function detectPlatformLabel(url) {
    const u = String(url || '').toLowerCase();
    if (!u) return '評';
    if (u.includes('instagram.com') || u.includes('instagr.am') || u.includes('ig.me')) return 'IG';
    if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.me')) return 'FB';
    if (u.includes('discord.gg') || u.includes('discord.com')) return 'DC';
    return '評';
  }

  function buildReviewButtons(urls) {
    const labelCount = Object.create(null);
    const genericCount = { n: 0 };

    return urls.map((x) => {
      const base = detectPlatformLabel(x.url);

      if (base === '評') {
        genericCount.n += 1;
        const txt = (genericCount.n === 1) ? '評' : `評${genericCount.n}`;
        return { text: txt, url: x.url };
      }

      labelCount[base] = (labelCount[base] || 0) + 1;
      const n = labelCount[base];
      const txt = (n === 1) ? base : `${base}${n}`;
      return { text: txt, url: x.url };
    });
  }

  // 讀取 ?code=1912,666 這種逗號多值
  function getCodeSet() {
    try {
      const p = new URLSearchParams(location.search);
      const raw = String(p.get('code') || '').trim();
      if (!raw) return new Set();
      const parts = raw.split(/[,\s，]+/u).map(s => s.trim()).filter(Boolean);
      return new Set(parts);
    } catch {
      return new Set();
    }
  }

  // Card 顯示模式=3：只認 666
  function hasCardCode666() {
    return getCodeSet().has('666');
  }


  function parseDisplayModeFlags(v) {
    const s = t(v);
    if (!s) return { hide: false, strike: false, grayBottom: false, requireCode1912: false };

    const parts = s.split(/[,，\s]+/u).map(x => x.trim()).filter(Boolean);
    const set = new Set(parts);
    return {
      hide: set.has('0'),
      strike: set.has('1'),
      grayBottom: set.has('2'),
      requireCode1912: set.has('3'), // 顯示模式=3：需要 ?code=1912 才顯示
    };
  }
  function showToast(msg, ms) {
    const UC = (typeof window !== 'undefined') ? window.UtilsCopy : null;
    if (UC && typeof UC.showCopyToast === 'function') return UC.showCopyToast(msg, ms);
    try { console.log('[toast]', msg); } catch {}
  }

  function ensureImageModalOnce() {
    if (document.getElementById('img-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'img-modal';
    modal.className = 'img-modal';
    modal.innerHTML = `
      <div class="img-modal-backdrop" data-close="1"></div>
      <div class="img-modal-panel" role="dialog" aria-modal="true">
        <button class="img-modal-close" type="button" aria-label="Close" data-close="1">×</button>
        <img class="img-modal-img" alt="" />
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      const close = e.target && e.target.getAttribute && e.target.getAttribute('data-close');
      if (close) hideImageModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideImageModal();
    });
  }

  function showImageModal(src, altText) {
    ensureImageModalOnce();
    const modal = document.getElementById('img-modal');
    const img = modal.querySelector('.img-modal-img');
    img.src = src || '';
    img.alt = altText || '';
    modal.classList.add('show');
    document.documentElement.classList.add('no-scroll');
  }

  function hideImageModal() {
    const modal = document.getElementById('img-modal');
    if (!modal) return;
    const img = modal.querySelector('.img-modal-img');
    if (img) img.src = '';
    modal.classList.remove('show');
    document.documentElement.classList.remove('no-scroll');
  }

  function ensureCardStyles() {
    const styleId = 'card-base-style-v2';
    if (document.getElementById(styleId)) return;

    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `.schedule-container{ --sched-img-w: 480px; }
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
    .schedule-summary{ color:#6b7280; font-size:13px; }
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
    .sched-btn:disabled{ opacity:.45; cursor:not-allowed; background:#fff; }
    .sched-btn:disabled:hover{ background:#fff; }

    .sched-img{ cursor:zoom-in; }

    /* 顯示模式：刪除線（包含 1） */
    .schedule-item.is-strike .schedule-time,
    .schedule-item.is-strike .schedule-info{
      text-decoration: line-through;
      text-decoration-thickness: 2px;
    }

    /* 顯示模式：灰色 + 排最後（包含 2） */
    .schedule-item.is-gray{ opacity: .55; }
    .schedule-item.is-gray .schedule-time-section{ background:#9ca3af; }

    /* ====== image modal (click image to zoom) ====== */
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
      .schedule-item.is-gray .schedule-time-section{ background:#9ca3af; color:#fff; }
      .schedule-item.is-gray{ color:#6b7280; }
      .schedule-item.is-gray .schedule-price{ color:#6b7280; }
      .schedule-item.is-gray .schedule-name.is-required{ color:#6b7280; }
      .schedule-item.is-gray .schedule-name.is-optional{ color:#6b7280; }

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
/* ====== shopping / common additions (do not affect legacy schedule layout) ====== */
.schedule-item{ cursor:pointer; }
.schedule-item.is-selected{
  outline:3px solid rgba(37,99,235,.35);
  box-shadow:0 12px 28px rgba(0,0,0,.10);
}
`;
    document.head.appendChild(s);
  }

  function createCardRenderer(config) {
    const cfg = config || {};
    const titleDefault = cfg.title || '清單';

    function render(cached) {
      ensureCardStyles();

      const out = document.getElementById('out');
      if (!out) return;
      out.innerHTML = '';

      const header = Array.isArray(cached?.header) ? cached.header : [];
      const data = Array.isArray(cached?.data) ? cached.data : [];
      const meta = (cached && typeof cached.meta === 'object') ? cached.meta : {};

      if (!header.length || !data.length) {
        out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
        return;
      }

      const keys = (typeof cfg.mapKeys === 'function') ? cfg.mapKeys(header) : {};
      const keyDisplayMode = keys.keyDisplayMode || pickField(header, ['顯示模式', 'display mode', 'display_mode', 'mode']);

      const visibleRows = keyDisplayMode
        ? data.filter(r => {
            const f = parseDisplayModeFlags(r[keyDisplayMode]);
            if (f.hide) return false;
            if (f.requireCode1912 && !hasCardCode666()) return false;
            return true;
          })
        : data;


      const sorted = (typeof cfg.sortRows === 'function')
        ? cfg.sortRows([...visibleRows], { ...keys, keyDisplayMode })
        : [...visibleRows];

      const titleFromMeta = t(meta['標題'] || meta['title'] || '') || titleDefault;
      const date = t(meta['日期'] || meta['date'] || '');

      let html = `<div class="schedule-container ${esc(cfg.containerClass || '')}">`;
      html += `<h2 class="schedule-title">${esc(titleFromMeta)}</h2>`;
      if (date) html += `<div class="schedule-date">日期：${esc(date)}</div>`;

      if (typeof cfg.beforeListHtml === 'function') {
        html += cfg.beforeListHtml(cached, { ...keys, keyDisplayMode }) || '';
      }

      html += `<div class="schedule-layout">`;

      const idByIndex = [];

      sorted.forEach((row, idx) => {
        const flags = keyDisplayMode ? parseDisplayModeFlags(row[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };

        const typeText = keys.keyType ? t(row[keys.keyType]) : '';
        const nameText = keys.keyName ? t(row[keys.keyName]) : '';
        const hoursText = keys.keyHours ? t(row[keys.keyHours]) : '';
        const summaryText = keys.keySummary ? t(row[keys.keySummary]) : '';
        const noteText = keys.keyNote ? t(row[keys.keyNote]) : '';

        const locRaw = keys.keyLocation ? t(row[keys.keyLocation]) : '';
        const aliasRaw = keys.keyLocationAlias ? t(row[keys.keyLocationAlias]) : '';
        const locDisplay = locRaw ? (aliasRaw ? `${locRaw}(${aliasRaw})` : locRaw) : '';

        const siteUrl = keys.keySite ? normalizeUrl(row[keys.keySite]) : '';

        const reviewUrlObjs = [];
        if (keys.keyReviews && keys.keyReviews.length) {
          keys.keyReviews.forEach((k) => {
            const u = normalizeUrl(row[k]);
            if (u) reviewUrlObjs.push({ url: u, key: k });
          });
        }
        const reviewButtons = buildReviewButtons(reviewUrlObjs);
        const firstReviewUrl = reviewUrlObjs.length ? reviewUrlObjs[0].url : '';

        const img = keys.keyImage ? firstImageUrl(row[keys.keyImage]) : '';

        const derived = { siteUrl, firstReviewUrl, img };

        const itemId = (typeof cfg.getItemId === 'function')
          ? (cfg.getItemId(row, idx, { ...keys, keyDisplayMode }, flags, cached) || '')
          : '';
        idByIndex.push(itemId);

        const itemClasses = ['schedule-item'];
        if (flags.strike) itemClasses.push('is-strike');
        if (flags.grayBottom) itemClasses.push('is-gray');

        if (typeof cfg.getItemExtraClasses === 'function') {
          const extra = cfg.getItemExtraClasses(row, idx, { ...keys, keyDisplayMode }, flags, cached) || [];
          extra.forEach(c => c && itemClasses.push(c));
        }

        const dataAttrs = {};
        if (itemId) dataAttrs['data-itemid'] = itemId;
        if (siteUrl) dataAttrs['data-site'] = siteUrl;
        if (firstReviewUrl) dataAttrs['data-review'] = firstReviewUrl;

        if (typeof cfg.getItemDataAttrs === 'function') {
          const more = cfg.getItemDataAttrs(row, idx, { ...keys, keyDisplayMode }, flags, cached, derived) || {};
          Object.assign(dataAttrs, more);
        }

        const dataAttrHtml = Object.keys(dataAttrs).map(k => `${k}="${esc(String(dataAttrs[k]))}"`).join(' ');

        html += `<div class="${itemClasses.join(' ')}" ${dataAttrHtml}>`;

        const hasHours = !!hoursText;
        html += `<div class="schedule-topbar ${hasHours ? '' : 'is-empty'}">
          <span class="topbar-label">${esc(cfg.topbarLabel || '營業時間：')}</span>
          <span class="topbar-value">${hasHours ? esc(String(hoursText)) : '&nbsp;'}</span>
        </div>`;

        const leftHtml = (typeof cfg.renderLeftCell === 'function')
          ? cfg.renderLeftCell(row, idx, { ...keys, keyDisplayMode }, flags, cached)
          : `<div class="schedule-time"><span class="t1">${esc(String(idx + 1))}</span></div>`;

        const tsecExtra = (typeof cfg.getTimeSectionClasses === 'function')
          ? (cfg.getTimeSectionClasses(row, idx, { ...keys, keyDisplayMode }, flags, cached) || [])
          : [];
        const tsecCls = ['schedule-time-section'].concat(tsecExtra || []).filter(Boolean).join(' ');
        html += `<div class="${tsecCls}">${leftHtml}</div>`;

        html += `<div class="schedule-content-section">`;

        html += `<div class="schedule-info">`;
        if (typeText) html += `<div class="schedule-type">${esc(typeText)}</div>`;

        if (nameText) {
          const nameClasses = ['schedule-name'];
          if (typeof cfg.getNameClasses === 'function') {
            const nc = cfg.getNameClasses(row, idx, { ...keys, keyDisplayMode }, flags, cached) || [];
            nc.forEach(c => c && nameClasses.push(c));
          }
          html += `<div class="${nameClasses.join(' ')}">${esc(nameText)}</div>`;
        }

        if (locDisplay) {
          const mapsUrl = buildGoogleMapsSearchUrl(locRaw || locDisplay);
          html += `
          <a class="schedule-location addr-link"
             href="${esc(mapsUrl)}"
             target="_blank"
             rel="noopener"
             title="開啟 Google 地圖">
            ${esc(locDisplay)}
          </a>
        `;
        }
        

        if (typeof cfg.renderPriceHtml === 'function') {
          const priceHtml = cfg.renderPriceHtml(row, idx, { ...keys, keyDisplayMode }, flags, cached) || '';
          if (priceHtml) html += `<div class="schedule-price"><strong>${priceHtml}</strong></div>`;
        } else if (keys.keyPrice) {
          const priceRaw = row[keys.keyPrice] || '';
          const priceNtRaw = keys.keyPriceNt ? (row[keys.keyPriceNt] || '') : '';

          // 若有「換算金額(NT)」欄位，套用共用換算顯示；否則照原字串顯示
          const pHtml = keys.keyPriceNt
            ? mustGetUtilsMoney().buildPriceDisplayHtml(priceRaw, priceNtRaw, esc)
            : esc(t(priceRaw));

          if (pHtml) html += `<div class="schedule-price"><strong>${pHtml}</strong></div>`;
        }

        if (summaryText) {
          const summaryHtml = summaryText
            .split(/\r?\n/)
            .map(s => s.trim()).filter(Boolean)
            .map(s => esc(s))
            .join('<br>');
          html += `<div class="schedule-summary">${summaryHtml}</div>`;
        }
        if (noteText) html += `<div class="schedule-note">${esc(noteText)}</div>`;
        html += `</div>`;

        html += `<div class="schedule-media">`;

        html += `<div class="schedule-image">`;
        if (img) {
          html += `
            <div class="img-bg" style="background-image:url('${esc(img)}')"></div>
            <img class="sched-img img-fg"
                 src="${esc(img)}"
                 data-full="${esc(img)}"
                 alt="${esc(nameText || '')}"
                 loading="lazy"
                 title="點圖片放大"
                 onerror="this.onerror=null;this.src='';this.closest('.schedule-image').classList.add('img-error');">
          `;
        } else {
          html += `<div class="img-placeholder">無圖</div>`;
        }
        html += `</div>`;

        if (siteUrl || reviewButtons.length) {
          html += `<div class="schedule-actions">`;
          if (siteUrl) {
            html += `<a class="sched-btn" href="${esc(siteUrl)}" target="_blank" rel="noopener" title="官網" aria-label="官網">官</a>`;
          }
          reviewButtons.forEach((b) => {
            html += `<a class="sched-btn" href="${esc(b.url)}" target="_blank" rel="noopener" title="評論" aria-label="評論">${esc(b.text)}</a>`;
          });
          html += `</div>`;
        }

        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
      });

      html += `</div></div>`;
      out.insertAdjacentHTML('beforeend', html);

      bindCommonEventsOnce(out);

      const renderer = render;
      renderer._last = { cached, sorted, keys, idByIndex };

      if (typeof cfg.afterRender === 'function') {
        cfg.afterRender({ out, cached, sorted, keys, idByIndex, renderer });
      }
    }

    render._cfg = cfg;
    return render;
  }

  function bindCommonEventsOnce(out) {
    if (out._cardBaseBound) return;
    out._cardBaseBound = true;

    // 複製地址
    out.addEventListener('click', async (e) => {
      const el = e.target.closest('.addr-copy-btn');
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      const text = t(el.dataset.copy || el.textContent || '');
      if (!text) return;

      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToast('已複製地點');
      } catch {
        showToast('複製失敗');
      }
    });

    // 圖片放大
    out.addEventListener('click', (e) => {
      const img = e.target.closest('.sched-img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      const src = img.getAttribute('data-full') || img.getAttribute('src') || '';
      if (!src) return;
      showImageModal(src, img.getAttribute('alt') || '');
    });

    // 互動元件不觸發 item click（避免誤選取）
    out.addEventListener('click', (e) => {
      const hit = e.target.closest(
        '.sched-btn, a, button, input, textarea, select, label, .sched-img, [data-close], .img-modal'
      );
      if (!hit) return;
      // 不擋掉預設行為（例如連結跳轉），只阻止冒泡到 item click
      e.stopPropagation();
    });
  }

  // 綁定目前 renderer 到 out（讓 item click hook 找得到）
  document.addEventListener('DOMContentLoaded', () => {
    const out = document.getElementById('out');
    if (!out) return;
    Object.defineProperty(out, '_cardBaseLastRenderer', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: null,
    });
  });

  // render 呼叫時更新 out._cardBaseLastRenderer
  const _origCreate = createCardRenderer;
  createCardRenderer = function (config) {
    const r = _origCreate(config);
    const wrapped = function (cached) {
      const out = document.getElementById('out');
      if (out) out._cardBaseLastRenderer = wrapped;
      return r(cached);
    };
    wrapped._cfg = r._cfg;
    wrapped._last = null;
    return wrapped;
  };

  window.SheetCardBase = {
    esc,
    t,
    pickField,
    normalizeUrl,
    collectReviewKeys,
    firstImageUrl,
    buildReviewButtons,
    parseDisplayModeFlags,
    showToast,
    createCardRenderer,
  };
})();
