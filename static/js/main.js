let currentPeriod = 7;
let eventSource = null; // SSE連接
let currentFromCurrency = 'TWD';
let currentToCurrency = 'HKD';
let isSwapping = false; // 防止交換時重複觸發事件

// 多幣種查詢冷卻機制
let lastCurrencyChangeTime = 0;
const CURRENCY_CHANGE_COOLDOWN = 30000; // 30秒冷卻期
let isLoadingAllCharts = false; // 是否正在載入所有圖表

// 非預設貨幣對的圖表緩存 - LRU機制
const MAX_CACHE_SIZE = 5; // 最多緩存5個貨幣對
let currencyPairCache = {}; // 格式: {'USD-EUR': {7: {chart: '...', stats: {...}}, 30: {...}}}
let cacheUsageOrder = []; // LRU使用順序，最新使用的在前面
let currentCacheKey = ''; // 當前緩存鍵值

// 頁面載入時自動載入圖表和最新匯率
document.addEventListener('DOMContentLoaded', function() {
    loadChart(currentPeriod);
    loadLatestRate();
    
    // 建立SSE連接
    setupSSEConnection();
    
    // 綁定貨幣選擇器事件
    setupCurrencySelectors();
});

// 檢查是否在冷卻期內
function isInCooldown() {
    const now = Date.now();
    const timeSinceLastChange = now - lastCurrencyChangeTime;
    return timeSinceLastChange < CURRENCY_CHANGE_COOLDOWN;
}

// 獲取剩餘冷卻時間（秒）
function getRemainingCooldownTime() {
    const now = Date.now();
    const timeSinceLastChange = now - lastCurrencyChangeTime;
    const remainingTime = CURRENCY_CHANGE_COOLDOWN - timeSinceLastChange;
    return Math.max(0, Math.ceil(remainingTime / 1000));
}

// 顯示冷卻期提示
function showCooldownMessage() {
    const remainingTime = getRemainingCooldownTime();
    showError(`請等待 ${remainingTime} 秒後再進行貨幣查詢，避免被API拒絕`);
}

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
    
    if (isInCooldown()) {
        showCooldownMessage();
        return;
    }
    
    isLoadingAllCharts = true;
    lastCurrencyChangeTime = Date.now();
    currentCacheKey = cacheKey;
    
    const periods = [7, 30, 90, 180];
    const periodNames = {7: '1週', 30: '1個月', 90: '3個月', 180: '6個月'};
    
    console.log(`🚀 並行載入所有期間的 ${currentFromCurrency} ⇒ ${currentToCurrency} 圖表...`);
    
    // 顯示載入進度
    showLoadingProgress(periods, periodNames);
    
    // 並行載入所有期間的圖表
    let completedCount = 0;
    let hasError = false;
    
    periods.forEach((period) => {
        loadChartWithCallback(period, (success, error, chartData) => {
            completedCount++;
            
            if (!success) {
                hasError = true;
                console.error(`❌ 載入近${period}天圖表失敗:`, error);
                updateLoadingProgress(period, false, error);
            } else {
                console.log(`✅ 載入近${period}天圖表成功`);
                updateLoadingProgress(period, true);
                
                // 將數據存入LRU緩存
                if (chartData) {
                    addToCache(cacheKey, period, chartData);
                }
            }
            
            // 如果所有圖表都已載入完成
            if (completedCount === periods.length) {
                isLoadingAllCharts = false;
                
                if (hasError) {
                    showError('部分圖表載入失敗，請檢查網路連接');
                } else {
                    const stats = getCacheStats();
                    showSuccess(`所有 ${currentFromCurrency} ⇒ ${currentToCurrency} 圖表已載入並暫存！`);
                    console.log(`💾 LRU緩存更新: ${stats.totalPairs}/${stats.maxSize} 貨幣對`);
                    console.log(`📋 使用順序: [${stats.usageOrder.join(', ')}]`);
                }
                
                hideLoadingProgress();
                
                // 設置冷卻期提示
                setTimeout(showCooldownReminder, 1000);
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
        <div class="progress-list">
            ${periods.map(period => `
                <div class="progress-item" id="progress-${period}">
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
    
    if (success) {
        icon.textContent = '✅';
        status.textContent = '完成';
        progressItem.style.color = '#28a745';
    } else {
        icon.textContent = '❌';
        status.textContent = error ? `失敗: ${error}` : '失敗';
        progressItem.style.color = '#dc3545';
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

// 顯示冷卻期提醒
function showCooldownReminder() {
    const cooldownTime = CURRENCY_CHANGE_COOLDOWN / 1000;
    showSuccess(`載入完成！接下來${cooldownTime}秒內無法進行新的貨幣查詢，避免API限制`);
    
    // 創建冷卻期提示元素
    const cooldownNotice = document.createElement('div');
    cooldownNotice.id = 'cooldown-notice';
    cooldownNotice.className = 'cooldown-notice';
    cooldownNotice.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 6px;
        padding: 12px 16px;
        font-size: 0.9rem;
        color: #856404;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        z-index: 1050;
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;
    
    let remainingTime = cooldownTime;
    
    const updateNotice = () => {
        if (remainingTime > 0) {
            cooldownNotice.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span>⏱️</span>
                    <span>冷卻期剩餘: <strong>${remainingTime}秒</strong></span>
                </div>
            `;
        } else {
            cooldownNotice.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span>✅</span>
                    <span>可以進行新查詢了！</span>
                </div>
            `;
            cooldownNotice.style.background = '#d4edda';
            cooldownNotice.style.borderColor = '#c3e6cb';
            cooldownNotice.style.color = '#155724';
            
            setTimeout(() => {
                if (cooldownNotice.parentNode) {
                    cooldownNotice.remove();
                }
            }, 3000);
        }
    };
    
    // 初始顯示
    updateNotice();
    document.body.appendChild(cooldownNotice);
    
    // 開始倒計時
    const countdownInterval = setInterval(() => {
        remainingTime--;
        updateNotice();
        
        if (remainingTime <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);
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
    
    const fromSelect = document.getElementById('from-currency');
    const toSelect = document.getElementById('to-currency');
    
    fromSelect.addEventListener('change', function() {
        if (isSwapping) return; // 如果正在交換，跳過處理
        currentFromCurrency = this.value;
        updateCurrencyDisplay('from-currency');
        updateDisplay();
        
        // 檢查是否為預設貨幣對
        const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
        if (isDefaultPair) {
            // 預設貨幣對只載入當前期間圖表
            loadChart(currentPeriod);
        } else {
            // 非預設貨幣對載入所有期間圖表
            loadAllCharts();
        }
        
        loadLatestRate();
    });
    
    toSelect.addEventListener('change', function() {
        if (isSwapping) return; // 如果正在交換，跳過處理
        currentToCurrency = this.value;
        updateCurrencyDisplay('to-currency');
        updateDisplay();
        
        // 檢查是否為預設貨幣對
        const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
        if (isDefaultPair) {
            // 預設貨幣對只載入當前期間圖表
            loadChart(currentPeriod);
        } else {
            // 非預設貨幣對載入所有期間圖表
            loadAllCharts();
        }
        
        loadLatestRate();
    });
    
    // 設置交換箭頭點擊事件
    setupCurrencySwapButton();
    
    // 初始化當前貨幣設置
    currentFromCurrency = fromSelect.value || 'TWD';
    currentToCurrency = toSelect.value || 'HKD';
    
    console.log(`🔧 初始化貨幣: currentFromCurrency="${currentFromCurrency}", currentToCurrency="${currentToCurrency}"`);
    
    // 確保 select 元素有正確的值
    if (fromSelect.value !== currentFromCurrency) {
        fromSelect.value = currentFromCurrency;
    }
    if (toSelect.value !== currentToCurrency) {
        toSelect.value = currentToCurrency;
    }
    
    updateDisplay();
    updateCurrencyDisplay('from-currency');
    updateCurrencyDisplay('to-currency');
}

// 設置貨幣交換按鈕
function setupCurrencySwapButton() {
    const swapButton = document.querySelector('.exchange-arrow');
    
    if (swapButton) {
        swapButton.addEventListener('click', function() {
            // 添加點擊動畫效果
            this.style.transform = 'rotate(180deg)';
            setTimeout(() => {
                this.style.transform = '';
            }, 300);
            
            // 交換貨幣
            swapCurrencies();
        });
        
        // 增加視覺提示
        swapButton.style.cursor = 'pointer';
        swapButton.title = '點擊交換貨幣';
    }
}

// 交換來源貨幣和目標貨幣
function swapCurrencies() {
    const fromSelect = document.getElementById('from-currency');
    const toSelect = document.getElementById('to-currency');
    
    // 檢查元素是否存在
    if (!fromSelect || !toSelect) {
        console.error('❌ 無法找到貨幣選擇器元素');
        return;
    }
    
    // 保存當前值
    const tempFromValue = fromSelect.value;
    const tempToValue = toSelect.value;
    
    console.log(`🔄 交換前: fromSelect.value="${tempFromValue}", toSelect.value="${tempToValue}"`);
    console.log(`🔄 交換前: currentFromCurrency="${currentFromCurrency}", currentToCurrency="${currentToCurrency}"`);
    
    // 驗證值不為空
    if (!tempFromValue || !tempToValue) {
        console.error('❌ 選擇器值為空', {tempFromValue, tempToValue});
        return;
    }
    
    // 設置交換標誌，避免重複觸發事件
    isSwapping = true;
    
    // 交換選擇
    fromSelect.value = tempToValue;
    toSelect.value = tempFromValue;
    
    // 更新全局變數
    currentFromCurrency = tempToValue;
    currentToCurrency = tempFromValue;
    
    console.log(`🔄 交換後: fromSelect.value="${fromSelect.value}", toSelect.value="${toSelect.value}"`);
    console.log(`🔄 交換後: currentFromCurrency="${currentFromCurrency}", currentToCurrency="${currentToCurrency}"`);
    
    // 更新顯示
    updateCurrencyDisplay('from-currency');
    updateCurrencyDisplay('to-currency');
    updateDisplay();
    
    // 重置交換標誌
    isSwapping = false;
    
    // 重新載入圖表和最新匯率
    const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
    if (isDefaultPair) {
        // 預設貨幣對只載入當前期間圖表
        loadChart(currentPeriod);
    } else {
        // 非預設貨幣對載入所有期間圖表
        loadAllCharts();
    }
    
    loadLatestRate();
    
    console.log(`🔄 貨幣已交換: ${tempFromValue} ⇔ ${tempToValue} → ${currentFromCurrency} ⇒ ${currentToCurrency}`);
}

// 設置單個貨幣組合框（統一搜索下拉選單）
function setupCurrencyCombobox(selectId) {
    const input = document.getElementById(selectId + '-input');
    const select = document.getElementById(selectId);
    const wrapper = input.parentElement;
    const dropdown = wrapper.querySelector('.currency-dropdown');
    const arrow = wrapper.querySelector('.currency-dropdown-arrow');
    
    let currentHighlight = -1;
    let filteredOptions = [];
    let isDropdownOpen = false;
    
    // 獲取所有選項
    const getAllOptions = () => {
        return Array.from(select.options).map(option => ({
            value: option.value,
            text: option.textContent,
            selected: option.value === select.value
        }));
    };
    
    // 過濾選項
    const filterOptions = (searchTerm) => {
        const allOptions = getAllOptions();
        if (!searchTerm.trim()) {
            return allOptions;
        }
        
        const term = searchTerm.toLowerCase();
        return allOptions.filter(option => 
            option.text.toLowerCase().includes(term) || 
            option.value.toLowerCase().includes(term)
        );
    };
    
    // 創建下拉項目
    const createDropdownItems = (options) => {
        dropdown.innerHTML = '';
        if (options.length === 0) {
            const noResult = document.createElement('div');
            noResult.className = 'currency-dropdown-item';
            noResult.style.color = '#6c757d';
            noResult.style.fontStyle = 'italic';
            noResult.textContent = '找不到匹配的貨幣';
            dropdown.appendChild(noResult);
            return;
        }
        
        options.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'currency-dropdown-item';
            if (option.value === select.value) {
                item.classList.add('selected');
            }
            item.textContent = option.text;
            item.dataset.value = option.value;
            item.dataset.index = index;
            
            item.addEventListener('click', () => {
                selectOption(option.value);
                hideDropdown();
            });
            
            dropdown.appendChild(item);
        });
    };
    
    // 顯示下拉列表
    const showDropdown = (isSearchMode = false) => {
        const searchTerm = isSearchMode ? input.value : '';
        filteredOptions = filterOptions(searchTerm);
        createDropdownItems(filteredOptions);
        dropdown.classList.add('show');
        wrapper.classList.add('dropdown-active');
        isDropdownOpen = true;
        currentHighlight = -1;
        
        // 高亮當前選中的項目
        const selectedIndex = filteredOptions.findIndex(opt => opt.value === select.value);
        if (selectedIndex >= 0) {
            highlightItem(selectedIndex);
        }
    };
    
    // 隱藏下拉列表
    const hideDropdown = () => {
        dropdown.classList.remove('show');
        wrapper.classList.remove('dropdown-active');
        isDropdownOpen = false;
        currentHighlight = -1;
    };
    
    // 高亮顯示項目
    const highlightItem = (index) => {
        const items = dropdown.querySelectorAll('.currency-dropdown-item');
        items.forEach(item => item.classList.remove('highlighted'));
        
        if (index >= 0 && index < items.length && filteredOptions.length > 0) {
            items[index].classList.add('highlighted');
            currentHighlight = index;
            
            // 滾動到可見區域
            items[index].scrollIntoView({
                block: 'nearest'
            });
        }
    };
    
    // 選擇選項
    const selectOption = (value) => {
        select.value = value;
        select.dispatchEvent(new Event('change'));
        updateInputDisplay();
    };
    
    // 更新輸入框顯示
    const updateInputDisplay = () => {
        const selectedOption = select.options[select.selectedIndex];
        if (selectedOption) {
            input.value = selectedOption.textContent;
            input.setAttribute('readonly', 'readonly');
        }
    };
    
    // 進入搜索模式
    const enterSearchMode = () => {
        input.removeAttribute('readonly');
        input.placeholder = '輸入貨幣代碼或名稱...';
        input.select(); // 選中所有文字以便輸入
    };
    
    // 退出搜索模式
    const exitSearchMode = () => {
        updateInputDisplay();
        input.placeholder = '點擊選擇或輸入搜索貨幣...';
    };
    
    // 輸入框點擊事件
    input.addEventListener('click', function(e) {
        e.stopPropagation();
        if (this.hasAttribute('readonly')) {
            // 進入搜索模式
            enterSearchMode();
            showDropdown(false); // 顯示所有選項
        }
    });
    
    // 輸入框輸入事件
    input.addEventListener('input', function() {
        if (!this.hasAttribute('readonly')) {
            showDropdown(true); // 搜索模式
        }
    });
    
    // 輸入框失去焦點事件
    input.addEventListener('blur', function(e) {
        const self = this;
        // 延遲隱藏，讓點擊下拉項目能夠生效
        setTimeout(() => {
            if (!wrapper.contains(document.activeElement)) {
                hideDropdown();
                exitSearchMode();
            }
        }, 150);
    });
    
    // 鍵盤導航
    input.addEventListener('keydown', function(e) {
        if (!isDropdownOpen) return;
        
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                const nextIndex = Math.min(currentHighlight + 1, filteredOptions.length - 1);
                highlightItem(nextIndex);
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                const prevIndex = Math.max(currentHighlight - 1, 0);
                highlightItem(prevIndex);
                break;
                
            case 'Enter':
                e.preventDefault();
                if (currentHighlight >= 0 && filteredOptions.length > 0) {
                    const selectedOption = filteredOptions[currentHighlight];
                    selectOption(selectedOption.value);
                    hideDropdown();
                    exitSearchMode();
                }
                break;
                
            case 'Escape':
                e.preventDefault();
                hideDropdown();
                exitSearchMode();
                input.blur();
                break;
                
            case 'Tab':
                hideDropdown();
                exitSearchMode();
                break;
        }
    });
    
    // 下拉箭頭點擊事件
    arrow.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isDropdownOpen) {
            hideDropdown();
            exitSearchMode();
        } else {
            enterSearchMode();
            showDropdown(false); // 顯示所有選項
            input.focus();
        }
    });
    
    // 為這個wrapper添加唯一的click handler
    const wrapperClickHandler = (e) => {
        if (!wrapper.contains(e.target)) {
            hideDropdown();
            exitSearchMode();
        }
    };
    
    // 存儲handler引用以便後續清理
    wrapper._clickHandler = wrapperClickHandler;
    
    // 如果已經有handler，先移除
    if (wrapper._clickHandlerAdded) {
        document.removeEventListener('click', wrapper._clickHandler);
    }
    
    document.addEventListener('click', wrapperClickHandler);
    wrapper._clickHandlerAdded = true;
    
    // 初始化顯示
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
    
    // 更新緩存相關按鈕的可見性
    const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
    const cacheButtons = document.querySelectorAll('.status-btn');
    cacheButtons.forEach(btn => {
        if (btn.textContent.includes('緩存')) {
            btn.style.display = isDefaultPair ? 'inline-block' : 'none';
        }
    });
}

// 期間按鈕點擊事件
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // 移除所有active類
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        // 添加active類到點擊的按鈕
        this.classList.add('active');
        
        currentPeriod = parseInt(this.dataset.period);
        
        // 檢查是否為非預設貨幣對且有緩存
        const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
        if (!isDefaultPair && currentCacheKey) {
            const cacheKey = getCacheKey(currentFromCurrency, currentToCurrency);
            if (cacheKey === currentCacheKey && currencyPairCache[cacheKey] && currencyPairCache[cacheKey][currentPeriod]) {
                console.log(`📦 從緩存載入 ${currentFromCurrency} ⇒ ${currentToCurrency} 近${currentPeriod}天圖表`);
                loadFromCache(cacheKey, currentPeriod);
                return;
            }
        }
        
        // 載入圖表（預設貨幣對或無緩存時）
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

function showSuccess(message) {
    const successDiv = document.getElementById('success');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 3000);
}

function loadChart(period) {
    const chartContainer = document.getElementById('chart-container');
    
    // 添加載入指示器
    const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
    const loadingMessage = isDefaultPair ? 
        '正在從緩存載入...' : 
        `正在並行查詢 ${currentFromCurrency} ⇒ ${currentToCurrency} 匯率數據...`;
    
    chartContainer.innerHTML = `
        <div class="chart-loading">
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 2rem; margin-bottom: 15px;">⏳</div>
                <div style="font-weight: 600; margin-bottom: 10px;">${loadingMessage}</div>
                ${!isDefaultPair ? `
                    <div style="font-size: 0.9rem; color: #6c757d; margin-top: 10px;">
                        🚀 使用並行查詢技術，預計需要 10-30 秒
                    </div>
                ` : ''}
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
            
            // 顯示詳細的緩存信息
            const isDefaultPair = (currentFromCurrency === 'TWD' && currentToCurrency === 'HKD');
            const cacheStatus = data.from_cache ? '✅ 緩存' : '🔄 即時生成';
            const cacheReason = data.cache_reason || (isDefaultPair ? '未知原因' : '非預設貨幣對');
            const dataCount = data.data_count || 0;
            
            console.log(`📊 圖表載入（${currentFromCurrency} ⇒ ${currentToCurrency}，近${period}天）:`);
            console.log(`   狀態: ${cacheStatus}`);
            console.log(`   原因: ${cacheReason}`);
            console.log(`   數據點: ${dataCount}`);
            console.log(`   生成時間: ${data.generated_at}`);
            
            // 顯示成功信息
            if (!isDefaultPair) {
                showSuccess(`${currentFromCurrency} ⇒ ${currentToCurrency} 圖表已生成 (${dataCount}個數據點)`);
            } else if (!data.from_cache) {
                showSuccess(`圖表已重新生成 (${dataCount}個數據點)`);
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
        console.error('❌ 全局貨幣變數為空', {currentFromCurrency, currentToCurrency});
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
document.addEventListener('keydown', function(event) {
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
    
    eventSource.onopen = function(event) {
        console.log('✅ SSE連接已建立');
    };
    
    eventSource.addEventListener('connected', function(event) {
        const data = JSON.parse(event.data);
        console.log('🔗 SSE連接確認:', data.message);
    });
    
    eventSource.addEventListener('rate_updated', function(event) {
        const data = JSON.parse(event.data);
        console.log('🔄 收到匯率更新事件:', data);
        
        // 自動刷新頁面內容
        autoRefreshContent(data);
    });
    
    eventSource.addEventListener('heartbeat', function(event) {
        // 心跳包，保持連接活躍
    });
    
    eventSource.onerror = function(event) {
        console.log('❌ SSE連接錯誤，5秒後重新連接...');
        eventSource.close();
        setTimeout(() => {
            setupSSEConnection();
        }, 5000);
    };
    
    // 頁面卸載時關閉連接
    window.addEventListener('beforeunload', function() {
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
    // 創建自動更新提示
    const notification = document.createElement('div');
    notification.className = 'auto-update-notification';
    
    const updateTime = updateData ? new Date(updateData.updated_time).toLocaleTimeString('zh-TW') : '';
    const message = updateData ? updateData.message : '資料已自動更新';
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            animation: slideInRight 0.3s ease-out;
            max-width: 300px;
        ">
            <span>📡</span>
            <div>
                <div style="font-weight: bold;">服務器推送更新</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">
                    ${updateTime && `${updateTime} - `}${message}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // 4秒後移除提示
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }
    }, 4000);
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

// 清除緩存
function clearCache(period) {
    if (period === 'all') {
        if (!confirm('確定要清除所有緩存嗎？這會導致下次請求時重新生成所有圖表。')) {
            return;
        }
    }
    
    fetch(`/api/clear_cache?period=${period}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccess(data.message);
                if (period === 'all') {
                    closePopup();
                } else {
                    // 重新顯示緩存狀態
                    setTimeout(() => checkCacheStatus(), 500);
                }
            } else {
                showError('清除緩存失敗: ' + data.message);
            }
        })
        .catch(error => {
            showError('清除緩存時發生錯誤: ' + error.message);
        });
}

// 重新生成圖表
function regenerateChart(period) {
    showSuccess(`正在重新生成近${period}天的圖表...`);
    
    fetch(`/api/regenerate_chart?period=${period}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccess(data.message);
                
                // 如果是當前顯示的期間，刷新圖表
                if (period == currentPeriod) {
                    loadChart(currentPeriod);
                }
                
                // 重新顯示緩存狀態
                setTimeout(() => checkCacheStatus(), 500);
            } else {
                showError('重新生成圖表失敗: ' + data.message);
            }
        })
        .catch(error => {
            showError('重新生成圖表時發生錯誤: ' + error.message);
        });
}

// 重新生成所有圖表
function regenerateAllCharts() {
    if (!confirm('確定要重新生成所有圖表嗎？這可能需要一些時間。')) {
        return;
    }
    
    const periods = [7, 30, 90, 180];
    let completed = 0;
    
    showSuccess('正在重新生成所有圖表，請稍候...');
    
    periods.forEach(period => {
        fetch(`/api/regenerate_chart?period=${period}`)
            .then(response => response.json())
            .then(data => {
                completed++;
                if (completed === periods.length) {
                    showSuccess('所有圖表重新生成完成！');
                    loadChart(currentPeriod); // 刷新當前圖表
                    setTimeout(() => checkCacheStatus(), 1000);
                }
            })
            .catch(error => {
                completed++;
                console.error(`期間${period}重新生成失敗:`, error);
            });
    });
}

// 檢查LRU緩存狀態
function checkLRUCacheStatus() {
    const stats = getCacheStats();
    
    let content = `<div>
        <p><strong>📊 LRU緩存狀態</strong></p>
        <p>🗂️ 已緩存貨幣對: <strong>${stats.totalPairs}/${stats.maxSize}</strong></p>
        <p>📈 總圖表數量: <strong>${stats.totalCharts}</strong></p>
        <p>🔄 當前貨幣對: <strong>${currentCacheKey || '無'}</strong></p>
        
        <div style="margin-top: 15px;">
            <p><strong>📋 使用順序 (最新 → 最舊):</strong></p>
            <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-top: 5px;">`;
    
    if (stats.usageOrder.length === 0) {
        content += '<em style="color: #6c757d;">暫無緩存數據</em>';
    } else {
        stats.usageOrder.forEach((key, index) => {
            const chartCount = currencyPairCache[key] ? Object.keys(currencyPairCache[key]).length : 0;
            const isCurrent = key === currentCacheKey;
            const prefix = isCurrent ? '🟢' : '⚪';
            content += `
                <div style="margin: 5px 0; ${isCurrent ? 'font-weight: bold; color: #2E86AB;' : ''}">
                    ${prefix} ${index + 1}. ${key} (${chartCount}個圖表)
                </div>`;
        });
    }
    
    content += `</div>
        </div>
        
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #dee2e6;">
            <p><strong>💡 說明:</strong></p>
            <ul style="margin: 5px 0; padding-left: 20px; font-size: 0.9rem;">
                <li>最多同時緩存 ${stats.maxSize} 個貨幣對</li>
                <li>超過限制時會自動刪除最久未使用的</li>
                <li>🟢 表示當前使用的貨幣對</li>
                <li>每個貨幣對包含4個期間的圖表</li>
            </ul>
        </div>
        
        <div style="margin-top: 15px; text-align: center;">
            <button onclick="clearAllCache(); checkLRUCacheStatus(); setTimeout(() => location.reload(), 1000);" 
                    style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                🗑️ 清除所有緩存
            </button>
        </div>
    </div>`;
    
    showPopup('LRU緩存狀態', content);
} 