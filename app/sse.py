import json
import queue
from threading import Lock

sse_clients = []
sse_lock = Lock()

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