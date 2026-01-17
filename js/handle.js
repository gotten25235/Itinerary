// filename: js/handle.js
'use strict';

/**
 * Handle（docId 預設 + 可由 URL 覆蓋、無關鍵字啟發式表頭、寬鬆偵錯）
 *
 * Doc ID 來源優先序：
 *  1) URL query: ?docId=...（別名：doc / doc_id）
 *  2) Template 欄位若貼了 Google Sheets URL，從 /d/{docId}/ 抽出
 *  3) DEFAULT_DOC_ID
 *
 * gid 來源：
 *  1) gid 輸入框
 *  2) Template 字串中抽 gid=
 *
 * 匯出 URL：
 *  https://docs.google.com/spreadsheets/d/{docId}/export?format=csv&gid={gid}
 *
 * 解析：
 *  - 前幾列像 meta（模式/備註/日期/日程表/標題）才當 meta
 *  - 行程模式：找含「時刻表/schedule」那列當 header
 *  - 其他模式：純啟發式偵測最像表頭的一列
 *
 * 視圖：
 *  - 模式=行程 -> ['schedule','list','raw']（預設 schedule）
 *  - 否則       -> ['grid','list','raw']（預設 grid）
 *
 * 新增：
 *  - meta 有「日程表」欄（放多個 gid）時，在 schedule/list/raw 顯示「上一頁／下一頁（第N天）」分頁
 *  - 表頭偵測時同步偵測「標題」，覆蓋頁面標題（h2#pageTitle + document.title）
 */

// 預設 Spreadsheet Doc ID（若 URL 或 Template 有提供 docId，會覆蓋）
const DEFAULT_DOC_ID = '1DuMk9-kPO_FmXGOyunTcGGC1Rquoova5Q6DCTr5Z_A8';

const AppState = {
  cached: null,
  currentView: 'raw',
  availableViews: [],
  isLoading: false,
  flags: { hideDebug: false, hideImages: false, hideControls: false },

  // 日程分頁狀態（由 meta['日程表'] 解析）
  navDays: { gids: [], index: -1 },

  // 目前載入的 gid / docId（由 URL 或輸入而來；用於比對第幾天與組 URL）
  currentGid: '',
  currentDocId: ''
};

/* ============ URL 參數 / 旗標 ============ */

// 解析網址參數，支援 ?hide=debug,ui 或 ?hideDebug=1&hideControls=1
function applyUrlFlags() {
  const p = new URLSearchParams(location.search);
  const raw = (p.get('hide') || '').toLowerCase();
  const list = raw.split(/[,\s]+/).filter(Boolean);
  const yes = (k) =>
    list.includes(k) || p.get('hide' + k[0].toUpperCase() + k.slice(1)) === '1';

  AppState.flags.hideDebug = yes('debug');
  AppState.flags.hideControls = yes('ui') || yes('controls') || yes('bar');

  if (AppState.flags.hideControls) document.documentElement.classList.add('hide-controls');
}

// 將 ?key=value 寫回網址（不重整）
function updateUrlParam(key, value) {
  const url = new URL(location.href);
  if (value == null || value === '') url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url.toString());
}

/* ============ 小工具 / Debug ============ */

function ensureDebugBox() {
  // 若要求隱藏 debug，建立一個隱藏的佔位 pre 並直接回傳
  if (AppState?.flags?.hideDebug) {
    let dbg = document.getElementById('debug');
    if (!dbg) {
      dbg = document.createElement('pre');
      dbg.id = 'debug';
      dbg.style.display = 'none';
      (document.body || document.documentElement).appendChild(dbg);
    }
    return dbg;
  }

  // 容器：<details id="debugPanel"><summary>…</summary><pre id="debug">…</pre></details>
  let panel = document.getElementById('debugPanel');
  if (!panel) {
    panel = document.createElement('details');
    panel.id = 'debugPanel';
    panel.open = false;
    panel.style.cssText = 'margin-top:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;';

    const sum = document.createElement('summary');
    sum.id = 'debugSummary';
    sum.textContent = 'Debug / Terminal';
    sum.style.cssText = 'cursor:pointer;user-select:none;padding:8px 10px;font-size:14px;font-weight:600;list-style:none;';
    panel.appendChild(sum);

    const dbg = document.createElement('pre');
    dbg.id = 'debug';
    dbg.style.cssText =
      'max-width:100%;overflow:auto;background:#0b1020;color:#e6edf3;margin:0;padding:10px;border-top:1px solid #e5e7eb;border-bottom-left-radius:8px;border-bottom-right-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;';
    panel.appendChild(dbg);

    const out = document.getElementById('out');
    const host = out?.parentElement || document.body;
    host.appendChild(panel);

    // 追加樣式（只插一次）
    if (!document.getElementById('debug-style')) {
      const s = document.createElement('style');
      s.id = 'debug-style';
      s.textContent = `
        #debugPanel summary::-webkit-details-marker { display: none; }
        #debugPanel summary::after {
          content: '\\25BC';
          float: right;
          transition: transform .2s;
        }
        #debugPanel[open] summary::after { transform: rotate(180deg); }
        #debugBadge {
          display:inline-block; margin-left:8px; padding:0 6px; border-radius:999px;
          background:#111827; color:#fff; font-size:12px; line-height:18px;
        }
      `;
      document.head.appendChild(s);
    }
  }
  return document.getElementById('debug');
}

function logDebug(lines) {
  const dbg = ensureDebugBox();
  const ts = new Date().toISOString();
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  dbg.textContent = `[${ts}]\n${text}\n\n` + (dbg.textContent || '');
  console.log('[DEBUG]', text);

  // 更新 summary 筆數徽章
  const sum = document.getElementById('debugSummary');
  if (sum) {
    const existing = document.getElementById('debugBadge');
    const count = (dbg.textContent.match(/\n\[/g) || []).length;
    if (!existing) {
      const b = document.createElement('span');
      b.id = 'debugBadge';
      b.textContent = count;
      sum.appendChild(b);
    } else {
      existing.textContent = count;
    }
  }
}

/** 是否像 CSV/TSV（至少兩行，某行含逗號或 tab） */
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
    ''
  );
}

/** 取得本次應使用的 docId（URL > Template > DEFAULT） */
function resolveActiveDocId(template) {
  const fromUrl = sanitizeDocId(getDocIdFromUrl());
  if (fromUrl) return fromUrl;

  const fromTpl = sanitizeDocId(extractDocId(template));
  if (fromTpl) return fromTpl;

  return sanitizeDocId(DEFAULT_DOC_ID) || '';
}

/** 覆蓋標題：頁面 h2 + 瀏覽器分頁標題 */
function setSheetTitleToPage(title) {
  const t = (title || '').toString().trim();
  if (!t) return;

  const h2 = document.getElementById('pageTitle') || document.querySelector('h2');
  if (h2) h2.textContent = t;

  document.title = t;
}

/* ============ URL 組裝（docId 可由 URL/Template 覆蓋） ============ */
/**
 * docId 來源：resolveActiveDocId(template)
 * gid 來源：輸入 gid 或從 template 抽 gid=
 */
function buildUrlFromTemplate(template, gid) {
  const docId = resolveActiveDocId(template);
  const fallbackGid = extractGid(template);
  const finalGid = gid && gid.trim() ? gid.trim() : fallbackGid;

  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/export?format=csv`;
  return finalGid ? `${base}&gid=${encodeURIComponent(finalGid)}` : base;
}

/* ============ 表頭偵測：meta / 行程 / 啟發式 ============ */

// 判斷一列是否為 meta（第一格是 模式/備註/日期/日程表/標題...）
function isMetaRow(row) {
  const k = String(row?.[0] ?? '').trim().toLowerCase();
  if (!k) return false;
  return [
    '模式', 'mode',
    '備註', 'note',
    '日期', 'date',
    '日程表', '行程表', 'days',
    '標題', 'title', '頁面標題', 'pagetitle', 'page title'
  ].some((key) => key.toLowerCase() === k);
}

// 行程用：找含「時刻表 / schedule」那列；找不到回 0
function detectHeaderIndexForSchedule(rows) {
  const idx = rows.findIndex((r) => Array.isArray(r) && r.some((c) => /時刻表|schedule/i.test(String(c || ''))));
  return idx >= 0 ? idx : 0;
}

// 啟發式（無關鍵字）：評分找「最像表頭」的一列
function detectHeaderIndexHeuristic(rows, start = 0, maxCheck = 30) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const isNumericOnly = (v) => /^\d+([.,]\d+)?$/.test(v);
  const isUrlLike = (v) => /^https?:\/\//i.test(v);
  const looksTime = (v) => /^\d{1,2}:\d{2}/.test(v);
  const hasLetters = (v) => /[A-Za-z\u4e00-\u9fff]/.test(v);

  function scoreRow(cells) {
    let nonEmpty = 0,
      textish = 0,
      numeric = 0,
      urlish = 0,
      longish = 0,
      timeLike = 0;

    for (const c of cells || []) {
      const v = (c ?? '').toString().trim();
      if (!v) continue;
      nonEmpty++;
      if (isNumericOnly(v)) numeric++;
      if (isUrlLike(v)) urlish++;
      if (looksTime(v)) timeLike++;
      if (hasLetters(v)) textish++;
      if (v.length >= 20) longish++;
    }

    // 表頭特性：非空較多、以文字為主、數字/URL/超長字較少、不像時間列
    return (
      nonEmpty * 2 +
      textish -
      numeric * 1.2 -
      urlish * 1.5 -
      longish * 0.3 -
      timeLike * 1.0
    );
  }

  let bestIdx = start;
  let bestScore = -Infinity;
  const end = Math.min(rows.length, start + maxCheck);
  for (let i = start; i < end; i++) {
    const row = (rows[i] || []).map((x) => (x ?? '').toString().trim());
    const nonEmpty = row.filter(Boolean).length;
    if (nonEmpty < 2) continue;
    if (row.some(isUrlLike)) continue;
    const s = scoreRow(row);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * 從 header 上方偵測「標題列」
 * 常見格式：某一列只有一格有文字（其餘皆空），且不是 URL/純數字/時間
 */
function detectStandaloneTitleRow(rows, from, to) {
  if (!Array.isArray(rows) || rows.length === 0) return '';

  const isNumericOnly = (v) => /^\d+([.,]\d+)?$/.test(v);
  const isUrlLike = (v) => /^https?:\/\//i.test(v);
  const looksTime = (v) => /^\d{1,2}:\d{2}/.test(v);
  const hasLetters = (v) => /[A-Za-z\u4e00-\u9fff]/.test(v);

  const a = Math.max(0, Number(from) || 0);
  const b = Math.max(0, Math.min(Number(to) || 0, rows.length));
  for (let i = a; i < b; i++) {
    const row = (rows[i] || []).map((x) => (x ?? '').toString().trim());
    const nonEmptyCells = row.filter(Boolean);
    if (nonEmptyCells.length !== 1) continue;

    const t = (nonEmptyCells[0] || '').trim();
    if (!t) continue;
    if (!hasLetters(t)) continue;
    if (isNumericOnly(t)) continue;
    if (isUrlLike(t)) continue;
    if (looksTime(t)) continue;

    return t;
  }
  return '';
}

function getMetaValueCaseInsensitive(meta, key) {
  if (!meta || !key) return '';
  if (meta[key] != null && String(meta[key]).trim() !== '') return String(meta[key]).trim();
  const target = String(key).toLowerCase();
  for (const k of Object.keys(meta)) {
    if (String(k).toLowerCase() === target) {
      const v = String(meta[k] ?? '').trim();
      if (v) return v;
    }
  }
  return '';
}

/* ============ 解析 CSV 文字 ============ */
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
    const rows = parseCSV(csvText);
    if (!rows || rows.length === 0) throw new Error('CSV 為空');

    // step1: 掃前幾列 meta
    const meta = {};
    let cursor = 0;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      if (!isMetaRow(rows[i])) break;
      const k = String(rows[i][0] ?? '').trim();
      const vals = (rows[i].slice(1) || [])
        .map((x) => String(x ?? '').trim())
        .filter(Boolean);
      if (k && vals.length) {
        const joined = vals.join('\n');
        meta[k] = meta[k] ? meta[k] + '\n' + joined : joined;
      }
      cursor = i + 1;
    }

    // step2: 決定 header 列
    const modeValue = (getMetaValueCaseInsensitive(meta, '模式') || getMetaValueCaseInsensitive(meta, 'mode') || '')
      .toString()
      .trim();

    let headerIndex;
    if (/^行程$/i.test(modeValue)) {
      headerIndex = detectHeaderIndexForSchedule(rows);
    } else {
      headerIndex = detectHeaderIndexHeuristic(rows, cursor);
    }

    // step2.5: 標題覆蓋
    {
      const titleFromMeta =
        getMetaValueCaseInsensitive(meta, '標題') ||
        getMetaValueCaseInsensitive(meta, '頁面標題') ||
        getMetaValueCaseInsensitive(meta, 'title') ||
        getMetaValueCaseInsensitive(meta, 'pagetitle') ||
        getMetaValueCaseInsensitive(meta, 'page title') ||
        '';

      const titleFromRow = detectStandaloneTitleRow(rows, cursor, headerIndex);
      const titleCandidate = (titleFromMeta || titleFromRow || '').toString().trim();
      if (titleCandidate) setSheetTitleToPage(titleCandidate);
    }

    const header = (rows[headerIndex] || []).map((h) => (h || '').toString().trim());

    // step3: 組資料
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

    AppState.cached = { header, data, meta };

    // 解析「日程表」
    const gids = parseDayGidsFromMeta(meta);
    if (gids.length) {
      AppState.navDays.gids = gids;
    } else {
      AppState.navDays = { gids: [], index: -1 };
    }

    // step4: 視圖決策
    if (/^行程$/i.test(modeValue)) {
      AppState.availableViews = ['schedule', 'list', 'raw'];
      AppState.currentView = 'schedule';
    } else {
      AppState.availableViews = ['grid', 'list', 'raw'];
      AppState.currentView = 'grid';
    }

    buildViewToggle();
    statusEl.textContent = `解析完成：${data.length} 筆（標題列索引 ${headerIndex}）`;
    renderCurrentView();
  } catch (err) {
    console.error('解析錯誤：', err);
    logDebug(['[loadFromText] 解析錯誤', String(err.stack || err)]);
    statusEl.textContent = '解析錯誤（請看 Console / Debug）';
  } finally {
    AppState.isLoading = false;
  }
}

/* ============ 範例載入（手動） ============ */
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
function parseDayGidsFromMeta(meta) {
  if (!meta) return [];
  const raw = meta['日程表'] || meta['行程表'] || meta['days'] || '';
  if (!raw) return [];
  const tokens = String(raw).split(/[\s,，、;；\n\r]+/).filter(Boolean);
  return tokens.map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
}

// 切換到指定 index 的日程（依 gid 載入）
async function navigateDayTo(index) {
  const gids = AppState.navDays.gids || [];
  if (!gids.length) return;
  const i = Math.max(0, Math.min(index, gids.length - 1));
  const gid = gids[i];

  const gidEl = document.getElementById('gidInput');
  if (gidEl) gidEl.value = gid;
  AppState.currentGid = gid;
  updateUrlParam('gid', gid);

  await loadFromUrlTemplate();
}

// 上/下一天
function navigateDayOffset(delta) {
  const i = (AppState.navDays.index ?? -1) + delta;
  navigateDayTo(i);
}

// 建立或更新分頁列（只在 schedule/list/raw 顯示；grid 隱藏）
function buildDayNavBar() {
  const meta = AppState?.cached?.meta || {};
  const gids = parseDayGidsFromMeta(meta);
  const showForView = AppState.currentView !== 'grid';
  const shouldShow = !!(gids.length && showForView);

  let mountAfter = document.getElementById('viewToggle');
  let nav = document.getElementById('dayNav');
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'dayNav';
    nav.style.margin = '10px 0';
    if (mountAfter && mountAfter.parentElement) {
      mountAfter.parentElement.insertBefore(nav, mountAfter.nextSibling);
    } else {
      const out = document.getElementById('out');
      (out?.parentElement || document.body).insertBefore(nav, out || null);
    }

    if (!document.getElementById('dayNav-style')) {
      const s = document.createElement('style');
      s.id = 'dayNav-style';
      s.textContent = `
        #dayNav{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        #dayNav .pager{ display:flex; gap:8px; }
        #dayNav button{
          padding:6px 10px; border-radius:8px; border:1px solid #e5e7eb;
          background:#fff; cursor:pointer; font-size:13px;
        }
        #dayNav button[disabled]{ opacity:.4; cursor:not-allowed; }
        #dayNav .current{ font-weight:700; }
      `;
      document.head.appendChild(s);
    }
  }

  if (!shouldShow) {
    nav.style.display = 'none';
    AppState.navDays = { gids: [], index: -1 };
    return;
  }

  AppState.navDays.gids = gids;

  const curGid = AppState.currentGid || new URLSearchParams(location.search).get('gid') || '';
  const idx = gids.indexOf(curGid);
  const curIdx = idx >= 0 ? idx : 0;
  AppState.navDays.index = curIdx;

  const total = gids.length;
  const prevIdx = curIdx - 1;
  const nextIdx = curIdx + 1;

  const prevLabel = prevIdx >= 0 ? `第${prevIdx + 1}天` : `第${Math.max(curIdx, 0)}天`;
  const nextLabel = nextIdx < total ? `第${nextIdx + 1}天` : `第${total}天`;
  const curLabel = `第${curIdx + 1}天 / 共${total}天`;

  nav.innerHTML = `
    <div class="pager">
      <button id="dayPrev" ${prevIdx < 0 ? 'disabled' : ''}>◀ ${prevLabel}</button>
      <button id="dayNext" ${nextIdx >= total ? 'disabled' : ''}>${nextLabel} ▶</button>
    </div>
    <div class="current">${curLabel}</div>
  `;
  nav.style.display = '';

  const prevBtn = document.getElementById('dayPrev');
  const nextBtn = document.getElementById('dayNext');
  if (prevBtn) prevBtn.onclick = () => navigateDayOffset(-1);
  if (nextBtn) nextBtn.onclick = () => navigateDayOffset(1);
}

/* ============ 視圖切換 / 渲染 ============ */

function renderCurrentView() {
  if (!AppState.cached) return;
  try {
    buildDayNavBar();

    switch (AppState.currentView) {
      case 'grid':
        return window.renderGrid(AppState.cached);
      case 'list':
        return window.renderList(AppState.cached);
      case 'schedule':
        return window.renderSchedule(AppState.cached);
      default:
        return window.renderRaw(AppState.cached);
    }
  } catch (e) {
    console.error('渲染錯誤：', e);
    logDebug(['[render error]', String(e.stack || e)]);
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = '渲染錯誤（請看 Console / Debug）';
  }
}

function switchView(view) {
  if (!AppState.availableViews.includes(view)) return;
  AppState.currentView = view;
  document.querySelectorAll('#viewToggle button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  renderCurrentView();
}

function buildViewToggle() {
  const ctr = document.getElementById('viewToggle');
  if (!ctr) return;
  ctr.innerHTML = '';
  AppState.availableViews.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.view = v;
    btn.textContent =
      v === 'grid'
        ? '圖片9宮格'
        : v === 'list'
          ? '詳細清單'
          : v === 'schedule'
            ? '行程'
            : '原始讀取';
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => switchView(v));
    ctr.appendChild(btn);
  });
}

/* ============ 初始化 ============ */

function initializeEventListeners() {
  const openBtn = document.getElementById('openCsv');
  const loadBtn = document.getElementById('loadBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const loadSampleBtn = document.getElementById('loadSampleBtn');

  // 開啟編輯頁：docId 依 resolveActiveDocId(template) 決定；gid 取輸入或 template 抽出
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      const tplEl = document.getElementById('csvTemplate');
      const gidEl = document.getElementById('gidInput');

      const template = (tplEl?.value || '').trim();
      const g = (gidEl?.value || '').trim() || extractGid(template);
      const docId = resolveActiveDocId(template);

      const editUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/edit${g ? `#gid=${encodeURIComponent(g)}` : ''}`;
      window.open(editUrl, '_blank');
      logDebug(['[openCsv]', editUrl]);
    });
  }

  if (loadBtn) loadBtn.addEventListener('click', () => loadFromUrlTemplate());
  if (reloadBtn) reloadBtn.addEventListener('click', () => loadFromUrlTemplate());
  if (loadSampleBtn) loadSampleBtn.addEventListener('click', () => loadSampleData());
}

// 強制隱藏 controls + status（JS 層級，保證即時生效）
function enforceHiddenControls() {
  if (!AppState?.flags?.hideControls) return;
  const selectors = [
    '#csvTemplate',
    '#gidInput',
    '#openCsv',
    '#loadBtn',
    '#reloadBtn',
    '#loadSampleBtn',
    '#status',
    '.status-row',
    '#controls',
    '.controls',
    '.controls-row',
    '#title',
    '.app-title',
    '.app-header'
  ];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.display = 'none';
    });
  });

  document.querySelectorAll('h1').forEach((h) => {
    const t = (h.textContent || '').trim();
    if (t === '試算表檢視器') h.style.display = 'none';
  });
}

async function initializeApp() {
  applyUrlFlags();

  // 初始化 docId（優先 URL）
  {
    const docId = sanitizeDocId(getDocIdFromUrl()) || sanitizeDocId(DEFAULT_DOC_ID) || '';
    AppState.currentDocId = docId;
  }

  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '尚未載入（請輸入 gid 或在模板欄貼含 gid= 的 URL，再按「載入資料」）';

  // 若網址帶 gid 就預填並嘗試載入
  const params = new URLSearchParams(location.search);
  const gid = params.get('gid');
  if (gid) {
    AppState.currentGid = gid;
    const gidEl = document.getElementById('gidInput');
    if (gidEl) gidEl.value = gid;
    await loadFromUrlTemplate();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applyUrlFlags();
  initializeEventListeners();
  enforceHiddenControls();
  initializeApp();
});

/* 匯出（給其他模組呼叫） */
window.loadFromText = loadFromText;
window.loadFromUrlTemplate = loadFromUrlTemplate;
window.renderCurrentView = renderCurrentView;
window.buildUrlFromTemplate = buildUrlFromTemplate;
window.switchView = switchView;
window.loadSampleData = loadSampleData;

// 內部工具（本檔用）：updateUrlParam / parseDayGidsFromMeta / navigateDayTo / navigateDayOffset / buildDayNavBar
