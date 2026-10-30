# 实验来源与观星页接入

新版所在分支为 `codex/astra-web-next`，工作目录为本仓库的 `web/`。编程可视化在仓库根的 [codevis/](../../codevis/) 修改和提交，它的原始 Git 路径及提交历史保持不变。

## 源码与运行文件

| 内容 | 维护位置 |
| --- | --- |
| 代码课程、挑战、执行追踪及语言适配器 | [codevis/](../../codevis/) |
| 工科与未来星系实验 | [pages/](../../pages/) 和 [shared/](../../shared/) |
| 稳定活动身份与地址导出 | [现有目录导出器](../../qianduan/scripts/catalog.mjs) |
| 公开运行文件、许可证与角色页面过滤 | [正式门户共用的打包函数](../../qianduan/scripts/package-resources.mjs) |
| 新版星图目录、返回观星按钮与 iframe 桥接 | [展示版打包脚本](../scripts/prepare-labs.mjs) 与 [bridge.js](../public/labs-host/bridge.js) |

`pnpm dev`、`pnpm test` 和 `pnpm build` 都会先生成 `web/public/labs/` 及 `web/src/data/lab-catalog.json`。这两处是 Git 忽略的生成物，不手工修改。单独更新可在 `web/` 执行 `pnpm prepare:labs`；修改权威实验源码后重启开发命令即可重新取包。生成器先完成新包，再替换本工作树内带实验清单的旧包，已移除的源文件不会残留。来源与打包时的 Git 状态记录在生成的 `public/labs/import-manifest.json` 中。

观星入口和望远镜目录共用同一份生成目录。现有工科 90 项、代码 18 项、未来 19 项；AI 智境仍是预览。实验由 `experiment.html?activity=活动身份` 打开，从原“星序”入口返回观星页；开发服务为真实存在的公开实验子目录提供 index.html，历史目录式链接与生产预览一致。

## 迁入基线与业务边界

迁入快照为 `e021fcd`，其中的实验最初导自 `82b9430`。当前分支基于远端 main 的 `c3a6f4d`；未合并 QA 分支上的后端和职教提交。公开资源使用本分支 main 基线提供的探索样式，QA 分支为正式课程记录条增加的样式不参与新版的公开探索流程。展示版自己的星序导航、加载与返回处理保留。

登录是本地演示；公开运行或浏览器预检不生成正式成绩。生成过程不复制服务端、数据库或教师／学生管理页。静态产物独立运行，不需要原竞赛目录或另一份工科实验室检出。迁移没有变更现行正式门户、部署入口或 GitHub Pages 发布流程。
