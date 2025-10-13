// filename: js/schedule-mobile.js
// 手機/平板強制覆蓋版：提高權重、加 !important，確保生效
(function injectScheduleMobileStyles() {
    const id = 'schedule-mobile-style';
    const old = document.getElementById(id);
    if (old) old.remove();                  // 確保不是舊的快取樣式
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      /* 手機與小平板：統一用 768px 比較保守 */
      @media (max-width: 768px) {
        /* 卡片兩欄 → 左時間 + 右內容 */
        .schedule-item { 
          grid-template-columns: 64px 1fr !important; 
          padding: 10px !important; 
          border-radius: 12px !important;
        }
  
        /* 時間欄維持你的藍/紅底規則（已在 view-schedule.js 寫好） */
        .schedule-time-section { 
          border-radius: 10px !important; 
          padding: 8px 6px !important; 
        }
        .schedule-time { 
          font-size: 14px !important; 
          font-weight: 700 !important; 
        }
  
        /* 右側內容：強制上下排列（先文字，後圖片） */
        .schedule-content-section {
          display: grid !important;
          grid-template-columns: 1fr !important;
          grid-template-rows: auto auto !important;
          gap: 10px !important;
          align-items: start !important;
        }
        .schedule-info  { order: 1 !important; gap: 4px !important; min-width: 0 !important; }
        .schedule-image { 
          order: 2 !important; 
          width: 100% !important; 
          aspect-ratio: 16 / 9 !important;   /* 要正方形改成 1 / 1 */
          border-radius: 10px !important; 
          margin-top: 2px !important;
        }
        .schedule-image img { object-fit: cover !important; }
  
        /* 字級/換行優化，避免中文一字一行 */
        .schedule-type      { font-size: 12px !important; }
        .schedule-name      { font-size: 16px !important; line-height: 1.35 !important; }
        .schedule-location  { font-size: 13px !important; line-height: 1.4 !important; }
        .schedule-price     { font-size: 15px !important; }
        .schedule-note      { font-size: 13px !important; }
  
        .schedule-name,
        .schedule-location,
        .schedule-note {
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
  
        .schedule-layout { gap: 10px !important; }
        .schedule-legend { margin-top: 10px !important; font-size: 12px !important; }
      }
    `;
    document.head.appendChild(style);
  })();
  