from flask import Blueprint, render_template, request, jsonify
from app import manager

# 主路由 Blueprint
main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    return render_template('index.html')

# API 路由: Chart
@main_bp.route('/api/chart')
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
    
# TODO: 繼續搬移其他 API 路由 