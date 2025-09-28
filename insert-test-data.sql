-- 插入测试数据到products表
-- 插入产品测试数据
INSERT OR IGNORE INTO products (sku) VALUES ('PROD001');
INSERT OR IGNORE INTO products (sku) VALUES ('PROD002');
INSERT OR IGNORE INTO products (sku) VALUES ('PROD003');

-- 插入带分销商信息的溯源码测试数据
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TEST123', 'DARK456', '上海分销商');
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TEST456', 'DARK789', '北京分销商');
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TEST789', 'DARK123', '广州分销商');
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TEST321', 'DARK654', '深圳分销商');
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TEST654', 'DARK987', '杭州分销商');

-- 关联产品到溯源码
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD001') WHERE code = 'TEST123';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD001') WHERE code = 'TEST321';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD002') WHERE code = 'TEST456';
UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD003') WHERE code = 'TEST789';

-- 插入一些额外的未关联溯源码
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TESTABC', 'DARKXYZ', '未分配分销商');
INSERT OR IGNORE INTO traceability_codes (code, dark_code, distributor) VALUES ('TESTDEF', 'DARKUVW', '未分配分销商');