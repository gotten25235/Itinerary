// filename: js/handle.js
'use strict';

/**
 * handle.js
 * - AppState / URL 旗標
 * - debug 面板
 * - 視圖切換與主流程
 *
 * 請在 index.html 以這個順序載入：
 * 1) js/sheet-data.js
 * 2) js/schedule-features.js
 * 3) js/handle.js
 */

// 預設 Spreadsheet Doc ID（若 URL 或 Template 有提供 docId，會覆蓋）
const DEFAULT_DOC_ID = '1DuMk9-kPO_FmXGOyunTcGGC1Rquoova5Q6DCTr5Z_A8';

const AppState = {
  noteRequireCode: false,
  noteCodeParam: 'code',

  personalRequireCode: false,
  personalCodeParam: 'code',
  personalCodeValue: '1912',

  cached: null,
  currentView: 'schedule',
  availableViews: [],
  isLoading: false,
  flags: { hideDebug: false, hideImages: false, hideControls: false },

  navDays: { gids: [], index: -1 },

  currentGid: '',
  currentDocId: '',

  onePageMode: false,
  onePageData: { sections: [] },
  onePageLoading: false,

  relatedAgenda: {
    items: null,
    loading: false,
    returnTo: null
  }
};

window.AppState = AppState;

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
        #debugMode {
          display:inline-block; margin-left:8px; padding:0 8px; border-radius:999px;
          background:#f3f4f6; color:#111827; font-size:12px; line-height:18px; font-weight:700;
          border:1px solid #e5e7eb;
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
  updateDebugSummaryContext();
}


// 同步在 Debug summary 顯示「目前模式 / 視圖 / 一頁式狀態」

function updateDebugSummaryContext() {
  // 若 debug 被隱藏就不顯示 summary（但仍允許 console）
  if (AppState?.flags?.hideDebug) return;

  const sum = document.getElementById('debugSummary');
  if (!sum) return;

  // 建立 / 取得 context badge
  let badge = document.getElementById('debugMode');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'debugMode';
    sum.appendChild(badge);
  }

  const meta = AppState?.cached?.meta || {};
  const rawMode =
    (typeof getMetaValueCaseInsensitive === 'function'
      ? (getMetaValueCaseInsensitive(meta, '模式') || getMetaValueCaseInsensitive(meta, 'mode') || '')
      : (meta['模式'] || meta['mode'] || '')
    );

  const modeValue = String(rawMode || '').trim();

  // 若 meta 沒有模式，給一個「推測」字樣，避免使用者誤判
  let inferred = '';
  let modeLabel = modeValue;

  if (!modeLabel) {
    if (Array.isArray(AppState.availableViews) && AppState.availableViews.includes('schedule')) {
      modeLabel = '行程';
      inferred = '(推測)';
    } else if (Array.isArray(AppState.availableViews) && AppState.availableViews.includes('shopping')) {
      modeLabel = '採購清單';
      inferred = '(推測)';
    } else {
      modeLabel = '一般';
      inferred = '(推測)';
    }
  }

  const view = AppState.currentView || '(unknown)';
  const onePage = AppState.onePageMode ? '一頁式' : '單日';
  const gid = AppState.currentGid ? ` gid=${AppState.currentGid}` : '';
  badge.textContent = `mode=${modeLabel}${inferred} | view=${view} | ${onePage}${gid}`;
}

/** 是否像 CSV/TSV（至少兩行，某行含逗號或 tab） */

function renderCurrentView() {
  if (!AppState.cached) return;
  try {
    buildDayNavBar();
    updateOnePageButtonVisibility();

    // 一頁式的 UI 切換集中在這裡處理，避免和 renderOnePageFromState() 重複收尾
    if (AppState.onePageMode) {
      const bar = document.getElementById('relatedAgendaBar');
      if (bar) {
        bar.style.display = 'none';
        bar.innerHTML = '';
      }
      if (AppState.relatedAgenda) AppState.relatedAgenda.returnTo = null;
      return renderOnePageFromState();
    }

    // 單日才需要相關議程按鈕列
    renderRelatedAgendaBar();

    switch (AppState.currentView) {
      case 'grid':
        return window.renderGrid(AppState.cached);
      case 'list':
        return window.renderList(AppState.cached);
      case 'schedule':
        return window.renderSchedule(AppState.cached);
      case 'shopping':
        return window.renderShopping(AppState.cached);
      case 'note':
        return window.renderNote(AppState.cached);
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
    resetOnePageState();
  }

  AppState.currentView = view;
  updateDebugSummaryContext();
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
            : v === 'shopping'
              ? '採購清單'
              : v === 'note'
                ? '注意事項'
                : '原始讀取';
    if (v === AppState.currentView || (!AppState.currentView && i === 0)) btn.classList.add('active');
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

  // 初始視圖（若提供 view=schedule/list/raw/grid/shopping）
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
