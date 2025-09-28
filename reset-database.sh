#!/bin/bash

# 备份现有数据库（如果存在）
if [ -f "products.db" ]; then
    TIMESTAMP=$(date +%Y%m%d%H%M%S)
    cp products.db "products_backup_$TIMESTAMP.db"
    echo "数据库已备份为 products_backup_$TIMESTAMP.db"
fi

# 删除现有数据库
rm -f products.db

# 创建uploads目录（如果不存在）
mkdir -p uploads

# 初始化新的数据库结构（合并traceability_product到traceability_codes）
cat reset-database-new.sql | sqlite3 products.db

# 重启服务器
echo "数据库已重置并初始化新的表结构。请手动重启服务器使更改生效。"