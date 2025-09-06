// Filename: js/app.js
// 此檔為程式入口，管理狀態、事件綁定與載入流程。註解為繁體中文。

let cached = null;
let currentView = 'grid';

/* 將 CSV 文字解析後建立資料結構，並觸發渲染 */
function loadFromText(txt){
  const status = document.getElementById('status');
  const out = document.getElementById('out');
  out.innerHTML = ''; status.textContent = '解析中...';
  try{
    const rows = parseCSV(txt);
    if(!rows || rows.length < 1){ status.textContent='CSV 無法解析或為空'; return; }
    const headerIdx = detectHeaderIndex(rows);
    const header = (rows[headerIdx] || []).map(h => (h||'').toString().trim());
    const data = [];
    for(let r = headerIdx + 1; r < rows.length; r++){
      if(rows[r].every(c=>c===''||c==null)) continue;
      const obj = {};
      for(let c=0;c<header.length;c++) obj[ header[c] || ('col'+c) ] = rows[r][c] || '';
      data.push(obj);
    }
    if(data.length === 0){ status.textContent='解析完成，但找不到資料列'; return; }
    cached = {header, data};
    status.textContent = '載入完成，共 ' + data.length + ' 筆 (header row index=' + headerIdx + ')';
    renderCurrentView();
  }catch(e){
    console.error(e);
    document.getElementById('status').textContent = '解析錯誤（請看 Console）';
    // 若解析失敗，改以範例資料（data/sample.csv）
    fetch('data/sample.csv').then(r=>r.text()).then(t=>loadFromText(t)).catch(()=>{
      document.getElementById('status').textContent = '連續錯誤，請查看 Console';
    });
  }
}

/* 以範本與 gid 建立最終 URL（與原邏輯相容） */
function buildUrlFromTemplate(template, gid){
  if(!template) return '';
  let tpl = template.trim();
  if(tpl.indexOf('{gid}') !== -1) return tpl.replace(/\{gid\}/g, encodeURIComponent(gid));
  if(/[?&]gid=[^&]*/i.test(tpl)) return tpl.replace(/([?&]gid=)[^&]*/i, '$1' + encodeURIComponent(gid));
  return tpl + (tpl.indexOf('?') === -1 ? '?' : '&') + 'gid=' + encodeURIComponent(gid);
}

/* 從 URL 載入 CSV（若失敗則回落到本機範例）*/
async function loadFromUrlTemplate(force=false){
  const template = document.getElementById('csvTemplate').value.trim();
  const gid = document.getElementById('gidInput').value.trim();
  if(!template || !gid){
    document.getElementById('status').textContent = '請填入 template 與 gid';
    return;
  }
  const finalUrl = buildUrlFromTemplate(template, gid);
  document.getElementById('status').textContent = '從 URL 載入中...';
  try{
    const res = await fetch(finalUrl);
    if(!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    const txt = await res.text();
    if(txt.trim().toLowerCase().startsWith('<!doctype') || txt.toLowerCase().indexOf('<html') !== -1){
      throw new Error('回傳 HTML（可能需要登入或共用未開）');
    }
    loadFromText(txt);
  }catch(err){
    console.warn('載入失敗，fallback -> embedded', err);
    document.getElementById('status').textContent = '從 URL 載入失敗，顯示範例資料（Console 有錯誤）';
    // 以本機 data/sample.csv 做為範例資料
    try{
      const sample = await fetch('data/sample.csv');
      const txt = await sample.text();
      loadFromText(txt);
    }catch(e){
      console.error(e);
      document.getElementById('status').textContent = '載入範例資料失敗，請查看 Console';
    }
  }
}

/* 根據 currentView 決定顯示哪一種 */
function renderCurrentView(){
  if(!cached) return;
  if(currentView === 'grid') renderGridGrouped(cached);
  else renderListGrouped(cached);
}

/* UI 綁定 */
document.getElementById('openCsv').addEventListener('click', function(){
  const tpl = document.getElementById('csvTemplate').value;
  const gid = document.getElementById('gidInput').value;
  const url = buildUrlFromTemplate(tpl, gid);
  window.open(url, '_blank');
});
document.getElementById('loadBtn').addEventListener('click', function(){ loadFromUrlTemplate(false); });
document.getElementById('reloadBtn').addEventListener('click', function(){ loadFromUrlTemplate(true); });

document.getElementById('gridViewBtn').addEventListener('click', function(){
  currentView = 'grid';
  document.getElementById('gridViewBtn').classList.add('active');
  document.getElementById('listViewBtn').classList.remove('active');
  renderCurrentView();
});
document.getElementById('listViewBtn').addEventListener('click', function(){
  currentView = 'list';
  document.getElementById('listViewBtn').classList.add('active');
  document.getElementById('gridViewBtn').classList.remove('active');
  renderCurrentView();
});

/* 頁面載入時：若有 ?gid=... 自動載入，否則使用本機範例 */
window.addEventListener('DOMContentLoaded', function(){
  const qgid = (new URLSearchParams(window.location.search)).get('gid');
  if(qgid && qgid.trim() !== ''){
    document.getElementById('gidInput').value = qgid.trim();
    currentView = 'grid';
    loadFromUrlTemplate();
  } else {
    currentView = 'grid';
    // 載入本機範例（data/sample.csv）作為預設
    fetch('data/sample.csv').then(r=>r.text()).then(t=>loadFromText(t)).catch(()=>{
      document.getElementById('status').textContent = '載入範例資料失敗，請查看 Console';
    });
  }
});
