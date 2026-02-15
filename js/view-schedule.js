// filename: js/view-schedule.js
'use strict';

/**
 * 行程 view（差異化檔）
 * - 使用 SheetCardBase 共通模板產生 renderer
 * - 保留既有行為：
 *   - 時刻表排序：? / ？ 較晚；顯示模式含 2 永遠排最後
 *   - 顯示模式：0 隱藏、1 刪除線、2 灰色 + 排最下面（可複數）
 *   - 時間為 ? / ？：左側 time 區塊加 has-plus（紅色）
 *   - 類型含「必」/「選」：name 套用 is-required / is-optional
 *   - 金額換算：優先吃「換算金額(NT)」，否則依匯率換算（僅明確非 NTD 幣別）
 */

(function () {
  const B = window.SheetCardBase;
  if (!B) {
    console.error('[view-schedule] missing SheetCardBase (view-card-base.js)');
    return;
  }

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
  return lines.map(x => B.esc(String(x))).join('<br>');
}

  function isUnknownScheduleTime(v) {
    const s = String(v || '').trim();
    return s === '?' || s === '？';
  }

  function scheduleTimeRank(v, flags) {
    if (flags && flags.grayBottom) return 2;
    if (isUnknownScheduleTime(v)) return 1;
    return 0;
  }

  function formatTimeMultiline(raw) {
    const s = String(raw || '');
    if (!s.includes('~')) return B.esc(s);
    const parts = s.split('~');
    const start = (parts[0] || '').trim();
    const end = (parts[1] || '').trim();
    const a = B.esc(start);
    const b = B.esc(end);
    return `<span class="t1">${a}</span><span class="tsep">~</span><span class="t2">${b}</span>`;
  }

  function mapKeys(header) {
    const keyDisplayMode = B.pickField(header, ['顯示模式', 'display mode', 'display_mode', 'mode']);

    const keyTime = header[0];
    const keyType = B.pickField(header, ['類型', 'type', '分類', 'category']);
    const keyName = B.pickField(header, ['名稱', 'name', 'title', '主題', '景點']) || header[1] || header[0];

    const keyLocation = B.pickField(header, ['地址', 'address']);
    const keyLocationAlias = B.pickField(header, ['地點別稱', '地點', 'location', '別稱', 'alias', 'location alias']);
    const keySite = B.pickField(header, ['官網', '網站', '官方網站', 'website', 'official', 'url']);

    const keyPrice = B.pickField(header, ['金額', 'price', '費用']);
    const keyPriceNt = B.pickField(header, [
      '換算金額(NT)', '換算金額', '換算金額nt', '換算金額(nt)',
      '換算金額twd', 'twd', 'ntd', 'converted', 'converted nt', 'converted ntd',
    ]);
    const keyHours = B.pickField(header, ['營業時間', '營業時段', 'hours', 'opening hours', 'open hours']);

    const keyReviews = B.collectReviewKeys(header);
    const keyImage = B.pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
    const keySummary = B.pickField(header, ['摘要', 'summary']);
    const keyNote = B.pickField(header, ['備註', 'note']);

    return {
      keyDisplayMode,
      keyTime,
      keyType,
      keyName,
      keyLocation,
      keyLocationAlias,
      keySite,
      keyPrice,
      keyPriceNt,
      keyHours,
      keyReviews,
      keyImage,
      keySummary,
      keyNote,
    };
  }

  function sortRows(rows, keys) {
    const keyTime = keys.keyTime;
    const keyDisplayMode = keys.keyDisplayMode;

    return rows.sort((a, b) => {
      const ta = String(a[keyTime] || '').trim();
      const tb = String(b[keyTime] || '').trim();

      const fa = keyDisplayMode ? B.parseDisplayModeFlags(a[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };
      const fb = keyDisplayMode ? B.parseDisplayModeFlags(b[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };

      const ra = scheduleTimeRank(ta, fa);
      const rb = scheduleTimeRank(tb, fb);
      if (ra !== rb) return ra - rb;

      return ta.localeCompare(tb);
    });
  }

  function renderLeftCell(row, idx, keys) {
    const time = String(row[keys.keyTime] || '').trim();
    return `<div class="schedule-time">${formatTimeMultiline(time)}</div>`;
  }

  function getTimeSectionClasses(row, idx, keys) {
    const time = String(row[keys.keyTime] || '').trim();
    return isUnknownScheduleTime(time) ? ['has-plus'] : [];
  }

  function getNameClasses(row, idx, keys) {
    const typ = keys.keyType ? String(row[keys.keyType] || '') : '';
    const out = [];
    if (/必/.test(typ)) out.push('is-required');
    if (/選/.test(typ)) out.push('is-optional');
    return out;
  }

  function renderPriceHtml(row, idx, keys) {
    const priceRaw = keys.keyPrice ? (row[keys.keyPrice] || '') : '';
    const priceNtRaw = keys.keyPriceNt ? (row[keys.keyPriceNt] || '') : '';
    const html = buildPriceDisplayHtml(priceRaw, priceNtRaw);
    return html || '';
  }

  function onItemClick(ctx) {
    // 點背景：開官網（若無官網，開第一個評論）
    const site = ctx.itemEl.getAttribute('data-site') || '';
    const rev = ctx.itemEl.getAttribute('data-review') || '';
    const url = site || rev;
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  function beforeListHtml(cached) {
    const meta = cached?.meta || {};
    const note = String(meta['備註'] || meta['note'] || '').trim();
    if (!note) return '';
    const lines = note.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const bullets = lines.map(s => `*.${B.esc(s)}`).join('<br>');
    return `<div class="schedule-meta-note"><div class="meta-label">備註：</div>${bullets}</div>`;
  }

  window.renderSchedule = B.createCardRenderer({
    title: '行程',
    topbarLabel: '營業時間：',
    mapKeys,
    sortRows,
    renderLeftCell,
    getTimeSectionClasses,
    renderPriceHtml,
    getNameClasses,
    beforeListHtml,
    onItemClick,
  });
})();
