// filename: js/view-note.js
'use strict';

/**
 * 注意事項 view
 * - 基本排版沿用 Card View Base
 * - 左側欄位使用 index（若無 index 欄位則用 idx+1）
 */
(function () {
  const B = window.SheetCardBase;
  if (!B) {
    console.error('[view-note] missing SheetCardBase (view-card-base.js)');
    return;
  }

  function mapKeys(header) {
    const keyDisplayMode = B.pickField(header, ['顯示模式', 'display mode', 'display_mode', 'mode']);

    const keyIndex = B.pickField(header, ['index', '序', '順序', '編號', 'no', 'No', '序號']);

    const keyType = B.pickField(header, ['類型', 'type', '分類', 'category']);
    const keyName = B.pickField(header, ['名稱', 'name', 'title', '主題', '事項']) || header[1] || header[0];

    const keyLocation = B.pickField(header, ['地址', 'address']);
    const keyLocationAlias = B.pickField(header, ['地點別稱', '地點', 'location', '別稱', 'alias', 'location alias']);

    const keySite = B.pickField(header, ['官網', '網站', '官方網站', 'website', 'official', 'url']);
    const keyReviews = B.collectReviewKeys(header);

    const keyImage = B.pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
    const keySummary = B.pickField(header, ['摘要', 'summary', '內容', 'content']);
    const keyNote = B.pickField(header, ['備註', 'note']);

    const keyHours = B.pickField(header, ['資訊', 'info', '營業時間', 'hours']);

    return {
      keyDisplayMode,
      keyIndex,
      keyType,
      keyName,
      keyLocation,
      keyLocationAlias,
      keySite,
      keyReviews,
      keyImage,
      keySummary,
      keyNote,
      keyHours,
    };
  }

  function sortRows(rows, keys) {
    const keyIndex = keys.keyIndex;
    if (!keyIndex) return rows;

    return rows.sort((a, b) => {
      const ai = parseInt(String(a[keyIndex] || '').trim(), 10);
      const bi = parseInt(String(b[keyIndex] || '').trim(), 10);
      const aOk = Number.isFinite(ai);
      const bOk = Number.isFinite(bi);
      if (aOk && bOk) return ai - bi;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return 0;
    });
  }

  function renderLeftCell(row, idx, keys) {
    const raw = keys.keyIndex ? String(row[keys.keyIndex] || '').trim() : '';
    const label = raw || String(idx + 1);
    return `<div class="schedule-time"><span class="t1">${B.esc(label)}</span></div>`;
  }

  function beforeListHtml(cached) {
    const meta = cached?.meta || {};
    const note = (meta['備註'] || meta['note'] || '').toString().trim();
    if (!note) return '';

    const lines = note.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const bullets = lines.map(s => `*.${B.esc(s)}`).join('<br>');
    return `<div class="schedule-meta-note"><div class="meta-label">備註：</div>${bullets}</div>`;
  }

    const _renderNoteImpl = B.createCardRenderer({
    title: '注意事項',
    topbarLabel: '資訊：',
    mapKeys,
    sortRows,
    renderLeftCell,
    beforeListHtml,
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

  window.renderNote = function (cached) {
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

    return _renderNoteImpl(cached);
  };
})();
