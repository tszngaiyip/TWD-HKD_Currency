let currentPeriod = 7;
let eventSource = null; // SSE連接
let currentFromCurrency = 'TWD';
let currentToCurrency = 'HKD';
let isSwapping = false; // 防止交換時重複觸發事件
let isSingleChartLoading = false; // 是否正在載入單一圖表

let pendingFromCurrency = null; // 待確認的來源貨幣
let pendingToCurrency = null; // 待確認的目標貨幣

// 多幣種查詢機制
let isLoadingAllCharts = false; // 是否正在載入所有圖表

// 非預設貨幣對的圖表緩存 - LRU機制
const MAX_CACHE_SIZE = 5; // 最多緩存5個貨幣對
let currencyPairCache = {}; // 格式: {'USD-EUR': {7: {chart: '...', stats: {...}}, 30: {...}}}
let cacheUsageOrder = []; // LRU使用順序，最新使用的在前面
let currentCacheKey = ''; // 當前緩存鍵值

// 圓形進度條管理器
class CircleProgressBar {
  constructor(options) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.r = options.r || 30; // 內圓半徑
    this.lineWidth = options.lineWidth || 6; // 邊框寬度
    this.lineColor = options.lineColor || '#2E86AB'; // 進度條顏色
    this.lineBgColor = options.lineBgColor || '#e9ecef'; // 背景顏色
    this.value = 0; // 當前進度值 (0-100)
    this.duration = options.duration || 1000; // 動畫時間
    this.showPercent = options.showPercent !== false; // 是否顯示百分比
    this.textColor = options.textColor || '#2E86AB'; // 文字顏色
    this.textFontSize = options.textFontSize || 12; // 文字大小

    // 處理高DPI螢幕，提升解析度
    const dpr = window.devicePixelRatio || 1;
    this.logicalSize = (this.r + this.lineWidth) * 2;

    // 設置Canvas的畫布大小（物理像素），乘以DPR
    this.canvas.width = this.logicalSize * dpr;
    this.canvas.height = this.logicalSize * dpr;

    // 設置Canvas的CSS顯示大小（邏輯像素）
    this.canvas.style.width = `${this.logicalSize}px`;
    this.canvas.style.height = `${this.logicalSize}px`;

    // 縮放繪圖上下文以匹配DPR，之後所有繪圖操作都會被縮放
    this.ctx.scale(dpr, dpr);

    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    // 使用邏輯大小進行計算
    const centerX = this.logicalSize / 2;
    const centerY = this.logicalSize / 2;

    // 清除畫布時也使用邏輯大小
    ctx.clearRect(0, 0, this.logicalSize, this.logicalSize);

    // 繪製背景圓環
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.r, 0, 2 * Math.PI);
    ctx.strokeStyle = this.lineBgColor;
    ctx.lineWidth = this.lineWidth;
    ctx.stroke();

    // 繪製進度圓環
    if (this.value > 0) {
      const startAngle = -Math.PI / 2; // 從頂部開始
      const endAngle = startAngle + (2 * Math.PI * this.value / 100);

      ctx.beginPath();
      ctx.arc(centerX, centerY, this.r, startAngle, endAngle);
      ctx.strokeStyle = this.lineColor;
      ctx.lineWidth = this.lineWidth;
      ctx.lineCap = 'round'; // 圓角端點
      ctx.stroke();
    }

    // 繪製百分比文字
    if (this.showPercent) {
      ctx.font = `${this.textFontSize}px Arial`;
      ctx.fillStyle = this.textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(this.value)}%`, centerX, centerY);
    }
  }

  animateTo(targetValue, onComplete = null) {
    const startValue = this.value;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / this.duration, 1);

      // 使用easeOutCubic緩動函數
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      this.value = startValue + (targetValue - startValue) * easeProgress;
      this.draw();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.value = targetValue;
        this.draw();
        if (onComplete) onComplete();
      }
    };

    animate();
  }

  setValue(value) {
    this.value = Math.max(0, Math.min(100, value));
    this.draw();
  }

  setColor(color) {
    this.lineColor = color;
    this.draw();
  }
}

// 圓形進度條實例管理
let circleProgressBars = {};

// 初始化圓形進度條
function initCircleProgressBars() {
  const periods = [7, 30, 90, 180];
  const colors = ['#2E86AB', '#A23B72', '#28a745', '#fd7e14']; // 不同顏色

  periods.forEach((period, index) => {
    const canvas = document.getElementById(`progress-canvas-${period}`);
    if (canvas) {
      circleProgressBars[period] = new CircleProgressBar({
        canvas: canvas,
        r: 25,
        lineWidth: 6,
        lineColor: colors[index],
        textFontSize: 10,
        duration: 800
      });
    }
  });
}

// 顯示圓形進度條
function showCircleProgress() {
  const periods = [7, 30, 90, 180];
  periods.forEach(period => {
    const progressItem = document.getElementById(`progress-item-${period}`);
    if (progressItem) {
      progressItem.classList.remove('hidden');
    }
  });

  // 重置所有進度條
  Object.values(circleProgressBars).forEach(bar => {
    bar.setValue(0);
  });
}

// 隱藏圓形進度條
function hideCircleProgress() {
  const periods = [7, 30, 90, 180];
  periods.forEach(period => {
    const progressItem = document.getElementById(`progress-item-${period}`);
    if (progressItem) {
      progressItem.classList.add('hidden');
    }
  });
}

// 更新特定期間的進度條
function updateCircleProgress(period, progress, color = null) {
  if (circleProgressBars[period]) {
    if (color) {
      circleProgressBars[period].setColor(color);
    }
    circleProgressBars[period].animateTo(progress);
  }
}

// 頁面載入時自動載入圖表和最新匯率
document.addEventListener('DOMContentLoaded', function () {
  loadChart(currentPeriod);
  loadLatestRate();

  // 初始化圓形進度條
  initCircleProgressBars();

  // 建立SSE連接
  setupSSEConnection();

  // 綁定貨幣選擇器事件
  setupCurrencySelectors();

  // 手動更新初始顯示
  updateCurrencyDisplay('from-currency');
  updateCurrencyDisplay('to-currency');
});

// 生成貨幣對緩存鍵值
function getCacheKey(fromCurrency, toCurrency) {
  return `${fromCurrency}-${toCurrency}`;
}

// 檢查緩存中是否有完整的貨幣對數據
function hasCachedData(cacheKey) {
  if (!currencyPairCache[cacheKey]) return false;

  const periods = [7, 30, 90, 180];
  return periods.every(period =>
    currencyPairCache[cacheKey][period] &&
    currencyPairCache[cacheKey][period].chart
  );
}

// 從緩存載入圖表
function loadFromCache(cacheKey, period) {
  const cachedData = currencyPairCache[cacheKey][period];
  if (!cachedData) return false;

  // 更新對應期間的圓形進度條為成功狀態（從緩存載入，只有非預設貨幣對）
  const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
  if (!isDefaultPair && circleProgressBars[period]) {
    updateCircleProgress(period, 100, '#28a745');
  }

  // 更新LRU使用順序
  updateCacheUsage(cacheKey);

  // 更新圖表顯示
  if (period === currentPeriod) {
    const chartContainer = document.getElementById('chart-container');
    chartContainer.innerHTML = `<img src="data:image/png;base64,${cachedData.chart}" alt="匯率走勢圖">`;

    // 更新統計信息
    if (cachedData.stats) {
      const precision = getPrecision(cachedData.stats.max_rate);
      document.getElementById('max-rate').textContent = cachedData.stats.max_rate.toFixed(precision);
      document.getElementById('min-rate').textContent = cachedData.stats.min_rate.toFixed(precision);
      document.getElementById('avg-rate').textContent = cachedData.stats.avg_rate.toFixed(precision);
      document.getElementById('data-points').textContent = cachedData.stats.data_points;
      document.getElementById('date-range').textContent = cachedData.stats.date_range;
      document.getElementById('stats').style.display = 'block';
    }
  }

  return true;
}

// 載入所有期間的圖表
function loadAllCharts() {
  if (isLoadingAllCharts) {
    console.log('🔄 正在載入圖表中，跳過重複請求');
    return;
  }

  isLoadingAllCharts = true;
  updateInteractionStates(); // 鎖定互動按鈕

  const cacheKey = getCacheKey(currentFromCurrency, currentToCurrency);

  // 檢查是否有緩存數據
  if (hasCachedData(cacheKey)) {
    const stats = getCacheStats();
    console.log(`📦 從緩存載入 ${currentFromCurrency} ⇒ ${currentToCurrency} 圖表`);
    console.log(`💾 緩存狀態: ${stats.totalPairs}/${stats.maxSize} 貨幣對, ${stats.totalCharts} 個圖表`);
    loadFromCache(cacheKey, currentPeriod);
    showSuccess(`已從緩存載入 ${currentFromCurrency} ⇒ ${currentToCurrency} 圖表！`);
    currentCacheKey = cacheKey;
    return;
  }

  // 檢查是否為預設貨幣對
  const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
  if (isDefaultPair) {
    showError('預設貨幣對緩存不完整，請點擊「🔄 重新生成所有圖表」按鈕');
    return;
  }

  currentCacheKey = cacheKey;

  const periods = [7, 30, 90, 180];
  const periodNames = { 7: '1週', 30: '1個月', 90: '3個月', 180: '6個月' };

  console.log(`🚀 並行載入所有期間的 ${currentFromCurrency} ⇒ ${currentToCurrency} 圖表...`);

  // 禁用所有期間按鈕，載入完成後分別解鎖
  disableAllPeriodButtons();

  // 顯示圓形進度條（只用於非緩存貨幣對的並行查詢）
  showCircleProgress();

  // 並行載入所有期間的圖表
  let completedCount = 0;
  let hasError = false;

  periods.forEach((period) => {
    // 重置並開始載入狀態
    circleProgressBars[period].setValue(0);  // 直接重置為0，避免倒退
    updateCircleProgress(period, 15, '#ffc107'); // 黃色表示載入中

    // 根據期間長短設置不同的載入速度（期間越長越慢，更真實）
    const getProgressConfig = (period) => {
      switch (period) {
        case 7: return { interval: 600, increment: 10 };  // 最快
        case 30: return { interval: 800, increment: 8 };   // 稍慢
        case 90: return { interval: 1000, increment: 6 };  // 更慢
        case 180: return { interval: 1200, increment: 4 };  // 最慢
        default: return { interval: 800, increment: 8 };
      }
    };

    const config = getProgressConfig(period);

    // 模擬進度更新（根據期間調整速度）
    const progressInterval = setInterval(() => {
      if (circleProgressBars[period] && circleProgressBars[period].value < 80) {
        const currentProgress = circleProgressBars[period].value;
        const randomIncrement = Math.random() * config.increment;
        updateCircleProgress(period, currentProgress + randomIncrement, '#ffc107');
      }
    }, config.interval);

    loadChartWithCallback(period, (success, error, chartData) => {
      clearInterval(progressInterval); // 停止模擬進度
      completedCount++;

      if (!success) {
        hasError = true;
        console.error(`❌ 載入近${period}天圖表失敗:`, error);
        updateCircleProgress(period, 100, '#dc3545'); // 紅色表示失敗
      } else {
        console.log(`✅ 載入近${period}天圖表成功`);
        updateCircleProgress(period, 100, '#28a745'); // 綠色表示成功

        // 將數據存入LRU緩存
        if (chartData) {
          addToCache(cacheKey, period, chartData);
        }
      }

      // 每個期間完成後立即解鎖對應的按鈕
      enablePeriodButton(period);

      // 如果所有圖表都已載入完成
      if (completedCount === periods.length) {
        isLoadingAllCharts = false;
        updateInteractionStates(); // 解鎖互動按鈕

        if (hasError) {
          showError('部分圖表載入失敗，請檢查網路連接');
        } else {
          const stats = getCacheStats();
          console.log(`💾 LRU緩存更新: ${stats.totalPairs}/${stats.maxSize} 貨幣對`);
          console.log(`📋 使用順序: [${stats.usageOrder.join(', ')}]`);
        }

        // 延遲隱藏進度條，讓用戶看到完成狀態
        setTimeout(() => {
          hideCircleProgress();
        }, 2000);
      }
    });
  });
}

// 顯示載入進度
function showLoadingProgress(periods, periodNames) {
  const progressContainer = document.createElement('div');
  progressContainer.id = 'chart-loading-progress';
  progressContainer.className = 'chart-loading-progress';
  progressContainer.innerHTML = `
        <div class="progress-header">
            <h4>🚀 正在載入 ${currentFromCurrency} ⇒ ${currentToCurrency} 圖表...</h4>
            <p>並行載入所有期間圖表，完成後將暫存於本地</p>
        </div>
        <div class="progress-main">
            <div class="progress-overview">
                <div class="progress-spinner-container">
                    <div class="progress-spinner">
                        <div></div>
                        <div></div>
                        <div></div>
                    </div>
                    <div class="progress-counter" id="progress-counter">0/${periods.length}</div>
                </div>
                <div class="progress-main-bar">
                    <div class="progress-bar-container">
                        <div class="progress-bar" id="main-progress-bar" style="width: 0%;"></div>
                    </div>
                    <div class="progress-percentage" id="main-progress-percentage">0%</div>
                </div>
                <div class="progress-main-text">正在並行載入多個期間的圖表...</div>
                <div class="progress-main-subtext">請稍候，預計需要 10-30 秒</div>
            </div>
        </div>
        <div class="progress-list">
            <h5>📋 詳細進度</h5>
            ${periods.map(period => `
                <div class="progress-item loading" id="progress-${period}">
                    <span class="progress-icon">⏳</span>
                    <span class="progress-text">近${periodNames[period]}圖表</span>
                    <span class="progress-status">載入中...</span>
                </div>
            `).join('')}
        </div>
    `;

  // 將進度顯示器插入到圖表容器前面
  const chartContainer = document.getElementById('chart-container');
  chartContainer.parentNode.insertBefore(progressContainer, chartContainer);
}

// 更新載入進度
function updateLoadingProgress(period, success, error = null) {
  const progressItem = document.getElementById(`progress-${period}`);
  if (!progressItem) return;

  const icon = progressItem.querySelector('.progress-icon');
  const status = progressItem.querySelector('.progress-status');

  // 移除載入中狀態
  progressItem.classList.remove('loading');

  if (success) {
    icon.textContent = '✅';
    status.textContent = '完成';
    progressItem.classList.add('success');
  } else {
    icon.textContent = '❌';
    status.textContent = error ? `失敗: ${error}` : '失敗';
    progressItem.classList.add('error');
  }

  // 更新總進度
  updateMainProgress();
}

// 更新主進度條
function updateMainProgress() {
  const progressItems = document.querySelectorAll('.progress-item');
  const completedItems = document.querySelectorAll('.progress-item.success, .progress-item.error');
  const successItems = document.querySelectorAll('.progress-item.success');

  if (progressItems.length === 0) return;

  const totalCount = progressItems.length;
  const completedCount = completedItems.length;
  const successCount = successItems.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);

  // 更新進度條
  const mainProgressBar = document.getElementById('main-progress-bar');
  const mainProgressPercentage = document.getElementById('main-progress-percentage');
  const progressCounter = document.getElementById('progress-counter');

  if (mainProgressBar) {
    mainProgressBar.style.width = `${progressPercentage}%`;
  }

  if (mainProgressPercentage) {
    mainProgressPercentage.textContent = `${progressPercentage}%`;
  }

  if (progressCounter) {
    progressCounter.textContent = `${completedCount}/${totalCount}`;
  }

  // 如果全部完成，顯示完成狀態
  if (completedCount === totalCount) {
    const mainText = document.querySelector('.progress-main-text');
    const mainSubtext = document.querySelector('.progress-main-subtext');

    if (mainText && mainSubtext) {
      if (successCount === totalCount) {
        mainText.textContent = '🎉 所有圖表載入完成！';
        mainSubtext.textContent = '圖表已暫存，下次載入將更快速';
        mainSubtext.style.color = '#28a745';
      } else {
        mainText.textContent = '⚠️ 部分圖表載入失敗';
        mainSubtext.textContent = `成功: ${successCount}，失敗: ${totalCount - successCount}`;
        mainSubtext.style.color = '#dc3545';
      }
    }
  }
}

// 隱藏載入進度
function hideLoadingProgress() {
  const progressContainer = document.getElementById('chart-loading-progress');
  if (progressContainer) {
    progressContainer.remove();
  }
}

// LRU緩存管理函數
function updateCacheUsage(cacheKey) {
  // 將指定的緩存鍵移到使用順序的最前面
  const index = cacheUsageOrder.indexOf(cacheKey);
  if (index > -1) {
    cacheUsageOrder.splice(index, 1);
  }
  cacheUsageOrder.unshift(cacheKey);

  console.log(`📈 更新緩存使用順序: [${cacheUsageOrder.join(', ')}]`);
}

function cleanupOldCache() {
  // 當緩存超過最大限制時，刪除最久沒用的貨幣對
  while (cacheUsageOrder.length > MAX_CACHE_SIZE) {
    const oldestKey = cacheUsageOrder.pop();
    if (currencyPairCache[oldestKey]) {
      delete currencyPairCache[oldestKey];
      console.log(`🗑️ LRU清理: 刪除最久未使用的緩存 "${oldestKey}"`);
    }
  }
}

function addToCache(cacheKey, period, chartData) {
  // 添加數據到緩存
  if (!currencyPairCache[cacheKey]) {
    currencyPairCache[cacheKey] = {};
  }
  currencyPairCache[cacheKey][period] = chartData;

  // 更新使用順序
  updateCacheUsage(cacheKey);

  // 清理超過限制的緩存
  cleanupOldCache();
}

function getCacheStats() {
  // 獲取緩存統計信息
  const totalPairs = Object.keys(currencyPairCache).length;
  const totalCharts = Object.values(currencyPairCache).reduce((sum, pair) => {
    return sum + Object.keys(pair).length;
  }, 0);

  return {
    totalPairs,
    totalCharts,
    usageOrder: [...cacheUsageOrder],
    maxSize: MAX_CACHE_SIZE
  };
}

// 清除所有緩存
function clearAllCache() {
  currencyPairCache = {};
  cacheUsageOrder = [];
  currentCacheKey = '';
  console.log('🗑️ 已清除所有貨幣對緩存');
}

// 帶回調的圖表載入函數
function loadChartWithCallback(period, callback) {
  const params = new URLSearchParams({
    period: period,
    from_currency: currentFromCurrency,
    to_currency: currentToCurrency
  });

  fetch(`/api/chart?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        callback(false, data.error, null);
        return;
      }

      // 準備緩存數據
      const chartData = {
        chart: data.chart,
        stats: data.stats,
        generated_at: data.generated_at || new Date().toISOString(),
        from_cache: false
      };

      // 如果這是當前選中的期間，更新顯示
      if (period === currentPeriod) {
        const chartContainer = document.getElementById('chart-container');
        chartContainer.innerHTML = `<img src="data:image/png;base64,${data.chart}" alt="匯率走勢圖">`;

        // 更新統計信息
        if (data.stats) {
          const precision = getPrecision(data.stats.max_rate);
          document.getElementById('max-rate').textContent = data.stats.max_rate.toFixed(precision);
          document.getElementById('min-rate').textContent = data.stats.min_rate.toFixed(precision);
          document.getElementById('avg-rate').textContent = data.stats.avg_rate.toFixed(precision);
          document.getElementById('data-points').textContent = data.stats.data_points;
          document.getElementById('date-range').textContent = data.stats.date_range;
          document.getElementById('stats').style.display = 'block';
        }
      }

      callback(true, null, chartData);
    })
    .catch(error => {
      callback(false, error.message, null);
    });
}

// 設置貨幣選擇器事件（統一搜索下拉選單）
function setupCurrencySelectors() {
  setupCurrencyCombobox('from-currency');
  setupCurrencyCombobox('to-currency');
  setupCurrencySwapButton();
}

function setupCurrencySwapButton() {
  const swapButton = document.querySelector('.exchange-arrow');
  swapButton.addEventListener('click', function () { // Use function to get 'this'
    // 添加點擊動畫效果
    this.style.transform = 'rotate(180deg)';
    setTimeout(() => {
      this.style.transform = '';
    }, 300);

    // 如果有任何一個下拉選單是開著的，就關閉它
    const openDropdown = document.querySelector('.currency-dropdown.open');
    if (openDropdown) {
      document.body.click();
    }

    // 交換前清除任何待確認的變更
    if (pendingFromCurrency !== null || pendingToCurrency !== null) {
      clearPendingChanges();
    }

    swapCurrencies();
  });
}

// 交換來源貨幣和目標貨幣
function swapCurrencies() {
  if (isSwapping) return;
  isSwapping = true;

  const fromSelect = document.getElementById('from-currency');
  const toSelect = document.getElementById('to-currency');
  const fromInput = document.getElementById('from-currency-input');
  const toInput = document.getElementById('to-currency-input');

  const fromValue = fromSelect.value;
  const toValue = toSelect.value;

  // 交換底層 select 的值
  fromSelect.value = toValue;
  toSelect.value = fromValue;

  // 更新全局貨幣狀態
  currentFromCurrency = fromSelect.value;
  currentToCurrency = toSelect.value;

  // 手動更新顯示的 input 值，確保與 select 同步
  const fromOption = fromSelect.options[fromSelect.selectedIndex];
  const toOption = toSelect.options[toSelect.selectedIndex];

  if (fromOption && fromInput) {
    fromInput.value = fromOption.textContent;
  }
  if (toOption && toInput) {
    toInput.value = toOption.textContent;
  }

  // 觸發後續更新
  updateDisplay();
  loadLatestRate();

  setTimeout(() => {
    isSwapping = false;
  }, 100);
}

// 設置單個貨幣組合框（統一搜索下拉選單）
function setupCurrencyCombobox(selectId) {
  const wrapper = document.querySelector(`#${selectId}`).parentElement;
  const input = wrapper.querySelector('.currency-input');
  const dropdown = wrapper.querySelector('.currency-dropdown');
  const select = wrapper.querySelector('select');

  let allOptions = [];
  let filteredOptions = [];
  let highlightedIndex = -1;
  let isSearchMode = false;

  const getAllOptions = () => {
    return Array.from(select.options).map(option => ({
      value: option.value,
      text: option.textContent
    }));
  };

  const filterOptions = (searchTerm) => {
    return allOptions.filter(option =>
      option.text.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const createDropdownItems = (options) => {
    dropdown.innerHTML = '';
    const fragment = document.createDocumentFragment();

    // 使用當前實際值或待定值來決定哪個項目被選中
    const currentValue = (selectId === 'from-currency' && pendingFromCurrency) ? pendingFromCurrency :
      (selectId === 'to-currency' && pendingToCurrency) ? pendingToCurrency :
        select.value;

    options.forEach((option) => {
      const item = document.createElement('div');
      item.className = 'currency-dropdown-item';
      item.dataset.value = option.value;
      item.textContent = option.text;
      if (option.value === currentValue) {
        item.classList.add('selected');
      }
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectOption(option.value);
      });
      fragment.appendChild(item);
    });

    dropdown.appendChild(fragment);
  };

  const showDropdown = () => {
    allOptions = getAllOptions();
    filteredOptions = [...allOptions];
    createDropdownItems(filteredOptions);

    const selectedValue = (selectId === 'from-currency' && pendingFromCurrency) ? pendingFromCurrency :
      (selectId === 'to-currency' && pendingToCurrency) ? pendingToCurrency :
        select.value;

    const selectedItem = dropdown.querySelector(`[data-value="${selectedValue}"]`);
    if (selectedItem) {
      setTimeout(() => {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }, 0);
    }

    dropdown.classList.add('open');
    highlightedIndex = filteredOptions.findIndex(o => o.value === selectedValue);
  };

  const hideDropdown = () => {
    dropdown.classList.remove('open');
    exitSearchMode();
  };

  const highlightItem = (index) => {
    const items = dropdown.querySelectorAll('.currency-dropdown-item');
    const currentHighlighted = dropdown.querySelector('.highlighted');
    if (currentHighlighted) {
      currentHighlighted.classList.remove('highlighted');
    }
    if (items[index]) {
      items[index].classList.add('highlighted');
      items[index].scrollIntoView({ block: 'nearest' });
    }
    highlightedIndex = index;
  };

  const selectOption = (value) => {
    const selectedOption = allOptions.find(o => o.value === value);
    if (!selectedOption) return;

    // 更新 pending 值
    if (selectId === 'from-currency') {
      pendingFromCurrency = value;
    } else {
      pendingToCurrency = value;
    }

    // 更新輸入框顯示為待定選項
    input.value = selectedOption.text;

    // 顯示確認按鈕
    document.getElementById('confirm-currency-btn').style.display = 'block';
    updateInteractionStates();

    hideDropdown();
  };

  const updateInputDisplay = () => {
    const pendingValue = selectId === 'from-currency' ? pendingFromCurrency : pendingToCurrency;
    const finalValue = pendingValue || select.value;
    const selectedOption = allOptions.length > 0 ? allOptions.find(o => o.value === finalValue) : Array.from(select.options).find(o => o.value === finalValue);

    if (selectedOption) {
      input.value = selectedOption.text;
    }
  };

  const enterSearchMode = () => {
    if (isSearchMode) return;
    isSearchMode = true;
    input.value = '';
    input.removeAttribute('readonly');
    input.focus();
    showDropdown();
    filteredOptions = filterOptions(''); // reset filter
    createDropdownItems(filteredOptions);
  };

  const exitSearchMode = () => {
    if (!isSearchMode) return;
    isSearchMode = false;
    input.setAttribute('readonly', true);
    updateInputDisplay();
  };

  input.addEventListener('input', () => {
    if (isSearchMode) {
      filteredOptions = filterOptions(input.value);
      createDropdownItems(filteredOptions);
    }
  });

  input.addEventListener('keydown', (e) => {
    const items = Array.from(dropdown.querySelectorAll('div'));
    const highlighted = dropdown.querySelector('.highlighted');
    let currentIndex = items.indexOf(highlighted);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (currentIndex < items.length - 1) {
          highlightItem(currentIndex + 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (currentIndex > 0) {
          highlightItem(currentIndex - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (highlighted) {
          selectOption(highlighted.dataset.value);
        }
        break;
      case 'Escape':
        exitSearchMode();
        input.blur(); // 失去焦點
        break;
    }
  });

  const wrapperClickHandler = (e) => {
    if (!wrapper.contains(e.target)) {
      hideDropdown();
    }
  };

  input.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) {
      hideDropdown();
    } else {
      // 關閉其他所有已開啟的下拉選單
      document.querySelectorAll('.currency-dropdown.open').forEach(d => {
        // 觸發一個全局點擊來正確關閉它們
        document.body.click();
      });
      enterSearchMode();
    }
  });

  wrapper.querySelector('.currency-dropdown-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    input.click();
  });

  // 新增：初始化時更新顯示
  allOptions = getAllOptions();
  updateInputDisplay();
}

// 新增：設定互動按鈕的鎖定狀態
function updateInteractionStates() {
  const swapButton = document.querySelector('.exchange-arrow');
  const confirmBtn = document.getElementById('confirm-currency-btn');

  const isLoading = isLoadingAllCharts || isSingleChartLoading;
  const hasPendingChanges = pendingFromCurrency !== null || pendingToCurrency !== null;

  // --- Swap Button State ---
  const isSwapLocked = isLoading || hasPendingChanges;
  if (swapButton) {
    swapButton.style.opacity = isSwapLocked ? '0.5' : '1';
    swapButton.style.cursor = isSwapLocked ? 'not-allowed' : 'pointer';
    swapButton.style.pointerEvents = isSwapLocked ? 'none' : 'auto';
    if (isLoading) {
      swapButton.title = '正在載入圖表，請稍候...';
    } else if (hasPendingChanges) {
      swapButton.title = '請先確認變更';
    } else {
      swapButton.title = '點擊交換貨幣';
    }
  }

  // --- Confirm Button State ---
  // The button is only visible when hasPendingChanges is true.
  // So we only need to lock it based on loading state.
  if (confirmBtn) {
    confirmBtn.disabled = isLoading;
    confirmBtn.style.opacity = isLoading ? '0.5' : '1';
    confirmBtn.style.cursor = isLoading ? 'not-allowed' : 'pointer';
    confirmBtn.style.pointerEvents = isLoading ? 'none' : 'auto';
  }
}

// 設定全域確認按鈕
function setupCurrencyConfirmation() {
  const confirmButton = document.getElementById('currency-confirm-button');
  const fromSelectWrapper = document.getElementById('from-currency-select');
  const toSelectWrapper = document.getElementById('to-currency-select');
  confirmButton.addEventListener('click', () => {
    // This check is now handled by the UI state, but keeping it is safer
    if (isLoadingAllCharts || isSingleChartLoading) {
      showError('正在載入圖表，請稍候...');
      return;
    }

    let changed = false;
    if (pendingFromCurrency !== null) {
      currentFromCurrency = pendingFromCurrency;
      document.getElementById('from-currency').value = pendingFromCurrency;
      changed = true;
    }
    if (pendingToCurrency !== null) {
      currentToCurrency = pendingToCurrency;
      document.getElementById('to-currency').value = pendingToCurrency;
      changed = true;
    }

    if (changed) {
      updateDisplay();
    }

    clearPendingChanges();
  });
}

// 清除待定變更並隱藏按鈕
function clearPendingChanges() {
  pendingFromCurrency = null;
  pendingToCurrency = null;
  document.getElementById('confirm-currency-btn').style.display = 'none';
  // 更新顯示以反映取消
  updateCurrencyDisplay('from-currency');
  updateCurrencyDisplay('to-currency');
  updateInteractionStates();
}

// 更新貨幣顯示（統一函數名）
function updateCurrencyDisplay(selectId) {
  const input = document.getElementById(selectId + '-input');
  const select = document.getElementById(selectId);
  const selectedOption = select.options[select.selectedIndex];

  if (selectedOption && input) {
    input.value = selectedOption.textContent;
    input.setAttribute('readonly', 'readonly');
    input.placeholder = '點擊選擇或輸入搜索貨幣...';
  }
}

// 更新搜索輸入框顯示（保留原函數名以兼容）
function updateCurrencySearchDisplay(selectId) {
  updateCurrencyDisplay(selectId);
}

// 更新顯示內容
function updateDisplay() {
  // 更新最新匯率區塊標題
  const rateHeader = document.querySelector('.latest-rate-header h3');
  if (rateHeader) {
    rateHeader.textContent = `💰 最新匯率 (${currentFromCurrency} ⇒ ${currentToCurrency})`;
  }

  // 更新UI元素的可見性
  const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');

  // 更新緩存相關按鈕的可見性（只有預設貨幣對才顯示伺服器緩存按鈕）
  const cacheButtons = document.querySelectorAll('.status-btn');
  cacheButtons.forEach(btn => {
    if (btn.textContent.includes('緩存')) {
      btn.style.display = isDefaultPair ? 'inline-block' : 'none';
    }
  });

  // 期間按鈕始終可見，用戶可以隨時切換已完成的期間
  // 圓形進度條作為狀態指示器顯示各期間的載入狀態

  // 根據貨幣對類型決定載入策略
  if (!isDefaultPair) {
    // 非預設貨幣對：立即載入當前圖表，同時在背景載入所有其他週期的圖表
    loadChart(currentPeriod);
    loadAllCharts();
  } else {
    // 預設貨幣對：隱藏圓形進度條，啟用所有按鈕，直接載入當前期間的圖表
    hideCircleProgress();
    // 確保所有按鈕都是啟用狀態（清理之前並行載入的禁用狀態）
    [7, 30, 90, 180].forEach(period => enablePeriodButton(period));
    loadChart(currentPeriod);
  }
}

// 禁用所有期間按鈕的函數
function disableAllPeriodButtons() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.disabled = true;
  });
}

// 禁用特定期間按鈕的函數
function disablePeriodButton(period) {
  const btn = document.querySelector(`.period-btn[data-period="${period}"]`);
  if (btn) {
    btn.disabled = true;
  }
}

// 啟用特定期間按鈕的函數
function enablePeriodButton(period) {
  const btn = document.querySelector(`.period-btn[data-period="${period}"]`);
  if (btn) {
    btn.disabled = false;
  }
}

// 期間按鈕點擊事件
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    // 如果按鈕已被禁用，不處理點擊
    if (this.disabled) return;

    // 移除所有active類
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    // 添加active類到點擊的按鈕
    this.classList.add('active');

    currentPeriod = parseInt(this.dataset.period);

    // 智能載入邏輯：檢查各種緩存來源
    const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
    const cacheKey = getCacheKey(currentFromCurrency, currentToCurrency);

    // 1. 檢查LRU緩存（非預設貨幣對）
    if (!isDefaultPair && currencyPairCache[cacheKey] && currencyPairCache[cacheKey][currentPeriod]) {
      console.log(`📦 從LRU緩存載入 ${currentFromCurrency} ⇒ ${currentToCurrency} 近${currentPeriod}天圖表`);
      loadFromCache(cacheKey, currentPeriod);
      return;
    }

    // 2. 預設貨幣對或無緩存時，使用API載入
    loadChart(currentPeriod);
  });
});

function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

function loadChart(period) {
  const chartContainer = document.getElementById('chart-container');

  isSingleChartLoading = true;
  updateInteractionStates(); // 鎖定互動按鈕

  // 只禁用當前正在載入的期間按鈕，其他按鈕保持可用
  disablePeriodButton(period);

  // 添加載入指示器
  const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');

  // 期間按鈕載入邏輯：
  // - 預設貨幣對：從伺服器緩存載入，速度很快，不顯示圓形進度條
  // - 非預設貨幣對：從API查詢或LRU緩存載入，可能較慢，顯示圓形進度條
  const loadingMessage = isDefaultPair ?
    '正在從緩存載入圖表...' :
    `正在查詢 ${currentFromCurrency} ⇒ ${currentToCurrency} 匯率數據...`;

  chartContainer.innerHTML = `
        <div class="chart-loading">
            <div class="loading-spinner">
                <div class="loading-text">${loadingMessage}</div>
                <div class="progress-bar-container">
                    <div class="progress-bar" id="single-chart-progress" style="width: 0%;"></div>
                </div>
                <div class="progress-percentage" id="single-chart-percentage">載入中</div>
            </div>
        </div>
    `;

  const params = new URLSearchParams({
    period: period,
    from_currency: currentFromCurrency,
    to_currency: currentToCurrency
  });

  // 只有非預設貨幣對才更新圓形進度條（預設貨幣對從伺服器緩存快速載入）
  if (!isDefaultPair && circleProgressBars[period]) {
    circleProgressBars[period].setValue(0);
    updateCircleProgress(period, 10, '#ffc107'); // 黃色表示載入中
  }

  // 開始單個圖表載入的進度條動畫
  let progressValue = 0;
  const progressBar = document.getElementById('single-chart-progress');
  const progressPercentage = document.getElementById('single-chart-percentage');

  const progressAnimation = setInterval(() => {
    progressValue += Math.random() * 12;
    if (progressValue > 90) progressValue = 90; // 不要到100%，等實際完成

    if (progressBar) progressBar.style.width = `${progressValue}%`;
    // 圖表進度條文字保持顯示"載入中"，不顯示百分比

    // 同步更新圓形進度條（只有非預設貨幣對）
    if (!isDefaultPair && circleProgressBars[period] && progressValue > 10) {
      updateCircleProgress(period, progressValue, '#ffc107');
    }
  }, 800);

  fetch(`/api/chart?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      // 清除進度動畫
      clearInterval(progressAnimation);
      if (progressBar) progressBar.style.width = '100%';
      // 保持顯示"載入中"，不改為"100%"

      // 重新啟用當前期間按鈕
      enablePeriodButton(period);

      if (data.error) {
        // 更新圓形進度條為錯誤狀態（只有非預設貨幣對）
        if (!isDefaultPair && circleProgressBars[period]) {
          updateCircleProgress(period, 100, '#dc3545');
        }

        chartContainer.innerHTML = `
                    <div class="chart-error">
                        <div class="error-icon">❌</div>
                        <h4>載入失敗</h4>
                        <p>${data.error}</p>
                    </div>
                `;
        return;
      }

      // 更新圓形進度條為成功狀態（只有非預設貨幣對）
      if (!isDefaultPair && circleProgressBars[period]) {
        updateCircleProgress(period, 100, '#28a745');
      }

      // 顯示圖表
      chartContainer.innerHTML = `<img src="data:image/png;base64,${data.chart}" alt="匯率走勢圖">`;

      // 顯示統計信息
      if (data.stats) {
        const precision = getPrecision(data.stats.max_rate);
        document.getElementById('max-rate').textContent = data.stats.max_rate.toFixed(precision);
        document.getElementById('min-rate').textContent = data.stats.min_rate.toFixed(precision);
        document.getElementById('avg-rate').textContent = data.stats.avg_rate.toFixed(precision);
        document.getElementById('data-points').textContent = data.stats.data_points;
        document.getElementById('date-range').textContent = data.stats.date_range;
        document.getElementById('stats').style.display = 'block';
      }

      // 顯示詳細的緩存信息
      // 使用已經聲明的 isDefaultPair 變數
      const cacheStatus = data.from_cache ? '✅ 緩存' : '🔄 即時生成';
      const cacheReason = data.cache_reason || (isDefaultPair ? '未知原因' : '非預設貨幣對');
      const dataCount = data.data_count || 0;
    })
    .catch(error => {
      // 清除進度動畫
      clearInterval(progressAnimation);

      // 重新啟用當前期間按鈕
      enablePeriodButton(period);

      // 更新圓形進度條為錯誤狀態（只有非預設貨幣對）
      if (!isDefaultPair && circleProgressBars[period]) {
        updateCircleProgress(period, 100, '#dc3545');
      }

      chartContainer.innerHTML = `
                <div class="chart-error">
                    <div class="error-icon">⚠️</div>
                    <h4>連接錯誤</h4>
                    <p>載入圖表時發生錯誤: ${error.message}</p>
                </div>
            `;
    })
    .finally(() => {
      isSingleChartLoading = false;
      // 僅當並行載入也完成時才解鎖
      if (!isLoadingAllCharts) {
        updateInteractionStates();
      }
    });
}

// 根據數值大小決定顯示精度
function getPrecision(value) {
  if (value < 1) return 4;
  if (value < 10) return 3;
  if (value < 100) return 2;
  return 1;
}

// 載入最新匯率
function loadLatestRate() {
  const params = new URLSearchParams({
    from_currency: currentFromCurrency,
    to_currency: currentToCurrency
  });

  fetch(`/api/latest_rate?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        displayLatestRate(data.data);
      } else {
        showRateError(data.message);
      }
    })
    .catch(error => {
      showRateError('載入最新匯率時發生錯誤: ' + error.message);
    });
}

// 顯示最新匯率數據
function displayLatestRate(rateData) {
  const rateContent = document.getElementById('latest-rate-content');

  // 格式化日期
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // 格式化趨勢顯示
  const getTrendDisplay = (trend, trendValue) => {
    if (!trend || trend === 'stable') {
      return {
        icon: '➡️',
        text: '持平',
        class: 'stable'
      };
    } else if (trend === 'up') {
      return {
        icon: '📈',
        text: `上漲 ${trendValue.toFixed(4)}`,
        class: 'up'
      };
    } else {
      return {
        icon: '📉',
        text: `下跌 ${trendValue.toFixed(4)}`,
        class: 'down'
      };
    }
  };

  const trendInfo = getTrendDisplay(rateData.trend, rateData.trend_value);

  // 檢查全局變數是否有效
  if (!currentFromCurrency || !currentToCurrency) {
    console.error('❌ 全局貨幣變數為空', { currentFromCurrency, currentToCurrency });
    showRateError('貨幣設置錯誤，請重新載入頁面');
    return;
  }

  // 針對 TWD-HKD 使用 1/rate 顯示
  const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
  const displayRate = isDefaultPair ? (1 / rateData.rate) : rateData.rate;
  const rateLabel = isDefaultPair ?
    `1 ${currentToCurrency} = ? ${currentFromCurrency}` :
    `1 ${currentFromCurrency} = ? ${currentToCurrency}`;

  rateContent.innerHTML = `
        <div class="rate-display">
            <div class="rate-info">
                <div class="rate-date">📅 ${formatDate(rateData.date)}</div>
                <div class="rate-trend ${trendInfo.class}">
                    <span class="trend-icon">${trendInfo.icon}</span>
                    <span>${trendInfo.text}</span>
                </div>
            </div>

            <div class="rate-main">
                <div class="rate-value">${displayRate.toFixed(getPrecision(displayRate))}</div>
                <div class="rate-label">${rateLabel}</div>
            </div>

            <div class="rate-info">
                <div class="rate-date">🔄 最後更新</div>
                <div style="font-size: 0.8rem; color: #999;">
                    ${rateData.updated_time ? new Date(rateData.updated_time).toLocaleString('zh-TW') : '未知'}
                </div>
            </div>
        </div>
    `;
}

// 顯示匯率載入錯誤
function showRateError(message) {
  const rateContent = document.getElementById('latest-rate-content');
  rateContent.innerHTML = `
        <div class="rate-error">
            <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
            <div>載入失敗</div>
            <div style="font-size: 0.9rem; margin-top: 5px;">${message}</div>
        </div>
    `;
}

// Popup 相關函數
function showPopup(title, content) {
  document.getElementById('popup-title').textContent = title;
  document.getElementById('popup-body').innerHTML = content;
  document.getElementById('popup-overlay').style.display = 'flex';
}

function closePopup() {
  document.getElementById('popup-overlay').style.display = 'none';
}

// 按ESC鍵關閉popup
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closePopup();
  }
});

function checkDataStatus() {

  fetch('/api/data_status')
    .then(response => response.json())
    .then(data => {
      const statusContent = `
                <div style="text-align: left;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <div style="font-size: 3rem; margin-bottom: 10px;">📊</div>
                        <h4 style="color: #2E86AB; margin: 0;">數據庫狀態報告</h4>
                    </div>

                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <p style="margin: 8px 0;"><strong>📈 總記錄數：</strong><span style="color: #28a745; font-weight: bold;">${data.total_records} 筆</span></p>
                        <p style="margin: 8px 0;"><strong>📅 最早日期：</strong>${data.earliest_date || '無數據'}</p>
                        <p style="margin: 8px 0;"><strong>🗓️ 最新日期：</strong>${data.latest_date || '無數據'}</p>
                    </div>

                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; border-left: 4px solid #2E86AB;">
                        <p style="margin: 8px 0;"><strong>⏰ 檢查時間：</strong></p>
                        <p style="margin: 8px 0; font-family: monospace; color: #666;">${new Date(data.last_updated).toLocaleString('zh-TW')}</p>
                    </div>

                    ${data.total_records > 0 ? `
                    <div style="margin-top: 15px; text-align: center; color: #666; font-size: 0.9rem;">
                        數據涵蓋期間：${Math.round((new Date(data.latest_date) - new Date(data.earliest_date)) / (1000 * 60 * 60 * 24))} 天
                    </div>
                    ` : ''}
                </div>
            `;
      showPopup('📊 數據狀態', statusContent);
    })
    .catch(error => {
      const errorContent = `
                <div style="text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">❌</div>
                    <h4 style="color: #dc3545; margin-bottom: 15px;">檢查失敗</h4>
                    <p><strong>錯誤信息：</strong>${error.message}</p>
                    <p style="color: #666; font-size: 0.9rem; margin-top: 15px;">無法連接到數據庫服務</p>
                </div>
            `;
      showPopup('📊 數據狀態', errorContent);
    });
}

// SSE 相關函數
function setupSSEConnection() {
  if (eventSource) {
    eventSource.close();
  }

  console.log('🔗 建立SSE連接...');
  eventSource = new EventSource('/api/events');

  eventSource.onopen = function (event) {
    console.log('✅ SSE連接已建立');
  };

  eventSource.addEventListener('connected', function (event) {
    const data = JSON.parse(event.data);
    console.log('🔗 SSE連接確認:', data.message);
  });

  eventSource.addEventListener('rate_updated', function (event) {
    const data = JSON.parse(event.data);
    console.log('🔄 收到匯率更新事件:', data);

    // 自動刷新頁面內容
    autoRefreshContent(data);
  });

  eventSource.addEventListener('heartbeat', function (event) {
    // 心跳包，保持連接活躍
  });

  eventSource.onerror = function (event) {
    console.log('❌ SSE連接錯誤，5秒後重新連接...');
    eventSource.close();
    setTimeout(() => {
      setupSSEConnection();
    }, 5000);
  };

  // 頁面卸載時關閉連接
  window.addEventListener('beforeunload', function () {
    if (eventSource) {
      eventSource.close();
    }
  });
}

function autoRefreshContent(updateData) {
  console.log('🔄 收到服務器推送，自動刷新頁面內容...');

  // 顯示自動更新提示
  showAutoUpdateNotification(updateData);

  // 刷新圖表
  loadChart(currentPeriod);

  // 刷新最新匯率
  loadLatestRate();
}

function showAutoUpdateNotification(updateData) {
  const notification = document.getElementById('auto-update-notification');
  const messageElement = notification.querySelector('.notification-message');

  messageElement.innerHTML = `
        <strong>數據已自動更新！</strong><br>
        ${updateData.message}<br>
        最新匯率 (1 HKD): <strong>${updateData.rate.toFixed(4)} TWD</strong>
    `;

  notification.classList.add('show');

  // 3秒後開始淡出
  setTimeout(() => {
    notification.classList.remove('show');
  }, 5000);
}

// 添加CSS動畫樣式
if (!document.getElementById('auto-update-styles')) {
  const style = document.createElement('style');
  style.id = 'auto-update-styles';
  style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
  document.head.appendChild(style);
}

// 檢查緩存狀態
function checkCacheStatus() {
  fetch('/api/chart_cache_status')
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        displayCacheStatus(data);
      } else {
        showError('獲取緩存狀態失敗: ' + data.message);
      }
    })
    .catch(error => {
      showError('檢查緩存狀態時發生錯誤: ' + error.message);
    });
}

// 顯示緩存狀態
function displayCacheStatus(data) {
  const cacheInfo = data.cache_info;
  const summary = data.summary;

  let content = `
        <div class="cache-status-container">
            <div class="cache-summary">
                <h4>📊 緩存概況</h4>
                <div class="summary-grid">
                    <div class="summary-item">
                        <span class="label">總期間數:</span>
                        <span class="value">${summary.total_periods}</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">已緩存:</span>
                        <span class="value">${summary.total_cached}</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">有效緩存:</span>
                        <span class="value">${summary.valid_cached}</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">緩存效率:</span>
                        <span class="value">${summary.cache_efficiency}</span>
                    </div>
                </div>
            </div>

            <div class="cache-details">
                <h4>📋 詳細狀態</h4>
                <div class="cache-items">
    `;

  for (const [period, info] of Object.entries(cacheInfo)) {
    const statusIcon = info.is_valid ? '✅' : (info.cached ? '⚠️' : '❌');
    const statusText = info.is_valid ? '有效' : info.validity_reason;
    const ageText = info.cached ? `${info.cache_age_hours.toFixed(1)}小時前` : '-';

    content += `
            <div class="cache-item ${info.is_valid ? 'valid' : (info.cached ? 'invalid' : 'missing')}">
                <div class="cache-item-header">
                    <span class="cache-icon">${statusIcon}</span>
                    <span class="cache-period">${info.period_name}</span>
                    <span class="cache-status">${statusText}</span>
                </div>
                <div class="cache-item-details">
                    <div>數據點: ${info.data_count}</div>
                    <div>生成時間: ${ageText}</div>
                    <div class="cache-actions">
                        <button onclick="regenerateChart(${period})" class="btn-small">🔄 重新生成</button>
                        ${info.cached ? `<button onclick="clearCache(${period})" class="btn-small btn-danger">🗑️ 清除</button>` : ''}
                    </div>
                </div>
            </div>
        `;
  }

  content += `
                </div>
            </div>

            <div class="cache-global-actions">
                <button onclick="clearCache('all')" class="btn btn-danger">🗑️ 清除所有緩存</button>
                <button onclick="regenerateAllCharts()" class="btn btn-primary">🔄 重新生成所有圖表</button>
            </div>
        </div>

        <style>
            .cache-status-container { padding: 20px; }
            .cache-summary { margin-bottom: 20px; }
            .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px; }
            .summary-item { display: flex; justify-content: space-between; padding: 8px; background: #f5f5f5; border-radius: 4px; }
            .cache-items { space: 10px; }
            .cache-item { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
            .cache-item.valid { border-color: #4CAF50; background: #f8fff8; }
            .cache-item.invalid { border-color: #FF9800; background: #fff8f0; }
            .cache-item.missing { border-color: #f44336; background: #fff5f5; }
            .cache-item-header { display: flex; align-items: center; gap: 10px; font-weight: bold; }
            .cache-item-details { margin-top: 8px; font-size: 0.9rem; color: #666; }
            .cache-actions { margin-top: 8px; }
            .btn-small { padding: 4px 8px; font-size: 0.8rem; margin-right: 5px; border: none; border-radius: 3px; cursor: pointer; }
            .btn-danger { background: #f44336; color: white; }
            .cache-global-actions { margin-top: 20px; text-align: center; }
            .btn { padding: 10px 20px; margin: 0 5px; border: none; border-radius: 5px; cursor: pointer; }
            .btn-primary { background: #2196F3; color: white; }
        </style>
    `;

  showPopup('緩存狀態管理', content);
}

// 顯示快取分析功能
function showCacheAnalytics() {
  fetch('/api/cache_analytics')
    .then(response => {
      // 檢查回應狀態
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 檢查內容類型
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return response.text().then(text => {
          throw new Error(`伺服器回應非 JSON 格式，內容: ${text.substring(0, 200)}`);
        });
      }

      return response.json();
    })
    .then(data => {
      if (data.success) {
        const analytics = data.data.analytics;
        const content = `
                    <div style="text-align: left;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <div style="font-size: 3rem; margin-bottom: 10px;">📈</div>
                            <h4 style="color: #2E86AB; margin: 0;">快取性能分析</h4>
                        </div>

                        <!-- 性能指標 -->
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                            <h5 style="color: #495057; margin: 0 0 10px 0;">🚀 性能指標</h5>
                            <p style="margin: 5px 0;"><strong>API 命中率：</strong><span style="color: ${analytics.performance.api_hit_rate > 70 ? '#28a745' : '#ffc107'};">${analytics.performance.api_hit_rate.toFixed(1)}%</span></p>
                            <p style="margin: 5px 0;"><strong>圖表命中率：</strong><span style="color: ${analytics.performance.chart_hit_rate > 70 ? '#28a745' : '#ffc107'};">${analytics.performance.chart_hit_rate.toFixed(1)}%</span></p>
                            <p style="margin: 5px 0;"><strong>整體效率：</strong><span style="color: ${analytics.performance.overall_efficiency > 70 ? '#28a745' : '#ffc107'};">${analytics.performance.overall_efficiency.toFixed(1)}%</span></p>
                        </div>

                        <!-- 操作按鈕 -->
                        <div style="text-align: center; margin-top: 20px;">
                            <button onclick="optimizeCache()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin: 0 5px; cursor: pointer;">🔧 優化快取</button>
                            <button onclick="warmupCache()" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin: 0 5px; cursor: pointer;">🔥 預熱快取</button>
                        </div>
                    </div>
                `;
        showPopup('📈 快取性能分析', content);
      } else {
        throw new Error(data.message || '未知錯誤');
      }
    })
    .catch(error => {
      console.error('快取分析錯誤:', error);
      showMessage(`檢查緩存狀態時發生錯誤: ${error.message}`, 'error');
    });
}

// 優化快取功能
function optimizeCache() {
  fetch('/api/cache_optimize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        const result = data.data;
        let message = '快取優化完成！\n';
        message += `清理過期項目：API ${result.expired_cleaned.api} 項，圖表 ${result.expired_cleaned.chart} 項`;

        if (result.optimizations.length > 0) {
          message += '\n\n建議：\n' + result.optimizations.join('\n');
        }

        showMessage(message, 'success');
        setTimeout(() => showCacheAnalytics(), 1000);
      } else {
        showMessage(data.message, 'error');
      }
    })
    .catch(error => {
      showMessage(`優化快取失敗: ${error.message}`, 'error');
    });
}

// 預熱 TWD-HKD 快取功能
function warmupCache() {
  fetch('/api/cache_warmup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      periods: [7, 30, 90, 180]
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showMessage(data.message, 'success');
        setTimeout(() => showCacheAnalytics(), 2000);
      } else {
        showMessage(data.message, 'error');
      }
    })
    .catch(error => {
      showMessage(`預熱快取失敗: ${error.message}`, 'error');
    });
}