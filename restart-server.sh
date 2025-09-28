#!/bin/bash

# 查找并杀死正在运行的Node.js服务器进程
pkill -f "node server.js"

# 等待一段时间确保进程已终止
sleep 2

# 启动新的服务器实例
npm start