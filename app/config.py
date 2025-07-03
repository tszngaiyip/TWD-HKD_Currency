import os

class Config:
    """應用程式設定"""
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev') 