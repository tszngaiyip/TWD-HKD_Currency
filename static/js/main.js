let currentPeriod = 7;
let eventSource = null; // SSE連接
let currentFromCurrency = 'TWD';
let currentToCurrency = 'HKD';
let isSwapping = false; // 防止交換時重複觸發事件
let isChartLoading = false; // 統一的圖表載入狀態

let pendingFromCurrency = null; // 待確認的來源貨幣
let pendingToCurrency = null; // 待確認的目標貨幣

// 頁面載入時自動載入圖表和最新匯率
document.addEventListener('DOMContentLoaded', async function () {
  try {
    const response = await fetch('/api/server_status');
    if (!response.ok) {
      throw new Error(`Server status check failed: ${response.statusText}`);
    }
    const data = await response.json();
    const currentServerId = data.server_instance_id;
    const storedServerId = sessionStorage.getItem('serverInstanceId');

    if (currentServerId !== storedServerId) {
      // Server has restarted. Reset settings.
      console.log('伺服器已重啟，正在重設貨幣選擇。');
      sessionStorage.removeItem('fromCurrency');
      sessionStorage.removeItem('toCurrency');
      // Store the new server ID
      sessionStorage.setItem('serverInstanceId', currentServerId);
    }
  } catch (error) {
    console.error('檢查伺服器狀態失敗:', error);
    // If check fails, do not reset to preserve user selection in case of network issues
  }
  // 嘗試從 sessionStorage 讀取儲存的貨幣
  const savedFromCurrency = sessionStorage.getItem('fromCurrency');
  const savedToCurrency = sessionStorage.getItem('toCurrency');

  // 如果有儲存的值，則使用它們；否則使用預設值
  currentFromCurrency = savedFromCurrency || 'TWD';
  currentToCurrency = savedToCurrency || 'HKD';

  // 將最終的貨幣選擇儲存回 sessionStorage
  sessionStorage.setItem('fromCurrency', currentFromCurrency);
  sessionStorage.setItem('toCurrency', currentToCurrency);
  
  // 更新 select 元素的值
  document.getElementById('from-currency').value = currentFromCurrency;
  document.getElementById('to-currency').value = currentToCurrency;

  fetchChart(currentPeriod);
  loadLatestRate();

  // 建立SSE連接
  setupSSEConnection();

  // 綁定貨幣選擇器事件
  setupCurrencySelectors();

  // 手動更新初始顯示
  updateCurrencyDisplay('from-currency');
  updateCurrencyDisplay('to-currency');
  
  // 綁定確認按鈕事件
  setupConfirmButton();
});

// 更新互動狀態（載入時禁用/啟用按鈕等）
function updateInteractionStates() {
  const isLoading = isChartLoading;
  
  // 禁用/啟用期間按鈕
  const periodButtons = document.querySelectorAll('.period-btn');
  periodButtons.forEach(btn => {
    btn.disabled = isLoading;
  });
  
  // 禁用/啟用貨幣選擇器
  const currencyInputs = document.querySelectorAll('.currency-input');
  currencyInputs.forEach(input => {
    input.disabled = isLoading;
  });
  
  // 禁用/啟用交換按鈕
  const swapButton = document.querySelector('.exchange-arrow');
  if (swapButton) {
    swapButton.style.pointerEvents = isLoading ? 'none' : 'auto';
    swapButton.style.opacity = isLoading ? '0.5' : '1';
  }
  
  // 禁用/啟用狀態按鈕
  const statusButtons = document.querySelectorAll('.status-btn');
  statusButtons.forEach(btn => {
    btn.disabled = isLoading;
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

    // 將新狀態存入 sessionStorage
    sessionStorage.setItem('fromCurrency', currentFromCurrency);
    sessionStorage.setItem('toCurrency', currentToCurrency);

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
    // 新增：觸發圖表預生成
    triggerChartPregeneration(currentFromCurrency, currentToCurrency);
  } finally {
    setTimeout(() => {
      isSwapping = false;
    }, 100);
  }
}

// 觸發後端預生成所有期間圖表
function triggerChartPregeneration(fromCurrency, toCurrency) {
  console.log(`觸發後端預生成 ${fromCurrency}-${toCurrency} 圖表...`);
  fetch(`/api/pregenerate_charts?from_currency=${fromCurrency}&to_currency=${toCurrency}`)
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        console.log(`✅ 圖表預生成觸發成功: ${data.message}`);
      } else {
        console.error(`❌ 圖表預生成觸發失敗: ${data.message}`);
      }
    })
    .catch(error => {
      console.error('觸發圖表預生成時發生錯誤:', error);
    });
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
  fetchChart(currentPeriod);
}

// 期間按鈕點擊事件
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    if (this.disabled) return;

    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    currentPeriod = parseInt(this.dataset.period);
    fetchChart(currentPeriod);
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

function fetchChart(period) {
    console.log(`請求圖表，期間: ${period} 天`);
    const chartImage = document.getElementById('chartImage');
    const chartSpinner = document.getElementById('chartSpinner');
    const statsContainer = document.getElementById('statsContainer');

    // 顯示加載動畫，隱藏舊圖表和統計信息
    chartSpinner.style.display = 'block';
    chartImage.style.display = 'none';
    statsContainer.style.display = 'none';
    
    // 從全局變數獲取當前貨幣對
    const fromCurrency = currentFromCurrency;
    const toCurrency = currentToCurrency;

    // 發起 API 請求
    fetch(`/api/chart?period=${period}&from_currency=${fromCurrency}&to_currency=${toCurrency}`)
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { 
                    throw new Error(err.error || '伺服器錯誤');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.chart_url) {
                // 使用返回的 URL，並添加時間戳以避免快取問題
                const uniqueUrl = data.chart_url + '?t=' + new Date().getTime();
                chartImage.src = uniqueUrl;
                chartImage.style.display = 'block';

                // 更新統計數據
                if (data.stats) {
                    updateStats(data.stats);
                    statsContainer.style.display = 'block';
                }
            } else if (data.no_data) {
                handleChartError('數據不足，無法生成圖表。');
            } else {
                handleChartError(data.error || '無法載入圖表，請稍後再試。');
            }
        })
        .catch(error => {
            console.error('獲取圖表時出錯:', error);
            handleChartError(`獲取圖表失敗: ${error.message}`);
        })
        .finally(() => {
            // 隱藏加載動畫
            chartSpinner.style.display = 'none';
        });
}

function handleChartError(message) {
    const chartImage = document.getElementById('chartImage');
    const statsContainer = document.getElementById('statsContainer');
    
    chartImage.style.display = 'none';
    statsContainer.style.display = 'none';
    
    // 可以在這裡顯示一個錯誤消息給用戶
    const errorDisplay = document.getElementById('chartErrorDisplay'); // 假設你有這個元素
    if (errorDisplay) {
        errorDisplay.textContent = message;
        errorDisplay.style.display = 'block';
    }
}

function updateStats(stats) {
    if (!stats) return;

    const maxRateEl = document.getElementById('maxRate');
    const minRateEl = document.getElementById('minRate');
    const avgRateEl = document.getElementById('avgRate');
    const dataPointsEl = document.getElementById('dataPoints');
    const dateRangeEl = document.getElementById('dateRange');

    if (maxRateEl) maxRateEl.textContent = `最高匯率: ${stats.max_rate ? stats.max_rate.toFixed(4) : 'N/A'}`;
    if (minRateEl) minRateEl.textContent = `最低匯率: ${stats.min_rate ? stats.min_rate.toFixed(4) : 'N/A'}`;
    if (avgRateEl) avgRateEl.textContent = `平均匯率: ${stats.avg_rate ? stats.avg_rate.toFixed(4) : 'N/A'}`;
    if (dataPointsEl) dataPointsEl.textContent = `數據點: ${stats.data_points || 'N/A'}`;
    if (dateRangeEl) dateRangeEl.textContent = `數據範圍: ${stats.date_range || 'N/A'}`;
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
  const fromCurrency = document.getElementById('from-currency').value;
  const toCurrency = document.getElementById('to-currency').value;

  fetch(`/api/latest_rate?from_currency=${fromCurrency}&to_currency=${toCurrency}`)
    .then(response => {
      if (!response.ok) {
        // 對於 4xx, 5xx 這類的 HTTP 錯誤，先解析 JSON 以獲取後端錯誤訊息
        return response.json().then(errorData => {
          throw new Error(errorData.error || `伺服器錯誤: ${response.status}`);
        });
      }
      return response.json();
    })
    .then(data => {
      // API 回應現在直接是數據物件，或帶有 error 屬性的物件
      if (data.error) {
        showRateError(data.error);
      } else {
        displayLatestRate(data);
      }
    })
    .catch(error => {
      console.error('載入最新匯率時發生錯誤:', error);
      showRateError(error.message || '無法連接伺服器或API發生錯誤');
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

  const isTwdHkd = currentFromCurrency === 'TWD' && currentToCurrency === 'HKD';
  const displayRate = rateData.rate;
  const rateLabel = `1 ${currentFromCurrency} = ? ${currentToCurrency}`;
  
  let hint = '';
  if (isTwdHkd) {
    const invertedRate = 1 / rateData.rate;
    hint = `<span class="rate-hint"> (${invertedRate.toFixed(getPrecision(invertedRate))})</span>`;
  }

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
                <div class="rate-value">${displayRate.toFixed(getPrecision(displayRate))}${hint}</div>
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
                        <p style="margin: 8px 0;"><strong>🗓️ 最新日期：：</strong>${data.latest_date || '無數據'}</p>
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
  fetchChart(currentPeriod);

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



// 清除待確認的貨幣變更
function clearPendingChanges() {
  pendingFromCurrency = null;
  pendingToCurrency = null;
  
  // 隱藏確認按鈕
  document.getElementById('confirm-currency-btn').style.display = 'none';
  
  // 重置輸入框顯示為實際選中的值
  updateCurrencyDisplay('from-currency');
  updateCurrencyDisplay('to-currency');
}

// 確認貨幣變更
function confirmCurrencyChanges() {
  if (pendingFromCurrency === null && pendingToCurrency === null) {
    return;
  }

  // 應用待確認的變更
  if (pendingFromCurrency !== null) {
    document.getElementById('from-currency').value = pendingFromCurrency;
    currentFromCurrency = pendingFromCurrency;
  }
  if (pendingToCurrency !== null) {
    document.getElementById('to-currency').value = pendingToCurrency;
    currentToCurrency = pendingToCurrency;
  }
  
  // 將新狀態存入 sessionStorage
  sessionStorage.setItem('fromCurrency', currentFromCurrency);
  sessionStorage.setItem('toCurrency', currentToCurrency);

  // 清除待確認狀態
  clearPendingChanges();

  // 更新顯示和數據
  updateDisplay();
  loadLatestRate();
  // 新增：觸發圖表預生成
  triggerChartPregeneration(currentFromCurrency, currentToCurrency);
}

// 設定確認按鈕事件
function setupConfirmButton() {
  const confirmBtn = document.getElementById('confirm-currency-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', confirmCurrencyChanges);
  }
}