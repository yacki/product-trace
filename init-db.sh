#!/bin/bash

# 检查是否已安装sqlite3
if ! command -v sqlite3 &> /dev/null
then
    echo "错误: 未安装sqlite3。请先安装它，例如使用 'brew install sqlite3'（Mac）或 'sudo apt install sqlite3'（Linux）"
    exit 1
fi

# 清理旧的数据库文件（测试用）
if [ -f "products.db" ]; then
    rm products.db
    echo "已清理旧数据库文件"
fi

# 创建产品表
echo "创建products表..."
sqlite3 products.db "CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);"

# 创建溯源码表
echo "创建traceability_codes表..."
sqlite3 products.db "CREATE TABLE IF NOT EXISTS traceability_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(50) UNIQUE,
    dark_code VARCHAR(50) UNIQUE,
    product_id INTEGER,
    distributor VARCHAR(100), -- 分销商字段
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id)
);"

# 创建视图
echo "创建product_view视图..."
sqlite3 products.db "CREATE VIEW IF NOT EXISTS product_view AS 
SELECT tc.code, tc.dark_code, p.sku, tc.distributor, tc.created_at 
FROM traceability_codes tc LEFT JOIN products p ON tc.product_id = p.id;"

# 创建uploads目录
if [ ! -d "uploads" ]; then
    mkdir -p uploads
    echo "uploads目录已创建"
fi

echo "数据库初始化成功！所有表和视图已创建。"

# 检查是否创建成功
if [ $? -eq 0 ]
then
    echo "数据库初始化成功！所有表和视图已创建。"
else
    echo "数据库初始化失败，请检查错误信息。"
fi