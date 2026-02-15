// filename: js/view-grid.js
'use strict';

const U = (typeof window !== 'undefined' && window.UtilsCopy) ? window.UtilsCopy : null;

/**
 * 圖片九宮格（可切換分組：依「類型」或依「地點別稱」）
 * 顯示：圖片、名稱、地點（可點複製）、營業時間、金額
 *
 * 功能特性（與既有邏輯一致）：
 * - 欄位對應：官網、地點別稱、換算金額(NT)
 * - 地點顯示：地址(地點別稱)；複製仍複製「地址」
 * - 評論欄位：評論 / 評論1 / 評論2（分成不同按鈕）
 *   - 檢測網址：IG/FB/Discord -> 按鈕文字改 IG/FB/DC；其他 -> 評 / 評2 / 評3
 * - 點選圖片：放大預覽（與背景點擊分離）
 *
 * 新增：
 * - 卡片背景點擊：點一下淡淡外框選取；再點一次取消
 * - 最上方擇一按鈕：依 keyType 分組 / 依 keyLocationAlias 分組
 * - 最上方複製按鈕：將選中的項目整理成文字並複製（格式：keyType keyName）
 *
 * 本次修正：
 * - 依地點別稱分組時，只取第一個主名稱（例如「國立臺灣科學教育館 七樓...」視為「國立臺灣科學教育館」）
 *
 * 金額顯示規則（本次新增重點）：
 * - 只處理「明確非 NTD/TWD」的幣別：RMB/CNY、JPY、USD、KRW、HKD
 * - 若檢測到 NT / TWD / NTD：完全不處理（照原本字串顯示）
 * - 若沒寫幣別：完全不處理（照原本字串顯示）
 * - 若「換算金額(NT)」該行有值：優先使用該值；否則用匯率自動換算
 * - 金額欄位可為多行：逐行處理；有幣別才換算，其他行原樣保留
 *
 * 依賴：全域 escapeHtml()
 */

/* =========================
 * Utilities
 * ========================= */

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

/**
 * 注意：依你的規則「沒寫幣別就不處理照原本顯示」，
 * 因此不再做「沒符號就自動補 $」。
 */
function formatPrice(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s;
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
      const t = (genericCount.n === 1) ? '評' : `評${genericCount.n}`;
      return { text: t, url: x.url };
    }

    labelCount[base] = (labelCount[base] || 0) + 1;
    const n = labelCount[base];
    const t = (n === 1) ? base : `${base}${n}`;
    return { text: t, url: x.url };
  });
}

/** 從地址中抓出「XX區」 */
function extractDistrict(addr = '') {
  if (U && typeof U.extractDistrict === 'function') return U.extractDistrict(addr);
  const s = String(addr || '').trim();
  if (!s) return null;

  const common = /(西屯區|南屯區|北屯區|北區|中區|西區|南區|東區|大里區|太平區|潭子區|烏日區|大雅區|龍井區|清水區|沙鹿區|后里區|外埔區|大肚區|霧峰區|神岡區|梧棲區|石岡區|新社區)/;
  let m = s.match(common);
  if (m) return m[1];

  const all = s.match(/([\u4e00-\u9fa5]{1,3}區)/g);
  if (all && all.length) return all[all.length - 1];

  return null;
}

/**
 * 地點別稱分組用：只取「第一個主名稱」
 * - 先取第一行（避免儲存格內有換行多筆）
 * - 再切常見分隔符（、 , ; / |）
 * - 若包含中文且有空白：取空白前（例：國立臺灣科學教育館 七樓... -> 國立臺灣科學教育館）
 */
function normalizeAliasForGroup(alias = '') {
  if (U && typeof U.normalizeAliasForGroup === 'function') return U.normalizeAliasForGroup(alias);

  let s = String(alias || '').trim();
  if (!s) return '';

  const lines = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  s = lines.length ? lines[0] : s;

  const segs = s.split(/[、,;\/|]+/).map(x => x.trim()).filter(Boolean);
  s = segs.length ? segs[0] : s;

  const hasCjk = /[\u4e00-\u9fff]/.test(s);
  if (hasCjk) {
    const i = s.indexOf(' ');
    if (i > 0) s = s.slice(0, i).trim();
  }

  return s;
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

  if (s.includes('¥') || s.includes('￥')) {
    if (sl.includes('rmb') || sl.includes('cny')) return 'CNY';
    return 'JPY';
  }

  // 若你不希望 "$123" 被推定 USD，可移除此條
  if (/^\s*\$/.test(s)) return 'USD';

  return '';
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

function splitMoneyLines(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s
    .split(/\r?\n|；|;|、/u)
    .map(x => String(x).trim())
    .filter(Boolean);
}

function buildPriceDisplaySingleLine(priceRawLine, priceNtRawLine) {
  const line = String(priceRawLine || '').trim();
  if (!line) return '';

  const currency = detectCurrencyCode(line);

  // 規則：NT / TWD / NTD 或 沒寫幣別 → 不處理，原樣顯示
  if (currency === 'NTD' || currency === '') {
    return line;
  }

  const amount = parseNumberLoose(line);
  if (!Number.isFinite(amount)) {
    return line;
  }

  // 優先吃「換算金額(NT)」的該行（若有），否則用匯率
  const preferredNt = parseNumberLoose(priceNtRawLine);
  let nt = Number.isFinite(preferredNt) ? preferredNt : NaN;

  if (!Number.isFinite(nt)) {
    const rates = getExchangeRatesToNt();
    const r = rates[currency];
    if (Number.isFinite(r) && r > 0) nt = amount * r;
  }

  const ntText = formatNtdAmount(nt);
  if (!ntText) return line;

  const { base, suffix } = extractTrailingUnitSuffix(line);

  // 例：RMB$ 3401/人 -> RMB$ 3401/人(約NT$14,964/人)
  if (suffix) {
    return `${base}${suffix}(約${ntText}${suffix})`;
  }
  return `${line}(約${ntText})`;
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

  // 這裡會 escape，並用 <br> 保留換行
  return lines.map(x => escapeHtml(String(x))).join('<br>');
}

/* =========================
 * Selection / Group
 * ========================= */

/** 穩定 32-bit hash（用於選取狀態持久化） */
function hash32(str) {
  if (U && typeof U.hash32 === 'function') return U.hash32(str);

  const s = String(str || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

/** 依目前 groupMode 決定分組 key */
function groupKeyForItem(item, fieldKeys, groupMode) {
  if (U && typeof U.groupKeyForItem === 'function') return U.groupKeyForItem(item, fieldKeys, groupMode);

  const type = fieldKeys.type ? String(item[fieldKeys.type] || '').trim() : '';
  const loc = fieldKeys.location ? String(item[fieldKeys.location] || '').trim() : '';
  const aliasRaw = fieldKeys.locationAlias ? String(item[fieldKeys.locationAlias] || '').trim() : '';
  const alias = normalizeAliasForGroup(aliasRaw);
  const district = extractDistrict(loc) || '';

  if (groupMode === 'locationAlias') {
    return alias || district || type || '未分類';
  }
  return type || district || alias || '未分類';
}

function groupData(data, fieldKeys, groupMode) {
  if (U && typeof U.groupData === 'function') return U.groupData(data, fieldKeys, groupMode);

  const map = new Map();
  data.forEach(it => {
    const g = groupKeyForItem(it, fieldKeys, groupMode);
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(it);
  });
  return map;
}

async function copyTextToClipboard(text) {
  if (U && typeof U.copyTextToClipboard === 'function') return U.copyTextToClipboard(text);

  const s = String(text || '');
  if (!s) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    // fallback below
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
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function buildSelectedText(selectedIds, idMap) {
  if (!selectedIds || !selectedIds.size) return '';

  const items = [];
  for (const id of selectedIds) {
    const it = idMap.get(id);
    if (!it) continue;
    items.push({ type: String(it.type || '').trim(), name: String(it.name || '').trim() });
  }

  if (U && typeof U.buildCopyText === 'function') return U.buildCopyText(items);
  return items.map(x => [x.type, x.name].filter(Boolean).join(' ').trim()).filter(Boolean).join('\n');
}

function updateCopyButtonUI(root) {
  const btn = root.querySelector('#grid-copy-selected');
  if (!btn) return;

  const n = (renderGrid._selectedIds && renderGrid._selectedIds.size) ? renderGrid._selectedIds.size : 0;
  btn.disabled = (n === 0);

  const label = (n === 0) ? '複製' : `複製(${n})`;
  btn.textContent = label;
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
 * Main Render
 * ========================= */

function renderGrid(cached, opts = {}) {
  const out = document.getElementById('out');
  if (!out) return;
  out.innerHTML = '';

  renderGrid._lastCached = cached;

  const prevMode = renderGrid._groupMode || 'type';
  const groupMode = (opts && opts.groupMode) ? String(opts.groupMode) : prevMode;
  renderGrid._groupMode = (groupMode === 'locationAlias') ? 'locationAlias' : 'type';

  if (!renderGrid._selectedIds) renderGrid._selectedIds = new Set();

  const header = Array.isArray(cached?.header) ? cached.header : [];
  const data = Array.isArray(cached?.data) ? cached.data : [];
  if (!header.length || !data.length) {
    out.innerHTML = '<div class="no-data">沒有可顯示的資料</div>';
    return;
  }

  // 欄位探測
  const keyType = pickField(header, ['類型', 'type', '分類', 'category']) || header[0];
  const keyImage = pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
  const keyName = pickField(header, ['名稱', 'name', 'title', '主題']) || header[0];

  const keySite = pickField(header, ['官網', '網站', '官方網站', 'website', 'official', 'url']);
  const keyReviews = collectReviewKeys(header);

  const keyLocation = pickField(header, ['地址', 'address']);
  const keyLocationAlias = pickField(header, ['地點別稱', '地點', 'location', '別稱', 'alias', 'location alias']);

  const keyHours = pickField(header, ['營業時間', '營業時段', 'hours', 'opening hours', 'open hours']);
  const keyPrice = pickField(header, ['金額', 'price', '費用', '價錢', '價格']);
  const keyPriceNt = pickField(header, [
    '換算金額(NT)', '換算金額', '換算金額nt', '換算金額(nt)',
    '換算金額twd', 'twd', 'ntd', 'converted', 'converted nt', 'converted ntd',
  ]);

  const fieldKeys = {
    type: keyType,
    image: keyImage,
    name: keyName,
    hours: keyHours,
    price: keyPrice,
    priceNt: keyPriceNt,
    location: keyLocation,
    locationAlias: keyLocationAlias,
    site: keySite,
  };

  const grouped = groupData(data, fieldKeys, renderGrid._groupMode);

  // 建立 id -> {type, name}，給「複製」用
  renderGrid._idMap = new Map();

  let html = '';

  /* ====== Controls (top) ====== */
  html += `
    <div class="grid-controls" role="group" aria-label="分組方式與複製">
      <div class="grid-controls-left" role="group" aria-label="分組方式">
        <label class="grid-radio">
          <input type="radio" name="grid-group" value="type" ${renderGrid._groupMode === 'type' ? 'checked' : ''}>
          依類型
        </label>
        <label class="grid-radio">
          <input type="radio" name="grid-group" value="locationAlias" ${renderGrid._groupMode === 'locationAlias' ? 'checked' : ''}>
          依地點別稱
        </label>
      </div>

      <div class="grid-controls-right">
        <button id="grid-copy-selected" class="grid-copy-btn" type="button" disabled>複製</button>
      </div>
    </div>
  `;

  grouped.forEach((items, groupName) => {
    html += `<div class="group">`;
    html += `<h3>${escapeHtml(groupName)}</h3>`;
    html += `<div class="grid">`;

    items.forEach(item => {
      const name = (item[keyName] || '').toString().trim() || '(無名稱)';
      const typeText = (item[keyType] || '').toString().trim();

      const imgUrl = keyImage ? firstImageUrl(item[keyImage]) : '';

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

      const hours = keyHours ? String(item[keyHours] || '').trim() : '';
      const priceRaw = keyPrice ? String(item[keyPrice] || '').trim() : '';
      const priceNtRaw = keyPriceNt ? String(item[keyPriceNt] || '').trim() : '';
      const priceHtml = buildPriceDisplayHtml(priceRaw, priceNtRaw);

      const loc = keyLocation ? String(item[keyLocation] || '').trim() : '';
      const alias = keyLocationAlias ? String(item[keyLocationAlias] || '').trim() : '';
      const locDisplay = loc ? (alias ? `${loc}(${alias})` : loc) : '';

      // 選取 id（跨重繪保留）
      const stableKey = [typeText, name, loc, alias, siteUrl, firstReviewUrl, imgUrl].join('|');
      const itemId = hash32(stableKey);
      const isSelected = renderGrid._selectedIds.has(itemId);

      // id map（複製用）
      renderGrid._idMap.set(itemId, { type: typeText, name });

      html += `<div class="grid-item ${isSelected ? 'is-selected' : ''}" data-itemid="${escapeHtml(itemId)}">`;

      // 圖片
      html += `  <div class="grid-img ${imgUrl ? '' : 'img-empty'}">`;
      if (imgUrl) {
        html += `    <img class="grid-img-el" src="${escapeHtml(imgUrl)}" data-full="${escapeHtml(imgUrl)}" alt="${escapeHtml(name)}" loading="lazy" draggable="false" title="點圖片放大" onerror="this.onerror=null;this.src='';this.closest('.grid-img').classList.add('img-error');">`;
      } else {
        html += `    <div class="img-placeholder">無圖</div>`;
      }
      html += `  </div>`;

      // 名稱
      html += `  <div class="grid-caption" title="${escapeHtml(name)}">${escapeHtml(name)}</div>`;

      // 地點 / 營業時間 / 金額
      if (locDisplay || hours || priceRaw) {
        html += `  <div class="grid-meta">`;
        if (locDisplay) {
          html += `    <div class="meta-line meta-location" title="地點">
                        <span class="copy-addr" data-copy="${escapeHtml(loc)}" title="點一下複製地點">
                          ${escapeHtml(locDisplay)}
                        </span>
                      </div>`;
        }
        html += `    <div class="meta-line meta-row">`;
        if (hours) html += `      <span class="meta-hours" title="營業時間">${escapeHtml(hours)}</span>`;
        if (priceHtml) html += `      <span class="meta-price"><strong>${priceHtml}</strong></span>`;
        html += `    </div>`;
        html += `  </div>`;
      }

      // 按鈕列：最下方
      if (siteUrl || reviewButtons.length) {
        html += `  <div class="grid-actions">`;
        if (siteUrl) {
          html += `    <a class="grid-btn" href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener" title="官網" aria-label="官網">官</a>`;
        }
        if (reviewButtons.length) {
          reviewButtons.forEach((b) => {
            html += `    <a class="grid-btn" href="${escapeHtml(b.url)}" target="_blank" rel="noopener" title="評論" aria-label="評論">${escapeHtml(b.text)}</a>`;
          });
        }
        html += `  </div>`;
      }

      html += `</div>`;
    });

    html += `</div></div>`;
  });

  out.insertAdjacentHTML('beforeend', html);

  // 初始化複製按鈕狀態
  updateCopyButtonUI(out);

  /* =========================
   * Event Delegation (bind once)
   * ========================= */
  if (!out._bindGridEvents) {
    out._bindGridEvents = true;

    // 0) 切換分組（radio）
    out.addEventListener('change', (e) => {
      const r = e.target && e.target.closest && e.target.closest('input[name="grid-group"]');
      if (!r) return;

      const v = (r.value || '').trim();
      const nextMode = (v === 'locationAlias') ? 'locationAlias' : 'type';
      if (nextMode === renderGrid._groupMode) return;

      renderGrid(renderGrid._lastCached, { groupMode: nextMode });
    });

    // 0.5) 點「複製」：將選取的整理成文字（keyType keyName）複製到剪貼簿
    out.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest && e.target.closest('#grid-copy-selected');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const text = buildSelectedText(renderGrid._selectedIds, renderGrid._idMap || new Map());
      if (!text) {
        showCopyToast('沒有選取項目');
        updateCopyButtonUI(out);
        return;
      }

      const ok = await copyTextToClipboard(text);
      showCopyToast(ok ? '已複製' : '複製失敗');
      updateCopyButtonUI(out);
    });

    // 1) 點地點 → 複製（阻止卡片背景點擊）
    out.addEventListener('click', async (e) => {
      const el = e.target.closest('.copy-addr');
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      const text = (el.dataset.copy || el.textContent || '').trim();
      if (!text) return;

      const ok = await copyTextToClipboard(text);
      showCopyToast(ok ? '已複製地點' : '複製失敗');
    }, true);

    // 2) 點圖片 → 放大（不觸發背景）
    out.addEventListener('click', (e) => {
      const img = e.target.closest('.grid-img-el');
      if (!img) return;

      e.preventDefault();
      e.stopPropagation();

      const src = img.getAttribute('data-full') || img.getAttribute('src') || '';
      if (!src) return;
      showImageModal(src, img.getAttribute('alt') || '');
    });

    // 3) 點按鈕列（a）→ 正常開，但不觸發背景
    out.addEventListener('click', (e) => {
      const btn = e.target.closest('.grid-btn');
      if (!btn) return;
      e.stopPropagation();
    });

    // 4) 點卡片背景 → 選取/取消（淡外框）
    out.addEventListener('click', (e) => {
      const card = e.target.closest('.grid-item');
      if (!card) return;

      const interactiveSel = '.grid-img-el, .grid-btn, .copy-addr, a, button, input, textarea, select, label';
      if (e.target.closest(interactiveSel)) return;

      const id = (card.getAttribute('data-itemid') || '').trim();
      if (!id) return;

      const set = renderGrid._selectedIds || (renderGrid._selectedIds = new Set());

      if (card.classList.contains('is-selected')) {
        card.classList.remove('is-selected');
        set.delete(id);
      } else {
        card.classList.add('is-selected');
        set.add(id);
      }

      updateCopyButtonUI(out);
    });
  }

  /* =========================
   * Inline Styles (inject once)
   * ========================= */
  const styleId = 'grid-style-v12';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .group > h3 { margin: 16px 0 10px; font-size: 16px; }

      /* Controls */
      .grid-controls{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin: 6px 0 14px;
        padding: 10px 12px;
        border: 1px solid #eee;
        border-radius: 12px;
        background: #fff;
      }
      .grid-controls-left{
        display:flex;
        gap:12px;
        align-items:center;
        flex-wrap:wrap;
      }
      .grid-controls-right{
        display:flex;
        align-items:center;
        gap:10px;
      }
      .grid-radio{
        display:inline-flex;
        align-items:center;
        gap:8px;
        font-size: 13px;
        color:#111827;
        user-select:none;
        cursor:pointer;
      }
      .grid-radio input{ transform: translateY(1px); }

      .grid-copy-btn{
        height:32px;
        padding:0 12px;
        border-radius:10px;
        border:1px solid #e5e7eb;
        background:#fff;
        color:#111827;
        font-size:13px;
        font-weight:700;
        cursor:pointer;
      }
      .grid-copy-btn:hover{ background:#f9fafb; }
      .grid-copy-btn:disabled{
        opacity:.5;
        cursor:not-allowed;
      }

      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }

      .grid-item {
        border: 1px solid #eee;
        border-radius: 12px;
        overflow: hidden;
        background: #fff;
        color: inherit;
        display: flex;
        flex-direction: column;
        cursor: default;
        min-height: 0;
      }

      /* 淡外框選取 */
      .grid-item.is-selected{
        box-shadow: 0 0 0 2px rgba(37,99,235,0.30) inset;
        border-color: rgba(37,99,235,0.20);
      }

      .grid-img {
        aspect-ratio: 1 / 1;
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .grid-img img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        pointer-events: auto;
        cursor: zoom-in;
      }
      .grid-img.img-error::after { content: '圖片載入失敗'; color: #999; font-size: 12px; }
      .grid-img.img-empty { background: repeating-linear-gradient(45deg, #f6f7f8, #f6f7f8 10px, #f0f1f2 10px, #f0f1f2 20px); }
      .grid-img .img-placeholder { color: #9aa0a6; font-size: 12px; letter-spacing: .1em; }

      .grid-caption {
        padding: 10px 10px 4px;
        font-size: 14px;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .grid-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 10px 10px;
        font-size: 12px;
        color: #374151;
      }
      .grid-meta .meta-line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .grid-meta .meta-location { color: #4b5563; white-space: normal; word-break: break-word; }
      .grid-meta .meta-hours { color: #374151; }
      .grid-meta .meta-price { color: #2563eb; line-height: 1.25; }
      .grid-meta .meta-price br { display: block; margin: 2px 0; content: ""; }

      .copy-addr{
        cursor: pointer;
        text-decoration: underline dotted;
        text-underline-offset: 2px;
      }
      .copy-addr:active{ transform: scale(0.99); }

      /* 按鈕列固定貼底 */
      .grid-actions{
        margin-top: auto;
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: flex-start;
        padding: 0 10px 10px;
        flex-wrap: wrap;
      }
      .grid-actions .grid-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;

        height:30px;
        min-width:40px;
        padding:0 10px;

        line-height:1;
        border:1px solid #e5e7eb;
        border-radius:10px;
        background:#fff;
        color:#111827;
        text-decoration:none;

        font-size:14px;
        font-weight:700;
        box-sizing:border-box;

        transform: translateY(1px);
      }
      .grid-btn:hover{ background: #f9fafb; }

      /* Toast */
      .copy-toast{
        position: fixed; z-index: 9999; top: 14px; right: 14px;
        background: rgba(17,24,39,.92); color: #fff;
        padding: 8px 12px; border-radius: 10px; font-size: 13px;
        box-shadow: 0 8px 20px rgba(0,0,0,.18);
        opacity: 0; transform: translateY(-6px);
        transition: opacity .2s, transform .2s;
      }
      .copy-toast.show{ opacity: 1; transform: translateY(0); }

      /* 圖片放大 Modal */
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

      /* 手機：單欄、圖片 16:9、標題可換行 */
      @media (max-width: 640px) {
        .grid { grid-template-columns: 1fr; }
        .grid-img { aspect-ratio: 16 / 9; }
        .grid-caption { white-space: normal; overflow: visible; text-overflow: unset; }
        .grid-item { border-radius: 12px; }
        .grid-controls{ flex-wrap: wrap; gap: 10px; }
      }
    `;
    document.head.appendChild(s);
  }
}

window.renderGrid = renderGrid;
