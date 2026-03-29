// filename: js/schedule-features.js
'use strict';

/**
 * schedule-features.js
 * - 日程分頁
 * - 一頁式
 * - 相關議程
 */

function ensureRelatedAgendaState() {
  if (!AppState.relatedAgenda) {
    AppState.relatedAgenda = {
      items: null,
      loading: false,
      returnTo: null
    };
  }
  return AppState.relatedAgenda;
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

  // 一頁式：不顯示「相關議程」按鈕列（避免從單日殘留）
  const bar = document.getElementById('relatedAgendaBar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  ensureRelatedAgendaState().returnTo = null;

  hideDayNavBarForOnePage();

  const sections = AppState.onePageData?.sections || [];
  out.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'onepage-wrap';
  out.appendChild(wrap);

  if (!document.getElementById('onepage-style')) {
    const s = document.createElement('style');
    s.id = 'onepage-style';
    // 參考你提供的 onePage 外觀：每段都用卡片包覆（header + body）
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

  // 將既有 renderer（會寫入 #out）導向到指定容器
  function renderInto(container, rendererFn, cachedObj) {
    if (typeof rendererFn !== 'function') {
      container.textContent = '缺少 renderer';
      return;
    }
    const realOut = document.getElementById('out');
    const realOutId = realOut ? realOut.id : 'out';

    if (realOut) realOut.id = 'out_real';
    const temp = document.createElement('div');
    temp.id = 'out';
    container.appendChild(temp);

    try {
      rendererFn(cachedObj);
    } finally {
      const rendered = temp.innerHTML;
      temp.remove();
      container.innerHTML += rendered;
      if (realOut) realOut.id = realOutId;
    }
  }


  function patchScheduleBlueTitle(container, cachedObj) {
    const meta = cachedObj?.meta || {};
    const title = (getMetaValueCaseInsensitive(meta, '標題') || getMetaValueCaseInsensitive(meta, 'title') || '').toString().trim();
    if (!title) return;

    // 優先找常見的標題節點
    const candidates = container.querySelectorAll('h1,h2,h3,.view-title,.title,[class*="title"]');
    for (const el of candidates) {
      const t = (el.textContent || '').toString().trim();
      if (t === '行程') {
        el.textContent = title;
        return;
      }
    }

    // 後備：找第一個文字為「行程」的元素
    const all = container.querySelectorAll('*');
    for (const el of all) {
      const t = (el.textContent || '').toString().trim();
      if (t === '行程') {
        el.textContent = title;
        return;
      }
    }
  }

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const cached = sec.cached;
    const gid = sec.gid || '';
    const date = (cached?.meta && (cached.meta['日期'] || cached.meta['date']))
      ? String(cached.meta['日期'] || cached.meta['date']).trim()
      : '';

    const day = document.createElement('div');
    day.className = 'onepage-day';

    const head = document.createElement('div');
    head.className = 'onepage-day-header';

    // 左側：標題；右側：日期 + gid
    const leftTitle = sec.title || `第${i + 1}段`;
    head.innerHTML = `
      <div>${escapeHtml(String(leftTitle))}</div>
      <small>gid=${escapeHtml(String(gid))}</small>
    `;

    const body = document.createElement('div');
    body.className = 'onepage-day-body';

    day.appendChild(head);
    day.appendChild(body);
    wrap.appendChild(day);

    const modeValue = getMetaValueCaseInsensitive(cached?.meta || {}, '模式') || '';
    const t = classifyAgendaTypeByMode(modeValue);

    // 增加更寬鬆的行程判斷邏輯（與單日模式的判斷標準一致）
    const modeRaw = String(modeValue).trim();
    const modeLower = modeRaw.toLowerCase();
    const isSchedule = modeRaw === '行程' || modeLower.includes('行程') || /schedule/i.test(modeLower);

    // 優先判斷是否為行程
    if (isSchedule && typeof window.renderSchedule === 'function') {
      renderInto(body, window.renderSchedule, cached);
      patchScheduleBlueTitle(body, cached);
    } 
    else if ((t === 'shopping' || t === 'personal_shopping') && typeof window.renderShopping === 'function') {
      renderInto(body, window.renderShopping, cached);
    } 
    else if ((t === 'note' || t === 'personal_note') && typeof window.renderNote === 'function') {
      renderInto(body, window.renderNote, cached);
    } 
    else if (typeof window.renderGrid === 'function') {
      renderInto(body, window.renderGrid, cached);
    } 
    else if (typeof window.renderRaw === 'function') {
      renderInto(body, window.renderRaw, cached);
    } else {
      // fallback：簡易預覽
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

  if (statusEl) statusEl.textContent = `一頁式：共 ${sections.length} 段`;
}

async function fetchAllSchedulesForOnePage() {
  const tplEl = document.getElementById('csvTemplate');
  const statusEl = document.getElementById('status');

  const template = (tplEl?.value || '').trim();
  const cached = AppState.cached;
  const dayGids = parseDayGidsFromMeta(cached?.meta || {});

  if (!dayGids.length) throw new Error('meta 未提供日程表（gids）');

  // 一頁式同時載入「總議程」+「日程表」
  const masterItems = parseAgendaItemsFromMeta(cached?.meta || {}, '總議程');

  // 沒有模板時，至少用 docId 組出 export URL
  const docId = AppState.currentDocId || sanitizeDocId(DEFAULT_DOC_ID) || '';
  if (!template && !docId) throw new Error('缺少模板與 docId，無法載入一頁式');

  AppState.onePageLoading = true;
  updateOnePageButtonVisibility();

  async function fetchOneByGid(gid) {
    const url = template
      ? buildUrlFromTemplate(template, gid)
      : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;

    const resp = await fetch(url, { cache: 'no-store', redirect: 'follow', credentials: 'omit', mode: 'cors' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} (gid=${gid})`);
    const text = await resp.text();
    const parsed = parseCsvTextToCached(text);
    return { header: parsed.header, data: parsed.data, meta: parsed.meta, modeValue: parsed.modeValue };
  }

  // 1) 載入總議程（依「模式」分類成 3 類；顯示順序固定）
  const masterBuckets = { personal_note: null, personal_shopping: null, note: null, shopping: null, other: [] };
  for (let i = 0; i < masterItems.length; i++) {
    const it = masterItems[i];
    const gid = it.gid;
    if (!gid) continue;

    // 個人注意事項需要 code=1912
    if (!hasPersonalCode1912()) {
      // 先抓到模式再決定要不要略過；但為了效能先不 fetch，直接略過 personal 類
      // 若你希望即使沒 code 也先 fetch 再判斷，可再調整
    }

    if (statusEl) statusEl.textContent = `一頁式載入總議程：${i + 1} / ${masterItems.length}（gid=${gid}）`;
    const c = await fetchOneByGid(gid);

    const t = classifyAgendaTypeByMode(c.modeValue);

    // 個人視圖：需要 code=1912
    if ((t === 'personal_note' || t === 'personal_shopping') && !hasPersonalCode1912()) continue;

    if (t === 'personal_note' && !masterBuckets.personal_note) masterBuckets.personal_note = { gid, cached: c };
    else if (t === 'personal_shopping' && !masterBuckets.personal_shopping) masterBuckets.personal_shopping = { gid, cached: c };
    else if (t === 'note' && !masterBuckets.note) masterBuckets.note = { gid, cached: c };
    else if (t === 'shopping' && !masterBuckets.shopping) masterBuckets.shopping = { gid, cached: c };
    else masterBuckets.other.push({ gid, cached: c });
  }

  // 2) 載入日程表全部天數
  const dayCaches = [];
  for (let i = 0; i < dayGids.length; i++) {
    const gid = dayGids[i];
    if (statusEl) statusEl.textContent = `一頁式載入日程表：${i + 1} / ${dayGids.length}（gid=${gid}）`;
    const c = await fetchOneByGid(gid);
    dayCaches.push({ gid, cached: c });
  }

  // 3) 組合 sections：先 master（固定順序），再 day（原順序）
  const sections = [];
  if (masterBuckets.personal_note) sections.push({ kind: 'agenda', title: '個人注意事項', ...masterBuckets.personal_note });
  if (masterBuckets.personal_shopping) sections.push({ kind: 'agenda', title: '個人採購清單', ...masterBuckets.personal_shopping });
  if (masterBuckets.note) sections.push({ kind: 'agenda', title: '注意事項', ...masterBuckets.note });
  if (masterBuckets.shopping) sections.push({ kind: 'agenda', title: '採購清單', ...masterBuckets.shopping });

  for (const o of masterBuckets.other) {
    const title = (getMetaValueCaseInsensitive(o.cached.meta, '標題') || '').trim() || '總議程';
    sections.push({ kind: 'agenda', title, gid: o.gid, cached: o.cached });
  }

  for (let i = 0; i < dayCaches.length; i++) {
    const d = dayCaches[i];
    const date = (d.cached.meta && (d.cached.meta['日期'] || d.cached.meta['date'])) ? String(d.cached.meta['日期'] || d.cached.meta['date']).trim() : '';
    sections.push({ kind: 'day', title: `第${i + 1}天${date ? ' · ' + date : ''}`, gid: d.gid, cached: d.cached });
  }

  AppState.onePageData = { sections };
}

async function toggleOnePageMode() {
  const statusEl = document.getElementById('status');

  // 關閉：回到單日
  if (AppState.onePageMode) {
    AppState.onePageMode = false;
    AppState.onePageData = { gids: [], caches: [] };
    updateOnePageButtonVisibility();
    updateDebugSummaryContext();
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
    updateDebugSummaryContext();
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

// 建立或更新分頁列（只在 schedule/list/raw 顯示；grid/shopping 隱藏）

function buildDayNavBar() {
  const meta = AppState?.cached?.meta || {};
  const gids = parseDayGidsFromMeta(meta);

  const showForView = ['schedule', 'list', 'raw'].includes(AppState.currentView);
  const shouldShow = !!(gids.length && showForView);

  let mountAfter = document.getElementById('viewToggle');
  let nav = document.getElementById('dayNav');

  // 相關議程按鈕列（要在 dayNav 上方）
  const relatedBar = ensureRelatedAgendaBar();

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

    // 確保 relatedAgendaBar 在 dayNav 上方
    if (nav && relatedBar && nav.parentElement) {
      if (relatedBar.parentElement !== nav.parentElement) {
        nav.parentElement.insertBefore(relatedBar, nav);
      } else if (relatedBar.nextSibling !== nav) {
        nav.parentElement.insertBefore(relatedBar, nav);
      }
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



/* ============ 單頁：相關議程按鈕（天數列上方） ============ */

ensureRelatedAgendaState() = {
  // 依 gid 內的「模式」分類：personal_note / personal_shopping / note / shopping
  items: null,           // {personal_note:{gid}, personal_shopping:{gid}, note:{gid}, shopping:{gid}}
  loading: false,
  returnTo: null         // {gid, view}
};

function ensureRelatedAgendaBar() {
  let bar = document.getElementById('relatedAgendaBar');
  if (bar) return bar;

  bar = document.createElement('div');
  bar.id = 'relatedAgendaBar';
  bar.style.display = 'none';

  if (!document.getElementById('relatedAgendaBar-style')) {
    const s = document.createElement('style');
    s.id = 'relatedAgendaBar-style';
    s.textContent = `
      #relatedAgendaBar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin: 8px 0 6px; }
      #relatedAgendaBar .btn{
        padding:6px 10px; border-radius:8px; border:1px solid #e5e7eb;
        background:#fff; cursor:pointer; font-size:13px; font-weight:700;
      }
      #relatedAgendaBar .btn.primary{ background:#111827; color:#fff; border-color:#111827; }
      #relatedAgendaBar .btn[disabled]{ opacity:.45; cursor:not-allowed; }
    `;
    document.head.appendChild(s);
  }

  // 預設插在 viewToggle 後面；之後會在 buildDayNavBar 時移到 dayNav 上方
  const mountAfter = document.getElementById('viewToggle');
  if (mountAfter && mountAfter.parentElement) {
    mountAfter.parentElement.insertBefore(bar, mountAfter.nextSibling);
  } else {
    const out = document.getElementById('out');
    (out?.parentElement || document.body).insertBefore(bar, out || null);
  }
  return bar;
}

function renderRelatedAgendaBar() {
  const bar = ensureRelatedAgendaBar();
  const meta = AppState.cached?.meta || {};
  const relatedItems = parseAgendaItemsFromMeta(meta, '相關議程');

  // 沒有相關議程：隱藏
  if (AppState.onePageMode || (!relatedItems.length && !ensureRelatedAgendaState().returnTo)) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  // 先渲染骨架（可先顯示「採購清單」等按鈕，待分類完成再更新）
  bar.style.display = '';
  bar.innerHTML = '';

  // 返回
  if (ensureRelatedAgendaState().returnTo) {
    const back = document.createElement('button');
    back.className = 'btn primary';
    back.textContent = '返回';
    back.onclick = async () => {
      const rt = ensureRelatedAgendaState().returnTo;
      ensureRelatedAgendaState().returnTo = null;

      const gidEl = document.getElementById('gidInput');
      if (gidEl) gidEl.value = rt.gid;
      AppState.currentGid = rt.gid;
      updateUrlParam('gid', rt.gid);

      await loadFromUrlTemplate();

      // 回到原 view（若可用）
      if (rt.view && AppState.availableViews.includes(rt.view)) {
        AppState.currentView = rt.view;
        buildViewToggle();
        renderCurrentView();
      }
    };
    bar.appendChild(back);
  }

  // 若已完成分類，依固定順序顯示三顆
  const buckets = ensureRelatedAgendaState().items;
  if (buckets) {
    const order = [
      { key: 'personal_note', label: '個人注意事項', needCode: true },
      { key: 'personal_shopping', label: '個人採購清單', needCode: true },
      { key: 'note', label: '注意事項', needCode: false },
      { key: 'shopping', label: '採購清單', needCode: false }
    ];
    for (const o of order) {
      const it = buckets[o.key];
      if (!it || !it.gid) continue;
      if (o.needCode && !hasPersonalCode1912()) continue;

      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = o.label;
      b.onclick = async () => {
        // 記錄返回點（只記第一次）
        if (!ensureRelatedAgendaState().returnTo) {
          ensureRelatedAgendaState().returnTo = { gid: AppState.currentGid, view: AppState.currentView };
        }

        const gidEl = document.getElementById('gidInput');
        if (gidEl) gidEl.value = it.gid;
        AppState.currentGid = it.gid;
        updateUrlParam('gid', it.gid);

        await loadFromUrlTemplate();
      };
      bar.appendChild(b);
    }
    return;
  }

  // 尚未分類：先顯示「載入中」提示
  const tip = document.createElement('span');
  tip.style.cssText = 'color:#6b7280;font-size:12px;font-weight:700;';
  tip.textContent = relatedItems.length ? '相關議程載入中…' : '';
  bar.appendChild(tip);
}

async function hydrateRelatedAgenda() {
  const meta = AppState.cached?.meta || {};
  const items = parseAgendaItemsFromMeta(meta, '相關議程');
  if (!items.length) {
    ensureRelatedAgendaState().items = null;
    ensureRelatedAgendaState().loading = false;
    renderRelatedAgendaBar();
    return;
  }

  if (ensureRelatedAgendaState().loading) return;
  ensureRelatedAgendaState().loading = true;
  ensureRelatedAgendaState().items = null;
  renderRelatedAgendaBar();

  const tplEl = document.getElementById('csvTemplate');
  const template = (tplEl?.value || '').trim();
  const docId = AppState.currentDocId || sanitizeDocId(DEFAULT_DOC_ID) || '';

  async function fetchOneByGid(gid) {
    const url = template
      ? buildUrlFromTemplate(template, gid)
      : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;

    const resp = await fetch(url, { cache: 'no-store', redirect: 'follow', credentials: 'omit', mode: 'cors' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} (gid=${gid})`);
    const text = await resp.text();
    const parsed = parseCsvTextToCached(text);
    return parsed.modeValue;
  }

  try {
    const buckets = { personal_note: null, personal_shopping: null, note: null, shopping: null };

    for (const it of items) {
      if (!it.gid) continue;
      const mode = await fetchOneByGid(it.gid);
      const t = classifyAgendaTypeByMode(mode);

      if (t === 'personal_note' && !buckets.personal_note) buckets.personal_note = { gid: it.gid };
      else if (t === 'personal_shopping' && !buckets.personal_shopping) buckets.personal_shopping = { gid: it.gid };
      else if (t === 'note' && !buckets.note) buckets.note = { gid: it.gid };
      else if (t === 'shopping' && !buckets.shopping) buckets.shopping = { gid: it.gid };
    }

    ensureRelatedAgendaState().items = buckets;
  } catch (e) {
    logDebug(['[relatedAgenda] hydrate error', String(e.stack || e)]);
    ensureRelatedAgendaState().items = null;
  } finally {
    ensureRelatedAgendaState().loading = false;
    renderRelatedAgendaBar();
  }
}

/* ============ 視圖切換 / 渲染 ============ */

