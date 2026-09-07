# 星序正式前端

当前门户使用 TypeScript、原生 DOM、Vite 和 Three.js。设计与页面说明统一见 [01 第 5.4 节](../doc/01-开发者手册.md#54-qianduan-独立前端原型)，进度与未来任务见 [02](../doc/02-更新规划.md)，不要在本目录另建一份实施计划。

## 两种运行方式

| 方式 | 构建 | 产物 | 数据 |
| --- | --- | --- | --- |
| 本机完整版本 | `npm run build` | `dist/` | 真实 Cookie 账号与 FastAPI，默认 `/api` |
| 静态展示 | `npm run build:demo` | `dist-demo/` | 三角色内存演示，刷新后重置 |

Node 版本取仓库根目录的 `.node-version`。从仓库根目录运行 `powershell -ExecutionPolicy Bypass -File .\astra-local.ps1`，脚本构建正式前端、迁移数据库并在 `http://127.0.0.1:9001/` 提供完整版本。首次创建演示账号可使用 `-InitializeDemoData`；这只操作指定的本机数据目录。

独立浏览静态效果：

```powershell
npm ci --ignore-scripts
npm run build:demo
npm run verify:demo
npm run preview:demo -- --port 4178 --strictPort
```

开发真实页面可使用 `npm run dev -- --port 5173 --strictPort`，其 `/api` 和 `/labs` 代理到 9001。先通过完整启动构建资源并启动后端。演示开发使用 `npm run dev:demo`；最终静态制品的验收使用 `preview:demo`，它不继承后端代理。

## 制品与 GitHub Pages

三个旧实验空间保留源文件在仓库原位置，构建脚本从权威活动注册表导出目录并复制公开资源至 `labs/`。正式产物包含页面、脚本、资源和第三方许可证，不包含 Python 服务、数据库、凭据或用户设计文件。`build-info.json` 标明模式、基础路径、源提交和源目录是否有未提交改动。

`main` 保存源码；`qianduan` 仅保存可部署的静态制品，不在制品分支手工改业务代码。发布前提交并推送已验收的 main，然后在本目录执行：

```powershell
$env:VITE_BASE_PATH='/Astra/'
npm run build:demo
npm run verify:demo
npm run publish:demo
Remove-Item Env:VITE_BASE_PATH
```

发布脚本要求已推送的 main、干净的前端来源、匹配的构建来源和没有被其他工作树占用的 qianduan；它使用临时 Git 索引创建制品提交，不切换或清空主工作区。普通推送不会强制覆盖远端。GitHub Pages 使用 `qianduan` 分支根目录，实际部署结果在 [03](../doc/03-发布历史.md) 记录。

部署到其他静态路径时设置 `VITE_BASE_PATH`。真实接口前缀可用 `VITE_API_BASE` 配置；只有显式 demo 构建才使用演示数据，连接失败不会自动伪装成演示成功。

## 检查

```powershell
npm test
npm run check
npm run build
npm run verify:package
```

前端单元测试覆盖轮盘、日期、请求边界、演示业务状态、草稿内容保留和安全 Markdown。真实授权、事务与迁移由后端测试覆盖；浏览器实测还需走教师与学生完整流程。
