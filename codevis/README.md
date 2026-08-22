# 代码空间 · 「星序 Astra」子站

「代码空间」（CodeSpace，目录代号 `codevis/`）是「星序 Astra」平台下属的互动编程课程子站，聚焦通过“预测—运行—追踪—修正”把代码执行过程变成可观察、可解释的学习活动。
与「工科实验室」同仓部署，通过 `/codevis/` 访问。

## 主色与品牌
- 深太空蓝 `#0a1929` + 震荡青 `#00d4ff`（赛博朋克风）
- 字体：Inter（界面）+ JetBrains Mono（代码）

## 目录结构
```
codevis/
├── index.html              ← 独立 SPA 入口
├── shared/
│   ├── css/   tokens · base · navbar · layout
│   └── js/    router · main · course-manifest · runtime-loader
├── vendor/                 固定版本运行时、许可证与 SHA-256 清单
└── pages/
    ├── course-catalog/    课程目录与独立子课
    ├── course-challenge/  预测—运行—追踪—修正挑战
    └── code-trace/        兼容代码追踪播放器
```

## 路由
- `#catalog`   · 默认课程目录
- `#lesson?activity=<activity_key>`    · 可刷新恢复的当前子课程
- `#challenge?activity=<activity_key>` · 可刷新恢复的当前可执行挑战
- `#trace`     · 兼容代码执行追踪

## 当前阶段
- **V7.5.4（已完成）**：6 个课程群、18 个稳定活动、独立子课与四步互动挑战；浏览器公开样例预检不等同于权威判题。
- **V7.5.6（后端已完成）**：0049 已提供稳定 activity 题目发现、不可变题目版本、学生源码提交、判题状态和教师分页查看。
- **V7.5.7（前端已完成）**：`student-context.js` 从 same-origin Cookie Session 与本人课程建立内存态班级/课程映射，`submission-adapter.js` 按稳定活动解析题目并提交源码；多班级歧义、认证丢失和接口异常失败关闭，runner 未启用时显示真实 `runner_unavailable`。
- **V7.5.8（综合收束已完成）**：入口 HTML 的 19 个本地 CSS/JS 查询代际统一为 `758r1`，防止旧样式与新逻辑混合缓存；课程内容、四语言运行时、正式提交、统一页脚和 390×844 布局已进入全量前端门禁。
- **浏览器学习运行时（已完成）**：固定版本、本地同源、按需加载；来源、许可证和哈希见 `vendor/manifest.json` 与 `THIRD_PARTY_NOTICES.md`。
  - JavaScript：[JS-Interpreter](https://github.com/NeilFraser/JS-Interpreter)（acorn + interpreter）
  - Python：[Skulpt](https://skulpt.org/)（纯 JS Python 3 子集）
  - C / C++：[JSCPP](https://github.com/felixhao28/JSCPP) v2.0.9（纯 JS C++ 子集，不支持 namespace/class）
- **待验收**：QA-010/V7.5.9 独立终验；状态只在 `doc/02-更新规划.md` 维护。

## 沙箱 API 速查
所有后端共享相同的"标记函数"协议，由 runtime 拦截后驱动可视化：

| 函数 | JS / Python | C / C++ |
|---|---|---|
| 移动指针/高亮 | `markPtr(i, j, j2, arr?)` | `markPtr(int i, int j, int j2)` / `markPtr2(int i, int j)` |
| 标记交换 | `markSwap(arr?)` | `markSwap()` |
| 覆盖数组面板 | `markArray(arr)` | `markArray(int* a, int n)` |
| 写入快照 | `snap(name, value)` | `snapInt(const char* name, int v)` |
| 标准输出 | `print(...)` / `console.log` | `printf` / `cout`（C++） |

> **C/C++ 注意事项**：JSCPP 不支持 `std::xxx` 命名空间限定符，请用 `using namespace std;` 或直接调用 `<cstdio>` 函数。

## 本地预览
```powershell
# 从仓库根目录与主站、后端共用 9001 同源入口
powershell -ExecutionPolicy Bypass -File .\astra-local.ps1
# 浏览器访问 http://127.0.0.1:9001/codevis/#catalog
```

## 开发约定
- 命名空间统一前缀：`cv-` (CSS class) / `Cv*` (全局对象，如 `CvRouter`/`CvCourseManifest`)
- `Course Trace` 沿用历史入口仅为兼容；新课程主路径只从 `#catalog` 进入
- 全部 JS 使用 IIFE 暴露至 `window`，无构建步骤
- 严格支持 `prefers-reduced-motion: reduce` 降级
- `vendor/` 文件必须保持字节不变并通过 manifest SHA-256；禁止直接替换成 CDN 或浮动分支
- 页面状态可接 BE-004 adapter，但前端隐藏不能代替后端授权；正式提交不得用浏览器结果伪造 accepted

## 📝 更新日志（子站视角）

> 仅记录与代码空间子站直接相关的变更；平台级更新统一见 [发布历史](../doc/03-发布历史.md)。

### V7.5.8 — 2026-07-19
- 统一入口 CSS/JS 静态代际为 `758r1`，新增合同阻止资源查询版本漂移；全量前端门禁为 193 个受跟踪 JavaScript 与 31/31 合同。
- 教师端代码提交列表改为真实服务端分页并清除跨页陈旧源码详情；本版不改变浏览器预检非权威、默认 runner 不可用和正式提交服务端授权边界。

### V7.5.7 — 2026-07-19
- 接入 Cookie-only 学生上下文、权威发布计划和正式代码提交；公开预检继续只作学习反馈，不写入 accepted。
- 课程撤回、hidden/locked、幂等冲突和 runner 不可用均显示服务端真实状态，敏感上下文与源码不写普通浏览器存储。

### V7.5.4 — 2026-07-19
- 课程目录、独立子课和可执行挑战取代旧首页作为默认路径，首批 6 组/18 活动覆盖 JavaScript、Python、C、C++。
- 新增 BE-004 发布状态 adapter、统一课程页脚、本地审计运行时清单和 C/C++ Worker 4.2 秒硬终止；移除学生页面的实现说明。

### v6.1.0-alpha（历史阶段；实现已进入现行主线）
- **alpha2** — 2026-05-26 — 优化代码空间子站交互与更新规划口径
- **alpha1** — 2026-05-26 — 修复 CodeSpace 跳转与文档口径偏差（主站 → 子站入口校准）

### v6.0.0 — 2026-05-25 / 2026-05-26
- 🪐 与「工科实验室星系」并列为「星序 Astra」下属两大子站之一
- 📚 子站定位写入开发者手册多星系开发指南（§17）

### v5.1.3 — 2026-05-24
- 🎛️ Code-trace 交互打磨：复制 / 重置按钮、关键步骤时间轴、左右面板可折叠

### v5.1.2 — 2026-05-24
- ✨ 子站交互整体优化：文案对齐、控件分区、键盘快捷键、首访引导、卡片光晕

### v5.1.0 — 2026-05-24（子站首发独立化）
- 💻 **Codevis 从主站抽离为独立 SPA** `/codevis/`，拥有独立 `index.html` + 命名空间隔离（`cv-` / `Cv*`）
- 🔧 引入 **Runtime 抽象层**，统一标记函数协议（`markPtr` / `markSwap` / `markArray` / `snap` / `print`）
- 🧪 三沙箱后端落地：
  - JavaScript — JS-Interpreter（acorn + interpreter）
  - Python — Skulpt（Python 3 子集）
  - C / C++ — JSCPP v2.0.9（不支持 namespace/class）

### v5.0.x — 2026-04-22 ~ 2026-05
- 🌌 codevis 作为「代码空间」学科首次在主站星系大屏中落地（彼时仍嵌在主站内）
