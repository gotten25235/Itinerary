// filename: js/view-shopping.js
'use strict';

/**
 * 採購清單 view（差異化檔）
 * - 使用 SheetCardBase 共通模板產生 renderer
 * - 差異行為：
 *   - 點卡片背景：選取 / 取消選取（外框變色）
 *   - 點列表空白背景：清空選取（全部取消外框）
 *   - 分享：只分享已選取；優先 Web Share，不支援則複製分享文字
 *   - 匯出/匯入：round-trip（header/data/meta + selectedIds）
 *   - 自動剪貼簿匯入：focus / visibilitychange 嘗試讀取；僅 shopping 模式
 */

(function () {
  const B = window.SheetCardBase;
  const U = window.UtilsCopy;
  if (!B) {
    console.error('[view-shopping] missing SheetCardBase (view-card-base.js)');
    return;
  }

  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function getStableId(row, keyTime, keyName, keyType, keyAddr, keyLocAlias, keySite) {
    const time = B.t(row?.[keyTime]);
    const name = B.t(row?.[keyName]);
    const typ  = B.t(row?.[keyType]);
    const addr = B.t(row?.[keyAddr]);
    const alias = B.t(row?.[keyLocAlias]);
    const site = B.normalizeUrl(row?.[keySite]);
    const sig = [time, typ, name, addr, alias, site].join('|');
    return `shop_${fnv1a32(sig)}`;
  }

  function buildRoundTrip(cached, allRows, selectedIds) {
    return {
      meta: cached.meta || {},
      header: cached.header || [],
      data: allRows || [],
      selectedIds: selectedIds || [],
    };
  }

  function buildShareText(meta, keyTime, keyType, keyName, keyLoc, keyAddr, keyPrice, keyPriceNt, keySite, keyNote, rows) {
    const title = B.t(meta?.['標題'] || meta?.['title'] || '採購清單');
    const date = B.t(meta?.['日期'] || meta?.['date'] || '');
    let out = `【${title}】${date ? ' ' + date : ''}\n\n`;

    rows.forEach((row, i) => {
      const time = B.t(row?.[keyTime]);
      const typ = B.t(row?.[keyType]);
      const name = B.t(row?.[keyName]);
      const loc = B.t(row?.[keyLoc]);
      const addr = B.t(row?.[keyAddr]);
      const note = B.t(row?.[keyNote]);
      const price = B.t(row?.[keyPrice]);
      const priceNt = B.t(row?.[keyPriceNt]);
      const site = B.normalizeUrl(row?.[keySite]);

      out += `${i + 1}. ${time ? `[${time}] ` : ''}${typ ? `(${typ}) ` : ''}${name}\n`;
      if (loc || addr) out += `   地點：${loc || addr}\n`;
      if (price || priceNt) out += `   金額：${priceNt || price}\n`;
      if (note) out += `   備註：${note}\n`;
      if (site) out += `   官網：${site}\n`;
      out += `\n`;
    });

    return out.trim();
  }

  async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }

  function getSelectedSet() {
    return window.renderShopping._selectedSet || (window.renderShopping._selectedSet = new Set());
  }

  function syncSelectionUi(out) {
    const root = out || document.getElementById('out');
    if (!root) return;

    const set = getSelectedSet();
    root.querySelectorAll('.schedule-item[data-itemid]').forEach((el) => {
      const id = (el.getAttribute('data-itemid') || '').trim();
      const on = id && set.has(id);
      el.classList.toggle('is-selected', !!on);
    });

    updateToolbarState(root);
  }

  function clearSelection(out) {
    const root = out || document.getElementById('out');
    if (!root) return;

    const set = getSelectedSet();
    if (set.size === 0) return;

    set.clear();
    root.querySelectorAll('.schedule-item.is-selected').forEach((el) => el.classList.remove('is-selected'));
    updateToolbarState(root);
  }

  function toggleSelectionByItemEl(itemEl, out) {
    const id = (itemEl.getAttribute('data-itemid') || '').trim();
    if (!id) return;

    const set = getSelectedSet();
    const next = !set.has(id);

    if (next) set.add(id);
    else set.delete(id);

    itemEl.classList.toggle('is-selected', next);
    updateToolbarState(out);
  }

  function bindShoppingSelectionEventsOnce(out) {
    if (!out || out._shoppingSelectBound) return;
    out._shoppingSelectBound = true;

    // 這些區塊點擊時，不應該觸發「卡片選取 / 清空」
    const INTERACTIVE_SEL =
      '.sched-btn, a, button, input, textarea, select, label, .sched-img, [data-close], .img-modal, .copy-addr';

    out.addEventListener('click', (e) => {
      const root = out;

      // 點到互動元件：忽略（讓 base 處理該互動）
      if (e.target.closest(INTERACTIVE_SEL)) return;

      // 點到卡片：切換選取（外框變色）
      const item = e.target.closest('.schedule-item');
      if (item) {
        toggleSelectionByItemEl(item, root);
        return;
      }

      // 點到列表空白背景：清空選取
      clearSelection(root);
    });
  }

  async function shareSelected() {
    const last = window.renderShopping?._last;
    if (!last) return;

    const set = getSelectedSet();
    const picked = [];
    last.sorted.forEach((row, idx) => {
      const id = last.idByIndex?.[idx] || '';
      if (id && set.has(id)) picked.push(row);
    });

    if (!picked.length) {
      B.showToast('未選取項目');
      return;
    }

    const meta = last.cached.meta || {};
    const k = last.keys;

    const text = buildShareText(
      meta, k.keyTime, k.keyType, k.keyName,
      k.keyLocation, k.keyLocation,
      k.keyPrice, k.keyPriceNt,
      k.keySite, k.keyNote,
      picked
    );

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // fallthrough
      }
    }

    const ok = await copyTextToClipboard(text);
    B.showToast(ok ? '已複製分享文字' : '分享失敗');
  }

  
  // ====== copy / import (text) ======

  async function copySelected() {
    const last = window.renderShopping?._last;
    if (!last) return;

    const set = getSelectedSet();
    const picked = [];
    last.sorted.forEach((row, idx) => {
      const id = last.idByIndex?.[idx] || '';
      if (id && set.has(id)) picked.push(row);
    });

    if (!picked.length) {
      B.showToast('未選取項目');
      return;
    }

    const k = last.keys;
    const items = picked.map((row) => ({
      type: B.t(row?.[k.keyType]),
      name: B.t(row?.[k.keyName]),
    }));

    const text = (U && U.buildCopyText)
      ? U.buildCopyText(items)
      : items.map(x => [x.type, x.name].filter(Boolean).join(' ').trim()).join('\n');

    const ok = (U && U.copyTextToClipboard)
      ? await U.copyTextToClipboard(text)
      : await copyTextToClipboard(text);

    B.showToast(ok ? '已複製' : '複製失敗');
  }

  function applyImportedSelectionFromText(text) {
    const last = window.renderShopping?._last;
    if (!last) return { ok: false, n: 0 };
    if (!U || !U.parseCopyText || !U.matchPairsToIds) return { ok: false, n: 0 };

    const parsed = U.parseCopyText(text);
    if (!parsed.ok) return { ok: false, n: 0 };

    const ids = U.matchPairsToIds({
      pairs: parsed.pairs,
      rows: last.sorted,
      keys: { keyType: last.keys.keyType, keyName: last.keys.keyName },
      getId: (row, idx) => last.idByIndex?.[idx] || getItemId(row, idx, last.keys),
    });

    window.renderShopping._selectedSet = ids;

    const out = document.getElementById('out');
    if (out) syncSelectionUi(out);

    return { ok: ids.size > 0, n: ids.size };
  }

  async function importFromPrompt() {
    const text = window.prompt('貼上匯入文字（每行：類型 名稱）：');
    if (!text) return;

    const r = applyImportedSelectionFromText(text);
    B.showToast(r.ok ? `已匯入並選取(${r.n})` : '匯入失敗');
  }

function exportRoundTrip() {
    const last = window.renderShopping?._last;
    if (!last) return;

    const set = getSelectedSet();
    const selectedIds = Array.from(set);

    const exportRows = selectedIds.length
      ? last.sorted.filter((row, idx) => {
          const id = last.idByIndex?.[idx] || '';
          return id && set.has(id);
        })
      : last.sorted;

    const payload = buildRoundTrip(last.cached, exportRows, selectedIds);
    const text = JSON.stringify(payload, null, 2);

    copyTextToClipboard(text).then((ok) => {
      B.showToast(ok ? '已複製匯出資料' : '匯出失敗');
    });
  }

  function importRoundTripFromText(text) {
    if (!text) return false;

    let obj = null;
    try { obj = JSON.parse(text); } catch { return false; }
    if (!obj || !Array.isArray(obj.header) || !Array.isArray(obj.data)) return false;

    const next = { header: obj.header, data: obj.data, meta: obj.meta || {} };

    if (window.AppState && window.AppState.cached) {
      window.AppState.cached = next;
      window.AppState.currentView = 'shopping';
    }

    window.renderShopping._selectedSet = new Set(obj.selectedIds || []);
    window.renderShopping(next);

    const out = document.getElementById('out');
    if (out) syncSelectionUi(out);

    return true;
  }

  async function importFromPrompt() {
    const text = window.prompt('貼上匯入 JSON：');
    if (!text) return;
    const ok = importRoundTripFromText(text);
    B.showToast(ok ? '已匯入' : '匯入失敗');
  }

  async function tryAutoImportFromClipboard() {
    if (window.__SHEET_VIEW_MODE__ !== 'shopping') return;
    if (!navigator.clipboard?.readText) return;
    if (!U || !U.parseCopyText) return;

    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;

      // 避免把 JSON 當成複製文字
      if (text.includes('"header"') && text.includes('"data"')) return;

      const parsed = U.parseCopyText(text);
      if (!parsed.ok) return;

      const r = applyImportedSelectionFromText(text);
      if (r.ok) B.showToast(`已自動匯入並選取(${r.n})`);
    } catch {
      // ignore
    }
  }

function updateToolbarState(out) {
    const root = out || document.getElementById('out');
    if (!root) return;

    const copyBtn = root.querySelector('.shop-copy');
    if (!copyBtn) return;

    const set = getSelectedSet();
    const n = set.size || 0;

    // 依選取數更新按鈕文字：複製(0)/複製(1)...
    copyBtn.textContent = `複製(${n})`;
    copyBtn.disabled = (n === 0);
    copyBtn.title = (n === 0) ? '未選取時不可複製' : '';
  }

function ensureShoppingToolbarHtml(meta) {
    return `
      <div class="copy-toolbar-right">
        <button class="sched-btn shop-copy" type="button">複製</button>
        <button class="sched-btn shop-import" type="button">匯入</button>
      </div>
    `;
  }

function mapKeys(header) {
    const keyDisplayMode = B.pickField(header, ['顯示模式', 'display mode', 'display_mode', 'mode']);

    const keyTime = header[0];
    const keyType = B.pickField(header, ['類型', 'type', '分類', 'category']);
    const keyName = B.pickField(header, ['名稱', 'name', 'title', '品項', '商品']) || header[1] || header[0];

    const keyLocation = B.pickField(header, ['地點', 'location', '店家', '店名', '地址', 'address']);
    const keyLocationAlias = B.pickField(header, ['地點別稱', '別稱', 'alias', 'location alias']);
    const keySite = B.pickField(header, ['官網', '網站', '官方網站', 'website', 'official', 'url']);

    const keyPrice = B.pickField(header, ['金額', 'price', '費用']);
    const keyPriceNt = B.pickField(header, [
      '換算金額(NT)', '換算金額', '換算金額nt', '換算金額(nt)',
      '換算金額twd', 'twd', 'ntd', 'converted', 'converted nt', 'converted ntd',
    ]);

    const keyHours = B.pickField(header, ['營業時間', 'hours', '資訊', 'info']);

    const keyReviews = B.collectReviewKeys(header);
    const keyImage = B.pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
    const keySummary = B.pickField(header, ['摘要', 'summary', '內容', 'content']);
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

  function sortRows(rows) {
    return rows;
  }

  function renderLeftCell(row, idx) {
    return `<div class="schedule-time"><span class="t1">${B.esc(String(idx + 1))}</span></div>`;
  }

  function getItemId(row, idx, keys) {
    return getStableId(row, keys.keyTime, keys.keyName, keys.keyType, keys.keyLocation, keys.keyLocationAlias, keys.keySite);
  }

  function getItemExtraClasses(row, idx, keys) {
    const id = getItemId(row, idx, keys);
    const set = getSelectedSet();
    return (id && set.has(id)) ? ['is-selected'] : [];
  }

  function renderPriceHtml(row, idx, keys) {
    const pnt = keys.keyPriceNt ? B.t(row[keys.keyPriceNt]) : '';
    const p = keys.keyPrice ? B.t(row[keys.keyPrice]) : '';
    if (!pnt && !p) return '';
    return B.esc(pnt || p);
  }

  function beforeListHtml(cached) {
    return ensureShoppingToolbarHtml(cached?.meta || {});
  }

  function afterRender() {
    const out = document.getElementById('out');
    if (!out) return;

    // toolbar
    const copyBtn = out.querySelector('.shop-copy');
    const importBtn = out.querySelector('.shop-import');

    if (copyBtn) copyBtn.onclick = () => { copySelected(); };
    if (importBtn) importBtn.onclick = () => { importFromPrompt(); };

// selection behaviors（點卡片背景/點空白背景清空）
    bindShoppingSelectionEventsOnce(out);

    // render 後同步一次（避免匯入/切換後狀態不一致）
    syncSelectionUi(out);

    // auto import hooks
    window.removeEventListener('focus', tryAutoImportFromClipboard);
    window.addEventListener('focus', tryAutoImportFromClipboard);

    document.removeEventListener('visibilitychange', afterRender._vis);
    afterRender._vis = () => {
      if (document.visibilityState === 'visible') tryAutoImportFromClipboard();
    };
    document.addEventListener('visibilitychange', afterRender._vis);
  }

  const _renderShoppingImpl = B.createCardRenderer({
    title: '採購清單',
    topbarLabel: '資訊：',
    containerClass: 'shopping-container',
    mapKeys,
    sortRows,
    renderLeftCell,
    getItemId,
    getItemExtraClasses,
    renderPriceHtml,
    beforeListHtml,
    afterRender,
  });

  function gatePersonalView() {
    const need = !!window.AppState?.personalRequireCode;
    if (!need) return { ok: true };

    const param = window.AppState?.personalCodeParam || 'code';
    const expected = (window.AppState?.personalCodeValue || '1912').trim();
    const p = new URLSearchParams(location.search);
    const code = (p.get(param) || '').trim();

    if (!code || code !== expected) {
      return { ok: false, param, expected };
    }
    return { ok: true };
  }

  window.renderShopping = function (cached) {
    const g = gatePersonalView();
    if (!g.ok) {
      const out = document.getElementById('out');
      if (out) {
        out.innerHTML =
          `<div class="schedule-meta-note">
             <div class="meta-label">需要授權：</div>
             <div>此頁為「個人」視圖，請在網址帶入 <b>?${B.esc(g.param)}=${B.esc(g.expected)}</b> 才會顯示內容。</div>
           </div>`;
      }
      const statusEl = document.getElementById('status');
      if (statusEl) statusEl.textContent = 'code 不正確，已隱藏個人視圖內容';
      return;
    }

    return _renderShoppingImpl(cached);
  };
})();
