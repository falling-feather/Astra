# 星序 Astra — 前端 SPA、路由与页面生命周期

> 子文档编号：12
> 上级文档：[01-开发者手册](../01-开发者手册.md)
> 文档状态：已从原始主文档迁移，保留原有技术事实
> 最近更新：2026-08-22
> 更新者：DOC 组（主开发单线兼任）

集中说明 SPA 页面系统、脚本加载、路由转场、模块选择、首页、加载流程与新增星系接入。

---
## 4. 前端架构

### 4.1 SPA 页面系统

所有页面内容均嵌入 `index.html` 中的 `<section>` 标签：

```html
<section id="page-home" class="page active home-page" role="region" aria-label="首页">...</section>
<section id="page-mathematics" class="page" role="region" aria-label="数学">...</section>
<section id="page-physics" class="page" role="region" aria-label="物理">...</section>
<section id="page-chemistry" class="page" role="region" aria-label="化学">...</section>
<section id="page-algorithms" class="page" role="region" aria-label="算法">...</section>
<section id="page-biology" class="page" role="region" aria-label="生物">...</section>
<section id="page-frontier" class="page frontier-page" data-galaxy="frontier">...</section>
<section id="page-cosmos" class="page frontier-page" data-galaxy="frontier">...</section>
<section id="page-engineering" class="page frontier-page" data-galaxy="frontier">...</section>
<section id="page-datascience" class="page frontier-page" data-galaxy="frontier">...</section>
<section id="page-infotech" class="page frontier-page" data-galaxy="frontier">...</section>
<section id="page-materials" class="page frontier-page" data-galaxy="frontier">...</section>
<section id="page-humanities" class="page frontier-page" data-galaxy="frontier">...</section>
```

**页面切换机制**：通过 CSS 类 `.active` 控制显隐，结合 GSAP 实现径向裁剪转场动画。

### 4.2 JS 加载顺序

V7.4.23 起采用**认证前置应用壳 + 角色资源级裁剪 + 星系级按需加载**策略。加载屏先等待 `api-client` 与 `app-session` 完成会话判定；只有认证成功并加载允许的角色样式后才启动 Router，不等待全部星系页面、实验模块、学习框架或 Service Worker 缓存完成。

```html
<!-- ① 内联加载屏 CSS（<head> 内，首帧可见） -->
<style>/* 加载动画关键帧 + 遮罩层样式 */</style>

<!-- ② 最小启动脚本（同步，必须保留顺序） -->
<script src="../shared/js/config.js"></script>
<script src="../shared/js/api-client.js"></script>
<script src="../shared/js/auth-ui.js"></script>
<script src="../shared/js/app-session.js"></script>
<script src="../shared/js/backend-content.js"></script>
<script src="../shared/js/experiment-registry.js"></script>
<script src="../shared/js/page-registry.js"></script>
<script src="../shared/js/router.js"></script>
<script src="../shared/js/main.js"></script>

<!-- ③ 可选增强系统（由 Router.galaxySupportScripts 按当前星系请求） -->
<script>/* index.html 只触发当前星系 support，不再顺序加载全站增强脚本 */</script>

<!-- ④ 页面脚本与实验脚本不写在 index.html 中 -->
<!-- 页面脚本由 AstraPageRegistry 登记、Router 按页注入；实验运行信息由 AstraExperimentRegistry 登记、ModuleSelector 按实验注入。 -->
```

**加载时序**：

1. 浏览器解析 `<head>`，内联 CSS 立即渲染加载屏
2. `app-session.js` 先调用 `/api/users/me`：401 时锁定主应用并呈现统一账号入口；成功时按 `AstraPageRegistry` 的角色矩阵清理旧缓存、加载允许的角色样式，再写入非敏感内存态、按需初始化共享学习证据 loader，并裁剪导航/section
3. `main.js` 仅在会话确认与角色样式成功后调用 `initApp()`；Router 对当前 hash 做角色守卫，再进入允许页面
4. `AstraPageRegistry` 提供页面的角色、样式、脚本和 ready/enter/leave 钩子，Router 只在角色守卫通过后补加载页面脚本；`Router.galaxySupportScripts` 只为当前星系补轻量 support
5. `AstraExperimentRegistry` 提供实验脚本和 init 元数据，`ModuleSelector` 只在用户打开具体实验时加载并初始化
6. `noDeferred=1` 必须同时跳过 `index.html` 触发器与 Router support，用作加载层故障的降级开关
7. 加载屏淡出只代表登录入口或已认证 Router shell 可交互，不代表页面脚本、实验模块、学习框架、canvas 动画或 SW 缓存全部 ready

V7.9.68 起，`pages/planets/planets.js` 还会在 Router 首次落点前建立 student 授权课程快照。它按本人 `GET /api/classes?mine=true` 逐班读取课程及 units，只把 published 课程中 `effective_release_state=open` 的活动映射为可见页面 / 深链；相同规范课程身份在多班级出现时合并 `class_ids`，不复制目录项。零班级 student 的 `#student` 会由该快照的 `guardRoute()` 归一到 `#planets`，全部“我的学习”链接同步 hidden + inert；`role-home-client.js` 的入班 dialog 不提供取消并消费 Escape，只有正式 direct-join 成功且随后权威班级回读包含目标才释放门禁。活动学生 owner 已迁为 `pages/student/student-workbench.js`，旧 `pages/student/student.js` 保持冻结且不再由 `AstraPageRegistry` 加载。

V7.9.69 起，`AstraStudentScopeSelection` 只在当前页面内存中按 student id 保存最近班级与课程，不写普通存储、Cookie 或 Service Worker；`#planets` 与 `student-workbench.js` 共同消费它，课程列表回读后优先恢复同班选择，否则选择首门可用课程并立即读取权威任务 / 进度。学生 rail 的 grid track 在桌面为 232px，可通过 44px 按钮收缩为 76px；stage 使用 `minmax(0, 1fr)` 和 inline-size container，默认单栏，只有 stage 自身至少 1180px 才切双栏。`global-search.js` 在每次渲染与激活动作前按 `AstraStudentCourseCatalogue` 同时检查 page 与 activity，顶栏的 hidden 条目由强制样式真正退出布局；教师与管理员搜索范围不受该学生裁剪影响。五学科概览只保留实验数量，Englab 首次按需加载 `scroll-animations.js` 后由动画 owner 自行初始化当前 active Hero，Router 继续保持冻结行数上限。

V7.9.70 的 DATA-004 不增加初始化器或产品写路径，只在当前 9003 本地 SQLite 上走公开 HTTP API：四个账号先通过 `/api/auth/register` 建立，现有管理员再经正式用户治理 API 将两名目标账号提升为 teacher；两名 teacher 各自创建学校、班级、课程 / unit / attachment / release plan，两名 student 再通过 direct-join 加入对应班级。全开放对象为 `class_id=2`，包含 17 门 published 课程与 124 个 open units；其中五门工科课程覆盖当前 88 个实验，代码空间与未来星系各 6 门、每门 3 units。部分开放对象为 `class_id=3`，复制当前本地演示的 14 课 / 42 unit 范围，权威状态为 30 open、6 locked、6 hidden；学生列表只回读 36 个非 hidden units，工科导航与搜索只发现 `mathematics.derivative-application` 和 `physics.mechanics`。两套教师 / 学生均只回读本人班级，跨班课程 scope 返回 403；用户名可记录，密码不得写入源码、数据库脚本、文档或 Git。

V7.9.71 起，`ModuleSelector.init()` 是文档级单例：主启动与 Router 延迟 course support 重复调用不会再次注册 backdrop、document keydown 或 `astra:student-catalogue-ready` listener。每次 catalogue loading / ready / closed 事件都会调用 `refreshCatalogueSurfaces()`，按五学科逐一移除既有 `sidebar-*`、`sidebar-toggle-*`、`learning-overview-*`、`gallery-*` 与 `learning-sources-*`，再通过 `_visibleExperiments()` 只为当前 exact-open、非 upcoming 活动重建生成 DOM；零可用活动不生成 ledger、gallery、sidebar 或来源区。身份 key 变化或 active module 被撤权时先调用既有 `closeModule()` 释放活动 / evidence owner；同身份且仍授权的活动可保留运行态，并在新 sidebar 上恢复 active 标记。`shared/js/main.js` 与 Router 对 ModuleSelector 使用资源代际 `20260731v7971CatalogueCountP0`，入口 main / router 和 Service Worker 壳同步换代。

#### 4.2.1 共享学习证据按需链（V7.7.2 首批实现）

- `app-session.js` 按需加载 `shared/js/learning-evidence-loader.js`；显式登录与注册必须先完成本地 authority 清理，再发送会建立 Session 的登录请求，成功后以一次性 fresh proof 配置新身份。不向 `index.html`、`main.js`、Router 或 Service Worker 增加静态入口。
- `/api/learning-evidence` 的唯一浏览器调用者是 `AstraLearningEvidenceClient`。页面 owner 只能发送稳定领域命令或请求共享回读，不得 direct fetch、写 `completed/transferred`、复制规则算法或从事件账本聚合权威积分。直接事件 POST 与批量 flush 共用 authority generation / AbortController；撤权会取消定时 flush、租约续期和在途写入，失效后才取得的租约也必须释放。
- `AstraLearningEvidenceQueue` 使用有界 IndexedDB：7 天、256 条、1 MiB、单 evidence 16 KiB、单批最多 50 条；只存严格 DTO，字段键先做 NFKC、去分隔符与小写规范化，显式拒绝身份 ID、凭据键及其 `_` / `-` / `.` / 无分隔符 / camelCase 变体，也不存姓名、成绩、源码、自由文本解释或完整答案。退出、401、账号 / 角色变化会先写固定值、无身份信息的 transient marker，再推进清理成功后仍保留的非敏感 clear epoch，随后物理清空；两者复用 `localStorage` 与同源 Cookie 通道。合法 BroadcastChannel / storage set 通知会直接撤销活动标签 authority；`pagehide` 关闭通知通道，`pageshow` 以 epoch 变化补回隐藏期间错过的清理。持久通道不可验证、物理清理拒绝或 marker 删除失败时均不重载、不配置新身份，只有可见重试成功后才解除失败 latch。SW 不参与后台同步。
- 首批代表活动是工科 `physics.mechanics` 与代码空间 `control-flow.loop-boundary`。代码挑战的本地过程态和 evidence controller 以权威 `class_id + course_id + activity_key` 为键，切换作用域会销毁旧 consumer / buffer 后重挂。恢复必须使用 catalog 给出的精确可执行深链；未知 key 不回退首课。角色首页、学生页与教师页分别读取共享 recovery / aggregate projection；学生主刷新会重新请求同 scope recovery，动态 owner 失败显示错误码与重试，教师约每 4 秒发起轮询且显示时延另含接口耗时。
- 学生课程单元只信任 `effective_release_state`：open 才生成可执行链接，locked 明示锁定且没有 `href`，hidden / 未知状态不渲染。班级切换、页面销毁和 401 通过 scope generation / `AbortSignal` 同时取消旧导航、发布查询与迟到写回；学生直达 `physics.mechanics` 时先解析发布上下文，open 才加载 Canvas、Zoom、证据 owner 与教学闭环。V7.7.22 集成实现限定为 student、当前 class、唯一 physics course，并先读取既有 `/units`：exact open / locked 直接沿用列表，多匹配失败关闭且不探针；只有零匹配才使用同一取消信号调用 `/unit-access`。响应只接受严格 `{available,error_code}` 二字段与 `activity_hidden / activity_locked / course_unit_missing` allowlist；hidden / locked 静默归一，missing 与普通 unknown 使用不含 slug 或异常正文的单参数固定 warning，畸形 DTO、未知码、异常和缺少 `course_unit_id` 的 available 结果均按上下文不可用处理。known / unknown pending 各有独立 controller；切换目标、close、reset 与 leave 通过 `_cancelPublicationGate()` 同步 abort 后再清状态，context 将该外部 signal 桥接到 prepare 和后续单一请求 scope，不调用 `context.close()` 或清空已选班级。通过 pending 去重后新建 unknown 分类会取得新 transition generation；迟到回调先匹配 exact controller，再由 generation 阻止忽略取消的 promise 污染模块或启动 owner；A→reset→同 slug B→A 迟到的动态合同已证明 B 不被旧结果删除或归一。实现已集成，仍待 QA。V7.7.8 把力学评分卡移入 `.demo-layout` 前的文档流，五个 FAB 操作组成 safe-area 移动 dock，并保持侧栏模态层、44px、方向键、焦点和减少动效边界。V7.7.10 在 `started` 获得耐久结果前保持证据控件不可操作，以精确 `client_event_id + event_type + scope + authority generation` 跟踪 tracked / untracked / domain 事件；16 条页面缓冲和单个在途请求串行 drain，最多 256 条 peer identity 只接受 exact terminal，confirmed 不被迟到状态回退。authority 清除、身份重配和 destroy 会失效旧 record / recovery、立即清空旧投影和 owner 状态；投影刷新失败不能把已确认事实降级成未保存。折叠 dock / 关闭导出菜单保存并撤销次级控件的 Tab / ARIA / inert，展开精确恢复，相关 Observer 与 timer 在 hide / destroy 后释放。回归必须同时检查矩形、`elementFromPoint`、Tab 顺序、权威预测确认和 console，不能用 CSS 隐藏或静态源码替代运行证据。
- 力学在共享单列断点 `max-width: 1024px` 下使用 `minmax(0, 1fr)`，并让控制区、可视区与 Canvas 以 `min-width: 0; max-width: 100%` 参与真实收缩；不要用根级裁切掩盖桌面 inline width 造成的 min-content 反馈。力学 Canvas owner 除父容器 `ResizeObserver` 外，还管理窗口 resize 和 `astra:physics-zoom-restored` 监听，保证跨断点或关闭 Zoom 后 CSS 宽度与 DPR 位图立即重新对齐，并在 destroy 时释放。Zoom dialog 的四类监听使用稳定 handler ref：init / open 幂等 attach，close / destroy 完整 detach；打开时焦点进入关闭按钮并约束 Tab，关闭、Escape 或销毁只把焦点归还仍连接且可用的原触发点。V7.7.30 候选复用上述父容器 Observer：当 `PhysicsZoom.movedCanvas` 与当前 PhysicsSim Canvas、观察目标与 `originalParent` 都精确相等时，回调通过 `syncOriginalParentResize()` 交给 Zoom 协调；不匹配则继续执行普通 `resizeCanvas()`。Zoom 仍只调用 `PhysicsSim.resizeForZoom()` 写 CSS、backing store、DPR、`W/H` 和即时 render；`_syncScale()` 使用 `min(1, sx, sy)`，自动布局只下缩，主动 pinch 仍可放大。动态合同模拟 390px 打开、window resize 先采到 863px、原父容器随后无第二次 window resize 稳定到 943px，断言既有 Observer 最终重建 943×528.08 逻辑尺寸和 943×528 DPR1 位图，关闭重开与直接桌面一致；Observer 数量、window / document listener 和 pinch owner 在生命周期后均归零。V7.7.17 已由 capture owner 在 Zoom、实验指南和导出菜单均未持有 Escape 时消费展开 dock 的 Escape；真实生命周期合同证明 hide → show 后首次 Escape 仍只折叠并归还主 FAB，下一次才走模块关闭，重复 show / hide 的 capture listener 对称释放且不泄漏，V7.7.18 已独立复验该路径通过。
- V7.7.27 把 student publication gate 扩到 registry + DOM 已登记的全部稳定 Physics module：每个已知深链都在 owner 前解析，open 才进入；列表或 `/unit-access` 判定的 hidden / locked 静默回到 `#physics`，missing / ordinary unknown 只输出固定、无 slug 的单条诊断。teacher、admin 和非 Physics 仍走原路由，不产生多余 authority 请求。`physics.mechanics` 的课程专用 owner 只接受固定 `e=0.40 / 0.80` 两次受控竖直落球，在预测后记录两次 `attempted`、等价测量表与一次结构化 `corrected`，再把焦点交给共享 `explained`；自由滑块、拖拽发射、暂停、清空、重看和 Zoom 为零证据，完成仍只读服务端投影。该 owner 的 destroy / reopen 会把课程 DOM、球体、暂停 / 拖拽、受控预设与对照状态一起复位并对称重挂 listener；受控运行中逻辑 Canvas 尺寸改变会取消当前轨迹、清受控球、保持零 `attempted` 并开放同预设重试，`reboundHeight > dropHeight` 的不可能测量直接拒绝。Activity 初始化若 recovery 中当前活动已有合法 `first_started_at`，则跳过重复 started，先 drain pending 再刷新；fresh scope 仍写一次，identity / authority replacement 强制写一次。实验指南打开时挂载稳定 document capture Escape owner；Zoom 存在时让位，否则首次 Escape 立即消费、关闭指南、对称解绑并归还模块焦点，从而保持 `Zoom > Guide > export/dock/module`。专项合同已通过，真实 9001 / SQLite / 外部浏览器仍由独立 QA 验收。
- 256 条 peer identity 只限制当前 Activity 的内存身份表；共享 IndexedDB 队列满是独立阻塞。遇到 `queue_limit_reached` 时，队首领域命令保留稳定 `client_event_id`，不 shift、不释放身份、不继续后续命令，也不输出预期 warn 或启动轮询。client 仅把物理队列的 `confirmed`、`removed`、`expired-pruned` 映射为不含身份的 `queue-capacity-released`；一个真实释放信号只允许一次重试，仍满就继续等待。authority 清除、身份重配和 destroy 会同步清除阻塞与页面缓冲。
- Future 的 6 方向 / 18 activity key 只登记到 catalog；本批没有 Future 页面、Bridge 或互动运行接线。BE-011 后端处置、V7.7.22 前端接线与 V7.7.27 教学闭环均已集成；V7.7.30 Zoom 候选仍需独立复审和真实浏览器续验，完整 FE-012 与 Future A03b 继续等待后续验证。

### 4.3 全局配置 (CONFIG)

`shared/js/config.js` 定义核心配置：

```javascript
CONFIG = {
    pages: {         // 页面元数据（标签、颜色、图标、标题、描述）
        mathematics: { label: '数学', accent: 'blue', ... },
        physics:     { label: '物理', accent: 'purple', ... },
        chemistry:   { label: '化学', accent: 'green', ... },
        algorithms:  { label: '算法', accent: 'orange', ... },
        biology:     { label: '生物', accent: 'teal', ... },
        cosmos:      { label: '地球与宇宙', accent: 'blue', ... },
        engineering: { label: '工程应用', accent: 'orange', ... },
        datascience: { label: '数据科学', accent: 'purple', ... },
        infotech:    { label: '信息技术', accent: 'teal', ... },
        materials:   { label: '材料微观', accent: 'orange', ... },
        humanities:  { label: '人文可视化', accent: 'teal', ... }
    },
    experiments: {   // 实验卡片列表（id、标题、描述、图标、变体、锚点）
        mathematics: [ /* 20 条 */ ],
        physics:     [ /* 20 条 */ ],
        chemistry:   [ /* 17 条 */ ],
        algorithms:  [ /* 12 条 */ ],
        biology:     [ /* 19 条 */ ]
    },
    accentColors: {  // 学科颜色映射
        mathematics: 'blue',
        physics: 'purple',
        chemistry: 'green',
        algorithms: 'orange',
        biology: 'teal',
        cosmos: 'blue',
        engineering: 'orange',
        datascience: 'purple',
        infotech: 'teal',
        materials: 'orange',
        humanities: 'teal'
    }
};
```

### 4.4 Canvas 渲染模式

多数图形实验使用 Canvas 2D API 进行绘制，少量表格、代码追踪或排序类实验使用 DOM/CSS 可视化：

- **DPR 适配**：`canvas.width = rect.width * dpr`，`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`
- **动画循环**：`requestAnimationFrame` + `performance.now()` dt 驱动
- **交互检测**：鼠标/触摸位置映射到画布坐标，几何碰撞检测
- **3D 投影**：Y-X 旋转矩阵 + perspective 透视投影（分子结构、DNA 螺旋、立体几何）
- **响应式**：`ResizeObserver` 监听容器尺寸变化（替代 window.resize）
- **教育面板**：多数实验通过 `_injectXxxPanel()` 动态注入 DOM

---

---

## 7. 路由与页面转场系统

### 7.1 路由器 (`Router`)

**核心对象**：`shared/js/router.js`

```javascript
Router = {
    currentPage: 'home',
    isTransitioning: false,
    transitionOrigin: { x: 50, y: 50 },

    init()          // 初始化：绑定导航点击、监听 hashchange、创建图标
    navigateTo()    // 页面切换（带/不带动画）
    handleHash()    // 处理 URL hash 变化
    updateNav()     // 更新导航栏高亮 + aria-current
    onPageEnter()   // 页面进入回调（init 各实验模块）
}
```

student 路由在页面脚本加载前额外消费 `AstraStudentCourseCatalogue.guardRoute()`：零班级的 `student`、以及目录快照未允许的工科 / Future 页面都会以 `history.replaceState` 归一到 `#planets`，因此不会先加载无权课程 owner 再显示错误门。ModuleSelector 还会按当前 page + activity key 隐藏未授权卡片，深链解析在 Canvas、Three、学习证据 owner 初始化前失败关闭。教师和管理员不经过这层学生目录裁剪，仍由原角色权限与后端授权决定范围。

### 7.2 转场动画流程

```
1. 当前页面淡出 (opacity→0, scale→0.97, blur→6px)  [0.18s]
2. 径向裁剪遮罩展开 (circle 0% → 150%)             [0.3s]
3. 切换 .active 类 + 滚动到顶部
4. 遮罩淡出 + 目标页面淡入 (opacity→1, y→0)        [0.3s]
5. Hero 区域子元素逐个入场 (stagger 50ms)
6. 触发 onPageEnter() 回调（初始化目标页面实验模块）
```

### 7.3 导航方式

- **URL Hash**：`#home`、`#mathematics`、`#physics` 等
- **导航栏点击**：顶部 nav 中每个 `.nav-item[data-page]`（支持 Tab 键盘导航）
- **首页卫星点击**：`selectModule('target')` → 自定义动画 → Router
- **实验画廊点击**：`ModuleSelector.openModule(page, id)` → 同页模块事务、按需资源与实验内容展开
- **Skip Navigation**：`#skip-nav` 链接，键盘用户可跳过导航栏直达内容

---

---

## 8. 模块选择器系统

### 8.1 工作原理

每个学科页面分为两种视图：

- **画廊视图** (Gallery)：显示所有实验卡片（支持键盘 Enter/Space 激活）
- **实验视图** (Module)：显示单个实验的完整内容

```
┌─────────────────────────────┐
│ 学科 Hero 区域               │
├─────────────────────────────┤
│ ┌───┐ ┌───┐ ┌───┐ ┌───┐   │  ← 画廊视图（ModuleSelector）
│ │ 01│ │ 02│ │ 03│ │ 04│   │     role="button" tabindex="0"
│ └───┘ └───┘ └───┘ └───┘   │
├─────────────────────────────┤
│ ← 返回                      │  ← 实验视图（点击卡片后展开）
│ [完整实验内容]               │
│                             │
├─────────────────────────────┤
│ 更多实验（推荐卡片）          │
└─────────────────────────────┘
```

### 8.2 关键方法

- `AstraExperimentRegistry.cleanupModule(subject, moduleId)`：只对精确 `verified:true` owner 执行模块级 cleanup，并返回冻结报告 `unknown`、`unverified`、`owner-unavailable`、`cleaned` 或 `failed`；legacy callback 不在模块级执行。
- `ModuleSelector.openModule(page, moduleId)`：先预校验目标；A→B 时先关闭学科 Zoom、cleanup 当前已验证实验 owner，再释放当前学习证据 owner，全部成功后才提交新的 transition generation、隐藏旧实验、显示目标并重新 init。任一步失败时不修改 DOM、hash、active state，也不提前销毁 evidence controller。
- 对 student 的稳定 Physics module，`openModule()` 在上述 owner 事务前统一进入 publication gate；只有权威 open 才递归以 `authorityPrepared` 激活。hidden / locked 不显示状态卡而直接恢复 `#physics`，unknown / missing 使用固定安全诊断；teacher、admin 与其他学科不经过这条学生门禁。
- `ModuleSelector.closeModule(page)`：B→画廊时使用相同的 Zoom / evidence / 实验 owner cleanup 事务；成功后清除已验证 owner 的初始化标记并恢复画廊，legacy 保留初始化标记。
- `ModuleSelector.leavePage(page)`：整页离开使用注册表 `cleanupPage()` 做兼容清理；只有报告包含完整计数、至少一个已加载 owner 实际执行且 `failed === 0` 时才释放 evidence controller，随后关闭公共工具并重置 dirty/init/generation 状态。未加载 legacy owner 会使 `executed < attempted`，这是既有兼容语义而不是失败；调用方通过 `skipExperimentCleanup` 避免模块级与页面级 cleanup 双调用。

每次转场都会推进 generation，旧资源加载、init 重试、resize、焦点、后端 schema settle 和相关推荐 timer 必须在写入前确认仍属于当前 generation。初始化抛错会把 runtime 标记为 dirty；已验证 owner 在重新进入前必须先成功 cleanup，dirty legacy 在同页保持 fail closed，不重复 init。Router 的深链失败必须恢复稳定 hash，陈旧 pending 回调不得覆盖新页面或新模块。

### 8.3 HTML 结构约定

实验内容必须用 `data-module` 属性标记：

```html
<div class="content-section" data-module="function-graph">
    <!-- 实验内容 -->
</div>
```

`data-module` 值必须与 `CONFIG.experiments` 中的 `id` 一致。

---

---

## 9. 首页系统

### 9.1 视觉组件

当前入口层级：`#planets` 是「星序 Astra」多星系顶层入口；`#home` 是「工科实验室」星系首页。两者都在主站 `index.html` 内，但视觉职责不同，不能互换标题与交互系统。

首页自身声明为固定全屏并裁剪动画装饰；由于基础样式 `.page.active` 的选择器权重高于 `.home-page`，活动态必须由 `.page.home-page.active` 显式恢复 `position: fixed`、`inset: 0`、`100dvh` 和 `overflow: hidden`，`.home-container` 则以 `height: 100%` 跟随父级动态视口。不要只依赖 body 的 `overflow-x` 隐藏滚动条，否则 390px 视口的根 `scrollWidth` 仍会被极光、星层和轨道扩张；也不要让场景子级重新使用独立 `100vh`，以免移动浏览器动态工具栏变化时底部内容被裁掉。

| 组件       | 类/ID                        | 说明                       |
| ---------- | ---------------------------- | -------------------------- |
| 粒子网络   | `#particle-network`        | Canvas 粒子连线 + 鼠标吸引 |
| 三层星空   | `.star-layer-far/mid/near` | CSS 闪烁星星 + 鼠标视差    |
| 星云       | `.nebula-1/2/3`            | CSS 模糊渐变漂浮           |
| 流星       | `#shooting-stars`          | JS 随机生成 + CSS 动画     |
| HUD 框架   | `.hud-frame`               | 四角装饰 + 扫描线 + 数据流 |
| 主星       | `#main-star`               | 工科实验室品牌核心 + 表面纹理滚动 |
| 主星眼睛   | `.star-eyes-container`     | 眼睛/瞳孔跟随鼠标，保留 L1 星系人格化交互 |
| 品牌副标   | `.star-subtitle`           | 当前星系定位与实验数量说明 |
| 打字机标语 | `#tagline-text`            | 循环 5 段文案              |
| 卫星轨道   | `#satellites-orbit`        | 5 颗行星独立 3D 轨道       |

### 9.2 卫星轨道系统

5 个卫星分别对应 5 个学科。`#home` 使用独立椭圆轨道 + 透视缩放，让行星持续漂浮；移动端按断点缩小轨道半径，避免图标与标签重叠：

| 卫星        | 学科 | 颜色 | 轨道半径 X/Y | 周期 |
| ----------- | ---- | ---- | ------------ | ---- |
| satellite-1 | 数学 | 蓝色 | 300 / 170 | 26s |
| satellite-2 | 物理 | 紫色 | 365 / 212 | 33s |
| satellite-3 | 化学 | 绿色 | 430 / 248 | 41s |
| satellite-4 | 算法 | 橙色 | 385 / 224 | 30s |
| satellite-5 | 生物 | 青色 | 340 / 198 | 36s |

**点击卫星动画流程**：

1. 粒子喷发效果
2. 主星摇晃 + 淡出
3. 其他卫星缩小消失
4. 选中卫星放大至屏幕中心（4倍）
5. 背景渐变为学科主题色
6. 路由切换至对应学科页面
7. 重置所有状态（延迟 300ms）

---

---

## 10. 加载屏与启动优化

### 10.1 加载屏系统

为解决 60+ 个脚本首次加载时的白屏/卡顿问题，实现了**内联 CSS 加载屏**：

```html
<head>
  <style>
    /* 加载屏样式直接内联在 <head> 中 */
    #loading-screen { /* 全屏遮罩 + 旋转动画 */ }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.5; } }
  </style>
</head>
<body>
  <div id="loading-screen">
    <div class="loading-spinner"></div>
    <p class="loading-text">正在加载实验室…</p>
  </div>
  <!-- 页面内容 -->
</body>
```

**特点**：

- CSS 内联在 `<head>` 中，**首帧即可渲染**，无需等待任何外部资源
- 加载屏位于 DOM 顶层 (`z-index: 99999`)
- 旋转动画 + 脉冲文字提供视觉反馈
- v6.3 起加载屏会按当前 hash 区分星系入口文案与色调：星序、工科试验室、未来星系分别进入自己的启动语境

#### v6.3 启动根因警示

本轮曾出现 `#cosmos` 等页面长时间停留在加载层的问题，根因不是单页内容损坏，而是加载层与全站级启动链过度耦合：页面脚本、实验脚本、增强系统、外部字体/CDN 和缓存预热被放在同一条启动路径上，任意一个长任务或资源阻塞都可能让用户误以为页面无法进入。后续复接 `frontier-learning.js` 时又定位到一次主线程卡死：`MutationObserver` 监听的读数区子树内存在无条件 `innerHTML` 重写，导致 observer 回调反复触发同一装饰函数。

维护硬规则：

- 加载屏只代表**最小 Router shell 已启动**，不得用它表示所有星系资源、实验模块、学习框架、canvas 动画或 Service Worker 已 ready。
- 新增星系页面脚本必须登记到 `shared/js/page-registry.js`，并同步 galaxy、标签、ready/enter/leave；Router 按页面进入加载，角色权限不得写入注册表。
- 新增星系增强脚本必须登记到 `Router.galaxySupportScripts`，并证明它只处理当前星系/当前页面；禁止在 `index.html` 中恢复全站 deferred 顺序队列。
- 新增工科试验室实验脚本必须登记到 `shared/js/experiment-registry.js`，按实验打开时由 `ModuleSelector` 加载；不要再把实验脚本清单写回 `module-selector.js` 或 `index.html`。
- cleanup 状态使用 `legacy-callback`、`candidate-unwired`、`validated-callback` 或 `missing`。只有完成真实 owner 核对、可取消资源修复和模块切换/离开重入验证的条目才能配置 `validated-callback / verified:true / run`；空函数、错误 owner 和未经验证的候选均不得伪装成可执行 cleanup。V7.4.26 仍为 `65 legacy-callback + 23 validated-callback + 0 missing`，模块级 cleanup 只允许 23 项已验证 owner。
- `SortingLab.destroy()` 必须使当前排序 epoch 失效、清除并 settle 所有 sleep/完成动画 timeout、阻止迟到 DOM 写入并恢复工具栏；速度滑块监听属于应用启动层，实验 owner 不重复绑定或移除它。`CellStructure.destroy()` 必须取消唯一 RAF、长按 timeout，断开 ResizeObserver，移除控件/document/Canvas 监听器（包括 `touchcancel`），并清空 Canvas/ctx 引用；重复 init/destroy 后资源数量不得增长。
- DNA、光合作用与遗传模式 wrapper 必须从 Canvas 最近的 `.demo-section` 查找 `.viz-controls`，再作为 controls 的兄弟节点挂载；不得从 `.canvas-container` 内查找兄弟控件。合同 fake DOM 必须保留真实兄弟关系，并验证 wrapper 创建、复用和 destroy 后监听器重绑。
- 模块切换/返回画廊先关闭物理/生物学科级 Zoom，再对当前 `verified:true` owner 执行精确 cleanup；失败必须在 DOM/hash/active state 变化前中止。成功后删除已验证 owner 的 init 标记并允许再次进入重新 init；legacy 不执行模块 callback。整页离开固定为关闭活动实验、公共实验工具和 Zoom，执行注册表页面级兼容 cleanup，再重置 ModuleSelector 状态，并避免同一 owner 双清理。
- 星系切换时必须有生命周期清理：离开页面调用对应 `destroy*`，离开工科试验室时关闭活动实验与浮动控件，避免动画循环和事件监听累积。
- 任何会扫描多个页面、挂 `MutationObserver`、启动 `requestAnimationFrame` 或绑定全局事件的增强层，必须提供当前页 init 和 destroy；不满足前不得进入自动启动链。
- `MutationObserver` 驱动的装饰器必须是幂等的：如果会写入被观察子树，必须先做签名、差异判断或节点存在检查；禁止在 observer 回调路径中无条件重写同一子树的 `innerHTML`。
- 缓存只做加速，不做启动前置条件。小型星系访问元数据可写入 localStorage，并用 cookie 做受限环境回退；静态资源本体依赖 HTTP cache / Cache Storage / 运行时缓存，不写入 cookie。session、bearer、password reset、admin bootstrap 等敏感 token 不得写入 localStorage/sessionStorage 或可被前端 JS 读取的 cookie。
- Service Worker 安装阶段只预缓存最小 APP_SHELL；星系资源通过实际访问后的运行时缓存留存，禁止重新把全站资源塞进安装清单。`student/teacher/admin` 的页面 CSS/JS 是例外：它们必须走 network-only，既不安装预缓存也不进入运行时 CacheStorage。

### 10.2 分阶段初始化 (initHome)

`main.js` 中的 `initHome()` 采用三阶段 `requestAnimationFrame` 分帧执行，避免长任务阻塞：

```javascript
function initHome() {
    // Phase 1: 粒子网络 + 卫星系统
    requestAnimationFrame(() => {
        initParticleNetwork();
        SatelliteSystem.init();

        // Phase 2: 星空 / 流星 / HUD
        requestAnimationFrame(() => {
            StarField.init();
            initShootingStars();
            initHUD();

            // Phase 3: 打字机 + 视差 + 交互绑定
            requestAnimationFrame(() => {
                initTypewriter();
                initParallax();
                // ... 其他初始化
            });
        });
    });
}
```

### 10.3 回访用户优化（localStorage / cookie 元数据 + Service Worker）

v4.0.1 新增两层缓存优化，显著提升回访用户加载体验：

#### 第一层：轻量访问元数据

`index.html` 内联脚本在解析早期读取 `englab-cache-meta`（JSON），判断是否为回访用户：

```javascript
// 存储结构
{ visitCount: number, lastVisit: ISO_string, hasSeenSplash: boolean }
```

- **回访用户标识**：`html.return-visit` CSS 类 + `window.__englabCache.returning = true`
- **加载屏加速**：回访用户使用更短的过渡动画（0.26s vs 0.5s）、更小的 loader
- **`main.js` 自适应**：回访用户的轮询间隔更短（60ms vs 90ms）、fallback 超时更短（900ms vs 1800ms）
- **`home.js` 自适应**：回访用户减少星星数量，延迟加载粒子网络/流星等非关键动画

`Router` 另维护 `astra-galaxy-cache-meta`，记录已访问星系、最后访问页面和访问次数。优先写入 `localStorage`，在受限浏览器环境下写入同名 cookie 作为小型元数据回退。cookie 只存星系访问状态，不存 JS/CSS/图片等资源本体。

#### 第二层：Service Worker 离线缓存

`sw.js` 实现完整的缓存策略：

- **安装阶段**：只预缓存最小 APP_SHELL（index.html、核心 JS/CSS、星序总览基础资源）
- **激活阶段**：清理旧版本缓存，立即接管所有客户端
- **请求策略**：
  - 导航请求：network-first + cache fallback
  - 静态资源（.js/.css/.png/.jpg/.svg/.woff2）：stale-while-revalidate
  - 三角色页面资源（`pages/student/student.*`、`pages/teacher/teacher.*`、`pages/admin/admin.*`）：network-only + `cache: no-store`，不得写入共享 CacheStorage
- **缓存命名**：`astra-static-v{版本号}`，更新代码时需同步更新
- **注册时机**：`main.js` 中通过 `requestIdleCallback` 延迟注册，不阻塞首屏

#### 版本管理

更新代码后需同步更新以下位置的版本号：

1. `sw.js` 中的 `CACHE_NAME`（如 `astra-static-v20260619v63GalaxyLoadP2`）
2. `index.html` 中本轮改动的 `<script>` / `<link>` 标签 `?v=` 查询参数
3. `shared/js/main.js` 中 HTTP fallback 分组清单的真实资源版本
4. `shared/js/page-registry.js` 中角色页面 `styles/script` 的真实资源版本；普通页面与星系 support 仍核对 Router 的对应清单

### 10.4 加载屏消除

加载屏在以下条件满足后淡出移除：

1. `main.js` 执行完毕（`Router.init()` 已触发当前页面进入）
2. 通过 `setTimeout + rAF` 确保至少一帧渲染完成
3. 加载屏 `opacity` 过渡到 0，`transitionend` 后从 DOM 移除

注意：页面脚本或实验脚本加载失败时，加载屏不应重新承担错误提示职责；应由对应页面或模块显示降级/空状态，并在控制台保留维护信息。

---

---

## 17. 新增星系开发指南（v6.3 修订）

星序 Astra 在 v6.0 后正式确立"多星系"顶层架构，v6.3 起追加更严格的层级与 UI 隔离规则。本节是从 0 到 1 创建或重建一个星系的完整参考。

**核心原则**：新增星系不是新增一个工科试验室学科页。星系是一级菜单，必须有自己的页面品牌、视觉系统、顶栏、页脚和二级目录。工科试验室的学科页布局、侧边栏、module-selector 和页脚只能服务工科试验室，不得作为未来星系最终 UI。

### 17.1 决策矩阵：站内星系 vs 外链子站

| 维度 | 站内星系（主站内独立星系壳） | 外链子站（独立 SPA） |
| --- | --- | --- |
| 适用场景 | 技术栈可共享，但产品定位与 UI 外壳必须独立 | 技术栈/交互范式差异大（如代码执行、AI 推理、3D 场景） |
| 路由 | 可共享 `shared/js/router.js`，但必须有星系级入口和二级目录 | 自带独立 router（如 `CvRouter`） |
| 部署 | 共享主站 `index.html` | 独立 `index.html`，独立目录（如 `codevis/`） |
| 命名空间 | **必须**有星系级 CSS/JS 前缀，不得继续扩散 englab 类名 | **必须**全套独立前缀（CSS class / JS 全局） |
| 与 planets 集成 | `CONFIG.galaxies` 配 `internal: true` | `CONFIG.galaxies` 配 `externalUrl: '/xxx/'` |
| 缓存 | 沿用主站 sw.js 缓存清单 | sw.js 缓存清单需追加子站静态资源 |
| 开发成本 | 中（可复用底层工具，但 UI 外壳必须重建） | 中-高（需建立独立 SPA + 隔离） |

**经验法则**：先决定星系定位与 UI 外壳，再决定站内或外链。不得因为站内开发成本低，就把新星系伪装成工科试验室的一个学科页。

### 17.2 需要绘制 / 准备的资产清单

1. **星系图标**：256×256 PNG 或矢量 SVG，用于星序总览与本星系顶栏
2. **星系主色**：1 个主色 + 1 个辅色（HSL 色相相隔 30~60°），写入 `tokens.css` 作为 `--galaxy-{name}-primary` / `--galaxy-{name}-accent`
3. **星球颜色 / 轨道半径**：写入 `CONFIG.galaxies` 配置，由 planets 自动布局
4. **星系首页视觉**：站内星系也需要自有首页或星系壳，不得直接使用工科试验室主页视觉
5. **二级目录图标**：每个星系内部知识目录一个图标，不等同于全局星系图标
6. **实验缩略图**：用于"更多实验"卡片（懒加载，建议 320×180 webp）

### 17.3 可复用接口（直接调用，无需重写）

| 接口 / 文件 | 用途 | 调用方式 |
| --- | --- | --- |
| `CONFIG.galaxies` (`shared/js/config.js`) | 星系顶层元数据 | 数组追加一项即可被 planets 自动识别 |
| `CONFIG.experiments` | 单实验注册 | 添加 `{ id, title, galaxy, subject, file }` |
| `AstraPageRegistry` (`shared/js/page-registry.js`) | 页面身份、星域、懒加载与页面生命周期 | 为站内页面登记 `galaxy/tags/script/ready/enter/leave`；Router 统一消费，不承载角色授权 |
| `Router.galaxySupportScripts` | 星系级轻量增强 | 只登记当前星系进入后才需要的 support；不得放入会全站扫描或缺少 destroy 的增强脚本 |
| `ModuleSelector.renderGallery(subject)` | 画廊渲染 | 仅适合工科试验室学科页；新星系需先评估是否适用 |
| `pages/planets/planets.js` 自动布局 | 星系球公转位置计算 | 不必动 JS，仅追加 CONFIG |
| `sw.js` 缓存策略 | 最小 APP_SHELL + 运行时缓存 | 只把真正首屏必需资源放入 APP_SHELL；星系页面资源通过 Router 访问后缓存 |
| `shared/css/tokens.css` 设计令牌 | 颜色 / 间距 / 字体 / 阴影 | 通过 CSS 变量引用 |
| GSAP 径向裁剪转场 | 页面进出动画 | Router 内置，无需重写 |
| Canvas DPR 适配模式 | 高分屏清晰渲染 | 复用 `_setupCanvasDPR(canvas)` 习惯 |

### 17.4 **不要**复用 / 必须隔离的部分

1. **工科试验室 navbar / footer / sidebar / module-selector 页面壳** — 这些只属于工科试验室，未来星系不得照搬
2. **CSS 类名命名空间** — 例如代码空间用 `cv-` 前缀，新星系必须有自己的 2~3 字母前缀（如 `fg-` 未来星系 / `sg-` 智能星系 / `hg-` 历史星系）
3. **JS 全局变量** — 同上，新星系子站全局对象应统一前缀（如 `Sg*` / `Hg*`）
4. **主站 `Router` 实例** — 外链子站独立 router，禁止跨子站调用主站 Router
5. **sw.js 缓存键** — 不同子站若同时部署，缓存版本号必须独立（如 `astra-codevis-v0.2.0`）
6. **`shared/js/main.js` 启动入口** — 站内启动顺序固定，外链子站需写自己的 `initApp`
7. **实验编号 / 路由 hash** — 站内 hash 由主站统一调度；外链子站自治，禁止占用 `#/galaxy/xxx` 这类主站保留前缀
8. **跨星系页脚快捷区** — 星系内部页脚不得列出其他星系的二级目录；只允许提供“返回星序总览”这样的全局出口

### 17.5 站内星系上线流程（推荐路径）

0. **定位**：先写清星系名称、一级入口、二级目录、页面品牌、视觉方向和不得复用的旧组件
1. **配置**：`shared/js/config.js` → `CONFIG.galaxies` 追加或修订 `{ id, name, color, subjects: [...] }`
2. **星系外壳**：`pages/{galaxy}/` 新建文件夹 + `{galaxy}.css` + `{galaxy}.js`，建立独立顶栏/页脚/二级目录结构
3. **HTML 骨架**：`index.html` 追加星系级 `<section id="page-{galaxy}">`，不得直接复制工科试验室学科页骨架
4. **二级内容**：每个知识目录或实验一个 JS 文件，封装为对象（`init` / `destroy`）
5. **脚本登记**：站内星系页面脚本和页面级 ready/enter/leave 写入 `shared/js/page-registry.js`，由 Router 进入页面时按需消费；星系增强脚本写入 `galaxySupportScripts`，不要把页面脚本或增强脚本追加为 `index.html` 底部 `defer`
6. **路由生命周期**：`router.js` 统一调用注册表 enter/leave；星系壳特例和课程实验清理仍留在 Router/ModuleSelector，后续迁移必须独立切片。canvas RAF、resize、MutationObserver、全局事件都必须可清理；observer 装饰函数必须幂等，不能无条件重写被观察子树
7. **星序总览入口**：`pages/planets/` 从 `CONFIG.galaxies` 读取一级星系，不直接展示该星系内部全部二级目录
8. **CSS 令牌**：`shared/css/tokens.css` 追加 `--{galaxy}-primary` / `--{galaxy}-accent`，页面类名使用星系前缀
9. **页脚边界**：星系页脚只列本星系内容，跨星系跳转只保留“返回星序总览”
10. **sw.js**：仅当资源属于最小启动壳时才追加到 APP_SHELL；一般星系 JS / CSS 依赖运行时缓存，并同步 bump 缓存版本

### 17.6 外链子站上线流程（独立 SPA）

1. **目录**：根目录新建 `{site}/`（如 `codevis/`）
2. **入口**：`{site}/index.html` 独立 SPA，复用 `shared/css/tokens.css` 设计令牌
3. **命名空间**：CSS 类前缀 + JS 全局前缀（参考 17.4）
4. **路由**：自带 `{Site}Router`（hash），不依赖主站 Router
5. **首页**：从 `codevis/pages/course-catalog/` 的现行目录—子课层级出发，按目标子站重新设计，不复制已删除的 V6 模板
6. **planets 配置**：`CONFIG.galaxies` 追加 `{ id, name, color, externalUrl: '/{site}/', internal: false }`
7. **sw.js**：追加 `{site}/index.html` 与全部子站 JS/CSS 至缓存清单
8. **README**：`{site}/README.md` 单独说明子站定位 + 技术栈 + 启动方式
9. **导航出口**：子站仅提供"返回星序总览"或返回来源星系，不列出其他星系二级目录
10. **部署**：`deploy.ps1` 与 httplib 服务器自动覆盖（静态资源透传，无需后端改造）

### 17.7 验收清单（上线前必查）

- [ ] `CONFIG.galaxies` 配置正确，星序总览页可见新星系
- [ ] 一级入口进入星系壳，二级目录只在星系内部出现
- [ ] 页面品牌、顶栏、页脚均显示本星系名称，不误用“星序 Astra”
- [ ] 新星系未直接复用工科试验室 navbar / footer / sidebar / module-selector 页面壳
- [ ] hash 路由前进/后退正常，GSAP 转场无残留
- [ ] Canvas DPR 适配（4K + 移动端 retina 均清晰）
- [ ] 移动端 ≤375px 不溢出（参考 §12.5 移动端规范）
- [ ] 无障碍：Canvas 有 `role="img"` + `aria-label`，键盘可访问
- [ ] reduce-motion 媒体查询：动画退化为静态
- [ ] sw.js 缓存命中，离线可加载
- [ ] 外链子站：独立 `<title>` 正确，命名空间无主站冲突
- [ ] `doc/02-更新规划.md` 更新该星系任务状态，`doc/03-发布历史.md` 追加完成记录

---
