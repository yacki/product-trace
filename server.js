const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { exec } = require('child_process');
const app = express();
const PORT = 3001;

// 配置文件上传
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// 检查并创建数据库
function initDatabase() {
    if (!fs.existsSync('products.db')) {
        // 导入分离表结构的SQL脚本
        const sqlScript = fs.readFileSync('init-separate-tables.sql', 'utf8');
        exec(`sqlite3 products.db "${sqlScript.replace(/"/g, '""')}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`数据库初始化错误: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`数据库初始化 stderr: ${stderr}`);
                return;
            }
            console.log('数据库初始化成功 - 使用分离的表结构');
        });
    }
}

// 初始化数据库
initDatabase();

// 中间件
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// API路由

// 导入二维码信息（明码和暗码的对应关系）
app.post('/api/import-codes', (req, res) => {
    const { code, dark_code } = req.body;
    
    // 验证输入
    if (!code || !dark_code) {
        return res.status(400).json({ success: false, message: '请填写明码和暗码' });
    }
    
    // 使用SQLite命令插入到溯源信息表
    const sql = `INSERT INTO traceability_codes (code, dark_code) VALUES ('${code}', '${dark_code}')`;
    
    exec(`sqlite3 products.db "${sql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`导入二维码信息错误: ${error.message}`);
            if (error.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, message: '明码或暗码已存在' });
            }
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`导入二维码信息 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        res.json({ success: true, message: '二维码信息导入成功' });
    });
});

// 录入产品信息
app.post('/api/products', (req, res) => {
    const { code, sku, origin } = req.body;
    
    // 验证输入
    if (!code || (!sku && !req.body.productId)) {
        return res.status(400).json({ success: false, message: '请填写明码和选择产品' });
    }
    
    // 事务处理：先检查溯源码是否存在，然后关联产品
    const checkCodeExists = `SELECT id FROM traceability_codes WHERE code = '${code}'`;
    
    exec(`sqlite3 -json products.db "${checkCodeExists}"`, (checkError, checkStdout) => {
        if (checkError) {
            console.error(`检查明码错误: ${checkError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const codeResults = JSON.parse(checkStdout);
            if (codeResults.length === 0) {
                return res.status(404).json({ success: false, message: '未找到对应的明码，请先导入二维码信息' });
            }
            
            const codeId = codeResults[0].id;
            
            // 如果提供了productId，直接使用现有产品
            if (req.body.productId) {
                const linkProductSql = `UPDATE traceability_codes SET product_id = ${req.body.productId} WHERE id = ${codeId}`;
                
                exec(`sqlite3 products.db "${linkProductSql}"`, (linkError, linkStdout, linkStderr) => {
                    if (linkError || linkStderr) {
                        console.error(`关联产品错误: ${linkError?.message || linkStderr}`);
                        return res.status(500).json({ success: false, message: '服务器内部错误' });
                    }
                    res.json({ success: true, message: '产品信息录入成功' });
                });
            } else {
                // 否则创建新产品并关联
                const insertProductSql = `INSERT OR IGNORE INTO products (sku, origin) VALUES ('${sku}', '${origin}')`;
                const linkProductSql = `UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = '${sku}') WHERE id = ${codeId}`;
                
                exec(`sqlite3 products.db "${insertProductSql}; ${linkProductSql}"`, (error, stdout, stderr) => {
                    if (error || stderr) {
                        console.error(`录入产品信息错误: ${error?.message || stderr}`);
                        return res.status(500).json({ success: false, message: '服务器内部错误' });
                    }
                    res.json({ success: true, message: '产品信息录入成功' });
                });
            }
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 查询产品信息
app.get('/api/products/:dark_code', (req, res) => {
    const { dark_code } = req.params;
    
    // 使用视图查询产品信息
    const sql = `SELECT sku, origin FROM product_view WHERE dark_code = '${dark_code}'`;
    
    exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`查询数据错误: ${error.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`查询数据 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const results = JSON.parse(stdout);
            if (results.length === 0) {
                return res.json({ success: false, message: '未找到该产品信息，可能是假货' });
            }
            res.json({ success: true, product: results[0] });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 获取产品库列表
app.get('/api/product-library', (req, res) => {
    const sql = `SELECT id, sku, origin FROM products`;
    
    exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`查询产品库错误: ${error.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`查询产品库 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const results = JSON.parse(stdout);
            res.json({ success: true, products: results });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 批量导入二维码信息（CSV文件）
app.post('/api/batch-import-codes', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '请选择CSV文件' });
    }
    
    const results = [];
    const errors = [];
    
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            if (row.code && row.dark_code) {
                results.push(row);
            } else {
                errors.push(`缺少必要字段: ${JSON.stringify(row)}`);
            }
        })
        .on('end', () => {
            // 删除临时文件
            fs.unlinkSync(req.file.path);
            
            if (errors.length > 0) {
                return res.status(400).json({ success: false, message: 'CSV文件格式错误', errors });
            }
            
            if (results.length === 0) {
                return res.status(400).json({ success: false, message: 'CSV文件没有有效数据' });
            }
            
            // 构建批量插入SQL到溯源信息表
            let sql = 'INSERT INTO traceability_codes (code, dark_code) VALUES ';
            const values = [];
            
            results.forEach((row) => {
                values.push(`('${row.code.trim()}', '${row.dark_code.trim()}')`);
            });
            
            sql += values.join(', ') + ';';
            
            exec(`sqlite3 products.db "${sql}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`批量导入二维码信息错误: ${error.message}`);
                    if (error.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ success: false, message: '存在重复的明码或暗码' });
                    }
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                if (stderr) {
                    console.error(`批量导入二维码信息 stderr: ${stderr}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                
                res.json({ success: true, message: `成功导入 ${results.length} 条二维码信息` });
            });
        })
        .on('error', (error) => {
            // 删除临时文件
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            
            console.error(`读取CSV文件错误: ${error.message}`);
            res.status(500).json({ success: false, message: '读取CSV文件错误' });
        });
});

// 获取所有二维码信息列表
app.get('/api/get-codes', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;
    
    // 查询总数
    const countSql = `SELECT COUNT(*) as total FROM traceability_codes`;
    
    exec(`sqlite3 -json products.db "${countSql}"`, (countError, countStdout) => {
        if (countError) {
            console.error(`查询二维码总数错误: ${countError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const countResult = JSON.parse(countStdout);
            const total = countResult[0].total;
            
            // 查询分页数据
            const sql = `SELECT id, code, dark_code, product_id, created_at FROM traceability_codes ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
            
            exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`查询二维码信息错误: ${error.message}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                if (stderr) {
                    console.error(`查询二维码信息 stderr: ${stderr}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                
                try {
                    const results = JSON.parse(stdout);
                    res.json({
                        success: true,
                        codes: results,
                        total: total,
                        page: page,
                        pageSize: pageSize,
                        totalPages: Math.ceil(total / pageSize)
                    });
                } catch (parseError) {
                    res.status(500).json({ success: false, message: '数据解析错误' });
                }
            });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 获取所有产品信息列表（关联了溯源码的产品）
app.get('/api/get-products', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;
    
    // 查询总数
    const countSql = `SELECT COUNT(DISTINCT product_id) as total FROM traceability_codes WHERE product_id IS NOT NULL`;
    
    exec(`sqlite3 -json products.db "${countSql}"`, (countError, countStdout) => {
        if (countError) {
            console.error(`查询产品总数错误: ${countError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const countResult = JSON.parse(countStdout);
            const total = countResult[0].total;
            
            // 查询分页数据，获取已关联产品的溯源码信息
            const sql = `SELECT tc.id, tc.code, tc.dark_code, p.sku, p.origin, tc.created_at 
                        FROM traceability_codes tc 
                        JOIN products p ON tc.product_id = p.id 
                        ORDER BY tc.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
            
            exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`查询产品信息错误: ${error.message}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                if (stderr) {
                    console.error(`查询产品信息 stderr: ${stderr}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                
                try {
                    const results = JSON.parse(stdout);
                    res.json({
                        success: true,
                        products: results,
                        total: total,
                        page: page,
                        pageSize: pageSize,
                        totalPages: Math.ceil(total / pageSize)
                    });
                } catch (parseError) {
                    res.status(500).json({ success: false, message: '数据解析错误' });
                }
            });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 批量导入产品信息（CSV文件）
app.post('/api/batch-import-products', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '请选择CSV文件' });
    }
    
    const results = [];
    const errors = [];
    
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            if (row.code && row.sku && row.origin) {
                results.push(row);
            } else {
                errors.push(`缺少必要字段: ${JSON.stringify(row)}`);
            }
        })
        .on('end', () => {
            // 删除临时文件
            fs.unlinkSync(req.file.path);
            
            if (errors.length > 0) {
                return res.status(400).json({ success: false, message: 'CSV文件格式错误', errors });
            }
            
            if (results.length === 0) {
                return res.status(400).json({ success: false, message: 'CSV文件没有有效数据' });
            }
            
            // 逐条处理，因为需要检查每条记录是否存在
            let successCount = 0;
            let errorCount = 0;
            let currentIndex = 0;
            
            function processNext() {
                if (currentIndex >= results.length) {
                    return res.json({
                        success: true,
                        message: `批量导入完成`,
                        successCount: successCount,
                        errorCount: errorCount
                    });
                }
                
                const row = results[currentIndex];
                const code = row.code.trim();
                const sku = row.sku.trim();
                const origin = row.origin.trim();
                
                // 先检查溯源码是否存在
                const checkCodeSql = `SELECT id FROM traceability_codes WHERE code = '${code}'`;
                
                exec(`sqlite3 -json products.db "${checkCodeSql}"`, (checkError, checkStdout) => {
                    if (checkError) {
                        console.error(`检查明码错误: ${checkError.message}`);
                        currentIndex++;
                        errorCount++;
                        processNext();
                        return;
                    }
                    
                    try {
                            const codeResults = JSON.parse(checkStdout);
                            if (codeResults.length === 0) {
                                currentIndex++;
                                errorCount++;
                                processNext();
                                return;
                            }
                            
                            const codeId = codeResults[0].id;
                            
                            // 插入产品并关联
                            const insertProductSql = `INSERT OR IGNORE INTO products (sku, origin) VALUES ('${sku}', '${origin}')`;
                            const linkProductSql = `UPDATE traceability_codes SET product_id = (SELECT id FROM products WHERE sku = '${sku}') WHERE id = ${codeId}`;
                            
                            exec(`sqlite3 products.db "${insertProductSql}; ${linkProductSql}"`, (error, stdout, stderr) => {
                                currentIndex++;
                                
                                if (error || stderr) {
                                    errorCount++;
                                } else {
                                    successCount++;
                                }
                                
                                processNext();
                            });
                    } catch (parseError) {
                        currentIndex++;
                        errorCount++;
                        processNext();
                    }
                });
            }
            
            processNext();
        })
        .on('error', (error) => {
            // 删除临时文件
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            
            console.error(`读取CSV文件错误: ${error.message}`);
            res.status(500).json({ success: false, message: '读取CSV文件错误' });
        });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});