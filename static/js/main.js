import { fetchChart, loadLatestRate, triggerPregeneration } from './api.js';
import { handleChartError } from './chart.js';
import { 
  displayLatestRate, 
  showRateError, 
  showPopup, 
  closePopup, 
  updateGridStats,
  showGlobalProgressBar,
  updateGlobalProgressBar,
  hideGlobalProgressBar,
  populateCurrencySelectors,
  renderChart,
  updateDateRange,
  updatePeriodButtons
} from './dom.js';
import { CurrencyManager } from './currency_manager.js';

// 全域變數
let currentPeriod = '7'; // 預設圖表週期
let eventSource = null;
let chartCache = {}; // 前端圖表短期快取

// 創建全域 CurrencyManager 實例
const currencyManager = new CurrencyManager({
  currentPeriod: () => currentPeriod,
  chartCache,
  updateDisplay,
  showGlobalProgressBar,
  updateGlobalProgressBar,
  hideGlobalProgressBar,
  renderChart,
  updateDateRange,
  updatePeriodButtons,
  displayLatestRate,
  showRateError,
  updateCurrencyDisplay,
  loadLatestRate,
  handleChartError
});

// 頁面載入時自動載入圖表和最新匯率
document.addEventListener('DOMContentLoaded', async function () {
  // 首先填充貨幣選擇器
  await populateCurrencySelectors('from-currency', 'to-currency');
  
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

  // 【修正】必須先建立 SSE 連接，才能觸發任何可能發送 SSE 事件的行為
  // 建立SSE連接
  setupSSEConnection();

  // 【修正】初始載入圖表與匯率，使用直接呼叫，而不是有 bug 的 switchCurrencies
  currencyManager.loadChart();
  currencyManager.loadRate();

  // 綁定貨幣選擇器事件
  setupCurrencySelectors();

  // 手動更新初始顯示
  updateCurrencyDisplay('from-currency');
  updateCurrencyDisplay('to-currency');
  
  // 綁定確認按鈕事件
  setupConfirmButton();
  
  // 綁定其他按鈕事件
  setupEventListeners();
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
  currencyManager.loadChart();
}

// 期間按鈕點擊事件
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    if (this.disabled) return;

    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    currentPeriod = parseInt(this.dataset.period);
    currencyManager.loadChart();
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

  eventSource = new EventSource('/api/events');

  eventSource.onopen = function() {
    
    document.getElementById('sse-status-indicator').classList.add('connected');
    document.getElementById('sse-status-indicator').classList.remove('disconnected');
    document.getElementById('sse-status-indicator').title = 'SSE 已連接';
  };

  eventSource.onerror = function(err) {
    // 當瀏覽器關閉或刷新頁面時，這是一個預期的行為，無需報錯
    if (eventSource.readyState === EventSource.CLOSED) {
      
      return;
    }
    console.error("[SSE] 連接錯誤:", err);
    document.getElementById('sse-status-indicator').classList.add('disconnected');
    document.getElementById('sse-status-indicator').classList.remove('connected');
    document.getElementById('sse-status-indicator').title = 'SSE 已斷開';
    // 可以在這裡添加重連邏輯
  };

  // 監聽後端發送的通用訊息
  eventSource.addEventListener('message', function(event) {
    
  });

  // 監聽匯率更新事件
  eventSource.addEventListener('rate_updated', function(event) {
    const updateData = JSON.parse(event.data);
    
    autoRefreshContent(updateData);
  });
  
  // 【新】監聽後端進度更新
  eventSource.addEventListener('progress_update', (event) => {
    const data = JSON.parse(event.data);
    // 檢查進度更新是否針對當前檢視的貨幣對
    if (data.buy_currency === currencyManager.currentFromCurrency && data.sell_currency === currencyManager.currentToCurrency) {
        updateGlobalProgressBar(data.progress, data.message);
    }
  });

  // 【新】監聽圖表就緒事件
  eventSource.addEventListener('chart_ready', (event) => {
    const data = JSON.parse(event.data);
    const { period, chart_info, buy_currency, sell_currency } = data;
    
    

    // 將收到的圖表資訊存入前端快取
    const cacheKey = `${buy_currency}_${sell_currency}_${period}`;
    chartCache[cacheKey] = chart_info;

    // 如果這個就緒的圖表，正是使用者當前正在查看的週期和貨幣，則立即刷新圖表
    if (String(period) === String(currentPeriod) && buy_currency === currencyManager.currentFromCurrency && sell_currency === currencyManager.currentToCurrency) {
        
        // 觸發 loadChart，它將從前端快取中讀取並渲染
        currencyManager.loadChart(); 
    }
  });

  eventSource.addEventListener('heartbeat', function(event) {
    // console.log("[SSE] 收到心跳包");
  });
}

/**
 * 自動刷新頁面內容
 */
function autoRefreshContent(updateData) {
  

  // 顯示自動更新提示
  showAutoUpdateNotification(updateData);

  // 自動刷新圖表與匯率
  currencyManager.loadChart();
  currencyManager.loadRate();
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

// 設定其他事件監聽器
function setupEventListeners() {
  // 數據狀態按鈕
  const dataStatusBtn = document.getElementById('data-status-btn');
  if (dataStatusBtn) {
    dataStatusBtn.addEventListener('click', checkDataStatus);
  }

  // 彈出視窗關閉事件
  const popupOverlay = document.getElementById('popup-overlay');
  const popupCloseBtn = document.getElementById('popup-close-btn');
  const popupContent = document.querySelector('.popup-content');

  if (popupOverlay) {
    popupOverlay.addEventListener('click', closePopup);
  }

  if (popupCloseBtn) {
    popupCloseBtn.addEventListener('click', closePopup);
  }

  if (popupContent) {
    popupContent.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }
}