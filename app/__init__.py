from flask import Flask

# 建立 Flask 應用工廠
def create_app():
    app = Flask(__name__, instance_relative_config=True)
    # 載入設定
    app.config.from_object('app.config.Config')
    # 註冊路由 Blueprint
    from app.routes import main_bp
    app.register_blueprint(main_bp)
    return app 