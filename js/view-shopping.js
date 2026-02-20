// filename: js/view-shopping.js
'use strict';

/**
 * view-shopping.js（採購清單視圖）
 *
 * 同樣以 SheetCardBase.createCardRenderer(config) 為底，僅保留採購清單特有互動：
 * - 卡片選取：點卡片背景切換選取狀態（以外框/陰影表示）
 * - 點列表空白：清空全部選取
 * - 分享：只分享已選取項目；優先使用 Web Share API，不支援則複製分享文字
 * - 匯出/匯入：支援 round-trip（header/data/meta + selectedIds），便於備份或跨裝置
 * - 自動匯入：在 focus / visibilitychange 嘗試讀取剪貼簿並解析選取（僅 shopping 模式）
 *
 * 文字格式與剪貼簿行為全部委派給 UtilsCopy：
 * - 複製/匯入解析：buildCopyText / parseCopyText / matchPairsToIds
 * - 分享文字：buildShoppingShareText
 * - toast：showCopyToast
 *
 * 依賴：
 * - window.SheetCardBase（view-card-base.js）
 * - window.UtilsCopy（utils-copy.js）
 */


(function () {
  const B = window.SheetCardBase;
  const U = window.UtilsCopy;

  if (!B) {
    console.error('[view-shopping] missing SheetCardBase (view-card-base.js)');
    return;
  }
  if (!U) {
    console.error('[view-shopping] missing UtilsCopy (utils-copy.js)');
    return;
  }

  // 強制依賴（缺就直接中止，以免 view 沒掛 renderer）
  const _needFns = [
    'showCopyToast',
    'buildCopyText',
    'parseCopyText',
    'matchPairsToIds',
    'buildShoppingShareText',
  ];
  for (const fn of _needFns) {
    if (typeof U[fn] !== 'function') {
      console.error('[view-shopping] UtilsCopy missing function:', fn);
      return;
    }
  }
  if (typeof U.copyTextToClipboardSync !== 'function' && typeof U.copyTextToClipboard !== 'function') {
    console.error('[view-shopping] UtilsCopy missing clipboard function');
    return;
  }

  function toast(msg) {
    if (typeof U.showCopyToast === 'function') return U.showCopyToast(msg);
    if (typeof B.showToast === 'function') return B.showToast(msg);
    console.log('[toast]', msg);
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
    const typ = B.t(row?.[keyType]);
    const addr = B.t(row?.[keyAddr]);
    const alias = B.t(row?.[keyLocAlias]);
    const site = B.normalizeUrl(row?.[keySite]);
    const sig = [time, typ, name, addr, alias, site].join('|');
    return `shop_${fnv1a32(sig)}`;
  }

  function buildRoundTrip(cached, allRows, selectedIds) {
    return {
      meta: cached?.meta || {},
      header: cached?.header || [],
      data: allRows || [],
      selectedIds: selectedIds || [],
    };
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

  function _pickedRowsFromLast(last) {
    const set = getSelectedSet();
    const picked = [];
    last.sorted.forEach((row, idx) => {
      const id = last.idByIndex?.[idx] || '';
      if (id && set.has(id)) picked.push(row);
    });
    return picked;
  }

  async function shareSelected() {
    const last = window.renderShopping?._last;
    if (!last) return;

    const picked = _pickedRowsFromLast(last);
    if (!picked.length) {
      toast('未選取項目');
      return;
    }

    const meta = last.cached?.meta || {};
    const k = last.keys;

    const text = U.buildShoppingShareText({
      meta,
      keys: {
        keyTime: k.keyTime,
        keyType: k.keyType,
        keyName: k.keyName,
        keyLocation: k.keyLocation,
        keyAddr: k.keyLocation, // shopping header 常把地點/地址合併，維持原邏輯
        keyPrice: k.keyPrice,
        keyPriceNt: k.keyPriceNt,
        keySite: k.keySite,
        keyNote: k.keyNote,
      },
      rows: picked,
    });

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // fallthrough
      }
    }

    let ok = false;
    if (typeof U.copyTextToClipboardSync === 'function') ok = U.copyTextToClipboardSync(text);
    else ok = await U.copyTextToClipboard(text);

    toast(ok ? '已複製分享文字' : '分享失敗');
  }

  // ====== copy / import (text) ======

  async function copySelected() {
    const last = window.renderShopping?._last;
    if (!last) return;

    const picked = _pickedRowsFromLast(last);
    if (!picked.length) {
      U.showCopyToast('未選取項目');
      return;
    }

    const k = last.keys;
    const items = picked.map((row) => ({
      type: B.t(row?.[k.keyType]),
      name: B.t(row?.[k.keyName]),
    }));

    const text = U.buildCopyText(items);

    let ok = false;
    if (typeof U.copyTextToClipboardSync === 'function') ok = U.copyTextToClipboardSync(text);
    else ok = await U.copyTextToClipboard(text);

    U.showCopyToast(ok ? '已複製' : '複製失敗');
  }

  function applyImportedSelectionFromText(text, rootOut) {
    const last = window.renderShopping?._last;
    if (!last) return { ok: false, n: 0 };

    const parsed = U.parseCopyText(text);
    if (!parsed.ok) return { ok: false, n: 0 };

    const ids = U.matchPairsToIds({
      pairs: parsed.pairs,
      rows: last.sorted,
      keys: { keyType: last.keys.keyType, keyName: last.keys.keyName },
      getId: (row, idx) => last.idByIndex?.[idx] || getItemId(row, idx, last.keys),
    });

    window.renderShopping._selectedSet = ids;

    // 一頁式需同步「該段」容器，不要永遠抓 #out
    const out = rootOut || document.getElementById('out');
    if (out) syncSelectionUi(out);

    return { ok: ids.size > 0, n: ids.size };
  }

  async function importSelectionSmart(rootOut) {
    // Prefer Clipboard API when available; if unavailable/blocked, fallback to prompt.
    const canRead = !!(navigator.clipboard && typeof navigator.clipboard.readText === 'function');

    if (canRead) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && String(text).trim()) {
          const r = applyImportedSelectionFromText(String(text), rootOut);
          toast(r.ok ? `已匯入並選取(${r.n})` : '匯入失敗');
          return;
        }
        toast('剪貼簿是空的');
        return;
      } catch (e) {
        // Permission denied / insecure context / other failures -> fallback to prompt.
      }
    }

    const text = window.prompt('貼上匯入文字（每行：類型 名稱）：');
    if (!text) return;

    const r = applyImportedSelectionFromText(text, rootOut);
    toast(r.ok ? `已匯入並選取(${r.n})` : '匯入失敗');
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

    (async () => {
      let ok = false;
      if (typeof U.copyTextToClipboardSync === 'function') ok = U.copyTextToClipboardSync(text);
      else ok = await U.copyTextToClipboard(text);
      toast(ok ? '已複製匯出資料' : '匯出失敗');
    })();
  }

  function importRoundTripFromText(text) {
    if (!text) return false;

    let obj = null;
    try {
      obj = JSON.parse(text);
    } catch {
      return false;
    }

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

  async function importRoundTripFromPrompt() {
    const text = window.prompt('貼上匯入 JSON：');
    if (!text) return;

    const ok = importRoundTripFromText(text);
    toast(ok ? '已匯入' : '匯入失敗');
  }

  async function tryAutoImportFromClipboard() {
    if (window.__SHEET_VIEW_MODE__ !== 'shopping') return;
    if (!navigator.clipboard?.readText) return;

    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;

      // 避免把 JSON 當成複製文字
      if (text.includes('"header"') && text.includes('"data"')) return;

      const parsed = U.parseCopyText(text);
      if (!parsed.ok) return;

      const r = applyImportedSelectionFromText(text);
      if (r.ok) toast(`已自動匯入並選取(${r.n})`);
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

    // 不要 disabled：讓使用者點了也能得到「未選取」提示
    copyBtn.disabled = false;
    copyBtn.title = (n === 0) ? '未選取項目：點選卡片可選取，再按複製' : '';
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

  function afterRender(ctx) {
    // SheetCardBase 內部 renderer._last 是掛在「實作 renderer」上，
    // 但外層包裝後 window.renderShopping._last 可能拿不到。
    // 這裡把 ctx（含 sorted/keys/idByIndex）同步到 window.renderShopping._last，
    // 供 copySelected / shareSelected / import 等功能使用。
    try {
      if (ctx && window.renderShopping) {
        window.renderShopping._last = {
          cached: ctx.cached,
          sorted: ctx.sorted,
          keys: ctx.keys,
          idByIndex: ctx.idByIndex,
        };
      }
    } catch {
      // ignore
    }

    const out = (ctx && ctx.out) ? ctx.out : document.getElementById('out');
    if (!out) return;

    const copyBtn = out.querySelector('.shop-copy');
    const importBtn = out.querySelector('.shop-import');

    if (copyBtn) copyBtn.onclick = () => { copySelected(); };
    if (importBtn) importBtn.onclick = () => { importSelectionSmart(out); };

    // selection behaviors
    bindShoppingSelectionEventsOnce(out);
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

  // 額外曝露：若你要從外部觸發（目前 toolbar 未綁 share/export/json import）
  window.renderShopping.shareSelected = shareSelected;
  window.renderShopping.exportRoundTrip = exportRoundTrip;
  window.renderShopping.importRoundTripFromPrompt = importRoundTripFromPrompt;
})();
