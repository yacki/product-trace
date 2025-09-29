const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// 确保测试环境清洁
function resetDatabase() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync('products.db')) {
            fs.unlinkSync('products.db');
            console.log('已删除旧数据库文件');
        }
        
        // 初始化新数据库
        const initDatabase = "sqlite3 products.db \"" +
            "CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, sku VARCHAR(50) UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);" +
            "CREATE TABLE IF NOT EXISTS traceability_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code VARCHAR(50) UNIQUE, dark_code VARCHAR(50) UNIQUE, product_id INTEGER, distributor VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(product_id) REFERENCES products(id));" +
            "CREATE VIEW IF NOT EXISTS product_view AS SELECT tc.code, tc.dark_code, p.sku, tc.distributor, tc.created_at FROM traceability_codes tc LEFT JOIN products p ON tc.product_id = p.id;\"";
        
        exec(initDatabase, (error, stdout, stderr) => {
            if (error) {
                reject(`数据库初始化错误: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`数据库初始化 stderr: ${stderr}`);
            }
            resolve();
        });
    });
}

// 导入测试用的溯源码
function importTestCode() {
    return new Promise((resolve, reject) => {
        const sql = `sqlite3 products.db "INSERT INTO traceability_codes (code, dark_code) VALUES ('TESTCODE123', 'DARKCODE123')"`;
        
        exec(sql, (error, stdout, stderr) => {
            if (error) {
                reject(`导入溯源码错误: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`导入溯源码 stderr: ${stderr}`);
            }
            resolve();
        });
    });
}

// 录入初始产品信息
function insertInitialProduct() {
    return new Promise((resolve, reject) => {
        // 首先获取溯源码的ID
        const getCodeIdSql = `sqlite3 -json products.db "SELECT id FROM traceability_codes WHERE code = 'TESTCODE123'"`;
        
        exec(getCodeIdSql, (error, stdout) => {
            if (error) {
                reject(`获取溯源码ID错误: ${error.message}`);
                return;
            }
            
            try {
                const codeResults = JSON.parse(stdout);
                if (codeResults.length === 0) {
                    reject('未找到测试溯源码');
                    return;
                }
                
                const codeId = codeResults[0].id;
                
                // 插入产品并关联
                const insertProductSql = `sqlite3 products.db "INSERT INTO products (sku) VALUES ('PROD-001'); UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD-001'), distributor = '分销商A' WHERE id = ${codeId}"`;
                
                exec(insertProductSql, (error, stdout, stderr) => {
                    if (error) {
                        reject(`插入产品错误: ${error.message}`);
                        return;
                    }
                    if (stderr) {
                        console.error(`插入产品 stderr: ${stderr}`);
                    }
                    resolve(codeId);
                });
            } catch (parseError) {
                reject(`数据解析错误: ${parseError.message}`);
            }
        });
    });
}

// 测试编辑产品信息
function testEditProduct(codeId) {
    return new Promise((resolve, reject) => {
        // 模拟API调用：更新产品信息
        const updateProductSql = `sqlite3 products.db "INSERT OR IGNORE INTO products (sku) VALUES ('PROD-002'); UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = 'PROD-002'), distributor = '分销商B' WHERE id = ${codeId}"`;
        
        exec(updateProductSql, (error, stdout, stderr) => {
            if (error) {
                reject(`更新产品信息错误: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`更新产品信息 stderr: ${stderr}`);
            }
            resolve();
        });
    });
}

// 验证编辑结果
function verifyEditResult() {
    return new Promise((resolve, reject) => {
        const verifySql = `sqlite3 -json products.db "SELECT tc.id, tc.code, p.sku, tc.distributor FROM traceability_codes tc JOIN products p ON tc.product_id = p.id WHERE tc.code = 'TESTCODE123'"`;
        
        exec(verifySql, (error, stdout) => {
            if (error) {
                reject(`验证结果错误: ${error.message}`);
                return;
            }
            
            try {
                const results = JSON.parse(stdout);
                if (results.length === 0) {
                    reject('未找到更新后的产品信息');
                    return;
                }
                
                const product = results[0];
                console.log('更新后的产品信息:', product);
                
                // 验证SKU和分销商是否已更新
                if (product.sku === 'PROD-002' && product.distributor === '分销商B') {
                    resolve(true);
                } else {
                    reject(`验证失败: 预期SKU=PROD-002, distributor=分销商B，实际SKU=${product.sku}, distributor=${product.distributor}`);
                }
            } catch (parseError) {
                reject(`数据解析错误: ${parseError.message}`);
            }
        });
    });
}

// 运行测试
async function runTest() {
    try {
        console.log('开始测试编辑产品信息功能...');
        
        await resetDatabase();
        console.log('数据库重置完成');
        
        await importTestCode();
        console.log('测试溯源码导入完成');
        
        const codeId = await insertInitialProduct();
        console.log('初始产品信息录入完成，溯源码ID:', codeId);
        
        await testEditProduct(codeId);
        console.log('产品信息更新完成');
        
        const isSuccess = await verifyEditResult();
        
        if (isSuccess) {
            console.log('测试通过！产品信息编辑功能正常工作。');
            process.exit(0);
        } else {
            console.error('测试失败：产品信息未正确更新。');
            process.exit(1);
        }
    } catch (error) {
        console.error('测试过程中出错:', error);
        process.exit(1);
    }
}

// 执行测试
runTest();