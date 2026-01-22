// filename: js/schedule-mobile.js
// 手機/平板強制覆蓋版：提高權重、加 !important，確保生效
(function injectScheduleMobileStyles() {
  const id = 'schedule-mobile-style';
  const old = document.getElementById(id);
  if (old) old.remove();

  const style = document.createElement('style');
  style.id = id;

  style.textContent = `
    @media (max-width: 768px) {

      /* 卡片兩欄：左時間 + 右內容 */
      .schedule-item{
        display: grid !important;
        grid-template-columns: 84px 1fr !important;
        gap: 12px !important;
        padding: 10px !important;
        border-radius: 12px !important;
        align-items: stretch !important;
      }

      /* topbar 跨兩欄 */
      .schedule-topbar{
        grid-column: 1 / -1 !important;
        justify-content: flex-end !important;
      }

      /* 左側時間欄 */
      .schedule-time-section{
        border-radius: 10px !important;
        padding: 8px 6px !important;
        align-self: stretch !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: #2563eb !important;
        color: #fff !important;
      }

      /* ? / ？：紅色 */
      .schedule-time-section.has-plus{
        background: #ef4444 !important;
        color: #fff !important;
      }

      /* @ / ＠：灰色 */
      .schedule-time-section.has-at{
        background: #9ca3af !important;
        color: #fff !important;
      }

      .schedule-time{
        font-size: 14px !important;
        font-weight: 700 !important;
      }

      /* 右側內容：上下排列（文字在上、圖片在下） */
      .schedule-content-section{
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        align-items: stretch !important;

        /* 重要：打掉 styles.css 的 padding:20px（不然看起來更擠） */
        padding: 0 !important;
      }

      .schedule-info{
        order: 1 !important;
        gap: 4px !important;
        min-width: 0 !important;
      }

      .schedule-media{
        order: 2 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        min-width: 0 !important;
        width: 100% !important;
        max-width: none !important;
        align-items: stretch !important;
      }

      /* ========= 關鍵修正：徹底解除 styles.css 的 80x80 縮圖 ========= */
      .schedule-image{
        flex: 0 0 auto !important;   /* 打掉 flex:0 0 80px */
        width: 100% !important;
        height: auto !important;     /* 打掉 height:80px */
        max-height: none !important;
        min-width: 0 !important;
      }

      /* 圖片框：4:3（你要的比較高），且一定要「用 auto height 才會撐起來」 */
      .schedule-item .schedule-content-section .schedule-image{
        width: 100% !important;
        aspect-ratio: 4 / 3 !important;
        height: auto !important;     /* 再保險一次，避免被其他規則設死 */
        border-radius: 12px !important;
        overflow: hidden !important;
        position: relative !important;
        background: #f3f4f6 !important;
      }

      /* 手機不需要 blur 背景層（避免誤判/干擾） */
      .schedule-item .schedule-content-section .schedule-image .img-bg{
        display: none !important;
      }

      /* 圖片本體：滿版（接近你第一張） */
      .schedule-item .schedule-content-section .schedule-image img,
      .schedule-item .schedule-content-section .schedule-image img.img-fg{
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        object-position: center center !important;
        display: block !important;
        max-width: none !important;
        max-height: none !important;
      }

      /* 圖片下方按鈕列 */
      .schedule-actions{
        display: flex !important;
        gap: 10px !important;
        justify-content: flex-start !important;
        padding-left: 2px !important;
      }

      /* 字級/換行 */
      .schedule-type     { font-size: 12px !important; }
      .schedule-name     { font-size: 16px !important; line-height: 1.35 !important; }
      .schedule-location { font-size: 13px !important; line-height: 1.4 !important; }
      .schedule-price    { font-size: 15px !important; }
      .schedule-note     { font-size: 13px !important; }

      .schedule-name,
      .schedule-location,
      .schedule-note{
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
    }
  `;

  document.head.appendChild(style);
})();
