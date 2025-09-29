const fs = require('fs');
const { exec } = require('child_process');

// 清理旧的数据库文件
console.log('清理旧的数据库文件...');
if (fs.existsSync('products.db')) {
    fs.unlinkSync('products.db');
    console.log('已删除旧的数据库文件');
}

// 导入server.js模块
const server = require('./server');

// 初始化数据库
console.log('初始化新的数据库...');
server.initDatabase();

// 等待数据库初始化完成
sleep(1000);

// 测试产品录入功能
console.log('\n测试产品录入功能...');
const testProduct = {
    code: 'test-code-123',
    sku: 'PROD-001',
    distributor: '测试分销商ABC'
};

// 先导入二维码信息
const importCodeSql = `INSERT INTO traceability_codes (code, dark_code) VALUES ('${testProduct.code}', 'dark-${testProduct.code}')`;
exec(`sqlite3 products.db "${importCodeSql}"`, (error, stdout, stderr) => {
    if (error) {
        console.error(`导入二维码信息失败: ${error.message}`);
        return;
    }
    console.log('成功导入二维码信息');
    
    // 录入产品信息（模拟API调用）
    const insertProductSql = `INSERT OR IGNORE INTO products (sku) VALUES ('${testProduct.sku}')`;
    const linkProductSql = `UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = '${testProduct.sku}'), distributor = '${testProduct.distributor}' WHERE code = '${testProduct.code}'`;
    
    exec(`sqlite3 products.db "${insertProductSql}; ${linkProductSql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`录入产品信息失败: ${error.message}`);
            return;
        }
        console.log('成功录入产品信息');
        
        // 测试产品查询功能
        console.log('\n测试产品查询功能...');
        const querySql = `SELECT sku, distributor FROM product_view WHERE dark_code = 'dark-${testProduct.code}'`;
        
        exec(`sqlite3 -json products.db "${querySql}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`查询产品信息失败: ${error.message}`);
                return;
            }
            
            try {
                const results = JSON.parse(stdout);
                if (results.length > 0) {
                    console.log('查询结果:');
                    console.log(`  SKU: ${results[0].sku}`);
                    console.log(`  分销商: ${results[0].distributor}`);
                    
                    // 验证结果是否正确
                    if (results[0].sku === testProduct.sku && results[0].distributor === testProduct.distributor) {
                        console.log('\n✓ 验证通过: 产品信息正确存储并返回分销商信息');
                    } else {
                        console.error('✗ 验证失败: 返回的产品信息与预期不符');
                    }
                } else {
                    console.error('✗ 查询失败: 未找到产品信息');
                }
            } catch (parseError) {
                console.error(`解析查询结果失败: ${parseError.message}`);
            }
        });
    });
});

// 辅助函数: 等待指定毫秒数
function sleep(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {}
}