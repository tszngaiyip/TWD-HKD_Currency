// static/js/dom.js
import { getPrecision } from './chart.js';

export function showError(message) {
  const errorEl = document.getElementById('error-message');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

// 顯示最新匯率數據（固定4位小數）
export function displayLatestRate(data) {
  const rateEl = document.getElementById('latest-rate-content');
  if (!rateEl) return;
  // 日期格式化
  const formatDate = dateStr => new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  // 趨勢顯示
  const getTrendDisplay = (trend, trendValue) => {
    if (!trend || trend === 'stable') return { icon: '➡️', text: '不變', class: 'stable' };
    if (trend === 'up') return { icon: '📈', text: `漲價 ${trendValue.toFixed(4)}`, class: 'up' };
    return { icon: '📉', text: `降價 ${Math.abs(trendValue).toFixed(4)}`, class: 'down' };
  };
  const trendInfo = getTrendDisplay(data.trend, data.trend_value);
  const rateValue = data.rate;
  // TWD⇔HKD反算提示
  let hint = '';
  if (data.buy_currency === 'TWD' && data.sell_currency === 'HKD') {
    const inverted = 1 / data.rate;
    hint = `<span class="rate-hint">(${inverted.toFixed(4)})</span>`;
  }
  // 準備處理時間顯示
  const timingDisplay = data.processing_time ? 
    `<div class="rate-timing">⚡ 載入時間：${data.processing_time_ms}ms</div>` : '';

  rateEl.innerHTML = `
    <div class="rate-display">
      <div class="rate-info">
        <div class="rate-date">📅 ${formatDate(data.date)}</div>
        <div class="rate-trend ${trendInfo.class}">
          <span class="trend-icon">${trendInfo.icon}</span>
          <span>${trendInfo.text}</span>
        </div>
      </div>
      <div class="rate-main">
        <div class="rate-value">${rateValue.toFixed(4)}${hint}</div>
        <div class="rate-label">1 ${data.buy_currency} = ? ${data.sell_currency}</div>
      </div>
      <div class="rate-info">
        ${data.is_best
          ? `<div class="rate-best">目前匯率是近${data.best_period}天最低</div>`
          : `<div class="rate-lowest">近${data.lowest_period}天最低: ${data.lowest_rate.toFixed(4)}</div>`}
        ${timingDisplay}
      </div>
    </div>
  `;
}

// 顯示匯率載入錯誤（原始設計）
export function showRateError(message) {
  const rateEl = document.getElementById('latest-rate-content');
  if (!rateEl) return;
  rateEl.innerHTML = `
    <div class="rate-error">
      <div style="font-size:2rem;margin-bottom:10px;">⚠️</div>
      <div>載入失敗</div>
      <div style="font-size:0.9rem;margin-top:5px;">${message}</div>
    </div>
  `;
}

export function showPopup(title, content) {
  const popupOverlay = document.getElementById('popup-overlay');
  const popupTitle = document.getElementById('popup-title');
  const popupBody = document.getElementById('popup-body');
  
  if (popupOverlay && popupTitle && popupBody) {
    popupTitle.textContent = title;
    popupBody.innerHTML = content;
    popupOverlay.style.display = 'flex';
    
    // 添加淡入動畫效果
    setTimeout(() => {
      popupOverlay.classList.add('show');
    }, 10);
  }
}

export function closePopup() {
  const popupOverlay = document.getElementById('popup-overlay');
  
  if (popupOverlay) {
    popupOverlay.classList.remove('show');
    
    // 等待動畫完成後隱藏元素
    setTimeout(() => {
      popupOverlay.style.display = 'none';
    }, 300);
  }
}

// 更新圖表統計網格
export function updateGridStats(stats, processingTimeMs = null) {
  if (!stats) return;
  const maxEl = document.getElementById('maxRate');
  const minEl = document.getElementById('minRate');
  const avgEl = document.getElementById('avgRate');
  const dpEl = document.getElementById('dataPoints');
  const drEl = document.getElementById('dateRange');
  if (maxEl) maxEl.textContent = `最高匯率: ${stats.max_rate.toFixed(4)}`;
  if (minEl) minEl.textContent = `最低匯率: ${stats.min_rate.toFixed(4)}`;
  if (avgEl) avgEl.textContent = `平均匯率: ${stats.avg_rate.toFixed(4)}`;
  if (dpEl) dpEl.textContent = `數據點: ${stats.data_points}`;
  
  // 更新日期範圍，並在有處理時間時添加時間信息
  if (drEl) {
    let dateRangeText = `數據範圍: ${stats.date_range}`;
    if (processingTimeMs) {
      dateRangeText += ` (⚡${processingTimeMs}ms)`;
    }
    drEl.textContent = dateRangeText;
  }
}

// --- 全局進度條管理 (Refactored) ---

/**
 * 顯示並重置全局進度條。
 * @param {string} message - 要顯示的載入訊息。
 */
export function showGlobalProgressBar(message = '正在請求後端生成圖表...') {
  const spinner = document.getElementById('chartSpinner');
  if (!spinner) return;

  const chartImage = document.getElementById('chartImage');
  const errorDisplay = document.getElementById('chartErrorDisplay');
  const loadingMessageEl = document.getElementById('loadingMessage');
  const progressBarContainer = spinner.querySelector('.progress-bar-container');
  const progressBar = document.getElementById('progressBar');
  const progressPercentage = document.getElementById('progressPercentage');

  // 顯示 spinner，隱藏圖表和錯誤
  spinner.style.display = 'flex';
  if (chartImage) chartImage.style.display = 'none';
  if (errorDisplay) errorDisplay.style.display = 'none';
  
  // 設定載入訊息
  if (loadingMessageEl) loadingMessageEl.textContent = message;

  // 重置並顯示進度條
  if (progressBarContainer && progressBar && progressPercentage) {
    progressBarContainer.style.display = 'block';
    progressPercentage.style.display = 'block';
    progressBar.style.transition = 'width 0.2s linear'; // 平滑過渡
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0%';
  }
}

/**
 * 更新全局進度條的進度。
 * @param {number} progress - 進度百分比 (0-100)。
 * @param {string|null} message - (可選) 要更新的載入訊息。
 */
export function updateGlobalProgressBar(progress, message = null) {
  const progressBar = document.getElementById('progressBar');
  const progressPercentage = document.getElementById('progressPercentage');
  const loadingMessageEl = document.getElementById('loadingMessage');

  if (progressBar && progressPercentage) {
    const p = Math.max(0, Math.min(100, progress)); // 確保進度在 0-100 之間
    progressBar.style.width = `${p}%`;
    progressPercentage.textContent = `${Math.round(p)}%`;
  }
  
  if (message && loadingMessageEl) {
      loadingMessageEl.textContent = message;
  }
}

/**
 * 以動畫效果完成並隱藏全局進度條。
 * @param {Function} [callback] - (可選) 在進度條完全隱藏後執行的回呼函式。
 */
export function hideGlobalProgressBar(callback) {
  const spinner = document.getElementById('chartSpinner');
  if (!spinner || spinner.style.display === 'none') {
    if (callback) callback();
    return;
  }

  const progressBar = document.getElementById('progressBar');
  
  // 讓完成動畫更明顯
  updateGlobalProgressBar(100, '圖表載入完成！');

  setTimeout(() => {
      if (spinner) spinner.style.display = 'none';
      
      // 在隱藏後執行回呼
      if (callback) callback();

      // 重置進度條以備下次使用
      if (progressBar) {
          progressBar.style.transition = '';
          progressBar.style.width = '0%';
      }
  }, 500); // 延遲 500ms 隱藏
}