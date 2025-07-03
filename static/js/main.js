let currentPeriod = 7;
let eventSource = null; // SSE連接

// CurrencyManager 類別 - 統一管理貨幣狀態和載入控制
class CurrencyManager {
  constructor() {
    this.currentFromCurrency = 'TWD';
    this.currentToCurrency = 'HKD';
    this.pendingFromCurrency = null;
    this.pendingToCurrency = null;
    this.isSwapping = false;
    
    // 載入狀態管理（只有圖表和匯率）
    this.loadingStates = {
      chart: false,
      rate: false
    };
    
    this.loadFromStorage();
  }

  // 從 sessionStorage 載入狀態
  loadFromStorage() {
    const savedFromCurrency = sessionStorage.getItem('fromCurrency');
    const savedToCurrency = sessionStorage.getItem('toCurrency');
    
    if (savedFromCurrency) this.currentFromCurrency = savedFromCurrency;
    if (savedToCurrency) this.currentToCurrency = savedToCurrency;
    
    this.saveToStorage();
  }

  // 儲存到 sessionStorage
  saveToStorage() {
    sessionStorage.setItem('fromCurrency', this.currentFromCurrency);
    sessionStorage.setItem('toCurrency', this.currentToCurrency);
  }

  // 檢查是否可以切換貨幣（圖表和匯率都載入完成）
  canSwitchCurrency() {
    return !this.loadingStates.chart && !this.loadingStates.rate;
  }

  // 設定載入狀態
  setLoading(type, status) {
    this.loadingStates[type] = status;
    this.updateUIStates();
  }

  // 更新UI狀態（禁用/啟用按鈕）
  updateUIStates() {
    const isLoading = !this.canSwitchCurrency();
    
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

    // 禁用/啟用確認按鈕
    const confirmBtn = document.getElementById('confirm-currency-btn');
    if (confirmBtn) {
      confirmBtn.disabled = isLoading;
    }
  }

  // 統一的貨幣切換入口
  async switchCurrencies(fromCurrency, toCurrency, source = 'manual') {
    console.log(`🔄 切換貨幣: ${this.currentFromCurrency}-${this.currentToCurrency} → ${fromCurrency}-${toCurrency} (${source})`);
    
    // 檢查是否可以切換
    if (!this.canSwitchCurrency()) {
      console.log('⚠️ 系統忙碌中，無法切換貨幣');
      return { success: false, reason: 'system_busy' };
    }

    // 如果沒有變化，直接返回
    if (fromCurrency === this.currentFromCurrency && toCurrency === this.currentToCurrency) {
      return { success: true, noChange: true };
    }

    // 立即設定載入狀態
    this.setLoading('chart', true);
    this.setLoading('rate', true);

    try {
      // 更新貨幣狀態
      this.currentFromCurrency = fromCurrency;
      this.currentToCurrency = toCurrency;
      this.saveToStorage();

      // 更新UI顯示
      this.updateCurrencySelectors();
      updateDisplay();

      // 並行執行載入操作
      const chartPromise = this.loadChart().finally(() => {
        this.setLoading('chart', false);
      });
      
      const ratePromise = this.loadRate().finally(() => {
        this.setLoading('rate', false);
      });

      // 獨立執行預生成（不等待完成）
      this.triggerPregeneration(fromCurrency, toCurrency);

      // 等待圖表和匯率載入完成
      await Promise.all([chartPromise, ratePromise]);

      return {
        success: true,
        fromCurrency,
        toCurrency,
        source
      };
    } catch (error) {
      console.error('貨幣切換失敗:', error);
      // 確保載入狀態被重置
      this.setLoading('chart', false);
      this.setLoading('rate', false);
      throw error;
    }
  }

  // 載入圖表
  async loadChart() {
    try {
      await fetchChart(currentPeriod);
    } catch (error) {
      console.error('圖表載入失敗:', error);
      showError('圖表載入失敗，請稍後再試');
      throw error;
    }
  }

  // 載入匯率
  async loadRate() {
    try {
      await loadLatestRate();
    } catch (error) {
      console.error('匯率載入失敗:', error);
      showError('匯率載入失敗，請稍後再試');
      throw error;
    }
  }

  // 觸發預生成（獨立執行，不阻塞）
  triggerPregeneration(fromCurrency, toCurrency) {
    console.log(`🚀 觸發後端預生成 ${fromCurrency}-${toCurrency} 圖表...`);
    fetch(`/api/pregenerate_charts?from_currency=${fromCurrency}&to_currency=${toCurrency}`)
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          if (data.skipped) {
            console.log(`⏭️ 預生成已跳過: ${data.message}`);
          } else {
            console.log(`✅ 預生成觸發成功: ${data.message}`);
          }
        } else {
          console.error(`❌ 預生成觸發失敗: ${data.message}`);
        }
      })
      .catch(error => {
        console.error('觸發圖表預生成時發生錯誤:', error);
      });
  }

  // 交換貨幣
  async swapCurrencies() {
    if (this.isSwapping) return;
    
    this.isSwapping = true;
    
    try {
      // 清除待確認狀態
      this.clearPendingChanges();
      
      // 添加視覺效果
      const swapButton = document.querySelector('.exchange-arrow');
      if (swapButton) {
        swapButton.style.transform = 'rotate(180deg)';
        setTimeout(() => swapButton.style.transform = '', 300);
      }

      // 關閉開啟的下拉選單
      const openDropdown = document.querySelector('.currency-dropdown.open');
      if (openDropdown) {
        document.body.click();
      }

      // 執行交換
      const result = await this.switchCurrencies(
        this.currentToCurrency, 
        this.currentFromCurrency, 
        'swap'
      );
      
      return result;
    } finally {
      setTimeout(() => this.isSwapping = false, 100);
    }
  }

  // 確認貨幣變更
  async confirmCurrencyChanges() {
    if (!this.pendingFromCurrency && !this.pendingToCurrency) {
      return { success: false, reason: 'no_pending_changes' };
    }

    const newFromCurrency = this.pendingFromCurrency || this.currentFromCurrency;
    const newToCurrency = this.pendingToCurrency || this.currentToCurrency;

    // 清除待確認狀態
    this.clearPendingChanges();

    // 執行切換
    return await this.switchCurrencies(newFromCurrency, newToCurrency, 'confirm');
  }

  // 設置待確認的貨幣
  setPendingCurrency(type, currency) {
    if (type === 'from') {
      this.pendingFromCurrency = currency;
    } else if (type === 'to') {
      this.pendingToCurrency = currency;
    }
    
    this.showConfirmButton();
  }

  // 清除待確認狀態
  clearPendingChanges() {
    this.pendingFromCurrency = null;
    this.pendingToCurrency = null;
    this.hideConfirmButton();
    this.updateCurrencySelectors();
  }

  // 顯示確認按鈕
  showConfirmButton() {
    const confirmBtn = document.getElementById('confirm-currency-btn');
    if (confirmBtn) {
      confirmBtn.style.display = 'block';
    }
  }

  // 隱藏確認按鈕
  hideConfirmButton() {
    const confirmBtn = document.getElementById('confirm-currency-btn');
    if (confirmBtn) {
      confirmBtn.style.display = 'none';
    }
  }

  // 更新貨幣選擇器顯示
  updateCurrencySelectors() {
    document.getElementById('from-currency').value = this.currentFromCurrency;
    document.getElementById('to-currency').value = this.currentToCurrency;
    
    updateCurrencyDisplay('from-currency');
    updateCurrencyDisplay('to-currency');
  }
}

// 創建全域 CurrencyManager 實例
const currencyManager = new CurrencyManager();

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
      
      // 重設 CurrencyManager
      currencyManager.currentFromCurrency = 'TWD';
      currencyManager.currentToCurrency = 'HKD';
      currencyManager.saveToStorage();
    }
  } catch (error) {
    console.error('檢查伺服器狀態失敗:', error);
    // If check fails, do not reset to preserve user selection in case of network issues
  }

  // CurrencyManager 已經在初始化時處理了 sessionStorage 載入
  // 更新 select 元素的值
  currencyManager.updateCurrencySelectors();

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

// 設置貨幣選擇器事件（統一搜索下拉選單）
function setupCurrencySelectors() {
  setupCurrencyCombobox('from-currency');
  setupCurrencyCombobox('to-currency');
  setupCurrencySwapButton();
}

function setupCurrencySwapButton() {
  const swapButton = document.querySelector('.exchange-arrow');
  if (swapButton) {
    swapButton.addEventListener('click', () => {
      currencyManager.swapCurrencies();
    });
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
    const currentValue = (selectId === 'from-currency' && currencyManager.pendingFromCurrency) ? currencyManager.pendingFromCurrency :
      (selectId === 'to-currency' && currencyManager.pendingToCurrency) ? currencyManager.pendingToCurrency :
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

    const selectedValue = (selectId === 'from-currency' && currencyManager.pendingFromCurrency) ? currencyManager.pendingFromCurrency :
      (selectId === 'to-currency' && currencyManager.pendingToCurrency) ? currencyManager.pendingToCurrency :
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
    const type = selectId === 'from-currency' ? 'from' : 'to';
    currencyManager.setPendingCurrency(type, value);

    // 更新輸入框顯示為待定選項
    input.value = selectedOption.text;

    hideDropdown();
  };

  const updateInputDisplay = () => {
    const pendingValue = selectId === 'from-currency' ? currencyManager.pendingFromCurrency : currencyManager.pendingToCurrency;
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
    rateHeader.textContent = `💰 最新匯率 (${currencyManager.currentFromCurrency} ⇒ ${currencyManager.currentToCurrency})`;
  }

  // 載入新選擇的圖表（注意：圖表載入會由 CurrencyManager 控制載入狀態）
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

    // 顯示加載動畫，隱藏舊圖表
    chartSpinner.style.display = 'block';
    chartImage.style.display = 'none';

    // 更新統計數據區域為載入中狀態
    updateStats(null); 
    
    // 從 CurrencyManager 獲取當前貨幣對
    const fromCurrency = currencyManager.currentFromCurrency;
    const toCurrency = currencyManager.currentToCurrency;

    // 發起 API 請求，返回 Promise
    return fetch(`/api/chart?period=${period}&from_currency=${fromCurrency}&to_currency=${toCurrency}`)
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
            throw error; // 重新拋出錯誤讓 CurrencyManager 能夠捕獲
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
    
    // 清空統計數據
    updateStats(null);
    
    // 可以在這裡顯示一個錯誤消息給用戶
    const errorDisplay = document.getElementById('chartErrorDisplay'); // 假設你有這個元素
    if (errorDisplay) {
        errorDisplay.textContent = message;
        errorDisplay.style.display = 'block';
    }
}

function updateStats(stats) {
    const maxRateEl = document.getElementById('maxRate');
    const minRateEl = document.getElementById('minRate');
    const avgRateEl = document.getElementById('avgRate');
    const dataPointsEl = document.getElementById('dataPoints');
    const dateRangeEl = document.getElementById('dateRange');

    if (!stats) {
        // 如果沒有統計數據（例如正在載入或出錯），則顯示預設文本
        if (maxRateEl) maxRateEl.textContent = `最高匯率: 載入中...`;
        if (minRateEl) minRateEl.textContent = `最低匯率: 載入中...`;
        if (avgRateEl) avgRateEl.textContent = `平均匯率: 載入中...`;
        if (dataPointsEl) dataPointsEl.textContent = `數據點: 載入中...`;
        if (dateRangeEl) dateRangeEl.textContent = `數據範圍: 載入中...`;
        return;
    }

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
  const fromCurrency = currencyManager.currentFromCurrency;
  const toCurrency = currencyManager.currentToCurrency;

  return fetch(`/api/latest_rate?from_currency=${fromCurrency}&to_currency=${toCurrency}`)
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
        throw new Error(data.error);
      } else {
        displayLatestRate(data);
      }
    })
    .catch(error => {
      console.error('載入最新匯率時發生錯誤:', error);
      showRateError(error.message || '無法連接伺服器或API發生錯誤');
      throw error; // 重新拋出錯誤讓 CurrencyManager 能夠捕獲
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

  // 檢查 CurrencyManager 的貨幣狀態是否有效
  if (!currencyManager.currentFromCurrency || !currencyManager.currentToCurrency) {
    console.error('❌ 貨幣狀態為空', { fromCurrency: currencyManager.currentFromCurrency, toCurrency: currencyManager.currentToCurrency });
    showRateError('貨幣設置錯誤，請重新載入頁面');
    return;
  }

  const isTwdHkd = currencyManager.currentFromCurrency === 'TWD' && currencyManager.currentToCurrency === 'HKD';
  const displayRate = rateData.rate;
  const rateLabel = `1 ${currencyManager.currentFromCurrency} = ? ${currencyManager.currentToCurrency}`;
  
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

// 設定確認按鈕事件
function setupConfirmButton() {
  const confirmBtn = document.getElementById('confirm-currency-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      currencyManager.confirmCurrencyChanges();
    });
  }
}