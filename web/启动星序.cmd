@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 星序 Astra - 本地网页
echo 浏览器地址：http://127.0.0.1:5173/
if not exist node_modules\vite\bin\vite.js (
  echo 缺少依赖，请在本目录运行 pnpm install 后重试。
  pause
  exit /b 1
)
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort
pause
