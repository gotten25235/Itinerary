// filename: js/handle.js
'use strict';

/**
 * Handle（docId 寫死 + 無關鍵字、啟發式找表頭 + 寬鬆偵錯）
 * - ★ DOC_ID 寫死：所有請求一律打到這個文件 ID
 * - gid 來源：優先用輸入框；若空，從模板字串（可貼 edit URL）抓 gid
 * - 匯出 URL: https://docs.google.com/spreadsheets/d/{DOC_ID}/export?format=csv&gid={gid}
 * - 解析：
 *   * 只有「前幾列真的像 meta（模式/備註/日期/…）」才當 meta，否則不跳過
 *   * 行程模式：找含「時刻表/schedule」那列當 header
 *   * 其他模式：不靠關鍵字，純啟發式偵測最像表頭的一列
 * - 視圖：模式=行程 -> ['schedule','list','raw']（預設 schedule），否則 ['grid','list','raw']（預設 grid）
 * - 失敗不自動 fallback 範例；需按「載入範例」才讀 sample.csv
 * - ★ 新增：若 meta 有「日程表」欄（放多個 gid），在 行程 / 詳細清單 / 原始讀取 顯示「上一頁／下一頁（第N天）」分頁列，點擊會切換 gid 並重載
 */

// ★ 將你的 Spreadsheet Doc ID 寫死在這裡
const DOC_ID = '1DuMk9-kPO_FmXGOyunTcGGC1Rquoova5Q6DCTr5Z_A8';

const AppState = {
  cached: null,
  currentView: 'raw',
  availableViews: [],
  isLoading: false,
  flags: { hideDebug: false, hideImages: false, hideControls: false },

  // ★ 日程分頁狀態（由 meta['日程表'] 解析）
  navDays: { gids: [], index: -1 },
  currentGid: '' // 目前載入的 gid（由 URL 或輸入框而來；用於比對第幾天）
};

// ★ 解析網址參數，支援 ?hide=debug,ui 或 ?hideDebug=1&hideControls=1
function applyUrlFlags() {
  const p = new URLSearchParams(location.search);
  const raw = (p.get('hide') || '').toLowerCase();
  const list = raw.split(/[,\s]+/).filter(Boolean); // e.g. "debug,ui"
  const yes = (k) =>
    list.includes(k) || p.get('hide' + k[0].toUpperCase() + k.slice(1)) === '1';

  AppState.flags.hideDebug    = yes('debug');
  AppState.flags.hideControls = yes('ui') || yes('controls') || yes('bar');

  if (AppState.flags.hideControls) document.documentElement.classList.add('hide-controls');
  // （按你的需求：不主動隱藏圖片區塊）
}

/* ============ 小工具 / Debug ============ */

function ensureDebugBox() {
  // ★ 若要求隱藏 debug，建立一個隱藏的佔位 pre 並直接回傳
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
    panel.open = false; // 預設收合
    panel.style.cssText = 'margin-top:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;';

    const sum = document.createElement('summary');
    sum.id = 'debugSummary';
    sum.textContent = '📟 終端機 / Debug';
    sum.style.cssText = 'cursor:pointer;user-select:none;padding:8px 10px;font-size:14px;font-weight:600;list-style:none;';
    panel.appendChild(sum);

    const dbg = document.createElement('pre');
    dbg.id = 'debug';
    dbg.style.cssText = 'max-width:100%;overflow:auto;background:#0b1020;color:#e6edf3;margin:0;padding:10px;border-top:1px solid #e5e7eb;border-bottom-left-radius:8px;border-bottom-right-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;';
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
    const count = (dbg.textContent.match(/\n\[/g) || []).length; // 粗估段落數
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
  return lines.some(l => l.includes(',') || l.includes('\t'));
}

/** 從任意字串（例如你貼的 edit URL）嘗試抓 gid=123 */
function extractGid(str) {
  if (!str) return '';
  const m = String(str).match(/[?&#]gid=([0-9]+)/i);
  return m ? m[1] : '';
}

/* ============ URL 組裝（docId 寫死） ============ */
/**
 * 一律使用寫死的 DOC_ID。gid 來自：
 * 1) gid 輸入框；若空
 * 2) 從 template 字串嘗試抓 gid=（可貼 edit URL）
 * 都沒有 → 不帶 gid（Google 會導出預設分頁；建議填 gid）
 */
function buildUrlFromTemplate(template, gid) {
  const fallbackGid = extractGid(template);
  const finalGid = (gid && gid.trim()) ? gid.trim() : fallbackGid;
  const base = `https://docs.google.com/spreadsheets/d/${DOC_ID}/export?format=csv`;
  return finalGid ? `${base}&gid=${encodeURIComponent(finalGid)}` : base;
}

/* ============ 表頭偵測：meta / 行程 / 啟發式 ============ */

// 判斷一列是否為「meta 格式」（第一格是 模式/備註/日期/mode/note/date）
function isMetaRow(row) {
  const k = String(row?.[0] ?? '').trim().toLowerCase();
  if (!k) return false;
  return ['模式','mode','備註','note','日期','date','日程表','行程表','days'].some(
    key => key.toLowerCase() === k
  );
}

// 行程用：找含「時刻表 / schedule」那列；找不到回 0
function detectHeaderIndexForSchedule(rows) {
  const idx = rows.findIndex(r =>
    Array.isArray(r) && r.some(c => /時刻表|schedule/i.test(String(c || '')))
  );
  return idx >= 0 ? idx : 0;
}

// 啟發式（無關鍵字）：評分找「最像表頭」的一列
function detectHeaderIndexHeuristic(rows, start = 0, maxCheck = 30) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const isNumericOnly = v => /^\d+([.,]\d+)?$/.test(v);
  const isUrlLike     = v => /^https?:\/\//i.test(v);
  const looksTime     = v => /^\d{1,2}:\d{2}/.test(v);
  const hasLetters    = v => /[A-Za-z\u4e00-\u9fff]/.test(v); // 英文或中日韓文字

  function scoreRow(cells) {
    let nonEmpty = 0, textish = 0, numeric = 0, urlish = 0, longish = 0, timeLike = 0;

    for (const c of (cells || [])) {
      const v = (c ?? '').toString().trim();
      if (!v) continue;
      nonEmpty++;
      if (isNumericOnly(v)) numeric++;
      if (isUrlLike(v))     urlish++;
      if (looksTime(v))     timeLike++;
      if (hasLetters(v))    textish++;
      if (v.length >= 20)   longish++;
    }

    // 表頭特性：非空較多、以文字為主、數字/URL/超長字較少、不像時間列
    return nonEmpty * 2 + textish
         - numeric * 1.2
         - urlish  * 1.5
         - longish * 0.3
         - timeLike * 1.0;
  }

  let bestIdx = start, bestScore = -Infinity;
  const end = Math.min(rows.length, start + maxCheck);
  for (let i = start; i < end; i++) {
    const row = (rows[i] || []).map(x => (x ?? '').toString().trim());
    const nonEmpty = row.filter(Boolean).length;
    if (nonEmpty < 2) continue;            // 至少要有幾個非空欄
    if (row.some(isUrlLike)) continue;     // 很像資料列（滿是 URL）就略過
    const s = scoreRow(row);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return bestIdx;
}

/* ============ 解析 CSV 文字 ============ */
/**
 * - 連續掃前幾列 meta（模式/備註/日期/日程表…），第2欄起合併為多行；同 key 續接
 * - 行程模式：用 detectHeaderIndexForSchedule
 * - 其他模式：用 detectHeaderIndexHeuristic（不靠關鍵字）
 */
async function loadFromText(csvText) {
  const statusEl = document.getElementById('status');
  const out = document.getElementById('out');
  if (!statusEl || !out) { console.error('缺少必要 DOM (#status/#out)'); return; }

  AppState.isLoading = true;
  out.innerHTML = '';
  statusEl.textContent = '解析中...';

  try {
    const rows = parseCSV(csvText);
    if (!rows || rows.length === 0) throw new Error('CSV 為空');

    // step1: 連續掃前幾列的 meta（含：模式/備註/日期/日程表…）
    // 規則：像 meta 的列 => 第 2 欄起全部用 '\n' 併成多行；同 key 續接
    const meta = {};
    let cursor = 0;
    for (let i = 0; i < Math.min(rows.length, 6); i++) { // 掃前 6 列足夠
      if (!isMetaRow(rows[i])) break;
      const k = String(rows[i][0] ?? '').trim();
      const vals = (rows[i].slice(1) || [])
        .map(x => String(x ?? '').trim())
        .filter(Boolean);
      if (k && vals.length) {
        const joined = vals.join('\n');
        meta[k] = meta[k] ? (meta[k] + '\n' + joined) : joined;
      }
      cursor = i + 1;
    }

    // step2: 決定 header 列（行程：找「時刻表/schedule」；否則：啟發式）
    const modeValue = (meta['模式'] || meta['mode'] || '').toString().trim();
    let headerIndex;
    if (/^行程$/i.test(modeValue)) {
      headerIndex = detectHeaderIndexForSchedule(rows);
    } else {
      headerIndex = detectHeaderIndexHeuristic(rows, cursor);
    }

    const header = (rows[headerIndex] || []).map(h => (h || '').toString().trim());

    // step3: 組資料（從 header 下一列開始；跳過全空列）
    const data = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        const key = header[j] || `col${j}`; // 空白表頭以 colX 補上
        obj[key] = (r[j] != null ? String(r[j]) : '').trim();
      }
      if (Object.values(obj).some(v => v !== '')) data.push(obj);
    }

    AppState.cached = { header, data, meta };

    // ★ 解析「日程表」：更新分頁狀態（僅記錄，渲染時才決定要不要顯示）
    const gids = parseDayGidsFromMeta(meta);
    if (gids.length) {
      // 若目前 currentGid 不在列表，先不亂跳；索引待 render 時比對
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

/* ============ 遠端載入（用寫死 DOC_ID） ============ */
async function loadFromUrlTemplate() {
  const tplEl = document.getElementById('csvTemplate'); // 可貼 edit URL 或留模板字串
  const gidEl = document.getElementById('gidInput');
  const statusEl = document.getElementById('status');
  const out = document.getElementById('out');
  if (!tplEl || !gidEl || !statusEl || !out) { console.error('缺少必要 DOM'); return; }

  const template = (tplEl.value || '').trim();
  const gid = (gidEl.value || '').trim();

  // ★ 記住目前要載入的 gid（用於日程分頁比對與顯示第幾天）
  AppState.currentGid = gid || extractGid(template) || AppState.currentGid || '';

  // 至少要有 template（可用來抽 gid），或直接填 gid
  if (!template && !gid) {
    statusEl.textContent = '請至少輸入 gid 或在模板欄貼含 gid= 的 URL';
    return;
  }

  const url = buildUrlFromTemplate(template, gid);
  statusEl.textContent = '從 URL 載入中…';
  out.innerHTML = '';

  logDebug(['[fetch start]', url, 'docId=' + DOC_ID, 'gid=' + (gid || extractGid(template) || '(empty)')]);

  try {
    const resp = await fetch(url, { cache: 'no-store', redirect: 'follow', credentials: 'omit', mode: 'cors' });
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
    const isHtmlLike = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text) || text.toLowerCase().includes('<html');

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
    out.innerHTML = ''; // 不自動顯示範例
  }
}

/* ============ 日程分頁（上一頁／下一頁 + 第N天） ============ */

// ★ 將 ?key=value 寫回網址（不重整）
function updateUrlParam(key, value) {
  const url = new URL(location.href);
  if (value == null || value === '') url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url.toString());
}

// ★ 從 meta 解析日程表的 gid 陣列（支援：日程表/行程表/days；分隔：逗號、頓號、換行、空白等）
function parseDayGidsFromMeta(meta) {
  if (!meta) return [];
  const raw = meta['日程表'] || meta['行程表'] || meta['days'] || '';
  if (!raw) return [];
  const tokens = String(raw).split(/[\s,，、;；\n\r]+/).filter(Boolean);
  return tokens.map(s => s.trim()).filter(s => /^\d+$/.test(s));
}

// ★ 切換到指定 index 的日程（依 gid 載入）
async function navigateDayTo(index) {
  const gids = AppState.navDays.gids || [];
  if (!gids.length) return;
  const i = Math.max(0, Math.min(index, gids.length - 1));
  const gid = gids[i];

  // 更新輸入框與內部狀態
  const gidEl = document.getElementById('gidInput');
  if (gidEl) gidEl.value = gid;
  AppState.currentGid = gid;
  updateUrlParam('gid', gid);

  // 重新載入
  await loadFromUrlTemplate();
}

// ★ 上/下一天
function navigateDayOffset(delta) {
  const i = (AppState.navDays.index ?? -1) + delta;
  navigateDayTo(i);
}

// ★ 建立或更新分頁列（只在 schedule/list/raw 顯示；grid 隱藏）
function buildDayNavBar() {
  const meta = AppState?.cached?.meta || {};
  const gids = parseDayGidsFromMeta(meta);
  const showForView = AppState.currentView !== 'grid'; // 只在三個檢視顯示
  const shouldShow = !!(gids.length && showForView);

  // 準備掛載點：插在 #viewToggle 後面；若沒有就插在 #out 前
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

    // 一次性樣式
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

  // 儲存列表
  AppState.navDays.gids = gids;

  // 計算目前 index（以 AppState.currentGid 對比）
  const curGid = AppState.currentGid || (new URLSearchParams(location.search).get('gid')) || '';
  const idx = gids.indexOf(curGid);
  const curIdx = idx >= 0 ? idx : 0;
  AppState.navDays.index = curIdx;

  const total = gids.length;
  const prevIdx = curIdx - 1;
  const nextIdx = curIdx + 1;

  // 按鈕文案：顯示「第N天」
  const prevLabel = prevIdx >= 0 ? `第${prevIdx + 1}天` : `第${Math.max(curIdx,0)}天`;
  const nextLabel = nextIdx < total ? `第${nextIdx + 1}天` : `第${total}天`;
  const curLabel  = `第${curIdx + 1}天 / 共${total}天`;

  nav.innerHTML = `
    <div class="pager">
      <button id="dayPrev" ${prevIdx < 0 ? 'disabled' : ''}>◀ ${prevLabel}</button>
      <button id="dayNext" ${nextIdx >= total ? 'disabled' : ''}>${nextLabel} ▶</button>
    </div>
    <div class="current">${curLabel}</div>
  `;
  nav.style.display = '';

  // 綁定事件
  const prevBtn = document.getElementById('dayPrev');
  const nextBtn = document.getElementById('dayNext');
  if (prevBtn) prevBtn.onclick = () => navigateDayOffset(-1);
  if (nextBtn) nextBtn.onclick = () => navigateDayOffset(1);
}

/* ============ 視圖切換 / 渲染 ============ */
function renderCurrentView() {
  if (!AppState.cached) return;
  try {
    // ★ 先更新日程分頁列（依目前 view 顯示/隱藏）
    buildDayNavBar();

    switch (AppState.currentView) {
      case 'grid':     return window.renderGrid(AppState.cached);
      case 'list':     return window.renderList(AppState.cached);
      case 'schedule': return window.renderSchedule(AppState.cached);
      default:         return window.renderRaw(AppState.cached);
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
  document.querySelectorAll('#viewToggle button').forEach(btn => {
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
    btn.textContent = (v === 'grid' ? '圖片9宮格' :
                       v === 'list' ? '詳細清單' :
                       v === 'schedule' ? '行程' : '原始讀取');
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => switchView(v));
    ctr.appendChild(btn);
  });
}

/* ============ 初始化 ============ */
function initializeEventListeners() {
  const openBtn       = document.getElementById('openCsv');
  const loadBtn       = document.getElementById('loadBtn');
  const reloadBtn     = document.getElementById('reloadBtn');
  const loadSampleBtn = document.getElementById('loadSampleBtn');

  // 直接用寫死的 DOC_ID 生成「編輯頁」連結，gid 取輸入或模板中抽出
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      const tplEl = document.getElementById('csvTemplate');
      const gidEl = document.getElementById('gidInput');
      const g = (gidEl.value || '').trim() || extractGid((tplEl.value || '').trim());
      const editUrl = `https://docs.google.com/spreadsheets/d/${DOC_ID}/edit${g ? `#gid=${encodeURIComponent(g)}` : ''}`;
      window.open(editUrl, '_blank');
      logDebug(['[openCsv]', editUrl]);
    });
  }
  if (loadBtn)       loadBtn.addEventListener('click', () => loadFromUrlTemplate());
  if (reloadBtn)     reloadBtn.addEventListener('click', () => loadFromUrlTemplate());
  if (loadSampleBtn) loadSampleBtn.addEventListener('click', () => loadSampleData());
}

// ★ 強制隱藏 controls + status（JS 層級，保證即時生效）
function enforceHiddenControls() {
  if (!AppState?.flags?.hideControls) return;
  const selectors = [
    '#csvTemplate', '#gidInput', '#openCsv', '#loadBtn', '#reloadBtn', '#loadSampleBtn',
    '#status', '.status-row', '#controls', '.controls', '.controls-row',
    '#title', '.app-title', '.app-header'   // 若你的 h1 有這些常見容器/ID，就直接隱藏
  ];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
  });

  // 沒有固定 ID 的情況：把文字是「試算表檢視器」的 h1 一起藏起來
  document.querySelectorAll('h1').forEach(h => {
    const t = (h.textContent || '').trim();
    if (t === '試算表檢視器') h.style.display = 'none';
  });
}

async function initializeApp() {
  applyUrlFlags(); // ★ 先套用網址旗標
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = '尚未載入（請輸入 gid 或在模板欄貼含 gid= 的 URL，再按「載入資料」）';

  // 若網址帶 gid 就預填，並嘗試載入（失敗不 fallback）
  const params = new URLSearchParams(location.search);
  const gid = params.get('gid');
  if (gid) {
    AppState.currentGid = gid; // ★ 記住 URL 的 gid（供日程列比對）
    const gidEl = document.getElementById('gidInput');
    if (gidEl) gidEl.value = gid;
    await loadFromUrlTemplate();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  applyUrlFlags();           // 先套旗標
  initializeEventListeners();
  enforceHiddenControls();   // ★ 一進來就隱藏一次（如有要求）
  initializeApp();
});

/* 匯出（給其他模組呼叫） */
window.loadFromText = loadFromText;
window.loadFromUrlTemplate = loadFromUrlTemplate;
window.renderCurrentView = renderCurrentView;
window.buildUrlFromTemplate = buildUrlFromTemplate;
window.switchView = switchView;
window.loadSampleData = loadSampleData;

// ========== 內部工具（本檔用） ==========

// 已於上方宣告：updateUrlParam / parseDayGidsFromMeta / navigateDayTo / navigateDayOffset / buildDayNavBar
