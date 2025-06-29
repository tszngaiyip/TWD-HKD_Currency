from flask import Flask, render_template, request, jsonify, Response
import requests
import matplotlib
matplotlib.use('Agg')  # 設定非GUI後端
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
import matplotlib.dates as mdates
import json
import os
import io
import base64
from threading import Lock, Thread
import schedule
import time
import queue

app = Flask(__name__)

# 設定中文字體
plt.rcParams['font.sans-serif'] = ['Microsoft JhengHei', 'SimHei', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False

# 數據文件路徑
DATA_FILE = 'exchange_rates.json'
data_lock = Lock()

# SSE 連接管理
sse_clients = []
sse_lock = Lock()

# 預生成圖表緩存
chart_cache = {}
chart_cache_lock = Lock()

class ExchangeRateManager:
    def __init__(self):
        self.data = self.load_data()
    
    def load_data(self):
        """載入本地數據"""
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"載入數據時發生錯誤: {e}")
                return {}
        return {}
    
    def save_data(self):
        """保存數據到本地"""
        with data_lock:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
    
    def get_sorted_dates(self):
        """獲取排序後的日期列表"""
        dates = list(self.data.keys())
        dates.sort()
        return dates
    
    def get_exchange_rate(self, date):
        """獲取指定日期的匯率"""
        url = "https://www.mastercard.com/marketingservices/public/mccom-services/currency-conversions/conversion-rates"
        
        params = {
            'exchange_date': date.strftime('%Y-%m-%d'),
            'transaction_currency': 'TWD',
            'cardholder_billing_currency': 'HKD',
            'bank_fee': '0',
            'transaction_amount': '10000'
        }
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
            "Accept": "*/*",
            "Accept-Language": "zh-TW,zh-HK;q=0.8,zh;q=0.6,en-US;q=0.4,en;q=0.2",
            "Sec-GPC": "1",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Priority": "u=0",
            "Referer": "https://www.mastercard.com/us/en/personal/get-support/currency-exchange-rate-converter.html"
        }
        
        try:
            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
            return data
        except Exception as e:
            print(f"獲取 {date.strftime('%Y-%m-%d')} 數據時發生錯誤: {e}")
            return None
    
    def update_data(self, days=180):  # 默認更新6個月數據
        """更新匯率數據"""
        end_date = datetime.now()  # 嘗試獲取到今天的數據
        start_date = end_date - timedelta(days=days)
        
        print(f"正在更新近{days}天的匯率數據...")
        updated_count = 0
        
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime('%Y-%m-%d')
            
            # 如果數據已存在，跳過
            if date_str in self.data:
                current_date += timedelta(days=1)
                continue
            
            print(f"獲取 {date_str} 的數據...")
            data = self.get_exchange_rate(current_date)
            
            if data and 'data' in data:
                try:
                    conversion_rate = float(data['data']['conversionRate'])
                    self.data[date_str] = {
                        'rate': conversion_rate,
                        'updated': datetime.now().isoformat()
                    }
                    updated_count += 1
                    print(f"  匯率: {conversion_rate}")
                except (KeyError, ValueError) as e:
                    print(f"  解析數據時發生錯誤: {e}")
            
            current_date += timedelta(days=1)
        
        if updated_count > 0:
            self.save_data()
            print(f"成功更新 {updated_count} 筆數據")
        else:
            print("沒有新數據需要更新")
        
        return updated_count
    
    def get_rates_for_period(self, days):
        """獲取指定天數的匯率數據"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        dates = []
        rates = []
        
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime('%Y-%m-%d')
            if date_str in self.data:
                dates.append(current_date)
                # 顯示 1/rate，即 1 港幣等於多少台幣
                rates.append(1 / self.data[date_str]['rate'])
            current_date += timedelta(days=1)
        
        return dates, rates
    
    def create_chart(self, days):
        """創建圖表"""
        dates, rates = self.get_rates_for_period(days)
        
        if not dates:
            return None
        
        # 清除之前的圖表
        plt.clf()
        
        # 創建圖表
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.plot(dates, rates, marker='o', linewidth=2, markersize=4, color='#2E86AB')
        
        # 設定標題
        period_names = {7: '近1週', 30: '近1個月', 90: '近3個月', 180: '近6個月'}
        title = f'HKD 到 TWD 匯率走勢圖 ({period_names.get(days, f"近{days}天")})'
        ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
        ax.set_xlabel('日期', fontsize=12)
        ax.set_ylabel('匯率', fontsize=12)
        
        # 格式化日期軸
        if days <= 7:
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
            ax.xaxis.set_major_locator(mdates.DayLocator())
        elif days <= 30:
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
            ax.xaxis.set_major_locator(mdates.DayLocator(interval=2))
        else:
            ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
            ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
        
        plt.xticks(rotation=45)
        
        # 添加網格
        ax.grid(True, alpha=0.3)
        
        # 設定 Y 軸範圍，為標籤留出空間
        if rates:
            y_min, y_max = min(rates), max(rates)
            y_range = y_max - y_min
            # 增加上下邊距，避免標籤被裁切
            ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.1)
        
        # 如果數據點不多，添加數值標籤
        if len(dates) <= 14:
            for date, rate in zip(dates, rates):
                ax.annotate(f'{rate:.3f}', 
                           (date, rate), 
                           textcoords="offset points", 
                           xytext=(0,10), 
                           ha='center',
                           va='bottom',
                           fontsize=8)
        
        # 調整佈局
        plt.tight_layout()
        
        # 轉換為base64字符串
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format='png', dpi=300, bbox_inches='tight')
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        plt.close(fig)
        
        # 計算統計信息
        stats = {
            'max_rate': max(rates),
            'min_rate': min(rates),
            'avg_rate': sum(rates) / len(rates),
            'data_points': len(rates),
            'date_range': f"{dates[0].strftime('%Y-%m-%d')} 至 {dates[-1].strftime('%Y-%m-%d')}"
        } if rates else None
        
        return img_base64, stats
    
    def pregenerate_all_charts(self):
        """預生成所有期間的圖表"""
        periods = [7, 30, 90, 180]
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 開始預生成圖表...")
        
        with chart_cache_lock:
            for period in periods:
                try:
                    chart_data = self.create_chart(period)
                    if chart_data:
                        img_base64, stats = chart_data
                        chart_cache[period] = {
                            'chart': img_base64,
                            'stats': stats,
                            'generated_at': datetime.now().isoformat()
                        }
                        print(f"  ✅ 近{period}天圖表生成完成")
                    else:
                        print(f"  ❌ 近{period}天圖表生成失敗")
                except Exception as e:
                    print(f"  ❌ 近{period}天圖表生成錯誤: {str(e)}")
        
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 圖表預生成完成")

# 創建管理器實例
rate_manager = ExchangeRateManager()

# SSE 相關函數
def send_sse_event(event_type, data):
    """發送SSE事件給所有連接的客戶端"""
    with sse_lock:
        message = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        
        # 移除已斷開的連接
        active_clients = []
        for client_queue in sse_clients:
            try:
                client_queue.put(message, timeout=1)
                active_clients.append(client_queue)
            except:
                pass  # 客戶端已斷開連接
        
        sse_clients[:] = active_clients
        print(f"[SSE] 已向 {len(active_clients)} 個客戶端發送 {event_type} 事件")

def sse_stream(client_queue):
    """SSE數據流生成器"""
    while True:
        try:
            message = client_queue.get(timeout=30)  # 30秒超時
            yield message
        except queue.Empty:
            # 發送心跳包保持連接
            yield "event: heartbeat\ndata: {}\n\n"
        except:
            break

# 定時更新函數
def scheduled_update():
    """定時更新匯率資料"""
    try:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 開始執行定時更新...")
        today = datetime.now()
        today_str = today.strftime('%Y-%m-%d')
        
        # 檢查今天的資料是否已存在
        if today_str in rate_manager.data:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 今天({today_str})的資料已存在，無需更新")
            return
        
        # 只獲取今天的資料
        print(f"正在獲取 {today_str} 的匯率資料...")
        data = rate_manager.get_exchange_rate(today)
        
        if data and 'data' in data:
            try:
                conversion_rate = float(data['data']['conversionRate'])
                rate_manager.data[today_str] = {
                    'rate': conversion_rate,
                    'updated': datetime.now().isoformat()
                }
                rate_manager.save_data()
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 定時更新完成，成功獲取今天的匯率: {conversion_rate}")
                
                # 預生成所有圖表
                rate_manager.pregenerate_all_charts()
                
                # 發送SSE事件通知前端更新
                send_sse_event('rate_updated', {
                    'date': today_str,
                    'rate': 1 / conversion_rate,  # 轉換為 1 HKD = ? TWD
                    'updated_time': datetime.now().isoformat(),
                    'message': f'成功獲取 {today_str} 的匯率資料'
                })
                
            except (KeyError, ValueError) as e:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 解析今天的資料時發生錯誤: {e}")
        else:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 無法獲取今天的匯率資料")
            
    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 定時更新失敗: {str(e)}")

# 啟動定時任務的背景執行緒
def run_scheduler():
    """在背景執行緒中執行定時任務"""
    while True:
        schedule.run_pending()
        time.sleep(60)  # 每分鐘檢查一次

# 設定定時任務
schedule.every().day.at("09:00").do(scheduled_update)
print("已設定每天09:00自動更新匯率資料")

@app.route('/')
def index():
    """主頁面"""
    return render_template('index.html')

@app.route('/api/chart')
def get_chart():
    """獲取圖表API"""
    period = request.args.get('period', '7')
    
    try:
        days = int(period)
        if days not in [7, 30, 90, 180]:
            days = 7
    except:
        days = 7
    
    # 優先從緩存返回
    with chart_cache_lock:
        if days in chart_cache:
            cached_chart = chart_cache[days]
            return jsonify({
                'chart': cached_chart['chart'],
                'stats': cached_chart['stats'],
                'from_cache': True,
                'generated_at': cached_chart['generated_at']
            })
    
    # 如果緩存中沒有，即時生成
    print(f"圖表緩存中沒有近{days}天的數據，即時生成...")
    chart_data = rate_manager.create_chart(days)
    
    if chart_data is None:
        return jsonify({'error': '無法獲取數據，請先更新數據'}), 400
    
    img_base64, stats = chart_data
    
    # 保存到緩存
    with chart_cache_lock:
        chart_cache[days] = {
            'chart': img_base64,
            'stats': stats,
            'generated_at': datetime.now().isoformat()
        }
    
    return jsonify({
        'chart': img_base64,
        'stats': stats,
        'from_cache': False,
        'generated_at': datetime.now().isoformat()
    })

@app.route('/api/data_status')
def data_status():
    """檢查數據狀態"""
    total_records = len(rate_manager.data)
    
    if total_records > 0:
        dates = rate_manager.get_sorted_dates()
        earliest_date = dates[0]
        latest_date = dates[-1]
    else:
        earliest_date = None
        latest_date = None
    
    return jsonify({
        'total_records': total_records,
        'earliest_date': earliest_date,
        'latest_date': latest_date,
        'last_updated': datetime.now().isoformat()
    })

@app.route('/api/latest_rate')
def get_latest_rate():
    """獲取最新匯率API"""
    try:
        if not rate_manager.data:
            return jsonify({
                'success': False,
                'message': '無匯率數據，請先更新數據'
            }), 400
        
        # 獲取最新日期的匯率
        dates = rate_manager.get_sorted_dates()
        latest_date = dates[-1]
        latest_data = rate_manager.data[latest_date]
        
        # 計算 1 港幣等於多少台幣
        hkd_to_twd_rate = 1 / latest_data['rate']
        
        # 計算趨勢（與前一天比較）
        trend = None
        trend_value = 0
        if len(dates) > 1:
            prev_date = dates[-2]
            prev_data = rate_manager.data[prev_date]
            prev_rate = 1 / prev_data['rate']
            
            trend_value = hkd_to_twd_rate - prev_rate
            if trend_value > 0:
                trend = 'up'
            elif trend_value < 0:
                trend = 'down'
            else:
                trend = 'stable'
        
        return jsonify({
            'success': True,
            'data': {
                'date': latest_date,
                'rate': hkd_to_twd_rate,
                'trend': trend,
                'trend_value': abs(trend_value),
                'updated_time': latest_data.get('updated', '')
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'獲取最新匯率失敗: {str(e)}'
        }), 500

@app.route('/api/schedule_status')
def get_schedule_status():
    """獲取定時任務狀態API"""
    try:
        jobs = schedule.jobs
        next_run_time = None
        
        if jobs:
            # 獲取下一次執行時間
            next_run_time = min(job.next_run for job in jobs).strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            'success': True,
            'data': {
                'is_active': len(jobs) > 0,
                'next_run_time': next_run_time,
                'scheduled_time': '每天 09:00',
                'current_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'獲取定時任務狀態失敗: {str(e)}'
        }), 500

@app.route('/api/trigger_scheduled_update')
def trigger_scheduled_update():
    """手動觸發定時更新API"""
    try:
        scheduled_update()
        return jsonify({
            'success': True,
            'message': '定時更新已手動觸發完成'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'手動觸發定時更新失敗: {str(e)}'
        }), 500

@app.route('/api/chart_cache_status')
def get_chart_cache_status():
    """獲取圖表緩存狀態API"""
    try:
        with chart_cache_lock:
            cache_info = {}
            periods = [7, 30, 90, 180]
            period_names = {7: '近1週', 30: '近1個月', 90: '近3個月', 180: '近6個月'}
            
            for period in periods:
                if period in chart_cache:
                    cache_info[period] = {
                        'period_name': period_names[period],
                        'cached': True,
                        'generated_at': chart_cache[period]['generated_at'],
                        'has_stats': chart_cache[period]['stats'] is not None
                    }
                else:
                    cache_info[period] = {
                        'period_name': period_names[period],
                        'cached': False,
                        'generated_at': None,
                        'has_stats': False
                    }
        
        return jsonify({
            'success': True,
            'cache_info': cache_info,
            'total_cached': len([k for k in cache_info if cache_info[k]['cached']]),
            'checked_at': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'獲取緩存狀態失敗: {str(e)}'
        }), 500

@app.route('/api/events')
def sse_events():
    """SSE事件端點"""
    client_queue = queue.Queue()
    
    with sse_lock:
        sse_clients.append(client_queue)
    
    print(f"[SSE] 新客戶端連接，目前連接數: {len(sse_clients)}")
    
    # 發送連接成功事件
    try:
        client_queue.put("event: connected\ndata: {\"message\": \"SSE連接已建立\"}\n\n", timeout=1)
    except:
        pass
    
    response = Response(sse_stream(client_queue), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Connection'] = 'keep-alive'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

if __name__ == '__main__':
    # 啟動時檢查並更新數據
    print("正在檢查本地數據...")
    if len(rate_manager.data) == 0:
        print("沒有本地數據，正在獲取初始數據...")
        rate_manager.update_data()  # 獲取6個月數據
    else:
        # 檢查是否需要更新最新數據
        dates = rate_manager.get_sorted_dates()
        latest_date = datetime.strptime(dates[-1], '%Y-%m-%d')
        today = datetime.now()
        
        # 如果最新數據不是今天的，就更新最新數據
        if latest_date.date() < today.date():
            print(f"正在更新最新數據（從 {latest_date.strftime('%Y-%m-%d')} 到 {today.strftime('%Y-%m-%d')}）...")
            days_to_update = (today - latest_date).days
            rate_manager.update_data(days_to_update + 1)  # +1 包含今天
        else:
            print("數據已是最新，無需更新")
    
    # 預生成圖表緩存
    print("正在預生成圖表緩存...")
    rate_manager.pregenerate_all_charts()
    
    # 啟動定時任務背景執行緒
    scheduler_thread = Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    print("定時更新背景服務已啟動")
    
    app.run() 