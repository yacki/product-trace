#!/bin/bash

# 检查是否已安装sqlite3
if ! command -v sqlite3 &> /dev/null
then
    echo "错误: 未安装sqlite3。请先安装它，例如使用 'brew install sqlite3'（Mac）或 'sudo apt install sqlite3'（Linux）"
    exit 1
fi

# 创建数据库和表
sqlite3 products.db <<EOF
-- 创建产品信息表
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku VARCHAR(50) UNIQUE,
    origin VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建溯源信息表（存储二维码信息，并直接关联产品）
CREATE TABLE IF NOT EXISTS traceability_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(50) UNIQUE,
    dark_code VARCHAR(50) UNIQUE,
    product_id INTEGER, -- 直接关联产品ID
    FOREIGN KEY (product_id) REFERENCES products(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建视图，方便查询产品信息
CREATE VIEW IF NOT EXISTS product_view AS 
SELECT 
    tc.code,
    tc.dark_code,
    p.sku,
    p.origin,
    tc.created_at
FROM 
    traceability_codes tc
LEFT JOIN 
    products p ON tc.product_id = p.id;

-- 创建uploads目录（如果不存在）
EOF

if [ ! -d "uploads" ]; then
    mkdir -p uploads
    echo "uploads目录已创建"
fi

# 检查是否创建成功
if [ $? -eq 0 ]
then
    echo "数据库初始化成功！所有表和视图已创建。"
else
    echo "数据库初始化失败，请检查错误信息。"
fi