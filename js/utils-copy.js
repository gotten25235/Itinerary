'use strict';

/**
 * utils-copy.js
 * 共用：依「類型 / 地點名稱(地點別稱)」分組 key、複製文字格式、剪貼簿、以及「從複製文字匯入並選取」。
 *
 * 主要給：
 * - view-grid.js：維持既有「依類型 / 依地點別稱」分組 + 複製選取項目（格式：keyType keyName）
 * - view-shopping.js：提供「複製 / 匯入」；匯入會解析複製文字並對應選中 card
 */

(function () {
  const U = {};

  function t(v) { return (v == null) ? '' : String(v).trim(); }
  function norm(v) { return t(v).replace(/\s+/g, ' ').toLowerCase(); }

  U.esc = function (s) {
    if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') {
      return window.escapeHtml(String(s ?? ''));
    }
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* =========================
   * Grouping helpers
   * ========================= */

  U.extractDistrict = function (addr = '') {
    const s = t(addr);
    if (!s) return null;

    const common = /(西屯區|南屯區|北屯區|北區|中區|西區|南區|東區|大里區|太平區|潭子區|烏日區|大雅區|龍井區|清水區|沙鹿區|后里區|外埔區|大肚區|霧峰區|神岡區|梧棲區|石岡區|新社區)/;
    let m = s.match(common);
    if (m) return m[1];

    const all = s.match(/([\u4e00-\u9fa5]{1,3}區)/g);
    if (all && all.length) return all[all.length - 1];

    return null;
  };

  U.normalizeAliasForGroup = function (alias = '') {
    let s = t(alias);
    if (!s) return '';

    const lines = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    s = lines.length ? lines[0] : s;

    const segs = s.split(/[、,;\/|]+/).map(x => x.trim()).filter(Boolean);
    s = segs.length ? segs[0] : s;

    const hasCjk = /[\u4e00-\u9fff]/.test(s);
    if (hasCjk) {
      const i = s.indexOf(' ');
      if (i > 0) s = s.slice(0, i).trim();
    }
    return s;
  };

  U.hash32 = function (str) {
    const s = String(str || '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(16);
  };

  U.groupKeyForItem = function (item, fieldKeys, groupMode) {
    const type = fieldKeys.type ? t(item?.[fieldKeys.type]) : '';
    const loc = fieldKeys.location ? t(item?.[fieldKeys.location]) : '';
    const aliasRaw = fieldKeys.locationAlias ? t(item?.[fieldKeys.locationAlias]) : '';
    const alias = U.normalizeAliasForGroup(aliasRaw);
    const district = U.extractDistrict(loc) || '';

    if (groupMode === 'locationAlias') {
      return alias || district || type || '未分類';
    }
    return type || district || alias || '未分類';
  };

  U.groupData = function (data, fieldKeys, groupMode) {
    const map = new Map();
    (data || []).forEach((it) => {
      const g = U.groupKeyForItem(it, fieldKeys, groupMode);
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(it);
    });
    return map;
  };

  /* =========================
   * Clipboard helpers
   * ========================= */

  function execCommandCopy(s) {
    try {
      // 避免 async/await 破壞 user-activation：在不安全來源(HTTP)直接走 execCommand
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);

      const prevFocus = document.activeElement;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);

      const ok = document.execCommand('copy');

      document.body.removeChild(ta);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch {}
      }
      return !!ok;
    } catch {
      return false;
    }
  }

  // 提供同步版本，讓 click handler 在 HTTP / 不安全來源下不會因 await 失去 user-activation
  U.copyTextToClipboardSync = function (text) {
    const s = String(text || '');
    if (!s) return false;
    return execCommandCopy(s);
  };

  U.copyTextToClipboard = function (text) {
    const s = String(text || '');
    if (!s) return Promise.resolve(false);

    // HTTP / 非 secure context 下，Clipboard API 常常直接 reject，且會失去 user activation
    const canClipboard = !!(window.isSecureContext && navigator.clipboard?.writeText);
    if (!canClipboard) return Promise.resolve(execCommandCopy(s));

    return navigator.clipboard.writeText(s)
      .then(() => true)
      .catch(() => execCommandCopy(s));
  };

  /* =========================
   * Copy / Import format
   * ========================= */

  U.buildCopyLines = function (items) {
    const lines = [];
    (items || []).forEach((it) => {
      const type = t(it?.type);
      const name = t(it?.name);
      if (!type && !name) return;
      lines.push(type ? `${type} ${name}`.trim() : name);
    });
    return lines;
  };

  U.buildCopyText = function (items) {
    return U.buildCopyLines(items).join('\n').trim();
  };

  U.parseCopyText = function (text) {
    const s = String(text || '').replace(/\r\n/g, '\n');
    const lines = s.split('\n').map(x => x.trim()).filter(Boolean);

    const pairs = [];
    for (const line of lines) {
      if (line.startsWith('{') || line.startsWith('[')) return { ok: false, pairs: [] };

      const m = line.match(/^(\S+)\s+(.+)$/);
      if (m) pairs.push({ type: t(m[1]), name: t(m[2]), raw: line });
      else pairs.push({ type: '', name: t(line), raw: line });
    }
    return { ok: pairs.length > 0, pairs };
  };

  U.matchPairsToIds = function ({ pairs, rows, keys, getId }) {
    const out = new Set();
    if (!pairs?.length || !rows?.length) return out;

    const keyType = keys?.keyType;
    const keyName = keys?.keyName;

    const map = new Map();
    rows.forEach((row, idx) => {
      const typ = keyType ? norm(row?.[keyType]) : '';
      const name = keyName ? norm(row?.[keyName]) : '';
      if (!name) return;

      const k = `${typ}||${name}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(idx);

      const kn = `||${name}`;
      if (!map.has(kn)) map.set(kn, []);
      map.get(kn).push(idx);
    });

    pairs.forEach((p) => {
      const typ = norm(p.type);
      const name = norm(p.name);
      if (!name) return;

      const k = `${typ}||${name}`;
      const kn = `||${name}`;

      const idxs = map.get(k) || map.get(kn) || [];
      idxs.forEach((idx) => {
        const id = getId(rows[idx], idx);
        if (id) out.add(String(id));
      });
    });

    return out;
  };

  
  /* =========================
   * Style (shared UI)
   * ========================= */

  U.ensureCopyStyle = function () {
    if (typeof document === 'undefined') return;
    if (document.getElementById('utils-copy-style')) return;

    const css = `
/* utils-copy shared controls */
.grid-controls{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:10px 12px;
  border:1px solid #e5e7eb;
  border-radius:12px;
  background:#fff;
  margin:10px 0 14px;
}
.grid-controls-left{
  display:flex;
  align-items:center;
  gap:14px;
  flex-wrap:wrap;
}
.grid-radio{
  display:inline-flex;
  align-items:center;
  gap:8px;
  font-size:14px;
  color:#111827;
  user-select:none;
}
.grid-radio input{
  width:16px;
  height:16px;
  accent-color:#2563eb;
}
.grid-controls-right{
  margin-left:auto;
  display:flex;
  align-items:center;
  gap:10px;
}
.grid-copy-btn,
.sched-btn.shop-copy,
.sched-btn.shop-import{
  appearance:none;
  border:1px solid #d1d5db;
  background:#fff;
  color:#111827;
  border-radius:9999px;
  padding:7px 14px;
  font-size:14px;
  line-height:1;
  cursor:pointer;
}
.grid-copy-btn:disabled,
.sched-btn.shop-copy:disabled{
  opacity:0.45;
  cursor:not-allowed;
}
.grid-copy-btn:hover:not(:disabled),
.sched-btn.shop-copy:hover:not(:disabled),
.sched-btn.shop-import:hover:not(:disabled){
  border-color:#9ca3af;
}
.copy-toolbar-right{
  display:flex;
  justify-content:flex-end;
  gap:10px;
  padding:10px 12px;
  border:1px solid #e5e7eb;
  border-radius:12px;
  background:#fff;
  margin:10px 0 14px;
}

/* simple toast */
.copy-toast{
  position:fixed;
  left:50%;
  bottom:18px;
  transform:translateX(-50%);
  background:rgba(17,24,39,.92);
  color:#fff;
  padding:10px 14px;
  border-radius:9999px;
  font-size:14px;
  font-weight:800;
  z-index:99999;
  opacity:0;
  pointer-events:none;
  transition:opacity .18s ease;
}
.copy-toast.show{ opacity:1; }
`;

    const style = document.createElement('style');
    style.id = 'utils-copy-style';
    style.textContent = css;
    document.head.appendChild(style);
  };

window.UtilsCopy = U;
  try { U.ensureCopyStyle(); } catch {}
})();
