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
    // 确保uploads目录存在
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
    }
    
    // 如果数据库文件不存在，则初始化所有表结构
    if (!fs.existsSync('products.db')) {
        // 分步执行SQL语句，避免SQL语法解析问题
        const createProductsTable = "CREATE TABLE IF NOT EXISTS products ("
            + "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "sku VARCHAR(50) UNIQUE, "
            + "name VARCHAR(100), "
            + "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)";
            
        const createTraceabilityCodesTable = "CREATE TABLE IF NOT EXISTS traceability_codes ("
            + "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "code VARCHAR(50) UNIQUE, "
            + "dark_code VARCHAR(50) UNIQUE, "
            + "product_id INTEGER, "
            + "distributor VARCHAR(100), " // 分销商字段
            + "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
            + "FOREIGN KEY(product_id) REFERENCES products(id))";
            
        const createProductView = "CREATE VIEW IF NOT EXISTS product_view AS "
            + "SELECT tc.code, tc.dark_code, p.sku, tc.distributor, tc.created_at "
            + "FROM traceability_codes tc LEFT JOIN products p ON tc.product_id = p.id";
            
        // 连续执行SQL语句
        exec(`sqlite3 products.db "${createProductsTable.replace(/"/g, '""')}" && sqlite3 products.db "${createTraceabilityCodesTable.replace(/"/g, '""')}" && sqlite3 products.db "${createProductView.replace(/"/g, '""')}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`数据库初始化错误: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`数据库初始化 stderr: ${stderr}`);
                return;
            }
            console.log('数据库初始化成功 - 所有表和视图已创建');
        });
    }
}

// 初始化数据库
initDatabase();

// 导出initDatabase函数以便测试
exports.initDatabase = initDatabase;

// 中间件
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// API请求日志中间件
app.use('/api', (req, res, next) => {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    console.log(`[${timestamp}] API请求: ${req.method} ${req.url} - 客户端IP: ${clientIP}`);
    
    // 记录请求参数
    if (req.method === 'GET' && Object.keys(req.query).length > 0) {
        console.log(`[${timestamp}] 查询参数:`, req.query);
    }
    if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
        console.log(`[${timestamp}] 请求体:`, req.body);
    }
    if (req.params && Object.keys(req.params).length > 0) {
        console.log(`[${timestamp}] 路径参数:`, req.params);
    }
    
    next();
});

// API路由

// 导入溯源码信息（明码和暗码的对应关系）
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
            console.error(`导入溯源码信息错误: ${error.message}`);
            if (error.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, message: '明码或暗码已存在' });
            }
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`导入溯源码信息 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        res.json({ success: true, message: '溯源码信息导入成功' });
    });
});

// 录入产品信息
app.post('/api/products', (req, res) => {
    const { code, sku } = req.body;
    
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
                return res.status(404).json({ success: false, message: '未找到对应的明码，请先导入溯源码信息' });
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
                const insertProductSql = `INSERT OR IGNORE INTO products (sku) VALUES ('${sku}')`;
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
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] 开始防伪查询: 暗码=${dark_code}`);
    
    // 使用分步查询避免复杂的JOIN，提高可靠性
    const sql = `SELECT tc.code, tc.dark_code, tc.product_id, tc.distributor, tc.created_at 
                 FROM traceability_codes tc 
                 WHERE tc.dark_code = '${dark_code}'`;
    
    exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`[${timestamp}] 查询数据错误: ${error.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`[${timestamp}] 查询数据 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        // 检查返回结果是否为空
        if (!stdout || stdout.trim() === '') {
            console.log(`[${timestamp}] 查询结果: 未找到暗码 ${dark_code}`);
            return res.json({ success: false, message: '未找到该产品信息，可能是假货' });
        }
        
        try {
            const results = JSON.parse(stdout);
            if (!results || results.length === 0) {
                console.log(`[${timestamp}] 查询结果: 未找到暗码 ${dark_code}`);
                return res.json({ success: false, message: '未找到该产品信息，可能是假货' });
            }
            
            const codeInfo = results[0];
            console.log(`[${timestamp}] 溯源码查询成功:`, codeInfo);
            
            // 如果有关联的产品ID，查询产品信息
            if (codeInfo.product_id) {
                const productSql = `SELECT sku, name FROM products WHERE id = ${codeInfo.product_id}`;
                
                exec(`sqlite3 -json products.db "${productSql}"`, (prodError, prodStdout, prodStderr) => {
                    if (prodError || prodStderr) {
                        console.error(`[${timestamp}] 查询产品信息错误:`, prodError || prodStderr);
                    }
                    
                    let productInfo = {
                        sku: '未关联产品',
                        name: '未设置产品名称'
                    };
                    
                    try {
                        if (prodStdout) {
                            const prodResults = JSON.parse(prodStdout);
                            if (prodResults.length > 0) {
                                productInfo = prodResults[0];
                                console.log(`[${timestamp}] 产品信息查询成功:`, productInfo);
                            }
                        }
                    } catch (parseErr) {
                        console.error(`[${timestamp}] 解析产品信息错误:`, parseErr);
                    }
                    
                    // 返回完整的产品信息
                    const responseData = {
                        sku: productInfo.sku || '未关联产品',
                        name: productInfo.name || '未设置产品名称',
                        distributor: codeInfo.distributor || '未设置分销商',
                        dark_code: codeInfo.dark_code,
                        created_at: codeInfo.created_at
                    };
                    
                    console.log(`[${timestamp}] 防伪查询成功返回:`, responseData);
                    res.json({ success: true, product: responseData });
                });
            } else {
                // 没有关联产品的情况
                const responseData = {
                    sku: '未关联产品',
                    name: '未设置产品名称',
                    distributor: codeInfo.distributor || '未设置分销商',
                    dark_code: codeInfo.dark_code,
                    created_at: codeInfo.created_at
                };
                
                console.log(`[${timestamp}] 防伪查询返回(无关联产品):`, responseData);
                res.json({ success: true, product: responseData });
            }
        } catch (parseError) {
            console.error(`[${timestamp}] 解析查询结果错误:`, parseError);
            console.log(`[${timestamp}] 原始查询输出:`, stdout);
            res.json({ success: false, message: '未找到该溯源码，请确认您输入的溯源码是否正确。' });
        }
    });
});

// 调试接口：查看所有溯源码数据
app.get('/api/debug/codes', (req, res) => {
    const sql = `SELECT 
        tc.id,
        tc.code, 
        tc.dark_code, 
        p.sku, 
        p.name,
        tc.distributor, 
        tc.created_at 
    FROM traceability_codes tc 
    LEFT JOIN products p ON tc.product_id = p.id 
    ORDER BY tc.created_at DESC
    LIMIT 10`;
    
    exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`查询调试数据错误: ${error.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`查询调试数据 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const results = JSON.parse(stdout);
            res.json({ 
                success: true, 
                total: results.length,
                codes: results 
            });
        } catch (parseError) {
            console.error('解析调试数据错误:', parseError);
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 获取产品库列表
app.get('/api/product-library', (req, res) => {
    const sql = `SELECT id, sku, name, created_at FROM products ORDER BY created_at DESC`;
    
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

// 添加产品到产品库
app.post('/api/product-library', (req, res) => {
    const { sku, name } = req.body;
    
    // 验证输入
    if (!sku) {
        return res.status(400).json({ success: false, message: '请填写产品SKU' });
    }
    
    const nameValue = name ? `'${name.replace(/'/g, "''")}'` : 'NULL';
    const sql = `INSERT INTO products (sku, name) VALUES ('${sku}', ${nameValue})`;
    
    exec(`sqlite3 products.db "${sql}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`添加产品错误: ${error.message}`);
            if (error.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, message: '产品SKU已存在' });
            }
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        if (stderr) {
            console.error(`添加产品 stderr: ${stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        res.json({ success: true, message: '产品添加成功' });
    });
});

// 更新产品库中的产品
app.put('/api/product-library/:id', (req, res) => {
    const { id } = req.params;
    const { sku, name } = req.body;
    
    // 验证输入
    if (!sku) {
        return res.status(400).json({ success: false, message: '请提供SKU信息' });
    }
    
    const nameValue = name ? `'${name.replace(/'/g, "''")}'` : 'NULL';
    const sql = `UPDATE products SET sku = '${sku}', name = ${nameValue} WHERE id = ${id}`;
    
    exec(`sqlite3 products.db "${sql}"`, (error, stdout, stderr) => {
        if (error || stderr) {
            console.error(`更新产品信息错误: ${error?.message || stderr}`);
            if (error && error.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, message: '该SKU已存在' });
            }
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        res.json({ success: true, message: '产品信息更新成功' });
    });
});

// 删除产品库中的产品
app.delete('/api/product-library/:id', (req, res) => {
    const { id } = req.params;
    
    // 验证ID
    if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ success: false, message: '请提供有效的产品ID' });
    }
    
    const sql = `DELETE FROM products WHERE id = ${parseInt(id)}`;
    
    exec(`sqlite3 products.db "${sql}"`, (error, stdout, stderr) => {
        if (error || stderr) {
            console.error(`删除产品错误: ${error?.message || stderr}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        res.json({ success: true, message: '产品删除成功' });
    });
});

// 原有的获取产品库列表API（保持兼容性）
app.get('/api/product-library-old', (req, res) => {
    const sql = `SELECT id, sku FROM products`;
    
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

// 批量导入溯源码信息（CSV文件）
app.post('/api/batch-import-codes', upload.single('csvFile'), (req, res) => {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] 开始批量导入溯源码: 文件=${req.file ? req.file.filename : '无'}`);
    
    if (!req.file) {
        console.log(`[${timestamp}] 批量导入失败: 未选择文件`);
        return res.status(400).json({ success: false, message: '请选择CSV文件' });
    }
    
    console.log(`[${timestamp}] 文件信息: 大小=${req.file.size}字节, 原始名=${req.file.originalname}`);
    
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
            console.log(`[${timestamp}] CSV解析完成: 有效记录=${results.length}条, 错误记录=${errors.length}条`);
            
            if (errors.length > 0) {
                console.log(`[${timestamp}] 批量导入失败: CSV格式错误`, errors.slice(0, 5));
                return res.status(400).json({ success: false, message: 'CSV文件格式错误', errors });
            }
            
            if (results.length === 0) {
                console.log(`[${timestamp}] 批量导入失败: 无有效数据`);
                return res.status(400).json({ success: false, message: 'CSV文件没有有效数据' });
            }
            
            // 分批处理，避免E2BIG错误（每批100条）
            const BATCH_SIZE = 100;
            let processedCount = 0;
            let totalSuccess = 0;
            let totalErrors = 0;
            const errorMessages = [];
            
            console.log(`[${timestamp}] 开始分批处理: 总记录=${results.length}条, 批大小=${BATCH_SIZE}`);
            
            function processBatch(startIndex) {
                const endIndex = Math.min(startIndex + BATCH_SIZE, results.length);
                const batch = results.slice(startIndex, endIndex);
                const batchTimestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                
                if (batch.length === 0) {
                    // 所有批次处理完成
                    console.log(`[${batchTimestamp}] 批量导入完成: 总成功=${totalSuccess}条, 总失败=${totalErrors}条`);
                    return res.json({
                        success: totalErrors === 0,
                        message: `导入完成 - 成功: ${totalSuccess} 条, 失败: ${totalErrors} 条`,
                        totalCount: results.length,
                        successCount: totalSuccess,
                        errorCount: totalErrors,
                        errors: errorMessages.slice(0, 10) // 只返回前10个错误
                    });
                }
                
                console.log(`[${batchTimestamp}] 处理批次 ${Math.floor(startIndex/BATCH_SIZE) + 1}: 记录${startIndex+1}-${endIndex}`);
                
                // 构建批量插入SQL
                const values = batch.map(row => 
                    `('${row.code.trim().replace(/'/g, "''")}', '${row.dark_code.trim().replace(/'/g, "''")}')`
                ).join(', ');
                
                const sql = `INSERT INTO traceability_codes (code, dark_code) VALUES ${values};`;
                
                exec(`sqlite3 products.db "${sql}"`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[${batchTimestamp}] 批次导入错误:`, error.message);
                        totalErrors += batch.length;
                        if (error.message.includes('UNIQUE constraint failed')) {
                            errorMessages.push(`批次 ${startIndex}-${endIndex}: 存在重复的明码或暗码`);
                        } else {
                            errorMessages.push(`批次 ${startIndex}-${endIndex}: ${error.message}`);
                        }
                    } else {
                        console.log(`[${batchTimestamp}] 批次导入成功: ${batch.length}条记录`);
                        totalSuccess += batch.length;
                    }
                    
                    if (stderr) {
                        console.error(`[${batchTimestamp}] 批次 stderr:`, stderr);
                    }
                    
                    processedCount += batch.length;
                    console.log(`[${batchTimestamp}] 进度: ${processedCount}/${results.length} (${((processedCount/results.length)*100).toFixed(1)}%)`);
                    
                    // 处理下一批
                    setTimeout(() => processBatch(endIndex), 100); // 短暂延迟避免过载
                });
            }
            
            // 开始处理第一批
            processBatch(0);
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

// 获取所有溯源码信息列表
// 已在文件末尾重写，返回关联的产品信息

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
            const sql = `SELECT tc.id, tc.code, tc.dark_code, p.sku, tc.distributor, tc.created_at 
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
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] 开始批量导入产品渠道: 文件=${req.file ? req.file.filename : '无'}`);
    
    if (!req.file) {
        console.log(`[${timestamp}] 批量导入产品失败: 未选择文件`);
        return res.status(400).json({ success: false, message: '请选择CSV文件' });
    }
    
    console.log(`[${timestamp}] 产品导入文件信息: 大小=${req.file.size}字节, 原始名=${req.file.originalname}`);
    
    const results = [];
    const errors = [];
    
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            if (row.code && row.sku && row.distributor) {
                results.push(row);
            } else {
                errors.push(`缺少必要字段: ${JSON.stringify(row)}`);
            }
        })
        .on('end', () => {
            // 删除临时文件
            fs.unlinkSync(req.file.path);
            console.log(`[${timestamp}] 产品CSV解析完成: 有效记录=${results.length}条, 错误记录=${errors.length}条`);
            
            if (errors.length > 0) {
                console.log(`[${timestamp}] 批量导入产品失败: CSV格式错误`, errors.slice(0, 5));
                return res.status(400).json({ success: false, message: 'CSV文件格式错误', errors });
            }
            
            if (results.length === 0) {
                console.log(`[${timestamp}] 批量导入产品失败: 无有效数据`);
                return res.status(400).json({ success: false, message: 'CSV文件没有有效数据' });
            }
            
            console.log(`[${timestamp}] 开始逐条处理产品关联: 总记录=${results.length}条`);
            
            // 逐条处理，因为需要检查每条记录是否存在
            let successCount = 0;
            let errorCount = 0;
            let currentIndex = 0;
            
            function processNext() {
                if (currentIndex >= results.length) {
                    const endTimestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                    console.log(`[${endTimestamp}] 批量导入产品完成: 成功=${successCount}条, 失败=${errorCount}条`);
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
                const distributor = row.distributor.trim();
                
                const processTimestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                
                // 每处理50条记录显示一次进度
                if (currentIndex % 50 === 0 || currentIndex === results.length - 1) {
                    console.log(`[${processTimestamp}] 产品导入进度: ${currentIndex + 1}/${results.length} (${((currentIndex + 1)/results.length*100).toFixed(1)}%)`);
                }
                
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
                            console.log(`明码 ${code} 不存在于溯源表中`);
                            currentIndex++;
                            errorCount++;
                            processNext();
                            return;
                        }
                        
                        const codeId = codeResults[0].id;
                        
                        // 插入产品并关联（使用事务）
                        const insertProductSql = `BEGIN TRANSACTION;
                            INSERT OR IGNORE INTO products (sku) VALUES ('${sku.replace(/'/g, "''")}');
                            UPDATE traceability_codes 
                            SET product_id = (SELECT id FROM products WHERE sku = '${sku.replace(/'/g, "''")}'), 
                                distributor = '${distributor.replace(/'/g, "''")}'
                            WHERE id = ${codeId};
                            COMMIT;`;
                        
                        exec(`sqlite3 products.db "${insertProductSql}"`, (error, stdout, stderr) => {
                            currentIndex++;
                            
                            if (error) {
                                console.error(`处理记录 ${code} 错误:`, error.message);
                                errorCount++;
                            } else if (stderr) {
                                console.error(`处理记录 ${code} stderr:`, stderr);
                                errorCount++;
                            } else {
                                successCount++;
                            }
                            
                            processNext();
                        });
                    } catch (parseError) {
                        console.error(`解析检查结果错误:`, parseError);
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

// 更新产品信息
app.put('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const { sku } = req.body;
    
    // 验证输入
    if (!sku) {
        return res.status(400).json({ success: false, message: '请提供SKU信息' });
    }
    
    // 检查产品是否存在
    const checkProductSql = `SELECT id FROM products WHERE id = ${id}`;
    
    exec(`sqlite3 -json products.db "${checkProductSql}"`, (checkError, checkStdout) => {
        if (checkError) {
            console.error(`检查产品错误: ${checkError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const productResults = JSON.parse(checkStdout);
            if (productResults.length === 0) {
                return res.status(404).json({ success: false, message: '未找到对应的产品' });
            }
            
            // 更新产品SKU信息
            const updateSql = `UPDATE products SET sku = '${sku}' WHERE id = ${id}`;
            
            exec(`sqlite3 products.db "${updateSql}"`, (error, stdout, stderr) => {
                if (error || stderr) {
                    console.error(`更新产品信息错误: ${error?.message || stderr}`);
                    if (error && error.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ success: false, message: '该SKU已存在' });
                    }
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                
                res.json({ success: true, message: '产品SKU更新成功' });
            });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 在溯源码上关联产品分销商信息
app.put('/api/codes/:code/distributor', (req, res) => {
    const { code } = req.params;
    const { distributor } = req.body;
    
    // 验证输入
    if (!distributor) {
        return res.status(400).json({ success: false, message: '请提供分销商信息' });
    }
    
    // 检查溯源码是否存在
    const checkCodeSql = `SELECT id, product_id FROM traceability_codes WHERE code = '${code}'`;
    
    exec(`sqlite3 -json products.db "${checkCodeSql}"`, (checkError, checkStdout) => {
        if (checkError) {
            console.error(`检查溯源码错误: ${checkError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const codeResults = JSON.parse(checkStdout);
            if (codeResults.length === 0) {
                return res.status(404).json({ success: false, message: '未找到对应的溯源码' });
            }
            
            const codeId = codeResults[0].id;
            const productId = codeResults[0].product_id;
            
            // 检查是否已关联产品
            if (!productId) {
                return res.status(400).json({ success: false, message: '该溯源码尚未关联产品，请先录入产品信息' });
            }
            
            // 更新分销商信息
            const updateSql = `UPDATE traceability_codes SET distributor = '${distributor}' WHERE id = ${codeId}`;
            
            exec(`sqlite3 products.db "${updateSql}"`, (error, stdout, stderr) => {
                if (error || stderr) {
                    console.error(`更新分销商信息错误: ${error?.message || stderr}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                
                res.json({ success: true, message: '分销商信息关联成功' });
            });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 在溯源码上关联产品信息
app.put('/api/codes/:code/product', (req, res) => {
    const { code } = req.params;
    const { product_id, distributor } = req.body;
    
    // 验证输入
    if (!product_id) {
        return res.status(400).json({ success: false, message: '请选择要关联的产品' });
    }
    
    // 检查溯源码是否存在
    const checkCodeSql = `SELECT id FROM traceability_codes WHERE code = '${code}'`;
    
    exec(`sqlite3 -json products.db "${checkCodeSql}"`, (checkError, checkStdout) => {
        if (checkError) {
            console.error(`检查溯源码错误: ${checkError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const codeResults = JSON.parse(checkStdout);
            if (codeResults.length === 0) {
                return res.status(404).json({ success: false, message: '未找到对应的溯源码' });
            }
            
            const codeId = codeResults[0].id;
            
            // 检查产品是否存在
            const checkProductSql = `SELECT id FROM products WHERE id = ${product_id}`;
            
            exec(`sqlite3 -json products.db "${checkProductSql}"`, (productCheckError, productCheckStdout) => {
                if (productCheckError) {
                    console.error(`检查产品错误: ${productCheckError.message}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                
                try {
                    const productResults = JSON.parse(productCheckStdout);
                    if (productResults.length === 0) {
                        return res.status(404).json({ success: false, message: '未找到对应的产品' });
                    }
                    
                    // 关联产品和经销商
                    const distributorValue = distributor ? `'${distributor.replace(/'/g, "''")}'` : 'NULL';
                    const updateSql = `UPDATE traceability_codes SET product_id = ${product_id}, distributor = ${distributorValue} WHERE id = ${codeId}`;
                    
                    exec(`sqlite3 products.db "${updateSql}"`, (error, stdout, stderr) => {
                        if (error || stderr) {
                            console.error(`关联产品错误: ${error?.message || stderr}`);
                            return res.status(500).json({ success: false, message: '服务器内部错误' });
                        }
                        
                        res.json({ success: true, message: '产品关联成功' });
                    });
                } catch (productParseError) {
                    res.status(500).json({ success: false, message: '数据解析错误' });
                }
            });
        } catch (parseError) {
            res.status(500).json({ success: false, message: '数据解析错误' });
        }
    });
});

// 修改获取溯源码列表的API，使其返回关联的产品名称和SKU
app.get('/api/get-codes', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 100;
    const offset = (page - 1) * pageSize;
    
    // 查询总数
    const countSql = `SELECT COUNT(*) as total FROM traceability_codes`;
    
    exec(`sqlite3 -json products.db "${countSql}"`, (countError, countStdout) => {
        if (countError) {
            console.error(`查询溯源码总数错误: ${countError.message}`);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
        
        try {
            const countResult = JSON.parse(countStdout);
            const total = countResult[0].total;
            
            // 查询分页数据，包含关联的产品信息
            const sql = `SELECT tc.id, tc.code, tc.dark_code, tc.product_id, tc.distributor, p.sku as product_sku, p.name as product_name, tc.created_at 
                        FROM traceability_codes tc 
                        LEFT JOIN products p ON tc.product_id = p.id 
                        ORDER BY tc.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
            
            exec(`sqlite3 -json products.db "${sql}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`查询溯源码信息错误: ${error.message}`);
                    return res.status(500).json({ success: false, message: '服务器内部错误' });
                }
                if (stderr) {
                    console.error(`查询溯源码信息 stderr: ${stderr}`);
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

// 启动服务器
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`服务器运行在 http://localhost:${PORT}`);
    });
}