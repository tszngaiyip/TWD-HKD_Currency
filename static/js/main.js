let currentPeriod = 7;
let eventSource = null; // SSE連接
let currentFromCurrency = 'TWD';
let currentToCurrency = 'HKD';
let isSwapping = false; // 防止交換時重複觸發事件
let isChartLoading = false; // 統一的圖表載入狀態

let pendingFromCurrency = null; // 待確認的來源貨幣
let pendingToCurrency = null; // 待確認的目標貨幣

// 頁面載入時自動載入圖表和最新匯率
document.addEventListener('DOMContentLoaded', function () {
  loadChart(currentPeriod);
  loadLatestRate();

  // 建立SSE連接
  setupSSEConnection();

  // 綁定貨幣選擇器事件
  setupCurrencySelectors();

  // 手動更新初始顯示
  updateCurrencyDisplay('from-currency');
  updateCurrencyDisplay('to-currency');
});

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

  try {
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
  } finally {
    setTimeout(() => {
      isSwapping = false;
    }, 100);
  }
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

// 更新顯示內容
function updateDisplay() {
  // 更新最新匯率區塊標題
  const rateHeader = document.querySelector('.latest-rate-header h3');
  if (rateHeader) {
    rateHeader.textContent = `💰 最新匯率 (${currentFromCurrency} ⇒ ${currentToCurrency})`;
  }

  // 載入新選擇的圖表
  loadChart(currentPeriod);
}

// 期間按鈕點擊事件
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    if (this.disabled) return;

    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    currentPeriod = parseInt(this.dataset.period);
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
  if (isChartLoading) {
    console.log('🔄 正在載入圖表中，跳過重複請求');
    return;
  }

  isChartLoading = true;
  updateInteractionStates();

  const chartContainer = document.getElementById('chart-container');
  const loadingMessage = `正在查詢 ${currentFromCurrency} ⇒ ${currentToCurrency} 匯率數據...`;

  chartContainer.innerHTML = `
        <div class="chart-loading">
            <div class="loading-spinner">
                <div class="loading-text">${loadingMessage}</div>
            </div>
        </div>
    `;

  const params = new URLSearchParams({
    period: period,
    from_currency: currentFromCurrency,
    to_currency: currentToCurrency
  });

  fetch(`/api/chart?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        chartContainer.innerHTML = `
                    <div class="chart-error">
                        <div class="error-icon">❌</div>
                        <h4>載入失敗</h4>
                        <p>${data.error}</p>
                    </div>
                `;
        return;
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
    })
    .catch(error => {
      chartContainer.innerHTML = `
                <div class="chart-error">
                    <div class="error-icon">⚠️</div>
                    <h4>連接錯誤</h4>
                    <p>載入圖表時發生錯誤: ${error.message}</p>
                </div>
            `;
    })
    .finally(() => {
      isChartLoading = false;
      updateInteractionStates();
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