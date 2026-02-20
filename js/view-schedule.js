// filename: js/view-schedule.js
'use strict';

/**
 * view-schedule.js（行程 / 時刻表視圖）
 *
 * 以 SheetCardBase.createCardRenderer(config) 為底，這個檔案只實作「行程視圖的差異化規則」：
 * - 欄位對應（mapKeys）：把 CSV header 轉成 keys（時間/類型/名稱/地點/金額/圖片/評論...）
 * - 排序（sortRows）：未知時間（? / ？）排較後；顯示模式含「2」(grayBottom) 永遠排最後
 * - 時間區塊樣式（getTimeSectionClasses）：時間為 ? / ？ 時加入 has-plus（對應紅色樣式）
 * - 名稱樣式（getNameClasses）：類型含「必」或「選」時，分別套 is-required / is-optional
 * - 金額顯示：若有「換算金額(NT)」欄位，交由 UtilsMoney 產出「原幣 + 約 NT$」的 HTML；否則顯示原字串
 *
 * 顯示模式（由 SheetCardBase 解析）：
 * - 0：隱藏
 * - 1：刪除線
 * - 2：灰色 + 排到最後
 * - 3：受 URL code 控制（由 base 統一處理）
 *
 * 依賴：
 * - window.SheetCardBase（view-card-base.js）
 */


(function () {
  const B = window.SheetCardBase;
  if (!B) {
    console.error('[view-schedule] missing SheetCardBase (view-card-base.js)');
    return;
  }

  function isUnknownScheduleTime(v) {
    const s = String(v || '').trim();
    return s === '?' || s === '？';
  }

  function scheduleTimeRank(v, flags) {
    if (flags && flags.grayBottom) return 2;
    if (isUnknownScheduleTime(v)) return 1;
    return 0;
  }

  function formatTimeMultiline(raw) {
    const s = String(raw || '');
    if (!s.includes('~')) return B.esc(s);
    const parts = s.split('~');
    const start = (parts[0] || '').trim();
    const end = (parts[1] || '').trim();
    const a = B.esc(start);
    const b = B.esc(end);
    return `<span class="t1">${a}</span><span class="tsep">~</span><span class="t2">${b}</span>`;
  }

  function mapKeys(header) {
    const keyDisplayMode = B.pickField(header, ['顯示模式', 'display mode', 'display_mode', 'mode']);

    const keyTime = header[0];
    const keyType = B.pickField(header, ['類型', 'type', '分類', 'category']);
    const keyName = B.pickField(header, ['名稱', 'name', 'title', '主題', '景點']) || header[1] || header[0];

    const keyLocation = B.pickField(header, ['地址', 'address']);
    const keyLocationAlias = B.pickField(header, ['地點別稱', '地點', 'location', '別稱', 'alias', 'location alias']);
    const keySite = B.pickField(header, ['官網', '網站', '官方網站', 'website', 'official', 'url']);

    const keyPrice = B.pickField(header, ['金額', 'price', '費用']);
    const keyPriceNt = B.pickField(header, [
      '換算金額(NT)', '換算金額', '換算金額nt', '換算金額(nt)',
      '換算金額twd', 'twd', 'ntd', 'converted', 'converted nt', 'converted ntd',
    ]);
    const keyHours = B.pickField(header, ['營業時間', '營業時段', 'hours', 'opening hours', 'open hours']);

    const keyReviews = B.collectReviewKeys(header);
    const keyImage = B.pickField(header, ['圖片', '圖片網址', '照片', 'image', 'img', 'thumbnail', 'photo', 'pic', '圖']);
    const keySummary = B.pickField(header, ['摘要', 'summary']);
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

  function sortRows(rows, keys) {
    const keyTime = keys.keyTime;
    const keyDisplayMode = keys.keyDisplayMode;

    return rows.sort((a, b) => {
      const ta = String(a[keyTime] || '').trim();
      const tb = String(b[keyTime] || '').trim();

      const fa = keyDisplayMode ? B.parseDisplayModeFlags(a[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };
      const fb = keyDisplayMode ? B.parseDisplayModeFlags(b[keyDisplayMode]) : { hide:false, strike:false, grayBottom:false };

      const ra = scheduleTimeRank(ta, fa);
      const rb = scheduleTimeRank(tb, fb);
      if (ra !== rb) return ra - rb;

      return ta.localeCompare(tb);
    });
  }

  function renderLeftCell(row, idx, keys) {
    const time = String(row[keys.keyTime] || '').trim();
    return `<div class="schedule-time">${formatTimeMultiline(time)}</div>`;
  }

  function getTimeSectionClasses(row, idx, keys) {
    const time = String(row[keys.keyTime] || '').trim();
    return isUnknownScheduleTime(time) ? ['has-plus'] : [];
  }

  function getNameClasses(row, idx, keys) {
    const typ = keys.keyType ? String(row[keys.keyType] || '') : '';
    const out = [];
    if (/必/.test(typ)) out.push('is-required');
    if (/選/.test(typ)) out.push('is-optional');
    return out;
  }

  function onItemClick(ctx) {
    // 點背景：開官網（若無官網，開第一個評論）
    const site = ctx.itemEl.getAttribute('data-site') || '';
    const rev = ctx.itemEl.getAttribute('data-review') || '';
    const url = site || rev;
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  function beforeListHtml(cached) {
    const meta = cached?.meta || {};
    const note = String(meta['備註'] || meta['note'] || '').trim();
    if (!note) return '';
    const lines = note.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const bullets = lines.map(s => `*.${B.esc(s)}`).join('<br>');
    return `<div class="schedule-meta-note"><div class="meta-label">備註：</div>${bullets}</div>`;
  }

  window.renderSchedule = B.createCardRenderer({
    title: '行程',
    topbarLabel: '營業時間：',
    mapKeys,
    sortRows,
    renderLeftCell,
    getTimeSectionClasses,
    getNameClasses,
    beforeListHtml,
    onItemClick,
  });
})();
