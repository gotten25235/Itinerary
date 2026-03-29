// filename: js/sheet-data.js
'use strict';

/**
 * sheet-data.js
 * - URL/docId/gid 解析
 * - meta/header/data 解析
 * - CSV / Google Sheets 載入
 * - 將解析結果套回 AppState
 */

function looksLikeDelimited(text) {
  if (!text) return false;
  const sample = text.slice(0, 4096);
  const lines = sample.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.some((l) => l.includes(',') || l.includes('\t'));
}

/** 從任意字串嘗試抓 gid=123 */

function extractGid(str) {
  if (!str) return '';
  const m = String(str).match(/[?&#]gid=([0-9]+)/i);
  return m ? m[1] : '';
}

/** 從 Google Sheets URL 抽 docId（/spreadsheets/d/{docId}/...） */

function extractDocId(str) {
  if (!str) return '';
  const s = String(str);
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : '';
}

/** 基本驗證 docId（避免塞奇怪字元） */

function sanitizeDocId(docId) {
  const v = String(docId || '').trim();
  if (!v) return '';
  // Google Sheets docId 通常是 base64url-ish，長度大多 > 20
  if (!/^[a-zA-Z0-9-_]{20,200}$/.test(v)) return '';
  return v;
}

/** 取得 URL query 的 docId（支援 docId/doc/doc_id） */

function getDocIdFromUrl() {
  const p = new URLSearchParams(location.search);
  return (
    p.get('docId') ||
    p.get('doc') ||
    p.get('doc_id') ||
    p.get('docID') ||
    p.get('DOC_ID') ||
    ''
  );
}

/* ============ meta / header 偵測 ============ */

// 判斷一列是否為 meta（第一格是 模式/備註/日期/日程表/標題...）

function isMetaRow(row) {
  if (!Array.isArray(row) || !row.length) return false;
  const k = String(row[0] ?? '').trim().toLowerCase();
  if (!k) return false;
  const keys = [
    '模式', 'mode',
    '備註', 'note', 'notes',
    '日期', 'date',
    '日程表', '行程表', 'days',
    '總議程', 'master agenda', 'masteragenda',
    '相關議程', 'related agenda', 'relatedagenda',
    '多相關議程', 'multi related agenda', 'multirelatedagenda',
    '標題', '頁面標題', 'title', 'pagetitle', 'page title'
  ].map((x) => String(x).toLowerCase());
  return keys.includes(k);
}

function getMetaValueCaseInsensitive(meta, key) {
  if (!meta || typeof meta !== 'object') return '';
  const lk = String(key || '').toLowerCase();
  for (const [k, v] of Object.entries(meta)) {
    if (String(k).toLowerCase() === lk) return v;
  }
  return '';
}



/* ============ 總議程 / 相關議程（依 gid 內的「模式」判斷類型） ============ */

function isLikelyUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function normalizeMetaKeyName(k) {
  return String(k || '').trim().toLowerCase();
}

// 從 meta 取出「原始欄位陣列」（若有保存），否則退回 meta[key] 字串拆 token

function getMetaRowTokens(meta, key) {
  if (!meta) return [];
  const want = normalizeMetaKeyName(key);
  const rows = meta.__rows || {};
  for (const [k, arr] of Object.entries(rows)) {
    if (normalizeMetaKeyName(k) === want && Array.isArray(arr)) {
      return arr
        .map((x) => String(x ?? '').trim())
        .flatMap((cell) => String(cell || '').split(/[\s,，、;；\n\r]+/))
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  const raw = getMetaValueCaseInsensitive(meta, key) || '';
  return String(raw)
    .split(/[\s,，、;；\n\r]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// 解析總議程/相關議程 token（gid 或 URL）

function parseAgendaItemsFromMeta(meta, key) {
  const tokens = getMetaRowTokens(meta, key);
  const items = [];
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      items.push({ kind: 'gid', gid: t, url: '' });
      continue;
    }
    if (isLikelyUrl(t)) {
      const gid = extractGid(t);
      items.push({ kind: 'url', gid: gid || '', url: t });
      continue;
    }
  }
  // 去重（以 gid 優先；沒有 gid 的 URL 用 url）
  const seen = new Set();
  return items.filter((it) => {
    const key = it.gid ? `gid:${it.gid}` : `url:${it.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getUrlCodeValue(param) {
  const p = new URLSearchParams(location.search);
  return String(p.get(param || 'code') || '').trim();
}

function getUrlCodeTokens(param) {
  return getUrlCodeValue(param || 'code')
    .split(/[\s,，、;；]+/u)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
}


function hasUrlCode(expected, param) {
  const want = String(expected || '').trim();
  if (!want) return false;
  return getUrlCodeTokens(param || 'code').includes(want);
}


function hasPersonalCode1912() {
  return hasUrlCode('1912', 'code');
}


// 依 gid 內的 meta['模式'] 判斷類型：personal/note/shopping/other

function classifyAgendaTypeByMode(modeValue) {
  const m = String(modeValue || '').trim();
  if (!m) return 'note';

  const lower = m.toLowerCase();

  const isPersonal = m.includes('個人') || /personal/i.test(m);
  const isShopping = m.includes('採購') || m.includes('購物') || /shopping/i.test(lower);
  const isNote = m.includes('注意') || /note/i.test(lower);

  if (isPersonal && isShopping) return 'personal_shopping';
  if (isPersonal && isNote) return 'personal_note';
  if (isShopping) return 'shopping';
  if (isNote) return 'note';

  // 沒命中：為了「不要整排消失」，預設歸到 注意事項
  return 'note';
}

// 行程模式：找含「時刻表/schedule」那列當 header

function detectHeaderIndexForSchedule(rows) {
  const keys = ['時刻表', 'schedule'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const joined = r.map((x) => String(x ?? '')).join(' ').toLowerCase();
    if (keys.some((k) => joined.includes(String(k).toLowerCase()))) return i;
  }
  // fallback：用啟發式
  return detectHeaderIndexHeuristic(rows, 0);
}

// 啟發式偵測最像表頭的一列

function detectHeaderIndexHeuristic(rows, startIdx) {
  const start = Math.max(0, startIdx || 0);
  let best = start;
  let bestScore = -1;

  for (let i = start; i < Math.min(rows.length, start + 30); i++) {
    const r = rows[i] || [];
    const cells = r.map((x) => String(x ?? '').trim());
    const nonEmpty = cells.filter(Boolean).length;
    if (nonEmpty < 2) continue;

    // score: 非空 + 偏好較短字串（像欄名）
    const avgLen = nonEmpty ? cells.reduce((a, c) => a + (c ? c.length : 0), 0) / nonEmpty : 999;
    const uniq = new Set(cells.filter(Boolean)).size;
    const score = nonEmpty * 2 + uniq - Math.min(avgLen, 20) / 4;

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// 偵測獨立標題列（非必要，有就用）

function detectStandaloneTitleRow(rows, cursor, headerIndex) {
  const start = Math.max(0, cursor || 0);
  const end = Math.min(rows.length, headerIndex || rows.length);
  for (let i = start; i < end; i++) {
    const r = rows[i] || [];
    const a = String(r[0] ?? '').trim();
    const b = String(r[1] ?? '').trim();
    const c = String(r[2] ?? '').trim();

    // 若第一格有文字，後面幾格幾乎空，當作標題
    const restEmpty = (!b && !c) && r.slice(1).every((x) => !String(x ?? '').trim());
    if (a && restEmpty && a.length <= 80) return a;
  }
  return '';
}

function setSheetTitleToPage(title) {
  const t = String(title || '').trim();
  if (!t) return;
  const el = document.getElementById('pageTitle');
  if (el) el.textContent = t;
  document.title = t;
}

/* ============ URL 組合 / docId 決策 ============ */

function resolveActiveDocId(template) {
  // 1) URL query 覆蓋
  const fromUrl = sanitizeDocId(getDocIdFromUrl());
  if (fromUrl) return fromUrl;

  // 2) template 若貼了 Google Sheets URL，抽 docId
  const fromTpl = sanitizeDocId(extractDocId(template));
  if (fromTpl) return fromTpl;

  // 3) default
  const def = sanitizeDocId(DEFAULT_DOC_ID);
  return def || '';
}

function buildUrlFromTemplate(template, gid) {
  const tpl = String(template || '').trim();
  const g = String(gid || '').trim() || extractGid(tpl);
  const docId = resolveActiveDocId(tpl);

  if (!docId) throw new Error('無法取得 docId（請檢查 URL 或 template）');
  if (!g) throw new Error('無法取得 gid（請在 input 或 template 帶 gid=）');

  // 若 template 本身就是 export URL，優先用它（但強制修正 docId/gid）
  if (/docs\.google\.com\/spreadsheets\/d\//i.test(tpl) && /\/export\?/i.test(tpl)) {
    let u = tpl;

    // 1) 支援 placeholder：{docId}/{DOC_ID}/{doc}/{gid} 這類
    u = u.replaceAll('{docId}', docId)
      .replaceAll('{DOC_ID}', docId)
      .replaceAll('{doc}', docId)
      .replaceAll('{DOC}', docId);

    u = u.replaceAll('{gid}', g)
      .replaceAll('{GID}', g);

    // 2) 強制把 /spreadsheets/d/<任意非斜線>/ 替換成正確 docId
    //    這個會吃掉 /d/{gid}/ 這種錯誤寫法
    u = u.replace(/\/spreadsheets\/d\/[^/]+/i, `/spreadsheets/d/${encodeURIComponent(docId)}`);

    // 3) gid 參數：若已有 gid=xxxx 直接替換；若是 gid={gid} 也會在上面被換掉
    if (/[?&#]gid=/.test(u)) {
      u = u.replace(/([?&#]gid=)[^&#]*/i, `$1${encodeURIComponent(g)}`);
    } else {
      const sep = u.includes('?') ? '&' : '?';
      u = u + `${sep}gid=${encodeURIComponent(g)}`;
    }

    // 4) 確保 format=csv（若沒有就補；若有其他 format 也改成 csv）
    if (/[?&#]format=/.test(u)) {
      u = u.replace(/([?&#]format=)[^&#]*/i, `$1csv`);
    } else {
      const sep = u.includes('?') ? '&' : '?';
      u = u + `${sep}format=csv`;
    }

    return u;
  }

  // template 不是 export URL：直接組標準 export
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/export?format=csv&gid=${encodeURIComponent(g)}`;
}



async function fetchParsedSheetByGid(gid, options = {}) {
  const g = String(gid || '').trim();
  if (!g) throw new Error('缺少 gid');

  const template = String(options.template || '').trim();
  const docId =
    sanitizeDocId(options.docId) ||
    sanitizeDocId(AppState?.currentDocId) ||
    resolveActiveDocId(template);

  if (!template && !docId) {
    throw new Error('缺少 template 與 docId，無法載入 gid=' + g);
  }

  const url = buildUrlFromTemplate(template || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/export?format=csv&gid=${encodeURIComponent(g)}`, g);
  const resp = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    credentials: 'omit',
    mode: 'cors'
  });

  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} (gid=${g})`);

  const text = await resp.text();
  const isCsvCt = /(^|;) *text\/csv(;|$)/.test(contentType);
  const likeDelimited = looksLikeDelimited(text);
  const isHtmlLike =
    /^\s*<!doctype html/i.test(text) ||
    /^\s*<html/i.test(text) ||
    text.toLowerCase().includes('<html');

  if (isHtmlLike) {
    throw new Error(`gid=${g} 回傳 HTML（可能是登入/權限頁或不是 CSV 端點）`);
  }
  if (!isCsvCt && !likeDelimited) {
    throw new Error(`gid=${g} 回傳非 CSV 內容（content-type: ${contentType || 'unknown'}）`);
  }

  return parseCsvTextToCached(text);
}


/* ============ CSV 解析後載入 ============ */

function parseDayGidsFromMeta(meta) {
  if (!meta) return [];
  const raw = meta['日程表'] || meta['行程表'] || meta['days'] || '';
  if (!raw) return [];
  const tokens = String(raw).split(/[\s,，、;；\n\r]+/).filter(Boolean);
  return tokens.map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
}

/* ============ 一頁式（日程表全部顯示） ============ */

/**
 * 將 CSV 文字解析為 cached（不改動 AppState）
 * - 與 loadFromText 的邏輯一致：meta 掃描、header 偵測、資料組裝
 * - 回傳 { header, data, meta, modeValue }
 */



function parseModeFlags(modeValue) {
  const modeRaw = String(modeValue || '').trim();
  const mode = modeRaw.toLowerCase();

  const isSchedule =
    modeRaw === '行程' || mode.includes('行程') || /schedule/i.test(modeRaw);

  const isShopping =
    modeRaw === '採購清單' || mode.includes('採購') || mode.includes('購物') || /shopping/i.test(modeRaw);

  const isNote =
    modeRaw === '注意事項' || mode.includes('注意事項') || mode.includes('注意') || /note/i.test(modeRaw);

  const isPersonal = mode.includes('個人') || /personal/i.test(modeRaw);

  const isPersonalNote =
    modeRaw === '個人注意事項' || (isPersonal && mode.includes('注意')) || /personal\s*note/i.test(modeRaw);

  const isPersonalShopping =
    modeRaw === '個人採購清單' || (isPersonal && (mode.includes('採購') || mode.includes('購物'))) || /personal\s*shopping/i.test(modeRaw);

  return {
    modeRaw,
    mode,
    isSchedule,
    isShopping,
    isNote,
    isPersonal,
    isPersonalNote,
    isPersonalShopping
  };
}

function decideViewsByMode(modeValue) {
  const flags = parseModeFlags(modeValue);

  const next = {
    noteRequireCode: false,
    personalRequireCode: false,
    availableViews: ['grid', 'list', 'raw'],
    defaultView: 'grid'
  };

  if (flags.isPersonal) next.personalRequireCode = true;
  if (flags.isPersonalNote) next.noteRequireCode = true;

  if (flags.isSchedule) {
    next.availableViews = ['schedule', 'list', 'raw'];
    next.defaultView = 'schedule';
  } else if (flags.isPersonalShopping || flags.isShopping) {
    next.availableViews = ['shopping', 'list', 'raw'];
    next.defaultView = 'shopping';
  } else if (flags.isPersonalNote || flags.isNote) {
    next.availableViews = ['note', 'list', 'raw'];
    next.defaultView = 'note';
  }

  return next;
}

/**
 * 將 CSV 文字解析為 cached（不直接改動 AppState）
 * 回傳：
 * {
 *   header, data, meta, modeValue,
 *   headerIndex, titleCandidate
 * }
 */
function parseCsvTextToCached(csvText) {
  const rows = parseCSV(csvText);
  if (!rows || rows.length === 0) throw new Error('CSV 為空');

  const meta = {};
  meta.__rows = {};

  let cursor = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (!isMetaRow(rows[i])) break;

    const k = String(rows[i][0] ?? '').trim();
    const rawCells = (rows[i].slice(1) || []).map((x) => String(x ?? '').trim());
    const filtered = rawCells.filter(Boolean);

    const lk = normalizeMetaKeyName(k);
    if (
      lk === '總議程' || lk === '相關議程' || lk === '多相關議程' ||
      lk === 'master agenda' || lk === 'related agenda' || lk === 'multi related agenda' ||
      lk === 'masteragenda' || lk === 'relatedagenda' || lk === 'multirelatedagenda'
    ) {
      meta.__rows[k] = rawCells;
    }

    if (k && filtered.length) {
      const joined = filtered.join('\n');
      meta[k] = meta[k] ? meta[k] + '\n' + joined : joined;
    }

    cursor = i + 1;
  }

  const modeValue =
    (getMetaValueCaseInsensitive(meta, '模式') ||
      getMetaValueCaseInsensitive(meta, 'mode') ||
      '')
      .toString()
      .trim();

  const headerIndex = /^行程$/i.test(modeValue)
    ? detectHeaderIndexForSchedule(rows)
    : detectHeaderIndexHeuristic(rows, cursor);

  const titleFromMeta =
    getMetaValueCaseInsensitive(meta, '標題') ||
    getMetaValueCaseInsensitive(meta, '頁面標題') ||
    getMetaValueCaseInsensitive(meta, 'title') ||
    getMetaValueCaseInsensitive(meta, 'pagetitle') ||
    getMetaValueCaseInsensitive(meta, 'page title') ||
    '';

  const titleFromRow = detectStandaloneTitleRow(rows, cursor, headerIndex);
  const titleCandidate = String(titleFromMeta || titleFromRow || '').trim();

  const header = (rows[headerIndex] || []).map((h) => (h || '').toString().trim());

  const data = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j] || `col${j}`;
      obj[key] = r[j] != null ? String(r[j]).trim() : '';
    }
    if (Object.values(obj).some((v) => v !== '')) data.push(obj);
  }

  return { header, data, meta, modeValue, headerIndex, titleCandidate };
}

function applyCachedToState(parsed) {
  if (!parsed) throw new Error('缺少 parsed 資料');

  const statusEl = document.getElementById('status');
  const {
    header,
    data,
    meta,
    modeValue,
    headerIndex,
    titleCandidate
  } = parsed;

  if (titleCandidate) setSheetTitleToPage(titleCandidate);

  AppState.cached = { header, data, meta };

  const gids = parseDayGidsFromMeta(meta);
  if (gids.length) {
    AppState.navDays.gids = gids;
  } else {
    AppState.navDays = { gids: [], index: -1 };
  }

  const viewState = decideViewsByMode(modeValue);
  AppState.noteRequireCode = viewState.noteRequireCode;
  AppState.personalRequireCode = viewState.personalRequireCode;
  AppState.availableViews = viewState.availableViews;

  const requestedView = String(AppState.currentView || '').trim();
  AppState.currentView = viewState.availableViews.includes(requestedView)
    ? requestedView
    : viewState.defaultView;

  if (typeof updateDebugSummaryContext === 'function') updateDebugSummaryContext();
  if (typeof buildViewToggle === 'function') buildViewToggle();
  if (typeof updateOnePageButtonVisibility === 'function') updateOnePageButtonVisibility();

  if (statusEl) statusEl.textContent = `解析完成：${data.length} 筆（標題列索引 ${headerIndex}）`;
  if (typeof renderCurrentView === 'function') renderCurrentView();
  if (typeof hydrateRelatedAgenda === 'function') hydrateRelatedAgenda();
}

async function loadFromText(csvText) {
  const statusEl = document.getElementById('status');
  const out = document.getElementById('out');
  if (!statusEl || !out) {
    console.error('缺少必要 DOM (#status/#out)');
    return;
  }

  AppState.isLoading = true;
  out.innerHTML = '';
  statusEl.textContent = '解析中...';

  try {
    const parsed = parseCsvTextToCached(csvText);
    applyCachedToState(parsed);
  } catch (err) {
    console.error('解析錯誤：', err);
    if (typeof logDebug === 'function') {
      logDebug(['[loadFromText] 解析錯誤', String(err.stack || err)]);
    }
    statusEl.textContent = '解析錯誤（請看 Console / Debug）';
  } finally {
    AppState.isLoading = false;
  }
}

async function loadSampleData() {
  const statusEl = document.getElementById('status');
  const out = document.getElementById('out');
  if (!statusEl || !out) return;

  statusEl.textContent = '載入範例中...';
  out.innerHTML = '';

  try {
    const resp = await fetch('data/sample.csv', { cache: 'no-store' });
    logDebug([
      '[loadSampleData] fetch data/sample.csv',
      'status: ' + resp.status + ' ' + resp.statusText,
      'content-type: ' + (resp.headers.get('content-type') || '')
    ]);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    logDebug(['[loadSampleData] text head:', text.slice(0, 400)]);
    await loadFromText(text);
  } catch (e) {
    console.error('載入範例失敗：', e);
    logDebug(['[loadSampleData] error', String(e.stack || e)]);
    statusEl.textContent = '載入範例失敗（請看 Console / Debug）';
  }
}

/* ============ 遠端載入 ============ */

async function loadFromUrlTemplate() {
  const tplEl = document.getElementById('csvTemplate');
  const gidEl = document.getElementById('gidInput');
  const statusEl = document.getElementById('status');
  const out = document.getElementById('out');
  if (!tplEl || !gidEl || !statusEl || !out) {
    console.error('缺少必要 DOM');
    return;
  }

  const template = (tplEl.value || '').trim();
  const gid = (gidEl.value || '').trim();

  // 記住目前 gid（供日程分頁比對）
  AppState.currentGid = gid || extractGid(template) || AppState.currentGid || '';

  // 記住目前 docId（URL > Template > Default）
  AppState.currentDocId = resolveActiveDocId(template) || AppState.currentDocId || sanitizeDocId(DEFAULT_DOC_ID) || '';
  // 若 docId 是由 URL 提供，會自然存在於網址；若不是，也不強制寫回（避免改你的分享連結格式）

  // 至少要有 template（可抽 gid/docId），或直接填 gid
  if (!template && !gid) {
    statusEl.textContent = '請至少輸入 gid 或在模板欄貼含 gid= 的 URL';
    return;
  }

  const url = buildUrlFromTemplate(template, gid);
  statusEl.textContent = '從 URL 載入中…';
  out.innerHTML = '';

  logDebug([
    '[fetch start]',
    url,
    'docId=' + (AppState.currentDocId || '(empty)'),
    'gid=' + (AppState.currentGid || '(empty)')
  ]);

  try {
    const resp = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      credentials: 'omit',
      mode: 'cors'
    });
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();

    logDebug([
      '[fetch response]',
      'final URL: ' + (resp.url || url),
      'status: ' + resp.status + ' ' + resp.statusText,
      'content-type: ' + contentType
    ]);

    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);

    const text = await resp.text();
    logDebug(['[fetch text head]', text.slice(0, 400)]);

    const isCsvCt = /(^|;) *text\/csv(;|$)/.test(contentType);
    const likeDelimited = looksLikeDelimited(text);
    const isHtmlLike =
      /^\s*<!doctype html/i.test(text) ||
      /^\s*<html/i.test(text) ||
      text.toLowerCase().includes('<html');

    if (isCsvCt || likeDelimited) {
      await loadFromText(text);
      return;
    }

    if (isHtmlLike) {
      throw new Error('回傳 HTML（可能是登入/權限頁或不是 CSV 端點）');
    }

    throw new Error('回傳非 CSV 內容（content-type: ' + contentType + '）');
  } catch (e) {
    console.warn('URL 載入失敗：', e);
    logDebug(['[fetch error]', String(e.stack || e)]);
    statusEl.textContent = '遠端載入失敗（權限/CORS/連線）。可按「載入範例」查看示例資料。';
    out.innerHTML = '';
  }
}

/* ============ 日程分頁（上一頁／下一頁 + 第N天） ============ */

// 從 meta 解析日程表的 gid 陣列

/* ============ 明確匯出（避免依賴瀏覽器對全域函式的隱式掛載） ============ */

window.looksLikeDelimited = looksLikeDelimited;
window.extractGid = extractGid;
window.extractDocId = extractDocId;
window.sanitizeDocId = sanitizeDocId;
window.getDocIdFromUrl = getDocIdFromUrl;
window.isMetaRow = isMetaRow;
window.getMetaValueCaseInsensitive = getMetaValueCaseInsensitive;
window.parseAgendaItemsFromMeta = parseAgendaItemsFromMeta;
window.getUrlCodeValue = getUrlCodeValue;
window.getUrlCodeTokens = getUrlCodeTokens;
window.hasUrlCode = hasUrlCode;
window.hasPersonalCode1912 = hasPersonalCode1912;
window.classifyAgendaTypeByMode = classifyAgendaTypeByMode;
window.detectHeaderIndexForSchedule = detectHeaderIndexForSchedule;
window.detectHeaderIndexHeuristic = detectHeaderIndexHeuristic;
window.detectStandaloneTitleRow = detectStandaloneTitleRow;
window.setSheetTitleToPage = setSheetTitleToPage;
window.resolveActiveDocId = resolveActiveDocId;
window.buildUrlFromTemplate = buildUrlFromTemplate;
window.fetchParsedSheetByGid = fetchParsedSheetByGid;
window.parseDayGidsFromMeta = parseDayGidsFromMeta;
window.parseModeFlags = parseModeFlags;
window.decideViewsByMode = decideViewsByMode;
window.parseCsvTextToCached = parseCsvTextToCached;
window.applyCachedToState = applyCachedToState;
window.loadFromText = loadFromText;
window.loadSampleData = loadSampleData;
window.loadFromUrlTemplate = loadFromUrlTemplate;
