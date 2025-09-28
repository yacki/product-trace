-- 插入测试数据到products表
-- 插入产品测试数据
INSERT OR IGNORE INTO products (sku, origin) VALUES ('PROD001', '中国上海');
INSERT OR IGNORE INTO products (sku, origin) VALUES ('PROD002', '中国北京');
INSERT OR IGNORE INTO products (sku, origin) VALUES ('PROD003', '中国广州');

-- 插入溯源码测试数据
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TEST123', 'DARK456');
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TEST456', 'DARK789');
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TEST789', 'DARK123');
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TEST321', 'DARK654');
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TEST654', 'DARK987');

-- 关联产品到溯源码
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD001') WHERE code = 'TEST123';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD001') WHERE code = 'TEST321';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD002') WHERE code = 'TEST456';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD003') WHERE code = 'TEST789';

-- 插入一些额外的未关联溯源码
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TESTABC', 'DARKXYZ');
INSERT OR IGNORE INTO traceability_codes (code, dark_code) VALUES ('TESTDEF', 'DARKUVW');