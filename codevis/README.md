# 代码空间 · 「星序 Astra」子站

「代码空间」（CodeSpace，目录代号 `codevis/`）是「星序 Astra」平台下属的互动编程课程子站，聚焦通过“预测—运行—追踪—修正”把代码执行过程变成可观察、可解释的学习活动。
与星序同仓维护，正式门户通过构建后的 `/labs/codevis/` 打开；原 `/codevis/` 路径保留兼容用途。

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

## 当前能力与边界

6 个课程群、18 个稳定活动，保留可刷新恢复的子课与四步挑战。浏览器四语言学习运行时按需加载，固定来源、许可证和哈希见 [vendor/manifest.json](vendor/manifest.json) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

正式门户资源包以自由探索方式打开本子站，不凭浏览器结果生成正式成绩。原 student-context/submission-adapter 的有授权课程提交代码保留兼容用途；runner 未启用时不得冒充判题成功。

准确业务接入与验证边界见 [01](../doc/01-开发者手册.md#4-三个学习空间与课程内容)。不再从旧 V7 待验收流水恢复任务。

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
# 浏览器访问 http://127.0.0.1:9001/labs/codevis/#catalog
```

## 开发约定
- 命名空间统一前缀：`cv-` (CSS class) / `Cv*` (全局对象，如 `CvRouter`/`CvCourseManifest`)
- `Course Trace` 沿用历史入口仅为兼容；新课程主路径只从 `#catalog` 进入
- 全部 JS 使用 IIFE 暴露至 `window`，无构建步骤
- 严格支持 `prefers-reduced-motion: reduce` 降级
- `vendor/` 文件必须保持字节不变并通过 manifest SHA-256；禁止直接替换成 CDN 或浮动分支
- 页面状态可接 BE-004 adapter，但前端隐藏不能代替后端授权；正式提交不得用浏览器结果伪造 accepted


版本和历史事实统一见 [03](../doc/03-发布历史.md)，不在子站重复维护更新日志。
