'use strict';

/**
 * utils-money.js（金額/幣別偵測 + 換算 NT$ + 顯示格式）
 *
 * 職責：
 * - 從單行/多行金額字串中偵測幣別（只處理明確「非台幣」的幣別）
 * - 依匯率換算成約略 NT$（或優先使用同列提供的「換算金額(NT)」）
 * - 產出可直接插入 HTML 的顯示字串（由呼叫端提供 escFn escape）
 *
 * 支援幣別（僅這些會被換算）：CNY(RMB)、JPY、USD、KRW、HKD
 * 不處理情況（原樣顯示）：
 * - 偵測到 NTD/TWD/NT/台幣/新台幣
 * - 未偵測到幣別
 * - 無法解析出數字
 *
 * 匯率來源：
 * - 優先讀取 window.SCHEDULE_EXCHANGE_RATES 或 window.EXCHANGE_RATES 覆蓋預設值
 *
 * 典型用法：
 * - UtilsMoney.buildPriceDisplayHtml(priceRaw, priceNtRaw, escapeHtml)
 */


(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;

  function getExchangeRatesToNt() {
    const base = {
      USD: 31.5,
      JPY: 0.2,
      CNY: 4.4,
      KRW: 0.024,
      HKD: 4.0,
      NTD: 1.0,
    };

    const src = (typeof root !== 'undefined')
      ? (root.SCHEDULE_EXCHANGE_RATES || root.EXCHANGE_RATES)
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

    // 規則：只要偵測到 NT/TWD/NTD，就「完全不處理」
    if (/\b(ntd|twd)\b/.test(sl) || /\bnt\s*\$?\b/i.test(s) || sl.includes('台幣') || sl.includes('新台幣')) return 'NTD';

    if (sl.includes('hkd') || sl.includes('hk$') || sl.includes('港幣') || sl.includes('港元')) return 'HKD';
    if (sl.includes('krw') || s.includes('₩') || sl.includes('韓幣') || sl.includes('韓元')) return 'KRW';
    if (sl.includes('rmb') || sl.includes('cny') || sl.includes('人民幣')) return 'CNY';
    if (sl.includes('usd') || sl.includes('us$') || sl.includes('美金') || sl.includes('美元')) return 'USD';
    if (sl.includes('jpy') || s.includes('円') || sl.includes('日幣') || sl.includes('日圓') || sl.includes('日元')) return 'JPY';

    // ¥/￥：預設 JPY，除非同列有 RMB/CNY
    if (s.includes('¥') || s.includes('￥')) {
      if (sl.includes('rmb') || sl.includes('cny')) return 'CNY';
      return 'JPY';
    }

    // "$123" 推定 USD（若你未來不想推定，直接刪掉此條）
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
    // 主要支援換行；額外支援分號/頓號當分隔
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
    if (currency === 'NTD' || currency === '') return line;

    const amount = parseNumberLoose(line);
    if (!Number.isFinite(amount)) return line;

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
    if (suffix) return `${base}${suffix}(約${ntText}${suffix})`;
    return `${line}(約${ntText})`;
  }

  /**
   * 產出可插入 HTML 的字串（由 escFn escape，並用 <br> 保留換行）
   * @param {string} priceRaw
   * @param {string} priceNtRaw
   * @param {(s:string)=>string} escFn
   */
  function buildPriceDisplayHtml(priceRaw, priceNtRaw, escFn) {
    const rawLines = splitMoneyLines(priceRaw);
    if (!rawLines.length) return '';

    const ntLines = splitMoneyLines(priceNtRaw);
    const hasNtLines = ntLines.length > 0;

    const lines = rawLines.map((line, idx) => {
      const ntLine = hasNtLines ? (ntLines[idx] || ntLines[0] || '') : '';
      return buildPriceDisplaySingleLine(line, ntLine);
    });

    const esc = (typeof escFn === 'function') ? escFn : (s) => String(s || '');
    return lines.map(x => esc(String(x))).join('<br>');
  }

  root.UtilsMoney = {
    getExchangeRatesToNt,
    parseNumberLoose,
    detectCurrencyCode,
    formatNtdAmount,
    extractTrailingUnitSuffix,
    splitMoneyLines,
    buildPriceDisplaySingleLine,
    buildPriceDisplayHtml,
  };
})();
