#!/bin/bash

# 测试脚本 - 验证日志功能

echo "=== 测试防伪查询系统日志功能 ==="
echo ""

# 启动服务器（后台运行）
echo "1. 启动服务器..."
node server.js &
SERVER_PID=$!

# 等待服务器启动
sleep 3

echo "2. 测试防伪查询API..."
# 使用一个已知存在的暗码进行测试
curl -s "http://localhost:3001/api/products/DARKCODE123" | jq '.'

echo ""
echo "3. 测试调试接口..."
curl -s "http://localhost:3001/api/debug/codes" | jq '.codes[0:2]'

echo ""
echo "4. 服务器进程ID: $SERVER_PID"
echo "   使用 'kill $SERVER_PID' 停止服务器"
echo "   或直接按 Ctrl+C 停止测试"

# 保持脚本运行，让用户看到服务器日志
wait $SERVER_PID