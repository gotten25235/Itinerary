// filename: js/view-schedule.js
'use strict';

/**
 * 行程 view
 *
 * 功能特性（與既有邏輯一致）：
 * - 欄位對應：官網、地點別稱、換算金額(NT)
 * - 地點顯示：地址(地點別稱)
 * - 點背景：開官網 URL（新分頁）— 但點互動元件不觸發
 * - 評論欄位：評論 / 評論1 / 評論2 → 分成不同按鈕
 *   - 檢測網址：IG/FB/Discord -> 按鈕文字改 IG/FB/DC
 *   - 其他 -> 評 / 評2 / 評3（可區分）
 *   - 同平台多顆：IG2、FB2、DC2...
 * - 點選圖片：放大預覽（與背景點擊分離，不觸發官網）
 * - hoursKey 沒填也維持同排版：topbar 永遠存在，空值隱藏文字但保留分隔線位置
 *
 * 金額顯示規則（既有）：
 * - 只處理「明確非 NTD/TWD」的幣別：RMB/CNY、JPY、USD、KRW、HKD
 * - 若檢測到 NT / TWD / NTD：完全不處理（照原本字串顯示）
 * - 若沒寫幣別：完全不處理（照原本字串顯示）
 * - 若「換算金額(NT)」該行有值：優先使用該值；否則用匯率自動換算
 * - 金額欄位可為多行：逐行處理；有幣別才換算，其他行原樣保留
 *
 * 本次需求：
* - 新增欄位：顯示模式（display mode）
*   - 0 => 隱藏（不顯示）
*   - 1 => 刪除線
*   - 2 => 顯示灰色 + 排序放最下面（在 ? / ？ 之後）
*   - 可複數：例如 "1,2" / "1，2"（刪除線 + 灰色 + 排最下面）
*   - 空值 => 正常顯示
* - 時刻表排序：? / ？ 視為較晚；若顯示模式包含 2，該筆固定排在最下面
 */

/* escapeHtml 由 csv-parser.js 提供（window.escapeHtml） */

/* =========================
 * Utilities
 * ========================= */

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}

function normalizeUrl(v) {
  const s = String(v || '').trim();
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

function collectReviewKeys(header = []) {
  const keys = header.map(h => (h || '').toString().trim()).filter(Boolean);
  const out = [];

  for (const k of keys) {
    const kl = k.toLowerCase();

    if (k === '評論' || /^評論\d+$/u.test(k)) {
      out.push(k);
      continue;
    }

    if (kl === 'review' || /^review\d+$/.test(kl) || kl === 'reviews') {
      out.push(k);
      continue;
    }

    if (kl.includes('review')) {
      out.push(k);
      continue;
    }
  }

  return out.filter((k, i) => out.indexOf(k) === i);
}

function firstImageUrl(value) {
  if (!value) return '';
  const parts = String(value).trim().split(/[\s,;\n\r]+/).filter(Boolean);
  const url = parts.find(p => /^https?:\/\//i.test(p));
  return url || '';
}

function formatTimeMultiline(raw) {
  const s = String(raw || '');
  if (!s.includes('~')) return escapeHtml(s);
  const [start, end] = s.split('~').map(x => x.trim());
  const a = escapeHtml(start || '');
  const b = escapeHtml(end || '');
  return `<span class="t1">${a}</span><span class="tsep">~</span><span class="t2">${b}</span>`;
}

/* =========================
 * Money / FX
 * ========================= */

function getExchangeRatesToNt() {
  const base = {
    USD: 31.5,
    JPY: 0.21,
    CNY: 4.4,
    KRW: 0.024,
    HKD: 4.0,
    NTD: 1.0,
  };

  const src = (typeof window !== 'undefined')
    ? (window.SCHEDULE_EXCHANGE_RATES || window.EXCHANGE_RATES)
    : null;

  if (!src || typeof src !== 'object') return base;

  const out = { ...base };
  Object.keys(base).forEach((k) => {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v > 0) out[k] = v;
  });
  return out;
}

function parseNumberLoose(v) {
  const s = String(v || '').trim();
  if (!s) return NaN;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function detectCurrencyCode(raw) {
  const s = String(raw || '').trim();
  const sl = s.toLowerCase();
  if (!s) return '';

  // 你的規則：只要偵測到 NT/TWD/NTD，就「完全不處理」
  if (/\b(ntd|twd)\b/.test(sl) || /\bnt\s*\$?\b/i.test(s) || sl.includes('台幣') || sl.includes('新台幣')) return 'NTD';

  if (sl.includes('hkd') || sl.includes('hk$') || sl.includes('港幣') || sl.includes('港元')) return 'HKD';
  if (sl.includes('krw') || s.includes('₩') || sl.includes('韓幣') || sl.includes('韓元')) return 'KRW';
  if (sl.includes('rmb') || sl.includes('cny') || sl.includes('人民幣')) return 'CNY';
  if (sl.includes('usd') || sl.includes('us$') || sl.includes('美金') || sl.includes('美元')) return 'USD';
  if (sl.includes('jpy') || s.includes('円') || sl.includes('日幣') || sl.includes('日圓') || sl.includes('日元')) return 'JPY';

  // ¥/￥ 預設當 JPY，除非同列有 RMB/CNY 字樣
  if (s.includes('¥') || s.includes('￥')) {
    if (sl.includes('rmb') || sl.includes('cny')) return 'CNY';
    return 'JPY';
  }

  // 單純 "$" 以 USD 推定（你若希望沒寫幣別就不處理，建議不要填 "$123" 這種）
  if (/^\s*\$/.test(s)) return 'USD';

  return '';
}

function parseMoney(raw) {
  const s = String(raw || '').trim();
  if (!s) return { raw: '', currency: '', amount: NaN };
  const currency = detectCurrencyCode(s);
  const amount = parseNumberLoose(s);
  return { raw: s, currency, amount };
}

function formatNtdAmount(n) {
  if (!Number.isFinite(n)) return '';
  const v = Math.round(n);
  return `NT$${v.toLocaleString('en-US')}`;
}

function extractTrailingUnitSuffix(line) {
  // 抓像：/人、/  人、/1人、/ 1 人、／人、／1人（僅抓「行尾」）
  const s = String(line || '');
  const m = s.match(/((?:\/|／)\s*(?:\d+\s*)?人)\s*$/u);
  if (!m) return { base: s, suffix: '' };
  const suffix = m[1].replace(/\s+$/u, '');
  const base = s.slice(0, m.index).trimEnd();
  return { base, suffix };
}

function buildPriceDisplaySingleLine(priceRawLine, priceNtRawLine) {
  const line = String(priceRawLine || '').trim();
  if (!line) return '';

  const m = parseMoney(line);

  // 你的規則：檢測到 NTD/TWD/NTD 或「沒寫幣別」=> 完全不處理，照原本顯示
  if (m.currency === 'NTD' || m.currency === '') {
    return line;
  }

  // 無法解析數字 => 也不硬做，照原本顯示
  if (!Number.isFinite(m.amount)) {
    return line;
  }

  const { base, suffix } = extractTrailingUnitSuffix(line);

  // 換算金額優先：換算金額(NT) 若有填，吃它；否則用匯率
  const preferredNt = parseNumberLoose(priceNtRawLine);
  let nt = Number.isFinite(preferredNt) ? preferredNt : NaN;

  if (!Number.isFinite(nt)) {
    const rates = getExchangeRatesToNt();
    const r = rates[m.currency];
    if (Number.isFinite(r) && r > 0) nt = m.amount * r;
  }

  const ntText = formatNtdAmount(nt);
  if (!ntText) return line;

  if (suffix) {
    return `${base}${suffix}(約${ntText}${suffix})`;
  }
  return `${line}(約${ntText})`;
}

function splitMoneyLines(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  // 主要支援換行；額外支援分號/頓號當分隔（不影響單行）
  return s
    .split(/\r?\n|；|;|、/u)
    .map(x => String(x).trim())
    .filter(Boolean);
}

function buildPriceDisplayHtml(priceRaw, priceNtRaw) {
  const rawLines = splitMoneyLines(priceRaw);
  if (!rawLines.length) return '';

  const ntLines = splitMoneyLines(priceNtRaw);
  const hasNtLines = ntLines.length > 0;

  const lines = rawLines.map((line, idx) => {
    const ntLine = hasNtLines ? (ntLines[idx] || ntLines[0] || '') : '';
    return buildPriceDisplaySingleLine(line, ntLine);
  });

  // 注意：這裡會 escape，並用 <br> 保留換行
  return lines.map(x => escapeHtml(String(x))).join('<br>');
}

/* =========================
 * Reviews
 * ========================= */

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
      const t = (genericCount.n === 1) ? '評' : `評${genericCount.n}`;
      return { text: t, url: x.url };
    }

    labelCount[base] = (labelCount[base] || 0) + 1;
    const n = labelCount[base];
    const t = (n === 1) ? base : `${base}${n}`;
    return { text: t, url: x.url };
  });
}

/* =========================
 * Image Modal (singleton)
 * ========================= */

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

/* =========================
 * Toast
 * ========================= */

function showCopyToast(msg) {
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

/* =========================
 * Schedule sort / display mode rules
 * ========================= */

function isUnknownScheduleTime(v) {
  const s = String(v || '').trim();
  return s === '?' || s === '？';
}

function scheduleTimeRank(v, displayFlags) {
  // displayFlags: { hide:boolean, strike:boolean, grayBottom:boolean }
  if (displayFlags && displayFlags.grayBottom) return 2;      // 最後
  if (isUnknownScheduleTime(v)) return 1; // 倒數第二
  return 0;
}

function hasNonEmptyValue(v) {
  return String(v ?? '').trim().length > 0;
}

/**
 * 顯示模式欄位規則：
 * - 0 => 隱藏（不顯示）
 * - 1 => 刪除線（顯示但刪除線）
 * - 2 => 顯示灰色 + 排序放最下面
 * - 可複數使用：例如 "1,2" / "1，2"
 * - 空值 => 正常顯示
 */
function parseDisplayModeFlags(v) {
  const s = String(v ?? '').trim();
  if (!s) return { hide: false, strike: false, grayBottom: false };

  const parts = s.split(/[,，\s]+/u).map(x => x.trim()).filter(Boolean);
  const set = new Set(parts);

  return {
    hide: set.has('0'),
    strike: set.has('1'),
    grayBottom: set.has('2'),
  };
}


/* =========================
 * Main render
 * ========================= */

function renderSchedule(cached) {
  const out = document.getElementById('out');
  if (!out) return;
  out.innerHTML = '';

  const header = Array.isArray(cached?.header) ? cached.header : [];
  const data = Array.isArray(cached?.data) ? cached.data : [];
  if (!header.length || !data.length) {
    out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
    return;
  }

  const keyTime = header[0];
    // 顯示模式（0 隱藏 / 1 刪除線 / 2 灰色+排最下面；可複數：1,2）
  const keyDisplayMode = pickField(header, ['顯示模式', 'display mode', 'display_mode', 'mode']);
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
  const keySummary = pickField(header, ['摘要', 'summary']);
  const keyNote = pickField(header, ['備註', 'note']);



// 先過濾「顯示模式=0」的項目
const visibleData = keyDisplayMode
  ? data.filter((row) => !parseDisplayModeFlags(row[keyDisplayMode]).hide)
  : data;

// 排序規則：
  // - 時刻欄位只有 ? / ？ => 放後面
    // - 其他照原本字串排序
  const sorted = [...visibleData].sort((a, b) => {
    const ta = String(a[keyTime] || '').trim();
    const tb = String(b[keyTime] || '').trim();

    const fa = keyDisplayMode ? parseDisplayModeFlags(a[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };
    const fb = keyDisplayMode ? parseDisplayModeFlags(b[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };

    const ra = scheduleTimeRank(ta, fa);
    const rb = scheduleTimeRank(tb, fb);
    if (ra !== rb) return ra - rb;

    return ta.localeCompare(tb);
  });

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
    const time = item[keyTime] || '';
    const typ = keyType ? (item[keyType] || '') : '';
    const name = item[keyName] || '';

    const locRaw = keyLocation ? (item[keyLocation] || '') : '';
    const aliasRaw = keyLocationAlias ? (item[keyLocationAlias] || '') : '';
    const locText = String(locRaw || '').trim();
    const aliasText = String(aliasRaw || '').trim();
    const locDisplay = locText ? (aliasText ? `${locText}(${aliasText})` : locText) : '';

    const priceRaw = keyPrice ? (item[keyPrice] || '') : '';
    const priceNtRaw = keyPriceNt ? (item[keyPriceNt] || '') : '';
    const priceHtml = buildPriceDisplayHtml(priceRaw, priceNtRaw);

    const hoursText = keyHours ? (item[keyHours] || '') : '';
    const hasHours = String(hoursText).trim().length > 0;

    const siteUrl = normalizeUrl(keySite ? item[keySite] : '');

    const reviewUrlObjs = [];
    if (keyReviews && keyReviews.length) {
      keyReviews.forEach((k, idx) => {
        const u = normalizeUrl(item[k]);
        if (u) reviewUrlObjs.push({ url: u, key: k, idx });
      });
    }
    const reviewButtons = buildReviewButtons(reviewUrlObjs);
    const firstReviewUrl = (reviewUrlObjs[0] && reviewUrlObjs[0].url) ? reviewUrlObjs[0].url : '';

    const summary = keySummary ? (item[keySummary] || '') : '';
    const note = keyNote ? (item[keyNote] || '') : '';
    const img = keyImage ? firstImageUrl(item[keyImage]) : '';

    const nameClasses = ['schedule-name'];
    if (/\u5fc5/.test(String(typ))) nameClasses.push('is-required');
    if (/\u9078/.test(String(typ))) nameClasses.push('is-optional');

    const timeSectionClasses = ['schedule-time-section'];
    if (isUnknownScheduleTime(time)) timeSectionClasses.push('has-plus'); // 既有：紅色

    const bgUrl = siteUrl || firstReviewUrl || '';

    const itemFlags = keyDisplayMode ? parseDisplayModeFlags(item[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };
const itemClasses = ['schedule-item'];
if (itemFlags.strike) itemClasses.push('is-strike');
if (itemFlags.grayBottom) itemClasses.push('is-gray');
html += `<div class="${itemClasses.join(' ')}">`;
html += `<div class="schedule-topbar ${hasHours ? '' : 'is-empty'}">
      <span class="topbar-label">營業時間：</span>
      <span class="topbar-value">${hasHours ? escapeHtml(String(hoursText)) : '&nbsp;'}</span>
    </div>`;

    html += `<div class="${timeSectionClasses.join(' ')}">`;
    html += `<div class="schedule-time">${formatTimeMultiline(time)}</div>`;
    html += `</div>`;

    html += `<div class="schedule-content-section">`;

    html += `<div class="schedule-info">`;
    if (typ) html += `<div class="schedule-type">${escapeHtml(String(typ))}</div>`;
    if (name) html += `<div class="${nameClasses.join(' ')}">${escapeHtml(String(name))}</div>`;
    if (locDisplay) {
      html += `<div class="schedule-location copy-addr"
                    data-copy="${escapeHtml(String(locText))}"
                    title="點一下複製地點">${escapeHtml(String(locDisplay))}</div>`;
    }
    if (priceHtml) html += `<div class="schedule-price"><strong>${priceHtml}</strong></div>`;
    if (summary) {
      const summaryHtml = String(summary)
        .split(/\r?\n/)       // 偵測換行（支援 Windows / Mac）
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => escapeHtml(s))
        .join('<br>');
    
      html += `<div class="schedule-summary">${summaryHtml}</div>`;
    }
    if (note) html += `<div class="schedule-note">${escapeHtml(String(note))}</div>`;
    html += `</div>`;

    html += `<div class="schedule-media">`;

    html += `<div class="schedule-image">`;
    if (img) {
      html += `
        <div class="img-bg" style="background-image:url('${escapeHtml(img)}')"></div>
        <img class="sched-img img-fg"
             src="${escapeHtml(img)}"
             data-full="${escapeHtml(img)}"
             alt="${escapeHtml(String(name || ''))}"
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
        html += `<a class="sched-btn" href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener" title="官網" aria-label="官網">官</a>`;
      }
      if (reviewButtons.length) {
        reviewButtons.forEach((b) => {
          html += `<a class="sched-btn" href="${escapeHtml(b.url)}" target="_blank" rel="noopener" title="評論" aria-label="評論">${escapeHtml(b.text)}</a>`;
        });
      }
      html += `</div>`;
    }

    html += `</div>`; // schedule-media
    html += `</div>`; // schedule-content-section
    html += `</div>`; // schedule-item
  });

  html += '</div>'; // schedule-layout
  html += `<div class="schedule-legend"><em>／ <span class="legend-blue">藍色</span>為必有行程．<span class="legend-red">紅色</span>為選擇行程 ／</em></div>`;
  html += '</div>'; // schedule-container

  out.insertAdjacentHTML('beforeend', html);

  if (!out._bindScheduleEvents) {
    out._bindScheduleEvents = true;

    out.addEventListener('click', async (e) => {
      const el = e.target.closest('.copy-addr');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();

      const text = (el.dataset.copy || el.textContent || '').trim();
      if (!text) return;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showCopyToast('已複製地點');
      } catch {
        showCopyToast('複製失敗');
      }
    });

    out.addEventListener('click', (e) => {
      const img = e.target.closest('.sched-img');
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();

      const src = img.getAttribute('data-full') || img.getAttribute('src') || '';
      if (!src) return;
      showImageModal(src, img.getAttribute('alt') || '');
    });

    out.addEventListener('click', (e) => {
      const btn = e.target.closest('.sched-btn');
      if (!btn) return;
      e.stopPropagation();
    });

    // out.addEventListener('click', (e) => {
    //   const item = e.target.closest('.schedule-item');
    //   if (!item) return;

    //   const interactiveSel = '.sched-img, .sched-btn, .copy-addr, a, button, input, textarea, select, label';
    //   if (e.target.closest(interactiveSel)) return;

    //   const site = (item.getAttribute('data-site') || '').trim();
    //   const firstReview = (item.getAttribute('data-reviews') || '').trim();
    //   const url = site || firstReview;
    //   if (!url) return;

    //   window.open(url, '_blank', 'noopener');
    // });
  }

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
    `;
    document.head.appendChild(s);
  }
}

window.renderSchedule = renderSchedule;
