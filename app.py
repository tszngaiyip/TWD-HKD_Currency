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

# LRU Cache 類別
class LRUCache:
    def __init__(self, capacity, ttl_seconds=3600):
        """
        LRU Cache 實現
        capacity: 快取容量
        ttl_seconds: 過期時間（秒），預設1小時
        """
        self.capacity = capacity
        self.ttl_seconds = ttl_seconds
        self.cache = {}  # key -> {'value': value, 'timestamp': timestamp}
        self.access_order = []  # 存儲存取順序
        self.lock = Lock()

        # 統計資訊
        self._total_requests = 0
        self._cache_hits = 0

    def get(self, key):
        """獲取快取值"""
        with self.lock:
            self._total_requests += 1

            if key not in self.cache:
                return None

            # 檢查是否過期
            entry = self.cache[key]
            current_time = time.time()
            # 如果 ttl 為 None，表示永不過期
            if entry.get('ttl') is not None and current_time - entry['timestamp'] > entry['ttl']:
                # 過期，移除
                self._remove_key(key)
                return None

            # 命中快取
            self._cache_hits += 1

            # 更新存取順序（移到最前面）
            self.access_order.remove(key)
            self.access_order.append(key)

            return entry['value']

    def put(self, key, value, ttl=None):
        """設定快取值，ttl=None 表示使用默認 TTL，ttl=False 表示永不過期"""
        with self.lock:
            current_time = time.time()

            if ttl is False:
                # 永不過期
                actual_ttl = None
            elif ttl is None:
                # 使用默認 TTL
                actual_ttl = self.ttl_seconds
            else:
                # 使用指定的 TTL
                actual_ttl = ttl

            if key in self.cache:
                # 更新現有項目
                self.cache[key] = {
                    'value': value,
                    'timestamp': current_time,
                    'ttl': actual_ttl
                }
                # 更新存取順序
                self.access_order.remove(key)
                self.access_order.append(key)
            else:
                # 新增項目
                # 檢查容量（但永不過期的項目不會被 LRU 淘汰）
                if len(self.cache) >= self.capacity:
                    # 找出最久未使用且可淘汰的項目
                    self._evict_lru_item()

                self.cache[key] = {
                    'value': value,
                    'timestamp': current_time,
                    'ttl': actual_ttl
                }
                self.access_order.append(key)

    def _evict_lru_item(self):
        """淘汰最久未使用的項目（但跳過永不過期的項目）"""
        for key in self.access_order:
            entry = self.cache[key]
            # 如果項目不是永不過期的，則可以淘汰
            if entry.get('ttl') is not None:
                self._remove_key(key)
                return

        # 如果所有項目都是永不過期的，移除最舊的一個
        if self.access_order:
            lru_key = self.access_order[0]
            self._remove_key(lru_key)

    def _remove_key(self, key):
        """移除指定的鍵（內部方法，不加鎖）"""
        if key in self.cache:
            del self.cache[key]
            if key in self.access_order:
                self.access_order.remove(key)

    def clear_expired(self):
        """清理過期項目（跳過永不過期的項目）"""
        with self.lock:
            current_time = time.time()
            expired_keys = []

            for key, entry in self.cache.items():
                # 只清理有 TTL 且已過期的項目
                if (entry.get('ttl') is not None and
                    current_time - entry['timestamp'] > entry['ttl']):
                    expired_keys.append(key)

            for key in expired_keys:
                self._remove_key(key)

            return len(expired_keys)

    def size(self):
        """獲取快取大小"""
        with self.lock:
            return len(self.cache)

    def clear(self):
        """清空快取"""
        with self.lock:
            self.cache.clear()
            self.access_order.clear()

    def get_stats(self):
        """獲取快取統計資訊"""
        with self.lock:
            current_time = time.time()
            expired_count = 0
            permanent_count = 0

            for entry in self.cache.values():
                if entry.get('ttl') is None:
                    # 永不過期的項目
                    permanent_count += 1
                elif current_time - entry['timestamp'] > entry['ttl']:
                    # 已過期的項目
                    expired_count += 1

            # 從內部統計獲取命中率
            total_requests = getattr(self, '_total_requests', 0)
            cache_hits = getattr(self, '_cache_hits', 0)
            hit_rate = (cache_hits / total_requests * 100) if total_requests > 0 else 0

            return {
                'total_items': len(self.cache),
                'expired_items': expired_count,
                'permanent_items': permanent_count,
                'valid_items': len(self.cache) - expired_count,
                'capacity': self.capacity,
                'usage_ratio': len(self.cache) / self.capacity if self.capacity > 0 else 0,
                'hit_rate': hit_rate,
                'total_requests': total_requests,
                'cache_hits': cache_hits,
                'cache_misses': total_requests - cache_hits
            }

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

# 預生成圖表緩存功能已移到 ExchangeRateManager 的 LRU Cache 中
# chart_cache = {}  # 已移除，使用 LRU Cache
# chart_cache_lock = Lock()  # 已移除，LRU Cache 內建線程安全

class ExchangeRateManager:
    def __init__(self):
        self.data = self.load_data()
        self._network_paused = False
        self._pause_until = 0
        self._pause_lock = Lock()
        self._pause_message_printed = False

        # 確保圖表目錄存在
        self.charts_dir = os.path.join('static', 'charts')
        if not os.path.exists(self.charts_dir):
            os.makedirs(self.charts_dir)

        # 初始化 LRU 快取
        self.lru_cache = LRUCache(capacity=50, ttl_seconds=3600)

        # 簡化快取配置
        self.cache_config = {
            'chart_cache': {
                'capacity': 50,
                'ttl_seconds': 3600,
                'auto_cleanup_interval': 3600
            },
            'warmup_enabled': True,
            'analytics_enabled': True
        }

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
        # 使用 LRU cache 而不是全域 dict
        cache_key = f"chart_TWD_HKD_{days}"
        cached_info = self.lru_cache.get(cache_key)
        
        if cached_info is None:
            return False, "緩存不存在"

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
        with self._pause_lock:
            if self._network_paused:
                if time.time() < self._pause_until:
                    if not self._pause_message_printed:
                        print(f"⏸️ 網路請求已暫停，將於 {datetime.fromtimestamp(self._pause_until).strftime('%H:%M:%S')} 恢復。")
                        self._pause_message_printed = True
                    return None
                else:
                    self._network_paused = False
                    self._pause_until = 0
                    self._pause_message_printed = False
                    print("🟢 網路請求暫停已解除，嘗試恢復。")

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
            print(f"🔍 發送 API 請求獲取 {date.strftime('%Y-%m-%d')} 的匯率數據")
            rate_limiter.wait_if_needed()
            response = requests.get(url, params=params, headers=headers,
                                  timeout=(5, 15))  # 連接超時5秒，讀取超時15秒
            response.raise_for_status()
            data = response.json()

            return data
        except requests.exceptions.RequestException as e:
            # 觸發熔斷機制
            with self._pause_lock:
                if not self._network_paused:
                    pause_duration = 300  # 暫停 5 分鐘
                    self._network_paused = True
                    self._pause_until = time.time() + pause_duration
                    self._pause_message_printed = False
                    print(f"‼️ 偵測到網路錯誤，所有請求將暫停 {pause_duration // 60} 分鐘。")

            error_type = "超時" if isinstance(e, requests.exceptions.Timeout) else "網路錯誤"
            print(f"獲取 {date.strftime('%Y-%m-%d')} 數據時{error_type}: {e}")
            return None
        except Exception as e:
            print(f"獲取 {date.strftime('%Y-%m-%d')} 數據時發生錯誤: {e}")
            return None

    def update_data(self, days=180):  # 默認更新近180天數據
        """數據更新：從最新日期開始補齊到今天，清理舊數據"""
        end_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        start_date = end_date - timedelta(days=days)
        
        print(f"🔍 開始極簡數據更新（從最新日期補齊到今天）...")
        
        # 第一步：找出並清理180天以外的舊數據
        old_count = len(self.data)
        cleaned_data = {}
        removed_count = 0
        removed_dates = []
        
        for date_str, data_entry in self.data.items():
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            # 保留從 start_date 開始的180天數據（包含 start_date）
            if date_obj >= start_date:
                # 保留180天內的數據
                cleaned_data[date_str] = data_entry
            else:
                # 刪除 start_date 之前的數據
                removed_dates.append(date_str)
                removed_count += 1
        
        if removed_count > 0:
            print(f"🗑️ 清理了 {removed_count} 筆180天以外的舊數據")
            self.data = cleaned_data
        
        # 第二步：找到數據中的最新日期
        if self.data:
            latest_date_str = max(self.data.keys())
            latest_date = datetime.strptime(latest_date_str, '%Y-%m-%d')
            print(f"📅 數據中最新日期：{latest_date_str}")
        else:
            # 如果沒有數據，從180天前開始
            latest_date = start_date - timedelta(days=1)
            print(f"📅 數據為空，從 {days} 天前開始獲取")
        
        # 第三步：從最新日期的下一天開始獲取到今天
        start_fetch_date = latest_date + timedelta(days=1)
        updated_count = 0
        
        if start_fetch_date <= end_date:
            print(f"🚀 從 {start_fetch_date.strftime('%Y-%m-%d')} 獲取到 {end_date.strftime('%Y-%m-%d')}")
            
            current_date = start_fetch_date
            while current_date <= end_date:
                date_str = current_date.strftime('%Y-%m-%d')
                
                # 跳過週末
                if current_date.weekday() < 5:  # Monday=0, Friday=4
                    data = self.get_exchange_rate(current_date)
                    
                    if data and 'data' in data:
                        try:
                            conversion_rate = float(data['data']['conversionRate'])
                            self.data[date_str] = {
                                'rate': conversion_rate,
                                'updated': datetime.now().isoformat()
                            }
                            updated_count += 1
                        except (KeyError, ValueError) as e:
                            print(f"    ❌ 解析失敗：{e}")
                    else:
                        print(f"    ⚠️ 無法獲取 {date_str} 的數據")
                
                current_date += timedelta(days=1)
        else:
            print("✅ 數據已是最新狀態，無需API請求")
        
        # 第四步：保存更新結果
        if updated_count > 0 or removed_count > 0:
            self.save_data()
            
            summary_parts = []
            if updated_count > 0:
                summary_parts.append(f"新增 {updated_count} 筆最新數據")
            if removed_count > 0:
                summary_parts.append(f"清理 {removed_count} 筆舊數據")
            
            print(f"💾 極簡更新完成：{', '.join(summary_parts)}")
        else:
            print("✅ 數據已是最新狀態，無需更新")
        
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

                # 如果 get_exchange_rate 回傳 None (網路暫停或已處理的錯誤)，直接返回
                if data is None:
                    return date_str, None

                # 如果 API 回傳的 JSON 結構不完整，但不是網路錯誤
                if attempt < max_retries - 1:
                    print(f"🔄 {date_str}: 無數據，重試 ({attempt + 1}/{max_retries})")
                    time.sleep(1)  # 等待1秒後重試
                    continue
                else:
                    return date_str, None

            except Exception as e:
                print(f"❌ {date_str}: 未知錯誤 - {e}")
                return date_str, None

        return date_str, None

    def get_live_rates_for_period(self, days, from_currency='TWD', to_currency='HKD', max_workers=2):
        """獲取指定期間的即時匯率數據（並行查詢版本，優先最新數據）"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        # 收集所有需要查詢的日期（跳過週末），從最新日期開始
        query_dates = []
        current_date = end_date

        while current_date >= start_date:
            # 跳過週末（Saturday=5, Sunday=6）
            if current_date.weekday() < 5:
                query_dates.append(current_date)
            current_date -= timedelta(days=1)

        # query_dates 現在是從新到舊的順序，這有助於優先處理最新數據
        actual_workers = min(max_workers, len(query_dates))

        rates_data = {}
        successful_queries = 0
        failed_queries = 0
        short_term_chart_generated = False

        print(f"🚀 開始並行查詢 {len(query_dates)} 個日期（優先最新數據）...")

        # 使用線程池進行並行查詢
        with ThreadPoolExecutor(max_workers=actual_workers) as executor:
            # 提交所有查詢任務，優先提交最新日期
            future_to_date = {
                executor.submit(self._fetch_single_rate, date, from_currency, to_currency): date
                for date in query_dates
            }

            # 收集結果，並在獲得足夠短期數據時立即生成圖表
            for future in as_completed(future_to_date):
                try:
                    date_str, rate = future.result(timeout=30)  # 30秒超時
                    if rate is not None:
                        rates_data[date_str] = rate
                        successful_queries += 1
                        
                        # 當獲得足夠的最新數據時，嘗試生成短期圖表
                        if (not short_term_chart_generated and 
                            successful_queries >= 7 and 
                            from_currency == 'TWD' and to_currency == 'HKD'):
                            
                            # 檢查是否有足夠的最新7天數據
                            recent_dates = sorted(rates_data.keys(), reverse=True)[:7]
                            if len(recent_dates) >= 7:
                                print(f"⚡ 已獲得 {successful_queries} 筆數據，優先生成7天即時圖表...")
                                try:
                                    # 創建7天的即時圖表
                                    chart_data = self.create_live_chart(7, from_currency, to_currency)
                                    if chart_data:
                                        print("✅ 7天即時圖表已優先生成")
                                        short_term_chart_generated = True
                                except Exception as e:
                                    print(f"⚠️ 生成7天即時圖表時發生錯誤: {e}")
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
                rates.append(self.data[date_str]['rate'])
            current_date += timedelta(days=1)

        return dates, rates

    def create_chart(self, days, from_currency, to_currency):
        """創建圖表（帶 LRU Cache）"""
        # 使用 LRU cache 而不是全域 dict
        cache_key = f"chart_{from_currency}_{to_currency}_{days}"
        cached_info = self.lru_cache.get(cache_key)
        
        if cached_info is None:
            # 快取未命中，重新生成
            chart_data = self.regenerate_chart_data(days, from_currency, to_currency)
            if chart_data:
                # 返回新生成的數據
                return chart_data
            else:
                # 生成失敗
                return None
        
        # 快取命中且有效
        # 檢查快取中的 URL 是否還存在
        chart_url = cached_info.get('chart_url')
        if chart_url and os.path.exists(os.path.join(self.charts_dir, os.path.basename(chart_url))):
            return cached_info
        else:
            # 文件丟失，重新生成
            return self.regenerate_chart_data(days, from_currency, to_currency)

    def regenerate_chart_data(self, days, from_currency, to_currency):
        """內部輔助函數：重新生成圖表並更新快取"""
        # 獲取數據
        all_dates, all_rates = self.get_rates_for_period(days)
        if not all_dates:
            return None

        # 將 datetime 對象轉換為字串列表
        all_dates_str = [d.strftime('%Y-%m-%d') for d in all_dates]

        # 生成圖表並獲取 URL
        chart_url = self.create_chart_from_data(days, all_dates_str, all_rates, from_currency, to_currency)
        if not chart_url:
            return None

        # 獲取新的數據指紋和統計數據
        data_fingerprint, data_count = self.get_data_fingerprint(days)
        stats = self._calculate_stats(all_rates, all_dates_str)

        # 存入新數據到快取
        cache_key = f"chart_{from_currency}_{to_currency}_{days}"
        new_cache_data = {
            'chart_url': chart_url,
            'stats': stats,
            'generated_at': datetime.now().isoformat(),
            'data_fingerprint': data_fingerprint,
            'data_count': data_count
        }
        self.lru_cache.put(cache_key, new_cache_data)
        
        return new_cache_data

    def create_live_chart(self, days, from_currency='TWD', to_currency='HKD'):
        """創建即時圖表，返回包含 URL 和統計數據的字典"""
        live_rates_data = self.get_live_rates_for_period(days, from_currency, to_currency)

        if not live_rates_data:
            return None

        all_dates_str = sorted(live_rates_data.keys())
        all_rates = [live_rates_data[d] for d in all_dates_str]

        if not all_dates_str:
            return None
        
        chart_url = self.create_chart_from_data(days, all_dates_str, all_rates, from_currency, to_currency)
        if not chart_url:
            return None
            
        stats = self._calculate_stats(all_rates, all_dates_str)
        
        return {
            'chart_url': chart_url,
            'stats': stats,
            'from_cache': False,
            'generated_at': datetime.now().isoformat()
        }

    def create_chart_from_data(self, days, all_dates_str, all_rates, from_currency, to_currency):
        """
        從提供的數據生成圖表，並將其保存為文件，返回其 URL 路徑。
        all_dates_str 應為 'YYYY-MM-DD' 格式的字符串列表。
        """
        if not all_dates_str or not all_rates:
            return None

        # 生成可讀性更高且唯一的檔名
        latest_date_str = all_dates_str[-1] if all_dates_str else "nodate"
        data_str = f"{days}-{from_currency}-{to_currency}-{''.join(all_dates_str)}-{''.join(map(str, all_rates))}"
        chart_hash = hashlib.md5(data_str.encode('utf-8')).hexdigest()
        filename = f"chart_{from_currency}-{to_currency}_{days}d_{latest_date_str}_{chart_hash[:8]}.png"

        relative_path = os.path.join('charts', filename)
        full_path = os.path.join(self.charts_dir, filename)

        if os.path.exists(full_path):
            return f"/static/{relative_path.replace(os.path.sep, '/')}"

        # 創建圖表
        fig, ax = plt.subplots(figsize=(15, 8.5))
        
        # 轉換日期
        dates = [datetime.strptime(d, '%Y-%m-%d') for d in all_dates_str]
        rates = all_rates

        ax.plot(dates, rates, marker='o', linewidth=2, markersize=4, color='#2E86AB')
        
        # 設定標題
        period_names = {7: '近1週', 30: '近1個月', 90: '近3個月', 180: '近6個月'}
        # 假設匯率是 TWD -> HKD，標題顯示 HKD -> TWD，所以是 1 TWD = X HKD
        title = f'{from_currency} 到 {to_currency} 匯率走勢圖 ({period_names.get(days, f"近{days}天")})'
        ax.set_title(title, fontsize=16, fontweight='bold', pad=20)
        ax.set_xlabel('日期', fontsize=12)
        ax.set_ylabel('匯率', fontsize=12)
        
        # 手動設置X軸刻度
        if days <= 7:
            tick_dates = dates
        elif days <= 30:
            tick_dates = dates[::2] if len(dates) > 2 else dates
        elif days <= 90:
            tick_dates = dates[::len(dates)//10] if len(dates) > 10 else dates[::2]
        else:
            tick_dates = dates[::len(dates)//15] if len(dates) > 15 else dates[::3]

        # 確保最後一個日期（今天）總是被包含在刻度中
        if days > 7 and dates and dates[-1] not in tick_dates:
            tick_dates.append(dates[-1])

        ax.set_xticks(tick_dates)
        ax.set_xticklabels([date.strftime('%m/%d') for date in tick_dates])

        ax.tick_params(axis='x', which='major', pad=8)
        
        # 添加網格
        ax.grid(True, alpha=0.3)
        
        # 添加平均線
        if rates:
            avg_rate = sum(rates) / len(rates)
            ax.axhline(y=avg_rate, color='orange', linestyle='--', linewidth=1.5, alpha=0.8, label=f'平均值: {avg_rate:.4f}')
            ax.legend(loc='upper right', fontsize=10)
        
        # 設定 Y 軸範圍
        if rates:
            y_min, y_max = min(rates), max(rates)
            y_range = y_max - y_min if y_max > y_min else 0.1
            if days >= 30:
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.15)
            else:
                ax.set_ylim(y_min - y_range * 0.05, y_max + y_range * 0.12)
        
        # 標記最高點和最低點
        if rates:
            max_rate = max(rates)
            min_rate = min(rates)
            max_index = rates.index(max_rate)
            min_index = rates.index(min_rate)
            
            # 標記最高點
            ax.annotate(f'{max_rate:.4f}', 
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
            ax.annotate(f'{min_rate:.4f}', 
                       (dates[min_index], min_rate), 
                       textcoords="offset points", 
                       xytext=(0,10), # 調整y偏移以避免重疊
                       ha='center',
                       va='bottom',
                       fontsize=9,
                       color='green',
                       fontweight='bold',
                       bbox=dict(boxstyle="round", facecolor='white', alpha=0.6, edgecolor='none'))
        
        # 手動調整佈局
        fig.subplots_adjust(left=0.08, right=0.95, top=0.85, bottom=0.20)
        
        try:
            fig.savefig(full_path, format='png', transparent=False, bbox_inches='tight', facecolor='white')
        except Exception as e:
            print(f"儲存圖表時出錯: {e}")
            plt.close(fig)
            return None
        finally:
            plt.close(fig)
        
        self._cleanup_charts_directory(self.charts_dir, max_age_days=1)
        
        # 返回 Flask 能識別的靜態文件 URL
        return f"/static/{relative_path.replace(os.path.sep, '/')}"

    def pregenerate_all_charts(self):
        """預生成所有期間的圖表"""
        periods = [7, 30, 90, 180]
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 開始預生成圖表...")

        with ThreadPoolExecutor(max_workers=4) as executor:
            future_to_period = {executor.submit(self.create_chart, period, 'TWD', 'HKD'): period for period in periods}
            for future in as_completed(future_to_period):
                period = future_to_period[future]
                try:
                    chart_data = future.result()
                    if chart_data and chart_data.get('chart_url'):
                        print(f"  ✅ 預生成 {period} 天圖表成功")
                    else:
                        print(f"  ❌ 預生成 {period} 天圖表失敗")
                except Exception as e:
                    print(f"  ❌ 預生成 {period} 天圖表時發生錯誤: {e}")
        
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 圖表預生成完成")

    @staticmethod
    def _cleanup_charts_directory(directory, max_age_days=1):
        """清理圖表目錄中的過期文件"""
        try:
            current_time = time.time()
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                if os.path.isfile(file_path):
                    file_age = current_time - os.path.getmtime(file_path)
                    if file_age > max_age_days * 24 * 3600:
                        os.remove(file_path)
        except Exception as e:
            print(f"清理圖表目錄時出錯: {e}")

    def clear_expired_cache(self):
        """清理過期的快取項目"""
        cleared_count = self.lru_cache.clear_expired()
        if cleared_count > 0:
            print(f"🧹 快取清理完成：圖表快取過期 {cleared_count} 項")
        return cleared_count

    def get_cache_stats(self):
        """獲取快取統計資訊"""
        return {'chart_cache': self.lru_cache.get_stats()}

    def clear_all_cache(self):
        """清空所有快取"""
        self.lru_cache.clear()
        self._cleanup_charts_directory(self.charts_dir, max_age_days=0)
        print("🗑️ 已清空所有快取和圖表文件")



    def _calculate_stats(self, rates, dates_str):
        if not rates or not dates_str:
            return None
        return {
            'max_rate': max(rates),
            'min_rate': min(rates),
            'avg_rate': sum(rates) / len(rates),
            'data_points': len(rates),
            'date_range': f"{dates_str[0]} 至 {dates_str[-1]}"
        }

# 創建管理器實例
manager = ExchangeRateManager()

# SSE 相關函數
def send_sse_event(event_type, data):
    """發送SSE事件給所有連接的客戶端"""
    with sse_lock:
        message = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        # 清理邏輯已移至 sse_stream 的 finally 區塊中，此處只需遍歷發送
        for client_queue in list(sse_clients): # 遍歷副本以提高並行安全性
            try:
                # 使用 nowait 避免阻塞，因為隊列無限大，理論上不應滿
                client_queue.put_nowait(message)
            except queue.Full:
                # 雖然理論上不會發生，但作為預防措施
                print(f"[SSE] 警告：客戶端隊列已滿，訊息可能遺失。")

        if sse_clients:
            print(f"[SSE] 已向 {len(sse_clients)} 個客戶端發送 {event_type} 事件")

def sse_stream(client_queue):
    """SSE數據流生成器"""
    try:
        while True:
            try:
                message = client_queue.get(timeout=30)  # 30秒超時
                yield message
            except queue.Empty:
                # 發送心跳包保持連接
                yield "event: heartbeat\ndata: {}\n\n"
    except GeneratorExit:
        # 當客戶端斷開連接時，Flask/Werkzeug 會引發 GeneratorExit
        print("[SSE] 客戶端已斷開連接 (GeneratorExit)。")
    finally:
        # 無論如何都從列表中移除客戶端
        with sse_lock:
            try:
                sse_clients.remove(client_queue)
                print(f"[SSE] 客戶端已清除，剩餘連接數: {len(sse_clients)}")
            except ValueError:
                # 如果隊列因為某些原因已經被移除，忽略錯誤
                pass

# 定時更新函數
def scheduled_update():
    """定時更新匯率資料"""
    try:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 開始執行定時更新...")
        today = datetime.now()
        today_str = today.strftime('%Y-%m-%d')

        # 檢查今天的資料是否已存在
        if today_str in manager.data:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 今天({today_str})的資料已存在，無需更新")
            return

        # 只獲取今天的資料
        print(f"正在獲取 {today_str} 的匯率資料...")
        data = manager.get_exchange_rate(today)

        if data and 'data' in data:
            try:
                conversion_rate = float(data['data']['conversionRate'])
                manager.data[today_str] = {
                    'rate': conversion_rate,
                    'updated': datetime.now().isoformat()
                }
                manager.save_data()
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 定時更新完成，成功獲取今天的匯率: {conversion_rate}")

                # 預生成所有圖表
                manager.pregenerate_all_charts()

                # 發送SSE事件通知前端更新
                send_sse_event('rate_updated', {
                    'date': today_str,
                    'rate': conversion_rate,  # 保持原始匯率
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
# 每小時清理一次過期快取
schedule.every().hour.do(lambda: manager.clear_expired_cache())

@app.route('/')
def index():
    """主頁面"""
    return render_template('index.html')

@app.route('/api/chart')
def get_chart():
    """獲取圖表API - 支援多幣種並統一使用伺服器快取"""
    period = request.args.get('period', '7')
    from_currency = request.args.get('from_currency', 'TWD')
    to_currency = request.args.get('to_currency', 'HKD')
    force_live = request.args.get('force_live', 'false').lower() == 'true'

    try:
        days = int(period)
    except ValueError:
        days = 7

    try:
        if force_live:
            chart_data = manager.create_live_chart(days, from_currency, to_currency)
        else:
            chart_data = manager.create_chart(days, from_currency, to_currency)

        if chart_data and chart_data.get('chart_url'):
            return jsonify(chart_data)
        else:
            return jsonify({'error': '無法生成圖表', 'no_data': True}), 500
            
    except Exception as e:
        print(f"處理圖表請求時發生未預期的錯誤: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': '伺服器內部錯誤'}), 500

@app.route('/api/data_status')
def data_status():
    """檢查數據狀態"""
    total_records = len(manager.data)

    if total_records > 0:
        dates = manager.get_sorted_dates()
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
            if not manager.data:
                return jsonify({
                    'success': False,
                    'message': '無TWD-HKD匯率數據，請先更新數據'
                }), 400

            # 獲取最新日期的匯率
            dates = manager.get_sorted_dates()
            latest_date = dates[-1]
            latest_data = manager.data[latest_date]

            # 計算 1 TWD 等於多少 HKD
            twd_to_hkd_rate = latest_data['rate']

            # 計算趨勢（與前一天比較）
            trend = None
            trend_value = 0
            if len(dates) > 1:
                prev_date = dates[-2]
                prev_data = manager.data[prev_date]
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


            rate_data = manager.get_exchange_rate(current_date, from_currency, to_currency)

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

@app.route('/api/force_cleanup_data')
def force_cleanup_data():
    """強制清理並更新近180天資料API"""
    try:
        print("🔄 強制執行180天資料清理...")
        old_count = len(manager.data)

        # 強制更新近180天資料（會自動清理超過180天的舊資料）
        updated_count = manager.update_data(180)
        new_count = len(manager.data)
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

        # 先清除該期間的緩存（使用 LRU cache）
        cache_key = f"chart_TWD_HKD_{days}"
        # LRU cache 不需要手動刪除，只需重新生成即可覆蓋

        # 重新生成圖表
        print(f"🔄 強制重新生成近{days}天圖表...")
        chart_data = manager.create_chart(days, 'TWD', 'HKD')

        if chart_data is None:
            return jsonify({
                'success': False,
                'message': '無法生成圖表，請檢查數據'
            }), 400

        img_base64, stats = chart_data

        # 獲取數據指紋並保存到緩存（使用 LRU cache）
        data_fingerprint, data_count = manager.get_data_fingerprint(days)
        
        cache_data = {
            'chart': img_base64,
            'stats': stats,
            'generated_at': datetime.now().isoformat(),
            'data_fingerprint': data_fingerprint,
            'data_count': data_count
        }
        manager.lru_cache.put(cache_key, cache_data)

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
    # 伺服器啟動時，清空舊的圖表文件
    print("🧹 清理舊的圖表文件...")
    manager._cleanup_charts_directory(manager.charts_dir, max_age_days=0)

    # 啟動時強制執行180天資料更新（自動清理舊資料）
    manager.update_data(180)  # 強制更新近180天，自動清理舊資料

    # 預生成圖表緩存
    manager.pregenerate_all_charts()



    # 啟動定時任務背景執行緒
    scheduler_thread = Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()

    app.run()