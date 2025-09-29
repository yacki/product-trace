# Linux服务器部署说明

## 问题说明
原来的代码在处理大文件批量导入时，会构建一个非常长的SQL字符串通过命令行执行，在Linux系统上会触发 `E2BIG` 错误（命令行参数过长）。

## 解决方案
已将批量导入改为使用 `sqlite3` Node.js 模块直接连接数据库，避免命令行长度限制。

## 部署步骤

### 1. 安装依赖
```bash
# 安装新的sqlite3依赖
npm install

# 如果遇到sqlite3编译问题，尝试：
npm install sqlite3 --build-from-source

# 或者使用预编译版本：
npm install sqlite3 --sqlite=/usr/local
```

### 2. 确保系统依赖
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install python3 make g++ sqlite3

# CentOS/RHEL
sudo yum install python3 make gcc-c++ sqlite3
# 或 (较新版本)
sudo dnf install python3 make gcc-c++ sqlite3
```

### 3. 权限设置
```bash
# 确保数据库文件权限正确
chmod 644 products.db
chmod 755 uploads/

# 确保Node.js进程有写权限
chown -R $USER:$USER ./
```

### 4. 启动服务
```bash
# 生产环境建议使用pm2
npm install -g pm2
pm2 start server.js --name product-trace

# 或直接启动
node server.js
```

## 优化建议

### 内存优化
对于超大文件导入，建议在Linux服务器上设置以下环境变量：

```bash
export NODE_OPTIONS="--max-old-space-size=4096"  # 增加Node.js内存限制
```

### 分批处理
如果文件仍然过大，可以考虑前端分批上传，每批处理1000-5000条记录。

### 数据库优化
```sql
-- 为提高导入性能，可以临时禁用自动提交
PRAGMA synchronous = OFF;
PRAGMA journal_mode = MEMORY;

-- 导入完成后恢复
PRAGMA synchronous = NORMAL;
PRAGMA journal_mode = WAL;
```

## 测试
修复后的代码已经：
1. 使用数据库连接池而非命令行执行
2. 支持事务回滚，保证数据一致性
3. 提供详细的错误信息
4. 适合处理大文件导入

在Linux上应该不再出现 `E2BIG` 错误。