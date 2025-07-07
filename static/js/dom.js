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
export function updateGridStats(stats) {
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
  if (drEl) drEl.textContent = `數據範圍: ${stats.date_range}`;
}