/**
 * CSV 解析器與工具函式
 * 提供 CSV 解析、HTML 轉義、URL 處理等核心功能
 * 
 * @fileoverview CSV 解析與小型工具函式集合
 * @author 系統
 * @version 1.0.0
 */

'use strict';

/**
 * ===========================================
 * CSV 解析相關函式
 * ===========================================
 */

/**
 * 解析 CSV 文字內容
 * 支援雙引號包圍的欄位、換行符號、逗號分隔
 * 
 * @param {string} text - 要解析的 CSV 文字
 * @returns {Array<Array<string>>} 解析後的二維陣列，每個子陣列代表一行
 * 
 * @example
 * const csv = '姓名,年齡\n"張三",25\n李四,30';
 * const result = parseCSV(csv);
 * // 結果: [['姓名', '年齡'], ['張三', '25'], ['李四', '30']]
 */
function parseCSV(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const rows = [];
  let currentField = '';
  let currentRow = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (inQuotes) {
      // 處理引號內的內容
      if (char === '"') {
        // 檢查是否為雙引號轉義
        if (text[i + 1] === '"') {
          currentField += '"';
          i++; // 跳過下一個引號
        } else {
          inQuotes = false; // 結束引號
        }
      } else {
        currentField += char;
      }
    } else {
      // 處理引號外的內容
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        // 欄位分隔符
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        // 忽略回車符
        continue;
      } else if (char === '\n') {
        // 行分隔符
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // 處理最後一個欄位和行
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * ===========================================
 * HTML 安全相關函式
 * ===========================================
 */

/**
 * HTML 轉義函式，防止 XSS 攻擊
 * 將特殊字元轉換為 HTML 實體
 * 
 * @param {any} input - 要轉義的輸入值
 * @returns {string} 轉義後的安全字串
 * 
 * @example
 * escapeHtml('<script>alert("XSS")</script>');
 * // 結果: '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
 */
function escapeHtml(input) {
  if (input === null || input === undefined) {
    return '';
  }
  
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * ===========================================
 * URL 處理相關函式
 * ===========================================
 */

/**
 * 將原始字串轉換為安全的 URL
 * 自動補全協議、驗證格式
 * 
 * @param {any} raw - 原始 URL 字串
 * @returns {string} 處理後的安全 URL
 * 
 * @example
 * makeSafeUrl('www.example.com'); // 結果: 'https://www.example.com'
 * makeSafeUrl('//example.com');   // 結果: 'https://example.com'
 */
function makeSafeUrl(raw) {
  if (!raw) return '';
  
  let url = raw.toString().trim();
  if (!url) return '';

  // 提取 HTTP/HTTPS URL
  const httpMatch = url.match(/https?:\/\/[^\s'")]+/i);
  if (httpMatch) {
    url = httpMatch[0];
  }

  // 處理協議相對 URL
  if (/^\/\//.test(url)) {
    url = window.location.protocol + url;
  }

  // 為沒有協議的網址添加 https://
  if (!/^https?:\/\//i.test(url) && /^[\w.-]+\.[\w.-]+/.test(url)) {
    url = 'https://' + url;
  }

  return url;
}

/**
 * 判斷字串是否為 URL 格式
 * 支援多種 URL 格式和圖片檔案副檔名
 * 
 * @param {any} value - 要檢查的值
 * @returns {boolean} 是否為 URL 格式
 * 
 * @example
 * isUrlLike('https://example.com');     // true
 * isUrlLike('data:image/png;base64...'); // true
 * isUrlLike('image.jpg');               // true
 * isUrlLike('普通文字');                 // false
 */
function isUrlLike(value) {
  if (!value) return false;
  
  const str = value.toString().trim();
  if (!str) return false;

  // 檢查 data URL (base64 圖片)
  if (/^data:image\//i.test(str)) return true;
  
  // 檢查 HTTP/HTTPS URL
  if (/^https?:\/\//i.test(str)) return true;
  
  // 檢查 www 開頭的網址
  if (/^www\./i.test(str)) return true;
  
  // 檢查圖片檔案副檔名
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(str)) return true;
  
  return false;
}

/**
 * ===========================================
 * 全域函式匯出
 * ===========================================
 */

// 將函式綁定到全域物件，供其他檔案使用
window.parseCSV = parseCSV;
window.escapeHtml = escapeHtml;
window.makeSafeUrl = makeSafeUrl;
window.isUrlLike = isUrlLike;
