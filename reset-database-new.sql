-- 重置数据库并应用新的表结构（合并traceability_product到traceability_codes）

-- 首先删除现有的表（注意：这会删除所有现有数据）
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS traceability_codes;

-- 创建产品信息表
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku VARCHAR(50) UNIQUE,
    origin VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建溯源信息表（存储二维码信息，并直接关联产品）
CREATE TABLE traceability_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(50) UNIQUE,
    dark_code VARCHAR(50) UNIQUE,
    product_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 注：product_id字段直接关联产品ID，替代原来的traceability_product中间表

-- 创建视图，方便查询产品信息
CREATE VIEW product_view AS 
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

-- 插入一些测试数据
INSERT INTO products (sku, origin) VALUES ('PROD001', '中国上海');
INSERT INTO products (sku, origin) VALUES ('PROD002', '中国北京');

INSERT INTO traceability_codes (code, dark_code) VALUES ('TEST123', 'DARK456');
INSERT INTO traceability_codes (code, dark_code) VALUES ('TEST456', 'DARK789');
INSERT INTO traceability_codes (code, dark_code) VALUES ('TEST789', 'DARK123');

-- 关联一些产品到溯源码
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD001') WHERE code = 'TEST123';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD002') WHERE code = 'TEST456';