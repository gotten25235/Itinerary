// Filename: js/renderers.js
// DOM 渲染（Grid / List）相關函式（繁體中文註解）
// 請存成 js/renderers.js 並確保在 app.js 執行前已載入。

'use strict';

/* -------------------------
   Fallback helpers（如果專案已有這些函式就不覆寫）
   ------------------------- */
if (typeof escapeHtml === 'undefined') {
  window.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
}

if (typeof makeSafeUrl === 'undefined') {
  window.makeSafeUrl = function (u) {
    if (!u && u !== 0) return '';
    try {
      const s = String(u).trim();
      if (!s) return '';
      // 自動補 protocol
      if (/^\/\//.test(s)) return window.location.protocol + s;
      if (!/^[a-zA-Z]+:\/\//.test(s) && !/^\//.test(s)) {
        return s;
      }
      return s;
    } catch (e) {
      return '';
    }
  };
}

if (typeof isUrlLike === 'undefined') {
  window.isUrlLike = function (s) {
    if (!s) return false;
    return /^(https?:\/\/|\/\/|www\.)/i.test(String(s).trim()) || /\.[a-z]{2,4}\/?/.test(String(s).trim());
  };
}

if (typeof buildUrlFromTemplate === 'undefined') {
  // 範本樣式：會把 {gid} 或 {id} 換掉
  window.buildUrlFromTemplate = function (template, id) {
    if (!template) return id;
    return template.replace(/\{gid\}|\{id\}/ig, id);
  };
}

/* -------------------------
   偵測 header 行索引（若無明確 header，回傳 0）
   參數 rows = CSV rows (array of arrays)
   ------------------------- */
function detectHeaderIndex(rows){
  if(!Array.isArray(rows) || rows.length === 0) return 0;
  const known = ['名稱','工作室','類型','網址','地點','金額','圖片','照片','img','圖','title','name','url','image'];
  for(let i=0;i<rows.length;i++){
    const row = (rows[i] || []).map(c => (c||'').toString().trim());
    if(row.some(cell => known.includes(cell))) return i;
    const nonEmpty = row.filter(c => c !== '').length;
    if(nonEmpty >= 2 && row.length >= 2) return i;
  }
  return 0;
}

/* -------------------------
   依類型分組
   header: array of header names
   data: array of objects (keyed by header)
   ------------------------- */
function groupByType(header = [], data = []){
  const typeKey = (header || []).find(h => /類型|type/i.test(h)) || (header[0] || '');
  const groups = {};
  (data || []).forEach(item => {
    const t = ((item && item[typeKey]) || item && item['類型'] || item && item['type'] || '其他').toString().trim() || '其他';
    if(!groups[t]) groups[t] = [];
    groups[t].push(item);
  });
  return {groups, typeKey};
}

/* -------------------------
   偵測圖片欄位（回傳 header 的 key，或 null）
   ------------------------- */
function detectImageField(header = []){
  if(!Array.isArray(header)) return null;
  const keys = header.map(h => (h||'').toString().trim().toLowerCase());
  const prefer = ['圖片','照片','img','image','圖','圖片網址','image_url','thumbnail'];
  for(const p of prefer){
    const idx = keys.findIndex(k => k === p || k.includes(p));
    if(idx !== -1) return header[idx];
  }
  const matchUrl = keys.find(k => k.includes('網址') || k.includes('url') || k.includes('link'));
  return matchUrl ? header[keys.indexOf(matchUrl)] : null;
}

/* -------------------------
   判斷該欄位值是否代表「刪除線」
   支援的表示： 'O' / 'o' / '1' / '是' / 'true' / 'y' / 'yes'
   ------------------------- */
function isStrikeValue(val){
  if(val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  if(!s) return false;
  return s === 'o' || s === '1' || s === '是' || s === 'true' || s === 'y' || s === 'yes';
}

/* -------------------------
   Render: Grid（每類型顯示所有資料）
   cached: { header: [...], data: [ {...}, ... ] }
   ------------------------- */
function renderGridGrouped(cached){
  const out = document.getElementById('out');
  if(!out) return;
  out.innerHTML = '';

  const header = Array.isArray(cached.header) ? cached.header : [];
  const data = Array.isArray(cached.data) ? cached.data : [];
  const {groups} = groupByType(header, data);
  const imageField = detectImageField(header);

  const urlField = (header || []).find(h => /網址|url|link|website/i.test(h)) || null;
  const templateEl = document.getElementById('csvTemplate');
  const template = templateEl ? (templateEl.value || '') : '';

  // 找出是否存在「刪除線」欄位
  const strikeField = (header || []).find(h => /刪除線|delete/i.test(h)) || null;

  Object.keys(groups).forEach(type => {
    const items = groups[type] || [];

    // 建立 group wrapper
    let html = '<div class="group">';
    html += '<h3>' + escapeHtml(type) + '</h3>';
    html += '<div class="grid">';

    items.forEach(row => {
      // row 可能是物件或陣列（若是陣列嘗試用 header mapping）
      let item = row;
      if(Array.isArray(row) && header.length){
        item = {};
        header.forEach((h, i)=> item[h] = row[i] || '');
      }

      const titleKey = header.find(h => /名稱|title|name/i.test(h)) || header[0] || '';
      const title = (item && item[titleKey]) ? item[titleKey].toString() : '';

      const rawImg = (item && (imageField ? item[imageField] : null)) || item && (item['圖片']||item['照片']||item['img']||item['image']) || '';
      const imgUrl = makeSafeUrl(rawImg);

      let rawUrl = '';
      if(urlField) rawUrl = item[urlField] || '';
      rawUrl = rawUrl || item && (item['網址']||item['url']||item['link']) || '';

      let finalLink = '';
      if(/^[0-9]+$/.test((rawUrl||'').toString().trim()) && template){
        finalLink = buildUrlFromTemplate(template, rawUrl.toString().trim());
      } else {
        finalLink = makeSafeUrl(rawUrl) || '';
      }

      const priceField = (header || []).find(h => /金額|價格|price/i.test(h));
      const rawPrice = (priceField ? (item ? (item[priceField] || '') : '') : '') || (item && (item['金額']||item['價格']||item['price']) ) || '';

      // 判斷是否需要刪除線
      const strike = strikeField ? isStrikeValue(item && item[strikeField]) : false;

      // compose item html
      // 若 strike，給予 class 並加上 inline style 以確保呈現（同時讓圖片變淡）
      const gridItemClass = strike ? 'grid-item strike' : 'grid-item';
      const gridItemStyle = strike ? 'style="text-decoration:line-through;"' : '';

      html += `<div class="${gridItemClass}" ${gridItemStyle}>`;
      if(imgUrl){
        const href = (finalLink && finalLink.toString().trim() !== '') ? finalLink : imgUrl;
        // 圖片若被刪除線則降低不透明度與灰階
        const imgStyle = strike ? 'style="opacity:0.45;filter:grayscale(60%);"' : '';
        html += '<a href="'+escapeHtml(href)+'" target="_blank" rel="noopener">';
        html += '<div class="grid-img">';
        html += `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" loading="lazy" ${imgStyle}>`;
        html += '</div>'; // .grid-img
        html += '<div class="grid-caption">' + escapeHtml(title) + '</div>';
        html += '</a>';
        if(rawPrice && rawPrice.toString().trim() !== ''){
          html += '<div class="grid-price">' + escapeHtml(rawPrice) + '</div>';
        }
      } else {
        // no image
        if(finalLink && finalLink.toString().trim() !== ''){
          const placeholderStyle = strike ? 'style="opacity:0.6;filter:grayscale(60%);"' : '';
          html += '<a href="'+escapeHtml(finalLink)+'" target="_blank" rel="noopener">';
          html += `<div class="placeholder" ${placeholderStyle}>無圖片（點我）</div>`;
          html += '<div class="grid-caption">'+escapeHtml(title)+'</div>';
          html += '</a>';
          if(rawPrice && rawPrice.toString().trim() !== ''){
            html += '<div class="grid-price">' + escapeHtml(rawPrice) + '</div>';
          }
        } else {
          html += '<div class="placeholder">無圖片</div>';
          html += '<div class="grid-caption">'+escapeHtml(title)+'</div>';
          if(rawPrice && rawPrice.toString().trim() !== ''){
            html += '<div class="grid-price">' + escapeHtml(rawPrice) + '</div>';
          }
        }
      }

      html += '</div>'; // .grid-item
    });

    html += '</div>'; // .grid
    html += '</div>'; // .group

    out.insertAdjacentHTML('beforeend', html);
  });
}

/* Render: List（表格，每類型一張表）
   修改說明：
   - 新增「刪除線」欄位支援；若該欄為 O 則整行顯示刪除線
   - 只對「網址」與「評論」欄位套用截斷（分別使用 .link-cell 與 .comment-cell）
   - 其他欄位完整顯示（不自動截斷）
   - 為網址 a 與評論 cell 加上 title 屬性，方便 hover 查看完整內容
*/
function renderListGrouped(cached){
  const out = document.getElementById('out');
  if(!out) return;
  out.innerHTML = '';

  const header = Array.isArray(cached.header) ? cached.header : [];
  const data = Array.isArray(cached.data) ? cached.data : [];
  const {groups} = groupByType(header, data);
  const templateEl = document.getElementById('csvTemplate');
  const template = templateEl ? (templateEl.value || '') : '';

  // 添加 linkify 函數，用來將文字中的 URL 轉成超連結
  function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    return text.replace(urlRegex, url => `<a href="${escapeHtml(makeSafeUrl(url))}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`);
  }

  // 想要顯示的欄位順序（已將 刪除線 放在最前面）
  const want = ['刪除線','類型','工作室','名稱','是否有NPC','人數','時間','金額','網址','地點','評論'];

  Object.keys(groups).forEach(type => {
    const items = groups[type] || [];
    let html = '<div class="group">';
    html += '<h3>' + escapeHtml(type) + '</h3>';
    html += '<div class="table-wrap"><table><thead><tr>';

    // 只採用在 header 中存在的 want 欄位；若都沒有則 fallback 為前幾個 header
    const present = want.filter(h => header.includes(h));
    const useFields = present.length ? present : header.slice(0, Math.min(10, header.length));

    useFields.forEach(f=>{
      const cls = (f==='類型' ? 'col-type' : f==='工作室' ? 'col-studio' : f==='名稱' ? 'col-name' : f==='時間' ? 'col-time' : f==='金額' ? 'col-price' : (f==='刪除線' ? 'col-delete' : ''));
      html += `<th class="${cls}">${escapeHtml(f)}</th>`;
    });
    html += '</tr></thead><tbody>';

    // 找出是否存在「刪除線」欄位名稱（可能在 header 內）
    const strikeField = (header || []).find(h => /刪除線|delete/i.test(h)) || null;

    items.forEach((row, rowIdx)=>{
      let item = row;
      if(Array.isArray(row) && header.length){
        item = {};
        header.forEach((h,i)=> item[h] = row[i] || '');
      }

      // 判斷是否需要刪除線
      const strike = strikeField ? isStrikeValue(item && item[strikeField]) : false;

      // 如果要刪除線，為每個 td 加上 inline style 確保子元素也呈現（避免 a 或 img 覆寫）
      const tdStyleAttr = strike ? 'style="text-decoration:line-through; color:inherit;"' : '';

      html += (strike ? `<tr class="strike-row">` : `<tr>`);

      useFields.forEach((f, colIdx)=>{
        const raw = (item && (item[f] || '')) ? (item[f].toString().trim()) : '';
        let cellHtml = '';

        // === 只針對「網址」處理為 link-cell（單行省略） ===
        if(/網址/i.test(f)){
          // 若是純數字用 template 建 link，否則如果是 URL-like 直接用
          let href = '';
          if(/^[0-9]+$/.test(raw) && template){
            href = buildUrlFromTemplate(template, raw);
          } else {
            href = makeSafeUrl(raw);
          }
          const display = raw.length > 80 ? raw.slice(0,80) + '…' : raw;
          // 把完整網址放到 title（hover 可見），並以 .link-cell 顯示省略
          cellHtml = `<div class="link-cell"><a href="${escapeHtml(href||raw)}" target="_blank" rel="noopener" title="${escapeHtml(raw)}">${escapeHtml(display)}</a></div>`;
        }
        // === 只針對「評論」處理為 comment-cell（2 行省略） ===
        else if(/評論/i.test(f)){
          let safeText = escapeHtml(raw).replace(/\n/g,'<br>');
          safeText = linkify(safeText); // 將評論中的 URL 轉成超連結
          // 顯示前幾字並設 title
          const shortRaw = raw.length > 240 ? raw.slice(0,240) + '…' : raw;
          const short = escapeHtml(shortRaw).replace(/\n/g,'<br>');
          const shortLinked = linkify(short);
          cellHtml = `<div class="comment-cell" title="${escapeHtml(raw)}">${shortLinked}</div>`;
        }
        // === 只針對「刪除線」欄顯示原始標記（例如 O）或空白 ===
        else if(/刪除線/i.test(f)){
          cellHtml = `<div class="delete-indicator">${escapeHtml(raw)}</div>`;
        }
        // === 其它欄位：完整顯示（不截斷） ===
        else {
          let cellText = escapeHtml(raw).replace(/\n/g, '<br>');
          cellText = linkify(cellText); // 將文字中的 URL 轉成超連結
          cellHtml = `<div class="small-text">${cellText}</div>`;
        }

        // 每一個 td 都帶入刪除線 style（若需要）
        html += `<td ${tdStyleAttr}>${cellHtml}</td>`;
      });

      html += '</tr>';
    });

    html += '</tbody></table></div></div>';
    out.insertAdjacentHTML('beforeend', html);
  });

  // 如果你還想要「更多」按鈕的展開行為（針對 comment），可以在此處綁定事件
  const moreBtns = document.querySelectorAll('.more-btn');
  moreBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-target');
      const el = document.getElementById(id);
      if(!el) return;
      const expanded = el.classList.toggle('expanded');
      btn.textContent = expanded ? '收合' : '更多';
      if(!expanded){
        const raw = el.textContent || '';
        const short = raw.length > 120 ? escapeHtml(raw.slice(0,120)) + '…' : escapeHtml(raw);
        el.innerHTML = short;
      }
    });
  });
}

/* Expose to global for app.js usage (若需要) */
window.renderGridGrouped = renderGridGrouped;
window.renderListGrouped = renderListGrouped;
window.detectHeaderIndex = detectHeaderIndex;
window.groupByType = groupByType;
window.detectImageField = detectImageField;
