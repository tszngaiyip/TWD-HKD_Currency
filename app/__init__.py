from flask import Flask
import os
import matplotlib
import matplotlib.font_manager as fm
from .services import ExchangeRateManager
from .scheduler import init_scheduler

def create_app():
    # 設定非 GUI 後端
    matplotlib.use('Agg')

    app = Flask(__name__, static_folder='../static', template_folder='../templates')
    
    # 建立服務實例並附加到 app
    app.manager = ExchangeRateManager()

    with app.app_context():
        # 設定中文字體
        font_path = os.path.join(os.path.dirname(__file__), '..', 'fonts', 'NotoSansTC-Regular.ttf')
        if os.path.exists(font_path):
            fm.fontManager.addfont(font_path)
            font_prop = fm.FontProperties(fname=font_path)
            matplotlib.rcParams['font.sans-serif'] = [font_prop.get_name()]
        else:
            try:
                matplotlib.rcParams['font.sans-serif'] = ['Noto Sans CJK TC']
                print("使用系統字體: Noto Sans CJK TC")
            except:
                matplotlib.rcParams['font.sans-serif'] = ['DejaVu Sans']
                print("警告: 未找到中文字體，請將 NotoSansTC-Regular.ttf 放入 fonts/ 資料夾")
        matplotlib.rcParams['axes.unicode_minus'] = False
        
        # 引入並註冊藍圖
        from . import routes
        app.register_blueprint(routes.bp)

        # 在應用程式啟動時執行一次性任務
        print("🧹 清理舊的圖表文件...")
        app.manager._cleanup_charts_directory(app.manager.charts_dir, max_age_days=0)
        
        print("🔄 啟動時更新數據...")
        app.manager.update_data(180)
        
        print("📊 預生成圖表...")
        app.manager.warm_up_chart_cache()

        # 啟動定時任務
        init_scheduler(app)

    return app 