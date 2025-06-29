let currentPeriod = 7;
let eventSource = null; // SSE連接

// 頁面載入時自動載入圖表和最新匯率
document.addEventListener('DOMContentLoaded', function() {
    loadChart(currentPeriod);
    loadLatestRate();
    
    // 建立SSE連接
    setupSSEConnection();
});

// 期間按鈕點擊事件
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // 移除所有active類
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        // 添加active類到點擊的按鈕
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
    
    fetch(`/api/chart?period=${period}`)
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
                document.getElementById('max-rate').textContent = data.stats.max_rate.toFixed(3);
                document.getElementById('min-rate').textContent = data.stats.min_rate.toFixed(3);
                document.getElementById('avg-rate').textContent = data.stats.avg_rate.toFixed(3);
                document.getElementById('data-points').textContent = data.stats.data_points;
                document.getElementById('date-range').textContent = data.stats.date_range;
                document.getElementById('stats').style.display = 'block';
            }
            
            // 顯示緩存信息（調試用）
            if (data.from_cache !== undefined) {
                const cacheStatus = data.from_cache ? '緩存' : '即時生成';
                console.log(`📊 圖表載入（近${period}天）: ${cacheStatus} - ${data.generated_at}`);
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



// 載入最新匯率
function loadLatestRate() {
    fetch('/api/latest_rate')
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
                <div class="rate-value">${rateData.rate.toFixed(4)}</div>
                <div class="rate-label">1 HKD = ? TWD</div>
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