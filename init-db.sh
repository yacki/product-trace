#!/bin/bash

# 检查是否已安装sqlite3
if ! command -v sqlite3 &> /dev/null
then
    echo "错误: 未安装sqlite3。请先安装它，例如使用 'brew install sqlite3'（Mac）或 'sudo apt install sqlite3'（Linux）"
    exit 1
fi

# 创建数据库和表
sqlite3 products.db "CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(50) UNIQUE,
    dark_code VARCHAR(50) UNIQUE,
    sku VARCHAR(50),
    origin VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);"

# 检查是否创建成功
if [ $? -eq 0 ]
then
    echo "数据库初始化成功！products表已创建。"
else
    echo "数据库初始化失败，请检查错误信息。"
fi