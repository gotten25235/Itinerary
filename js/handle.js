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
 *  - 右上角「一頁式」按鈕：一次載入並顯示全部日程表（依 meta['日程表'] gid 清單）
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
  currentDocId: '',

  // 一頁式（日程表全部顯示）
  onePageMode: false,
  onePageData: { gids: [], caches: [] },
  onePageLoading: false
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


/* ============ CSV 解析後載入 ============ */

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
    updateOnePageButtonVisibility();
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

/* ============ 一頁式（日程表全部顯示） ============ */

/**
 * 將 CSV 文字解析為 cached（不改動 AppState）
 * - 與 loadFromText 的邏輯一致：meta 掃描、header 偵測、資料組裝
 * - 回傳 { header, data, meta, modeValue }
 */
function parseCsvTextToCached(csvText) {
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
  if (/^行程$/i.test(modeValue)) headerIndex = detectHeaderIndexForSchedule(rows);
  else headerIndex = detectHeaderIndexHeuristic(rows, cursor);

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

  return { header, data, meta, modeValue };
}

function ensureOnePageButton() {
  let btn = document.getElementById('onePageBtn');
  if (btn) return btn;

  btn = document.createElement('button');
  btn.id = 'onePageBtn';
  btn.type = 'button';
  btn.textContent = '一頁式';
  btn.title = '一頁式顯示全部日程表';
  btn.style.display = 'none';

  btn.addEventListener('click', async () => {
    if (AppState.onePageLoading) return;
    await toggleOnePageMode();
  });

  document.body.appendChild(btn);

  if (!document.getElementById('onePageBtn-style')) {
    const s = document.createElement('style');
    s.id = 'onePageBtn-style';
    s.textContent = `
      #onePageBtn{
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 9990;

        padding: 8px 12px;
        border-radius: 10px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        color: #111827;

        cursor: pointer;
        font-size: 13px;
        font-weight: 700;

        box-shadow: 0 8px 18px rgba(0,0,0,.08);
        user-select: none;
      }
      #onePageBtn:hover{ background:#f9fafb; }
      #onePageBtn[disabled]{ opacity:.5; cursor:not-allowed; }
    `;
    document.head.appendChild(s);
  }

  return btn;
}

function updateOnePageButtonVisibility() {
  const btn = ensureOnePageButton();

  const cached = AppState.cached;
  const hasScheduleView = Array.isArray(AppState.availableViews) && AppState.availableViews.includes('schedule');
  const gids = parseDayGidsFromMeta(cached?.meta || {});
  const hasDays = gids.length > 0;

  // 只有「行程模式」且 meta 有日程表 gid 清單時才顯示
  const shouldShow = !!(cached && hasScheduleView && hasDays);

  btn.style.display = shouldShow ? '' : 'none';
  btn.disabled = !!AppState.onePageLoading;

  if (!shouldShow) {
    AppState.onePageMode = false;
    AppState.onePageData = { gids: [], caches: [] };
  }

  btn.textContent = AppState.onePageMode ? '回單日' : '一頁式';
  btn.title = AppState.onePageMode ? '回到單日顯示' : '一頁式顯示全部日程表';
}

function hideDayNavBarForOnePage() {
  const nav = document.getElementById('dayNav');
  if (nav) nav.style.display = 'none';
}

function renderOnePageFromState() {
  const out = document.getElementById('out');
  const statusEl = document.getElementById('status');
  if (!out) return;

  hideDayNavBarForOnePage();

  const gids = AppState.onePageData?.gids || [];
  const caches = AppState.onePageData?.caches || [];

  out.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'onepage-wrap';
  out.appendChild(wrap);

  if (!document.getElementById('onepage-style')) {
    const s = document.createElement('style');
    s.id = 'onepage-style';
    s.textContent = `
      .onepage-wrap{ display:flex; flex-direction:column; gap:18px; }
      .onepage-day{
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        background: #fff;
        overflow: hidden;
      }
      .onepage-day-header{
        display:flex; align-items:center; justify-content:space-between;
        padding: 10px 12px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        font-weight: 800;
      }
      .onepage-day-header small{
        color:#6b7280;
        font-weight: 700;
      }
      .onepage-day-body{ padding: 10px 10px 12px; }
    `;
    document.head.appendChild(s);
  }

  for (let i = 0; i < caches.length; i++) {
    const cached = caches[i];
    const gid = gids[i] || '';
    const date = (cached?.meta && (cached.meta['日期'] || cached.meta['date'])) ? String(cached.meta['日期'] || cached.meta['date']).trim() : '';

    const day = document.createElement('div');
    day.className = 'onepage-day';

    const head = document.createElement('div');
    head.className = 'onepage-day-header';
    head.innerHTML = `
      <div>第${i + 1}天</div>
      <small>${date ? escapeHtml(date) + ' · ' : ''}gid=${escapeHtml(String(gid))}</small>
    `;

    const body = document.createElement('div');
    body.className = 'onepage-day-body';

    day.appendChild(head);
    day.appendChild(body);
    wrap.appendChild(day);

    // 只渲染行程（若該天不是行程模式，就顯示簡易預覽）
    const modeValue = (cached?.meta && (getMetaValueCaseInsensitive(cached.meta, '模式') || getMetaValueCaseInsensitive(cached.meta, 'mode'))) || '';
    const isSchedule = /^行程$/i.test(String(modeValue).trim());

    if (isSchedule && typeof window.renderSchedule === 'function') {
      // renderSchedule 固定使用 #out；這裡用「暫時換 id」的方式，讓它渲染到 body
      const temp = document.createElement('div');
      body.appendChild(temp);

      const realOut = document.getElementById('out');
      const realOutId = realOut ? realOut.id : 'out';

      if (realOut) realOut.id = 'out_real';

      temp.id = 'out';
      try {
        window.renderSchedule(cached);
      } finally {
        const rendered = temp.innerHTML;
        temp.remove();
        body.innerHTML = rendered;

        if (realOut) realOut.id = realOutId;
      }
    } else {
      const pre = document.createElement('pre');
      pre.style.cssText = 'max-width:100%;overflow:auto;background:#f6f8fa;padding:12px;border-radius:10px;';
      pre.textContent = JSON.stringify(
        { meta: cached?.meta || {}, header: cached?.header || [], sample: (cached?.data || []).slice(0, 10) },
        null,
        2
      );
      body.appendChild(pre);
    }
  }

  if (statusEl) statusEl.textContent = `一頁式：共 ${caches.length} 天`;
}

async function fetchAllSchedulesForOnePage() {
  const tplEl = document.getElementById('csvTemplate');
  const statusEl = document.getElementById('status');

  const template = (tplEl?.value || '').trim();
  const cached = AppState.cached;
  const gids = parseDayGidsFromMeta(cached?.meta || {});

  if (!gids.length) throw new Error('meta 未提供日程表（gids）');

  // 沒有模板時，至少用 docId 組出 export URL
  const docId = AppState.currentDocId || sanitizeDocId(DEFAULT_DOC_ID) || '';
  if (!template && !docId) throw new Error('缺少模板與 docId，無法載入全部日程表');

  AppState.onePageLoading = true;
  updateOnePageButtonVisibility();

  const caches = [];
  for (let i = 0; i < gids.length; i++) {
    const gid = gids[i];
    if (statusEl) statusEl.textContent = `一頁式載入中：${i + 1} / ${gids.length}（gid=${gid}）`;

    const url = template
      ? buildUrlFromTemplate(template, gid)
      : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;

    const resp = await fetch(url, { cache: 'no-store', redirect: 'follow', credentials: 'omit', mode: 'cors' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} (gid=${gid})`);
    const text = await resp.text();

    const parsed = parseCsvTextToCached(text);
    caches.push({ header: parsed.header, data: parsed.data, meta: parsed.meta });
  }

  AppState.onePageData = { gids, caches };
}

async function toggleOnePageMode() {
  const statusEl = document.getElementById('status');

  // 關閉：回到單日
  if (AppState.onePageMode) {
    AppState.onePageMode = false;
    AppState.onePageData = { gids: [], caches: [] };
    updateOnePageButtonVisibility();
    renderCurrentView();
    return;
  }

  // 開啟：一頁式只支援「行程」視圖
  const hasScheduleView = Array.isArray(AppState.availableViews) && AppState.availableViews.includes('schedule');
  if (!hasScheduleView) {
    if (statusEl) statusEl.textContent = '一頁式只支援「行程」模式';
    return;
  }

  try {
    await fetchAllSchedulesForOnePage();
    AppState.onePageMode = true;
    updateOnePageButtonVisibility();
    renderOnePageFromState();
  } catch (e) {
    console.error('一頁式載入失敗：', e);
    logDebug(['[onePage] error', String(e.stack || e)]);
    if (statusEl) statusEl.textContent = '一頁式載入失敗（請看 Console / Debug）';
    AppState.onePageMode = false;
    AppState.onePageData = { gids: [], caches: [] };
  } finally {
    AppState.onePageLoading = false;
    updateOnePageButtonVisibility();
  }
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
    updateOnePageButtonVisibility();

    if (AppState.onePageMode) {
      return renderOnePageFromState();
    }

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

  // 一頁式僅適用於行程（schedule）；若切到其他視圖，自動回單日
  if (AppState.onePageMode && view !== 'schedule') {
    AppState.onePageMode = false;
    AppState.onePageData = { gids: [], caches: [] };
  }

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

  updateOnePageButtonVisibility();
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

  if (loadBtn) loadBtn.addEventListener('click', loadFromUrlTemplate);
  if (reloadBtn) reloadBtn.addEventListener('click', loadFromUrlTemplate);
  if (loadSampleBtn) loadSampleBtn.addEventListener('click', loadSampleData);

  // 支援 Enter 觸發載入
  const tplEl = document.getElementById('csvTemplate');
  const gidEl = document.getElementById('gidInput');
  if (tplEl) tplEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromUrlTemplate(); });
  if (gidEl) gidEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromUrlTemplate(); });
}

function initializeFromUrlParams() {
  const p = new URLSearchParams(location.search);

  // gid
  const gid = p.get('gid') || '';
  const gidEl = document.getElementById('gidInput');
  if (gidEl && gid) gidEl.value = gid;
  AppState.currentGid = gid;

  // docId（不強制寫入 template，只在載入時取用）
  const docId = sanitizeDocId(getDocIdFromUrl());
  if (docId) AppState.currentDocId = docId;

  // 初始視圖（若提供 view=schedule/list/raw/grid）
  const view = (p.get('view') || '').toLowerCase();
  if (view) AppState.currentView = view;

  // 若 URL 有 template（可選）：?tpl=...
  const tpl = p.get('tpl') || '';
  const tplEl = document.getElementById('csvTemplate');
  if (tplEl && tpl) tplEl.value = tpl;
}

function main() {
  applyUrlFlags();
  initializeFromUrlParams();
  initializeEventListeners();

  // 初次畫面：如果 URL 已有 template + gid，直接載入
  const tplEl = document.getElementById('csvTemplate');
  const gidEl = document.getElementById('gidInput');
  const hasTpl = !!(tplEl && String(tplEl.value || '').trim());
  const hasGid = !!(gidEl && String(gidEl.value || '').trim());
  if (hasTpl && hasGid) loadFromUrlTemplate();

  updateOnePageButtonVisibility();
}

main();
