import schedule
import time
from datetime import datetime
from threading import Thread
from .sse import send_sse_event

_app = None

def scheduled_update():
    """定時更新匯率資料"""
    if not _app:
        return
        
    with _app.app_context():
        manager = _app.manager
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
                        'rate': conversion_rate,
                        'updated_time': datetime.now().isoformat(),
                        'message': f'成功獲取 {today_str} 的匯率資料'
                    })

                except (KeyError, ValueError) as e:
                    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 解析今天的資料時發生錯誤: {e}")
            else:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 無法獲取今天的匯率資料")

        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 定時更新失敗: {str(e)}")

def clear_cache_with_context():
    """帶上下文清理緩存"""
    if not _app:
        return
    with _app.app_context():
        _app.manager.clear_expired_cache()

def run_scheduler():
    """在背景執行緒中執行定時任務"""
    while True:
        schedule.run_pending()
        time.sleep(60)

def init_scheduler(app):
    """初始化並啟動排程"""
    global _app
    _app = app
    
    schedule.every().day.at("09:00").do(scheduled_update)
    schedule.every().hour.do(clear_cache_with_context)
    
    scheduler_thread = Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    print("✅ 定時任務已啟動。") 