// Filename: js/csv-parser.js
// 此檔包含 CSV 解析與小型工具函式，皆以繁體中文註解。
// 函式採全域綁定以簡化後續引用（不使用 module/import）。

/* 解析 CSV（支援雙引號與換行）*/
function parseCSV(text){
  const rows=[];
  let cur='', col=[], inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(inQuotes){
      if(ch === '"'){ if(text[i+1] === '"'){ cur += '"'; i++; } else inQuotes=false; } else cur += ch;
    } else {
      if(ch === '"'){ inQuotes=true; }
      else if(ch === ','){ col.push(cur); cur=''; }
      else if(ch === '\r'){ continue; }
      else if(ch === '\n'){ col.push(cur); rows.push(col); col=[]; cur=''; }
      else cur += ch;
    }
  }
  if(cur !== '' || col.length){ col.push(cur); rows.push(col); }
  return rows;
}

/* HTML 轉義（避免 XSS） */
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* 將原始欄位嘗試轉成可點的 URL（簡易）*/
function makeSafeUrl(raw){
  if(!raw) return '';
  let s = raw.toString().trim();
  const m = s.match(/https?:\/\/[^\s'")]+/i);
  if(m) s = m[0];
  if(/^\/\//.test(s)) s = window.location.protocol + s;
  if(!/^https?:\/\//i.test(s) && /^[\w.-]+\.[\w.-]+/.test(s)) s = 'https://' + s;
  return s;
}

/* 判斷字串是否像圖片 URL */
function isUrlLike(val){
  if(!val) return false;
  const s = val.toString().trim();
  if(/^data:image\//i.test(s)) return true;
  if(/^https?:\/\//i.test(s)) return true;
  if(/^www\./i.test(s)) return true;
  if(/\.(jpg|jpeg|png|gif|webp|svg)(?:\?|$)/i.test(s)) return true;
  return false;
}
