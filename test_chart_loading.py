#!/usr/bin/env python3
"""
簡單的測試腳本來驗證圖表載入和request發送功能
Test script to verify chart loading and request sending functionality
"""

import requests
import json
import time

BASE_URL = "http://127.0.0.1:5000"

def test_api_endpoints():
    """測試API端點"""
    print("🧪 測試API端點...")
    
    # 測試圖表API
    test_cases = [
        {"period": "7", "buy_currency": "TWD", "sell_currency": "HKD"},
        {"period": "30", "buy_currency": "TWD", "sell_currency": "HKD"},
        {"period": "90", "buy_currency": "TWD", "sell_currency": "HKD"},
        {"period": "180", "buy_currency": "TWD", "sell_currency": "HKD"},
    ]
    
    for case in test_cases:
        print(f"  📊 測試圖表API: {case['period']}天 {case['buy_currency']}-{case['sell_currency']}")
        response = requests.get(f"{BASE_URL}/api/chart", params=case, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if 'chart_url' in data and 'stats' in data:
                print(f"    ✅ 成功: 圖表URL={data['chart_url']}, 數據點={data['stats'].get('data_points', 'N/A')}")
            else:
                print(f"    ❌ 失敗: 響應缺少必要字段")
                return False
        else:
            print(f"    ❌ 失敗: HTTP {response.status_code}")
            return False
    
    # 測試最新匯率API
    print("  💰 測試最新匯率API")
    response = requests.get(f"{BASE_URL}/api/latest_rate", 
                          params={"buy_currency": "TWD", "sell_currency": "HKD"}, 
                          timeout=10)
    
    if response.status_code == 200:
        data = response.json()
        if 'rate' in data and 'date' in data:
            print(f"    ✅ 成功: 匯率={data['rate']}, 日期={data['date']}")
        else:
            print(f"    ❌ 失敗: 響應缺少必要字段")
            return False
    else:
        print(f"    ❌ 失敗: HTTP {response.status_code}")
        return False
    
    # 測試預生成API
    print("  🚀 測試預生成API")
    response = requests.get(f"{BASE_URL}/api/pregenerate_charts", 
                          params={"buy_currency": "TWD", "sell_currency": "HKD"}, 
                          timeout=10)
    
    if response.status_code == 200:
        data = response.json()
        if 'success' in data and data['success']:
            print(f"    ✅ 成功: {data.get('message', '無訊息')}")
        else:
            print(f"    ❌ 失敗: 預生成未成功")
            return False
    else:
        print(f"    ❌ 失敗: HTTP {response.status_code}")
        return False
    
    return True

def test_chart_files_exist():
    """測試圖表文件是否存在"""
    print("📁 檢查圖表文件...")
    import os
    
    charts_dir = "static/charts"
    if not os.path.exists(charts_dir):
        print(f"    ❌ 圖表目錄不存在: {charts_dir}")
        return False
    
    chart_files = [f for f in os.listdir(charts_dir) if f.endswith('.png')]
    if len(chart_files) == 0:
        print(f"    ❌ 沒有找到圖表文件")
        return False
    
    print(f"    ✅ 找到 {len(chart_files)} 個圖表文件")
    for file in chart_files[:3]:  # 顯示前3個文件
        print(f"      - {file}")
    
    return True

def main():
    """主測試函數"""
    print("🔍 開始測試圖表載入和request發送功能...")
    print("=" * 50)
    
    start_time = time.time()
    
    try:
        # 測試API端點
        if not test_api_endpoints():
            print("❌ API端點測試失敗")
            return False
        
        # 測試圖表文件
        if not test_chart_files_exist():
            print("❌ 圖表文件測試失敗")
            return False
        
        end_time = time.time()
        print("=" * 50)
        print(f"✅ 所有測試通過! 耗時: {end_time - start_time:.2f}秒")
        return True
        
    except requests.RequestException as e:
        print(f"❌ 網路請求錯誤: {e}")
        return False
    except Exception as e:
        print(f"❌ 測試過程中發生錯誤: {e}")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)