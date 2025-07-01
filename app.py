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
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import concurrent.futures

app = Flask(__name__)

# 速率限制器類別
class RateLimiter:
    def __init__(self, max_requests_per_second):
        self.max_requests_per_second = max_requests_per_second
        self.min_interval = 1.0 / max_requests_per_second
        self.last_request_time = 0
        self.lock = Lock()
    
    def wait_if_needed(self):
        """如果需要的話，等待以符合速率限制"""
        with self.lock:
            current_time = time.time()
            time_since_last = current_time - self.last_request_time
            
            if time_since_last < self.min_interval:
                sleep_time = self.min_interval - time_since_last
                time.sleep(sleep_time)
            
            self.last_request_time = time.time()

rate_limiter = RateLimiter(max_requests_per_second=8)

# 設定中文字體
import matplotlib.font_manager as fm

# 檢查專案字體文件夾中的字體
font_path = os.path.join(os.path.dirname(__file__), 'fonts', 'NotoSansTC-Regular.ttf')

if os.path.exists(font_path):
    # 使用專案內的字體文件
    fm.fontManager.addfont(font_path)
    font_prop = fm.FontProperties(fname=font_path)
    plt.rcParams['font.sans-serif'] = [font_prop.get_name()]
else:
    # 嘗試使用系統字體
    try:
        plt.rcParams['font.sans-serif'] = ['Noto Sans CJK TC']
        print("使用系統字體: Noto Sans CJK TC")
    except:
        plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
        print("警告: 未找到中文字體，請將 NotoSansTC-Regular.ttf 放入 fonts/ 資料夾")

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
    
    def get_data_fingerprint(self, days):
        """獲取指定期間數據的指紋，用於檢查數據是否有變化"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        relevant_data = {}
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime('%Y-%m-%d')
            if date_str in self.data:
                relevant_data[date_str] = self.data[date_str]['rate']
            current_date += timedelta(days=1)
        
        # 創建數據指紋
        data_str = json.dumps(relevant_data, sort_keys=True)
        fingerprint = hashlib.md5(data_str.encode()).hexdigest()
        return fingerprint, len(relevant_data)
    
    def is_cache_valid(self, days):
        """檢查緩存是否仍然有效"""
        with chart_cache_lock:
            if days not in chart_cache:
                return False, "緩存不存在"
            
            cached_info = chart_cache[days]
            
            # 檢查緩存是否有數據指紋
            if 'data_fingerprint' not in cached_info:
                return False, "緩存缺少數據指紋"
            
            # 獲取當前數據指紋
            current_fingerprint, current_data_count = self.get_data_fingerprint(days)
            
            # 比較指紋
            if cached_info['data_fingerprint'] != current_fingerprint:
                return False, f"數據已更新 (當前{current_data_count}筆數據)"
            
            # 檢查緩存時間（可選：如果緩存超過24小時，重新生成）
            cached_time = datetime.fromisoformat(cached_info['generated_at'])
            time_diff = datetime.now() - cached_time
            if time_diff.total_seconds() > 24 * 3600:  # 24小時
                return False, f"緩存已過期 ({time_diff.days}天{time_diff.seconds//3600}小時前)"
            
            return True, "緩存有效"
    
    def get_exchange_rate(self, date, from_currency='TWD', to_currency='HKD'):
        """獲取指定日期的匯率"""
        url = "https://www.mastercard.com/marketingservices/public/mccom-services/currency-conversions/conversion-rates"
        
        params = {
            'exchange_date': date.strftime('%Y-%m-%d'),
            'transaction_currency': from_currency,
            'cardholder_billing_currency': to_currency,
            'bank_fee': '0',
            'transaction_amount': '1'
        }
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "zh-TW,zh;q=0.9",
            "Sec-Ch-Ua": "\"Google Chrome\";v=\"137\", \"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\"",
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "\"Windows\"",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Referer": "https://www.mastercard.com/us/en/personal/get-support/currency-exchange-rate-converter.html"
        }
        
        try:
            rate_limiter.wait_if_needed()
            response = requests.get(url, params=params, headers=headers, 
                                  timeout=(5, 15))  # 連接超時5秒，讀取超時15秒
            response.raise_for_status()
            data = response.json()
            return data
        except requests.exceptions.Timeout as e:
            print(f"獲取 {date.strftime('%Y-%m-%d')} 數據時超時: {e}")
            return None
        except requests.exceptions.RequestException as e:
            print(f"獲取 {date.strftime('%Y-%m-%d')} 數據時網路錯誤: {e}")
            return None
        except Exception as e:
            print(f"獲取 {date.strftime('%Y-%m-%d')} 數據時發生錯誤: {e}")
            return None
    
    def update_data(self, days=180):  # 默認更新近180天數據
        """更新匯率數據，只保留近180天資料"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        updated_count = 0
        
        # 建立新的資料字典，只包含需要的日期範圍
        new_data = {}
        
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime('%Y-%m-%d')
            
            # 如果舊資料中已有這個日期，直接複製
            if date_str in self.data:
                new_data[date_str] = self.data[date_str]
                current_date += timedelta(days=1)
                continue
            
            # 獲取新資料
            print(f"獲取 {date_str} 的數據...")
            data = self.get_exchange_rate(current_date)
            
            if data and 'data' in data:
                try:
                    conversion_rate = float(data['data']['conversionRate'])
                    new_data[date_str] = {
                        'rate': conversion_rate,
                        'updated': datetime.now().isoformat()
                    }
                    updated_count += 1
                    print(f"  匯率: {conversion_rate}")
                except (KeyError, ValueError) as e:
                    print(f"  解析數據時發生錯誤: {e}")
            
            current_date += timedelta(days=1)
        
        # 替換成新的資料（自動移除超過180天的舊資料）
        old_count = len(self.data)
        self.data = new_data
        new_count = len(self.data)
        removed_count = old_count - new_count + updated_count
        
        if updated_count > 0 or removed_count > 0:
            self.save_data()
            if updated_count > 0:
                print(f"成功更新 {updated_count} 筆數據")
            if removed_count > 0:
                print(f"已移除 {removed_count} 筆超過{days}天的舊資料")
        else:
            print("沒有新數據需要更新")
        
        return updated_count
    
    def _fetch_single_rate(self, date, from_currency, to_currency, max_retries=1):
        """獲取單一日期的匯率數據（用於並行查詢，含重試機制）"""
        date_str = date.strftime('%Y-%m-%d')
        
        for attempt in range(max_retries):
            try:
                data = self.get_exchange_rate(date, from_currency, to_currency)
                
                if data and 'data' in data:
                    conversion_rate = float(data['data']['conversionRate'])
                    return date_str, conversion_rate
                else:
                    if attempt < max_retries - 1:
                        print(f"🔄 {date_str}: 無數據，重試 ({attempt + 1}/{max_retries})")
                        time.sleep(1)  # 等待1秒後重試
                        continue
                    else:
                        print(f"❌ {date_str}: 多次重試後仍無法獲取數據")
                        return date_str, None
                        
            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    print(f"⏰ {date_str}: 請求超時，重試 ({attempt + 1}/{max_retries})")
                    time.sleep(2)  # 超時後等待2秒重試
                    continue
                else:
                    print(f"❌ {date_str}: 多次超時後放棄")
                    return date_str, None
                    
            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    print(f"🌐 {date_str}: 網路錯誤，重試 ({attempt + 1}/{max_retries}) - {e}")
                    time.sleep(2)
                    continue
                else:
                    print(f"❌ {date_str}: 網路錯誤，多次重試失敗 - {e}")
                    return date_str, None
                    
            except Exception as e:
                print(f"❌ {date_str}: 未知錯誤 - {e}")
                return date_str, None
        
        return date_str, None

    def get_live_rates_for_period(self, days, from_currency='TWD', to_currency='HKD', max_workers=2):
        """獲取指定期間的即時匯率數據（並行查詢版本，已加入速率限制）"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        # 收集所有需要查詢的日期（跳過週末）
        query_dates = []
        current_date = start_date
        
        while current_date <= end_date:
            # 跳過週末（Saturday=5, Sunday=6）
            if current_date.weekday() < 5:
                query_dates.append(current_date)
            current_date += timedelta(days=1)
        
        actual_workers = min(max_workers, len(query_dates))
        
        rates_data = {}
        successful_queries = 0
        failed_queries = 0
        
        # 使用線程池進行並行查詢
        with ThreadPoolExecutor(max_workers=actual_workers) as executor:
            # 提交所有查詢任務
            future_to_date = {
                executor.submit(self._fetch_single_rate, date, from_currency, to_currency): date 
                for date in query_dates
            }
            
            # 收集結果
            for future in as_completed(future_to_date):
                try:
                    date_str, rate = future.result(timeout=30)  # 30秒超時
                    if rate is not None:
                        rates_data[date_str] = rate
                        successful_queries += 1
                    else:
                        failed_queries += 1
                except concurrent.futures.TimeoutError:
                    date = future_to_date[future]
                    print(f"⏰ {date.strftime('%Y-%m-%d')}: 查詢超時")
                    failed_queries += 1
                except Exception as e:
                    date = future_to_date[future]
                    print(f"❌ {date.strftime('%Y-%m-%d')}: 並行查詢錯誤 - {e}")
                    failed_queries += 1
        
        print(f"📈 並行查詢完成！成功: {successful_queries}, 失敗: {failed_queries}")
        
        if not rates_data:
            print("⚠️ 沒有獲取到任何有效的匯率數據")
        
        return rates_data
    
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
        
        # 手動設置X軸刻度，確保與數據點對齊
        if days <= 7:
            # 每天顯示一個刻度
            ax.set_xticks(dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in dates])
        elif days <= 30:
            # 每2天顯示一個刻度
            tick_dates = dates[::2]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        elif days <= 90:
            # 每週顯示2-3個刻度
            tick_dates = dates[::len(dates)//10] if len(dates) > 10 else dates[::2]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        else:
            # 每週顯示1-2個刻度
            tick_dates = dates[::len(dates)//15] if len(dates) > 15 else dates[::3]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        
        # 調整X軸刻度的間距
        ax.tick_params(axis='x', which='major', pad=8)
        
        # 添加網格
        ax.grid(True, alpha=0.3)
        
        # 添加平均線
        if rates:
            avg_rate = sum(rates) / len(rates)
            ax.axhline(y=avg_rate, color='orange', linestyle='--', linewidth=1.5, alpha=0.8, label=f'平均值: {avg_rate:.3f}')
            ax.legend(loc='upper right', fontsize=10)
        
        # 設定 Y 軸範圍，為標籤和圖例留出空間
        if rates:
            y_min, y_max = min(rates), max(rates)
            y_range = y_max - y_min
            # 根據期間調整邊距，為標籤和圖例留出空間
            if days >= 30:
                # 長期圖表統一在上方顯示最高最低點標籤，並為圖例留空間
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.15)
            else:
                # 短期圖表為圖例留出空間
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.12)
        
        # 根據期間決定標籤顯示策略
        # 所有圖表統一標記最高點和最低點
        if rates:
            max_rate = max(rates)
            min_rate = min(rates)
            max_index = rates.index(max_rate)
            min_index = rates.index(min_rate)
            
            # 標記最高點
            ax.annotate(f'{max_rate:.3f}', 
                       (dates[max_index], max_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), 
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='red',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
            
            # 標記最低點
            ax.annotate(f'{min_rate:.3f}', 
                       (dates[min_index], min_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), 
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='green',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
        
        # 手動調整佈局，避免使用不穩定的 tight_layout
        fig.subplots_adjust(left=0.08, right=0.95, top=0.85, bottom=0.15)
        
        # 轉換為base64字符串
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format='png', dpi=300)
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
    
    def create_live_chart(self, days, from_currency='TWD', to_currency='HKD'):
        """創建即時圖表（不使用緩存數據）"""
        rates_data = self.get_live_rates_for_period(days, from_currency, to_currency)
        
        if not rates_data:
            return None
        
        # 準備數據
        dates = sorted(rates_data.keys())
        rates = [rates_data[date] for date in dates]
        
        if not dates or not rates:
            return None
        
        # 轉換日期格式
        date_objects = [datetime.strptime(date, '%Y-%m-%d') for date in dates]
        
        # 清除之前的圖表
        plt.clf()
        
        # 創建圖表 - 與 create_chart 保持一致的尺寸
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.plot(date_objects, rates, marker='o', linewidth=2, markersize=4, color='#2E86AB')
        
        # 設定標題 - 與 create_chart 保持一致的格式
        period_names = {7: '近1週', 30: '近1個月', 90: '近3個月', 180: '近6個月'}
        title = f'{to_currency} 到 {from_currency} 匯率走勢圖 ({period_names.get(days, f"近{days}天")})'
        ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
        ax.set_xlabel('日期', fontsize=12)
        ax.set_ylabel('匯率', fontsize=12)
        
        # 手動設置X軸刻度，確保與數據點對齊 - 與 create_chart 保持一致
        if days <= 7:
            # 每天顯示一個刻度
            ax.set_xticks(date_objects)
            ax.set_xticklabels([date.strftime('%m/%d') for date in date_objects])
        elif days <= 30:
            # 每2天顯示一個刻度
            tick_dates = date_objects[::2]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        elif days <= 90:
            # 每週顯示2-3個刻度
            tick_dates = date_objects[::len(date_objects)//10] if len(date_objects) > 10 else date_objects[::2]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        else:
            # 每週顯示1-2個刻度
            tick_dates = date_objects[::len(date_objects)//15] if len(date_objects) > 15 else date_objects[::3]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        
        # 調整X軸刻度的間距
        ax.tick_params(axis='x', which='major', pad=8)
        
        # 添加網格 - 與 create_chart 保持一致
        ax.grid(True, alpha=0.3)
        
        # 添加平均線 - 與 create_chart 保持一致
        if rates:
            avg_rate = sum(rates) / len(rates)
            ax.axhline(y=avg_rate, color='orange', linestyle='--', linewidth=1.5, alpha=0.8, label=f'平均值: {avg_rate:.3f}')
            ax.legend(loc='upper right', fontsize=10)
        
        # 設定 Y 軸範圍，為標籤和圖例留出空間 - 與 create_chart 保持一致
        if rates:
            y_min, y_max = min(rates), max(rates)
            y_range = y_max - y_min
            # 根據期間調整邊距，為標籤和圖例留出空間
            if days >= 30:
                # 長期圖表統一在上方顯示最高最低點標籤，並為圖例留空間
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.15)
            else:
                # 短期圖表為圖例留出空間
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.12)
        
        # 根據期間決定標籤顯示策略
        # 所有圖表統一標記最高點和最低點
        if rates:
            max_rate = max(rates)
            min_rate = min(rates)
            max_index = rates.index(max_rate)
            min_index = rates.index(min_rate)
            
            # 標記最高點
            ax.annotate(f'{max_rate:.3f}', 
                       (date_objects[max_index], max_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), 
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='red',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
            
            # 標記最低點
            ax.annotate(f'{min_rate:.3f}', 
                       (date_objects[min_index], min_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), 
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='green',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
        
        # 手動調整佈局，避免使用不穩定的 tight_layout
        fig.subplots_adjust(left=0.08, right=0.95, top=0.9, bottom=0.1)
        
        # 轉換為base64字符串 - 與 create_chart 保持一致的DPI
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format='png', dpi=300)
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        plt.close(fig)
        
        # 計算統計信息 - 與 create_chart 保持一致的格式
        stats = {
            'max_rate': max(rates),
            'min_rate': min(rates),
            'avg_rate': sum(rates) / len(rates),
            'data_points': len(rates),
            'date_range': f"{date_objects[0].strftime('%Y-%m-%d')} 至 {date_objects[-1].strftime('%Y-%m-%d')}"
        } if rates else None
        
        return img_base64, stats
    
    def create_chart_from_data(self, days, all_dates, all_rates):
        """從已準備好的數據創建圖表（避免重複數據查詢）"""
        if not all_dates or not all_rates:
            return None
        
        # 從完整數據中提取指定天數的子集
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        # 過濾出指定時間範圍的數據
        filtered_dates = []
        filtered_rates = []
        
        for date, rate in zip(all_dates, all_rates):
            if start_date <= date <= end_date:
                filtered_dates.append(date)
                filtered_rates.append(rate)
        
        if not filtered_dates:
            return None
        
        # 清除之前的圖表
        plt.clf()
        
        # 創建圖表
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.plot(filtered_dates, filtered_rates, marker='o', linewidth=2, markersize=4, color='#2E86AB')
        
        # 設定標題
        period_names = {7: '近1週', 30: '近1個月', 90: '近3個月', 180: '近6個月'}
        title = f'HKD 到 TWD 匯率走勢圖 ({period_names.get(days, f"近{days}天")})'
        ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
        ax.set_xlabel('日期', fontsize=12)
        ax.set_ylabel('匯率', fontsize=12)
        
        # 手動設置X軸刻度，確保與數據點對齊
        if days <= 7:
            # 每天顯示一個刻度
            ax.set_xticks(filtered_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in filtered_dates])
        elif days <= 30:
            # 每2天顯示一個刻度
            tick_dates = filtered_dates[::2]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        elif days <= 90:
            # 每週顯示2-3個刻度
            tick_dates = filtered_dates[::len(filtered_dates)//10] if len(filtered_dates) > 10 else filtered_dates[::2]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        else:
            # 每週顯示1-2個刻度
            tick_dates = filtered_dates[::len(filtered_dates)//15] if len(filtered_dates) > 15 else filtered_dates[::3]
            ax.set_xticks(tick_dates)
            ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])
        
        # 調整X軸刻度的間距
        ax.tick_params(axis='x', which='major', pad=8)
        
        # 添加網格
        ax.grid(True, alpha=0.3)
        
        # 添加平均線
        if filtered_rates:
            avg_rate = sum(filtered_rates) / len(filtered_rates)
            ax.axhline(y=avg_rate, color='orange', linestyle='--', linewidth=1.5, alpha=0.8, label=f'平均值: {avg_rate:.3f}')
            ax.legend(loc='upper right', fontsize=10)
        
        # 設定 Y 軸範圍，為標籤和圖例留出空間
        if filtered_rates:
            y_min, y_max = min(filtered_rates), max(filtered_rates)
            y_range = y_max - y_min
            # 根據期間調整邊距，為標籤和圖例留出空間
            if days >= 30:
                # 長期圖表統一在上方顯示最高最低點標籤，並為圖例留空間
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.15)
            else:
                # 短期圖表為圖例留出空間
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.12)
        
        # 根據期間決定標籤顯示策略
        # 所有圖表統一標記最高點和最低點
        if filtered_rates:
            max_rate = max(filtered_rates)
            min_rate = min(filtered_rates)
            max_index = filtered_rates.index(max_rate)
            min_index = filtered_rates.index(min_rate)
            
            # 標記最高點
            ax.annotate(f'{max_rate:.3f}', 
                       (filtered_dates[max_index], max_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), 
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='red',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
            
            # 標記最低點
            ax.annotate(f'{min_rate:.3f}', 
                       (filtered_dates[min_index], min_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), 
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='green',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
        
        # 手動調整佈局，避免使用不穩定的 tight_layout
        fig.subplots_adjust(left=0.08, right=0.95, top=0.9, bottom=0.1)
        
        # 轉換為base64字符串
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format='png', dpi=300)
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        plt.close(fig)
        
        # 計算統計信息
        stats = {
            'max_rate': max(filtered_rates),
            'min_rate': min(filtered_rates),
            'avg_rate': sum(filtered_rates) / len(filtered_rates),
            'data_points': len(filtered_rates),
            'date_range': f"{filtered_dates[0].strftime('%Y-%m-%d')} 至 {filtered_dates[-1].strftime('%Y-%m-%d')}"
        } if filtered_rates else None
        
        return img_base64, stats

    def pregenerate_all_charts(self):
        """預生成所有期間的圖表（優化版2：邊取數據邊生圖，提升使用者體驗）"""
        periods = [7, 30, 90, 180]
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 開始預生成圖表...")
        
        # 檢查哪些圖表需要更新
        needed_periods = []
        for period in periods:
            is_valid = self.is_cache_valid(period)
            if not is_valid:
                needed_periods.append(period)

        if not needed_periods:
            print("✅ 所有圖表緩存都有效，無需重新生成")
            return
        
        # 獲取最長需要的時間範圍數據
        max_needed_period = max(needed_periods)
        print(f"📊 正在獲取數據範圍（{max_needed_period}天）...")
        all_dates, all_rates = self.get_rates_for_period(max_needed_period)
        
        if not all_dates:
            print("❌ 無法獲取數據，跳過圖表生成")
            return
            
        print(f"✅ 成功獲取 {len(all_dates)} 個數據點")
        
        # 按時間週期從短到長生成圖表（讓使用者更快看到短期圖表）
        needed_periods.sort()
        
        for period in needed_periods:
            try:
                print(f"  🔄 正在生成近{period}天圖表...")
                
                # 使用優化版本的圖表生成方法，重用已獲取的數據
                chart_data = self.create_chart_from_data(period, all_dates, all_rates)
                
                if chart_data:
                    img_base64, stats = chart_data
                    
                    # 獲取數據指紋
                    data_fingerprint, data_count = self.get_data_fingerprint(period)
                    
                    with chart_cache_lock:
                        chart_cache[period] = {
                            'chart': img_base64,
                            'stats': stats,
                            'generated_at': datetime.now().isoformat(),
                            'data_fingerprint': data_fingerprint,
                            'data_count': data_count
                        }
                    
                    print(f"  ✅ 近{period}天圖表生成完成 (數據點: {stats['data_points']})")
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

@app.route('/')
def index():
    """主頁面"""
    return render_template('index.html')

@app.route('/api/chart')
def get_chart():
    """獲取圖表API - 支援多幣種"""
    period = request.args.get('period', '7')
    from_currency = request.args.get('from_currency', 'TWD')
    to_currency = request.args.get('to_currency', 'HKD')
    
    try:
        days = int(period)
        if days not in [7, 30, 90, 180]:
            days = 7
    except:
        days = 7
    
    # 檢查是否為預設貨幣對（只有TWD-HKD才使用緩存）
    is_default_pair = (from_currency == 'TWD' and to_currency == 'HKD')
    
    if is_default_pair:
        # 預設貨幣對使用緩存邏輯
        is_valid, reason = rate_manager.is_cache_valid(days)
        
        if is_valid:
            # 從緩存返回
            with chart_cache_lock:
                cached_chart = chart_cache[days]
                return jsonify({
                    'chart': cached_chart['chart'],
                    'stats': cached_chart['stats'],
                    'from_cache': True,
                    'cache_reason': '緩存有效',
                    'generated_at': cached_chart['generated_at'],
                    'data_count': cached_chart.get('data_count', 0)
                })
        
        # 需要重新生成預設貨幣對圖表
        chart_data = rate_manager.create_chart(days)
        
        if chart_data is None:
            return jsonify({'error': '無法獲取TWD-HKD數據，請先更新數據'}), 400
        
        img_base64, stats = chart_data
        
        # 獲取數據指紋並保存到緩存
        data_fingerprint, data_count = rate_manager.get_data_fingerprint(days)
        
        with chart_cache_lock:
            chart_cache[days] = {
                'chart': img_base64,
                'stats': stats,
                'generated_at': datetime.now().isoformat(),
                'data_fingerprint': data_fingerprint,
                'data_count': data_count
            }
        
        return jsonify({
            'chart': img_base64,
            'stats': stats,
            'from_cache': False,
            'generated_at': datetime.now().isoformat(),
            'data_count': data_count
        })
    
    else:
        # 非預設貨幣對使用即時生成
        try:
            chart_data = rate_manager.create_live_chart(days, from_currency, to_currency)
            
            if chart_data is None:
                return jsonify({'error': f'無法獲取 {from_currency} ⇒ {to_currency} 數據'}), 400
            
            img_base64, stats = chart_data
            
            
            return jsonify({
                'chart': img_base64,
                'stats': stats,
                'from_cache': False,
                'cache_reason': '非預設貨幣對，即時生成',
                'generated_at': datetime.now().isoformat(),
                'data_count': stats['data_points']
            })
            
        except Exception as e:
            print(f"❌ 生成 {from_currency} ⇒ {to_currency} 圖表時發生錯誤: {e}")
            return jsonify({'error': f'生成 {from_currency} ⇒ {to_currency} 圖表時發生錯誤: {str(e)}'}), 500

@app.route('/api/data_status')
def data_status():
    """檢查數據狀態"""
    total_records = len(rate_manager.data)
    
    if total_records > 0:
        dates = rate_manager.get_sorted_dates()
        earliest_date = dates[0]
        latest_date = dates[-1]
        
        # 計算數據覆蓋天數
        earliest = datetime.strptime(earliest_date, '%Y-%m-%d')
        latest = datetime.strptime(latest_date, '%Y-%m-%d')
        data_span_days = (latest - earliest).days + 1
    else:
        earliest_date = None
        latest_date = None
        data_span_days = 0
    
    return jsonify({
        'total_records': total_records,
        'earliest_date': earliest_date,
        'latest_date': latest_date,
        'data_span_days': data_span_days,
        'data_retention_policy': '保留最近 180 天的資料',
        'last_updated': datetime.now().isoformat()
    })

@app.route('/api/latest_rate')
def get_latest_rate():
    """獲取最新匯率API - 支援多幣種"""
    from_currency = request.args.get('from_currency', 'TWD')
    to_currency = request.args.get('to_currency', 'HKD')
    
    try:
        # 檢查是否為預設貨幣對
        is_default_pair = (from_currency == 'TWD' and to_currency == 'HKD')
        
        if is_default_pair:
            # 預設貨幣對從緩存數據獲取
            if not rate_manager.data:
                return jsonify({
                    'success': False,
                    'message': '無TWD-HKD匯率數據，請先更新數據'
                }), 400
            
            # 獲取最新日期的匯率
            dates = rate_manager.get_sorted_dates()
            latest_date = dates[-1]
            latest_data = rate_manager.data[latest_date]
            
            # 計算 1 TWD 等於多少 HKD
            twd_to_hkd_rate = latest_data['rate']
            
            # 計算趨勢（與前一天比較）
            trend = None
            trend_value = 0
            if len(dates) > 1:
                prev_date = dates[-2]
                prev_data = rate_manager.data[prev_date]
                prev_rate = prev_data['rate']
                
                trend_value = twd_to_hkd_rate - prev_rate
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
                    'rate': twd_to_hkd_rate,
                    'trend': trend,
                    'trend_value': abs(trend_value),
                    'updated_time': latest_data.get('updated', ''),
                    'from_cache': True
                }
            })
        
        else:
            # 非預設貨幣對獲取即時匯率
            current_date = datetime.now()
            
            # 如果是週末，往前找到最近的工作日
            while current_date.weekday() >= 5:  # Saturday=5, Sunday=6
                current_date -= timedelta(days=1)
            
            
            rate_data = rate_manager.get_exchange_rate(current_date, from_currency, to_currency)
            
            if not rate_data or 'data' not in rate_data:
                return jsonify({
                    'success': False,
                    'message': f'無法獲取 {from_currency} ⇒ {to_currency} 即時匯率'
                }), 400
            
            try:
                conversion_rate = float(rate_data['data']['conversionRate'])
                
                return jsonify({
                    'success': True,
                    'data': {
                        'date': current_date.strftime('%Y-%m-%d'),
                        'rate': conversion_rate,
                        'trend': None,  # 即時匯率不提供趨勢
                        'trend_value': 0,
                        'updated_time': datetime.now().isoformat(),
                        'from_cache': False
                    }
                })
                
            except (KeyError, ValueError) as e:
                return jsonify({
                    'success': False,
                    'message': f'解析 {from_currency} ⇒ {to_currency} 匯率數據失敗: {str(e)}'
                }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'獲取 {from_currency} ⇒ {to_currency} 最新匯率失敗: {str(e)}'
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
    """獲取圖表緩存狀態API - 增強版本"""
    try:
        cache_info = {}
        periods = [7, 30, 90, 180]
        period_names = {7: '近1週', 30: '近1個月', 90: '近3個月', 180: '近6個月'}
        
        for period in periods:
            # 檢查緩存有效性
            is_valid, reason = rate_manager.is_cache_valid(period)
            
            with chart_cache_lock:
                if period in chart_cache:
                    cache_info[period] = {
                        'period_name': period_names[period],
                        'cached': True,
                        'is_valid': is_valid,
                        'validity_reason': reason,
                        'generated_at': chart_cache[period]['generated_at'],
                        'data_fingerprint': chart_cache[period].get('data_fingerprint', 'N/A'),
                        'data_count': chart_cache[period].get('data_count', 0),
                        'has_stats': chart_cache[period]['stats'] is not None,
                        'cache_age_hours': (datetime.now() - datetime.fromisoformat(chart_cache[period]['generated_at'])).total_seconds() / 3600
                    }
                else:
                    cache_info[period] = {
                        'period_name': period_names[period],
                        'cached': False,
                        'is_valid': False,
                        'validity_reason': '緩存不存在',
                        'generated_at': None,
                        'data_fingerprint': None,
                        'data_count': 0,
                        'has_stats': False,
                        'cache_age_hours': 0
                    }
        
        # 計算總體統計
        total_cached = sum(1 for info in cache_info.values() if info['cached'])
        valid_cached = sum(1 for info in cache_info.values() if info['is_valid'])
        
        return jsonify({
            'success': True,
            'cache_info': cache_info,
            'summary': {
                'total_periods': len(periods),
                'total_cached': total_cached,
                'valid_cached': valid_cached,
                'cache_efficiency': f"{valid_cached}/{len(periods)} ({valid_cached/len(periods)*100:.1f}%)"
            },
            'checked_at': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'獲取緩存狀態失敗: {str(e)}'
        }), 500

@app.route('/api/clear_cache')
def clear_cache():
    """清除圖表緩存API"""
    try:
        period = request.args.get('period', 'all')
        
        with chart_cache_lock:
            if period == 'all':
                cleared_count = len(chart_cache)
                chart_cache.clear()
                message = f"已清除所有 {cleared_count} 個期間的緩存"
            else:
                try:
                    days = int(period)
                    if days in chart_cache:
                        del chart_cache[days]
                        message = f"已清除近{days}天的緩存"
                    else:
                        message = f"近{days}天的緩存不存在"
                except ValueError:
                    return jsonify({
                        'success': False,
                        'message': '無效的期間參數'
                    }), 400
        
        return jsonify({
            'success': True,
            'message': message,
            'cleared_at': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'清除緩存失敗: {str(e)}'
        }), 500

@app.route('/api/force_cleanup_data')
def force_cleanup_data():
    """強制清理並更新近180天資料API"""
    try:
        print("🔄 強制執行180天資料清理...")
        old_count = len(rate_manager.data)
        
        # 強制更新近180天資料（會自動清理超過180天的舊資料）
        updated_count = rate_manager.update_data(180)
        new_count = len(rate_manager.data)
        removed_count = old_count - new_count + updated_count
        
        message = f"清理完成！原有 {old_count} 筆資料，現有 {new_count} 筆資料"
        if removed_count > 0:
            message += f"，已移除 {removed_count} 筆超過180天的舊資料"
        if updated_count > 0:
            message += f"，更新了 {updated_count} 筆新資料"
        
        print(f"✅ {message}")
        
        return jsonify({
            'success': True,
            'message': message,
            'old_count': old_count,
            'new_count': new_count,
            'removed_count': max(0, removed_count),
            'updated_count': updated_count,
            'cleaned_at': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'強制清理資料失敗: {str(e)}'
        }), 500

@app.route('/api/regenerate_chart')
def regenerate_chart():
    """強制重新生成圖表API"""
    try:
        period = request.args.get('period', '7')
        
        try:
            days = int(period)
            if days not in [7, 30, 90, 180]:
                days = 7
        except:
            days = 7
        
        # 先清除該期間的緩存
        with chart_cache_lock:
            if days in chart_cache:
                del chart_cache[days]
        
        # 重新生成圖表
        print(f"🔄 強制重新生成近{days}天圖表...")
        chart_data = rate_manager.create_chart(days)
        
        if chart_data is None:
            return jsonify({
                'success': False,
                'message': '無法生成圖表，請檢查數據'
            }), 400
        
        img_base64, stats = chart_data
        
        # 獲取數據指紋並保存到緩存
        data_fingerprint, data_count = rate_manager.get_data_fingerprint(days)
        
        with chart_cache_lock:
            chart_cache[days] = {
                'chart': img_base64,
                'stats': stats,
                'generated_at': datetime.now().isoformat(),
                'data_fingerprint': data_fingerprint,
                'data_count': data_count
            }
        
        print(f"✅ 近{days}天圖表強制重新生成完成 (數據點:{data_count})")
        
        return jsonify({
            'success': True,
            'chart': img_base64,
            'stats': stats,
            'data_count': data_count,
            'generated_at': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'重新生成圖表失敗: {str(e)}'
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
    # 啟動時強制執行180天資料更新（自動清理舊資料）
    print("正在檢查本地數據...")
    rate_manager.update_data(180)  # 強制更新近180天，自動清理舊資料
    
    # 預生成圖表緩存
    print("正在預生成圖表緩存...")
    rate_manager.pregenerate_all_charts()
    
    # 啟動定時任務背景執行緒
    scheduler_thread = Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    app.run() 