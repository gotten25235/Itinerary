// Filename: js/renderers.js
// 此檔負責 DOM 渲染（Grid / List）相關函式，使用繁體中文註解。
// 依賴全域函式：parseCSV, escapeHtml, makeSafeUrl, isUrlLike

/* 偵測 header 行索引（若無明確 header，回傳 0）*/
function detectHeaderIndex(rows){
  const known = ['名稱','工作室','類型','網址','地點','金額','圖片','照片','img','圖'];
  for(let i=0;i<rows.length;i++){
    const row = rows[i].map(c => (c||'').toString().trim());
    if(row.some(cell => known.includes(cell))) return i;
    const nonEmpty = row.filter(c => c !== '').length;
    if(nonEmpty >=2 && row.length >=2) return i;
  }
  return 0;
}

/* 依類型分組 */
function groupByType(header, data){
  const typeKey = header.find(h => /類型|type/i.test(h)) || header[0];
  const groups = {};
  data.forEach(item => {
    const t = (item[typeKey] || '其他').toString().trim() || '其他';
    if(!groups[t]) groups[t] = [];
    groups[t].push(item);
  });
  return {groups, typeKey};
}

/* 偵測圖片欄位 */
function detectImageField(header){
  const keys = header.map(h => (h||'').toString().trim().toLowerCase());
  const prefer=['圖片','照片','img','image','圖','圖片網址','image_url'];
  for(const p of prefer){
    const idx = keys.findIndex(k=>k === p || k.includes(p));
    if(idx !== -1) return header[idx];
  }
  const matchUrl = keys.find(k => k.includes('網址') || k.includes('url') || k.includes('link'));
  return matchUrl ? header[keys.indexOf(matchUrl)] : null;
}

/* Grid（每類型顯示最多 9 筆）*/
function renderGridGrouped(cached){
  const out = document.getElementById('out');
  out.innerHTML = '';
  const {groups} = groupByType(cached.header, cached.data);
  const imageField = detectImageField(cached.header);
  Object.keys(groups).forEach(type => {
    const items = groups[type].slice(0,9);
    let html = '<div class="group">';
    html += '<h3>' + escapeHtml(type) + '</h3>';
    html += '<div class="grid">';
    items.forEach(row => {
      const title = row[ cached.header.find(h=>/名稱|title|name/i.test(h)) || cached.header[0] ] || '';
      const rawImg = row[imageField] || row['圖片'] || row['照片'] || row['img'] || row['網址'] || '';
      const imgUrl = makeSafeUrl(rawImg);
      html += '<div class="grid-item">';
      if(imgUrl){
        html += '<a href="'+escapeHtml(imgUrl)+'" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">';
        html += '<div class="grid-img" style="background-image:url('+escapeHtml(imgUrl)+')"></div>';
        html += '<div class="grid-caption">'+escapeHtml(title)+'</div></a>';
      } else {
        html += '<div class="placeholder">無圖片</div>';
        html += '<div class="grid-caption">'+escapeHtml(title)+'</div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
    out.insertAdjacentHTML('beforeend', html);
  });
}

/* List（每類型以表格顯示所有資料）*/
function renderListGrouped(cached){
  const out = document.getElementById('out');
  out.innerHTML = '';
  const {groups} = groupByType(cached.header, cached.data);
  const template = document.getElementById('csvTemplate').value.trim();
  Object.keys(groups).forEach(type => {
    const items = groups[type];
    let html = '<div class="group">';
    html += '<h3>' + escapeHtml(type) + '</h3>';
    html += '<div class="table-wrap"><table><thead><tr>';
    const want = ['類型','工作室','名稱','是否有NPC','人數','時間','金額','網址','地點','評論'];
    const present = want.filter(h => cached.header.includes(h));
    const useFields = present.length ? present : cached.header.slice(0, Math.min(10, cached.header.length));
    useFields.forEach(f=>{
      const cls = (f==='類型' ? 'col-type' : f==='工作室' ? 'col-studio' : f==='名稱' ? 'col-name' : f==='時間' ? 'col-time' : f==='金額' ? 'col-price' : '');
      html += `<th class="${cls}">${escapeHtml(f)}</th>`;
    });
    html += '</tr></thead><tbody>';
    items.forEach((row, rowIdx)=>{
      html += '<tr>';
      useFields.forEach((f, colIdx)=>{
        const raw = (row[f] || '').toString().trim();
        let cellHtml = '';
        if(/網址/i.test(f) && /^[0-9]+$/.test(raw)){
          const link = buildUrlFromTemplate(template, raw);
          cellHtml = `<div class="link-cell"><a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(raw)}</a></div>`;
        } else if(isUrlLike(raw)){
          const safe = makeSafeUrl(raw);
          const displayText = raw.length>60 ? raw.slice(0,56)+'…' : raw;
          cellHtml = `<div class="link-cell"><a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${escapeHtml(displayText)}</a></div>`;
        } else if(['地點','評論','網址'].includes(f) || raw.length > 120){
          const id = `cell_${escapeHtml(type)}_${rowIdx}_${colIdx}`.replace(/[^a-zA-Z0-9_\-]/g,'_');
          const safeText = escapeHtml(raw).replace(/\n/g,'<br>');
          if(raw.length > 120){
            const short = escapeHtml(raw.slice(0,120)) + '…';
            cellHtml = `<div id="${id}" class="truncate">${short}</div><span class="more-btn" data-target="${id}">更多</span>`;
          } else {
            cellHtml = `<div class="truncate">${safeText}</div>`;
          }
        } else {
          cellHtml = `<div class="small-text">${escapeHtml(raw)}</div>`;
        }
        html += `<td>${cellHtml}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    out.insertAdjacentHTML('beforeend', html);
  });

  // 綁定更多按鈕（收合/展開）
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
