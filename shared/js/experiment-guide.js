// ===== Experiment Guide System =====
// Shows first-time operation hints when user opens an experiment.
// Tracks seen status in memory. Provides a "?" re-open button.

var ExperimentGuide = {
    _storageKey: 'englab-guide-seen',
    _overlay: null,
    _helpBtn: null,
    _focusTimer: null,
    _currentModule: null,
    _escapeOwnerHandler: null,
    _escapeOwnerAttached: false,
    _seen: new Set(),
    _moduleAliases: {
        complex: 'complex-numbers',
    },

    // ── Guide data per subject (generic) ──
    _subjectGuides: {
        mathematics: {
            title: '数学实验操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '拖动滑块调整参数，观察图像实时变化' },
                { icon: 'mouse-pointer-click', text: '点击切换按钮查看不同模式或函数类型' },
                { icon: 'move', text: '部分实验支持拖拽交互，直接在画布上操作' },
                { icon: 'book-open', text: '底部教育面板展示公式推导与知识要点' }
            ]
        },
        physics: {
            title: '物理实验操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '拖动滑块调整物理量（速度、加速度、力等）' },
                { icon: 'play', text: '点击播放/暂停控制动画运行，观察运动过程' },
                { icon: 'bar-chart-2', text: '实时数据面板展示当前物理量计算结果' },
                { icon: 'book-open', text: '教育面板包含公式、定律和人教版知识点' }
            ]
        },
        chemistry: {
            title: '化学实验操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '点击元素/分子查看详细属性和结构信息' },
                { icon: 'sliders-horizontal', text: '调整参数观察反应条件对化学过程的影响' },
                { icon: 'rotate-3d', text: '部分实验支持3D旋转，拖拽查看分子空间结构' },
                { icon: 'book-open', text: '知识面板展示反应方程式、机理和考试要点' }
            ]
        },
        algorithms: {
            title: '算法实验操作指南',
            steps: [
                { icon: 'play', text: '点击运行/步进按钮逐步观察算法执行过程' },
                { icon: 'sliders-horizontal', text: '调整数据规模和速度参数' },
                { icon: 'shuffle', text: '点击随机/重置生成新的测试数据' },
                { icon: 'book-open', text: '面板展示时间复杂度分析和伪代码' }
            ]
        },
        biology: {
            title: '生物实验操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '点击切换按钮查看不同阶段或过程' },
                { icon: 'play', text: '播放动画观察生物过程的动态变化' },
                { icon: 'zoom-in', text: '部分实验支持缩放，查看微观结构细节' },
                { icon: 'book-open', text: '知识面板包含人教版教材核心概念和要点' }
            ]
        }
    },

    // ── Experiment-specific overrides (optional, for key experiments) ──
    _experimentGuides: {
        'periodic-table': {
            title: '元素周期表操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '点击任意元素查看详细属性（居中弹窗）' },
                { icon: 'palette', text: '顶部按钮切换显示模式：标准分类/电负性/原子半径' },
                { icon: 'search', text: '使用搜索框按名称、符号或序号快速定位元素' },
                { icon: 'x', text: '点击弹窗外部任意区域即可关闭详情面板' }
            ]
        },
        'kinematics': {
            title: '匀变速运动操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '拖动 v₀ 和 a 滑块设置初速度与加速度' },
                { icon: 'play', text: '点击播放观察粒子运动，暂停后可手动拖动时间轴' },
                { icon: 'bar-chart-2', text: 'v-t 图阴影面积 = 位移，s-t 图为抛物线' },
                { icon: 'book-open', text: '教育面板实时更新速度/位移公式计算过程' }
            ]
        },
        'calculus': {
            title: '微积分操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部按钮切换三种模式：导数/积分/Taylor展开' },
                { icon: 'move', text: '拖拽画布上的红色标记点观察切线/面积变化' },
                { icon: 'sliders-horizontal', text: '调整参数（阶数/区间）观察逼近效果' },
                { icon: 'book-open', text: '面板展示极限定义、基本公式与几何意义' }
            ]
        },
        'genetics': {
            title: '遗传学操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '选择亲本基因型，观察 Punnett 方格生成' },
                { icon: 'dna', text: '切换单基因/双基因/种群遗传模式' },
                { icon: 'bar-chart-2', text: '观察后代表现型比例统计图' },
                { icon: 'book-open', text: '知识面板包含分离定律和自由组合定律' }
            ]
        },
        'dna': {
            title: 'DNA 结构操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部按钮切换四种模式：双螺旋 / 复制 / 转录 / 突变' },
                { icon: 'rotate-3d', text: '双螺旋模式可拖拽旋转查看立体结构（A-T、G-C 配对）' },
                { icon: 'play', text: '复制/转录模式自动播放过程动画，可暂停或调速' },
                { icon: 'mouse-pointer-click', text: '点击碱基对查看详细配对信息（2 个 / 3 个氢键）' },
                { icon: 'book-open', text: '知识面板含 Watson-Crick 模型与人教版必修2 核心要点' }
            ]
        },
        'cellular-respiration': {
            title: '细胞呼吸操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部三按钮切换三个阶段：糖酵解 → 柠檬酸循环 → 电子传递链' },
                { icon: 'play', text: '默认自动播放粒子流动，演示底物→产物转化过程' },
                { icon: 'sliders-horizontal', text: '可调节速度滑块加快/减慢动画进度' },
                { icon: 'bar-chart-2', text: '右侧面板实时显示当前阶段场所、底物、产物、ATP 产量' },
                { icon: 'book-open', text: '面板汇总三阶段总览：高中教材常用估算约 38 ATP；现代常见真核细胞约 30-32 ATP，受穿梭系统和条件影响' }
            ]
        },
        'photosynthesis': {
            title: '光合作用操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部按钮切换三种模式：反应模拟 / 光合曲线 / 呼吸对比' },
                { icon: 'play', text: '反应模拟点击「开始模拟」观察光反应与 Calvin 循环（光不直接依赖反应）的物质和能量转化' },
                { icon: 'sliders-horizontal', text: '调节光照强度 / 温度 / CO₂ 浓度三滑块，观察对反应速率的影响' },
                { icon: 'bar-chart-2', text: '光合曲线模式呈现 Michaelis-Menten 速率-光强曲线及温度修正' },
                { icon: 'book-open', text: '呼吸对比模式找出补偿点 / 饱和点（人教版必修1 第五章）' }
            ]
        },
        'mitosis': {
            title: '有丝分裂操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '点击阶段按钮切换间期 → 前期 → 中期 → 后期 → 末期' },
                { icon: 'play', text: '播放/暂停按钮控制动画自动循环演示染色体动态' },
                { icon: 'sliders-horizontal', text: '速度滑块调节动画快慢，方便观察纺锤丝牵引细节' },
                { icon: 'bar-chart-2', text: '中期染色体排列在赤道板，是观察染色体形态最佳时期' },
                { icon: 'book-open', text: '末期形成 2 个遗传信息与母细胞完全相同的子细胞（人教版必修1）' }
            ]
        },
        'electromagnetism': {
            title: '电磁场操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部按钮切换 5 种显示模式：电力线 / 等势线 / 电势图 / 粒子轨迹 / 磁场' },
                { icon: 'sparkles', text: '右侧「预设配置」一键加载偶极子 / 四极子 / 平行板电容器 / 三角形' },
                { icon: 'move', text: '拖拽电荷或导线可改变位置，添加/删除按钮自由组合' },
                { icon: 'crosshair', text: '勾选测量探针后在画布上点击查看任意点的电场强度与电势' },
                { icon: 'book-open', text: '粒子轨迹模式演示电荷在场中的运动；磁场模式展示通电导线周围磁感线' }
            ]
        },
        'reaction-rate': {
            title: '化学反应速率操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '调节温度滑块改变粒子运动速度，观察有效碰撞频率变化' },
                { icon: 'sliders-horizontal', text: '调节浓度滑块改变粒子数量，模拟单位体积反应物增减' },
                { icon: 'check-square', text: '勾选「催化剂」可降低活化能，加速反应而不改变产物总量' },
                { icon: 'play', text: '左侧粒子区实时模拟有效碰撞（闪光），右侧绘制反应进度曲线' },
                { icon: 'book-open', text: '基于碰撞理论 + Maxwell-Boltzmann 分布（人教版选必一第2章）' }
            ]
        },
        'chemical-equilibrium': {
            title: '化学平衡操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '示例反应 N₂ + 3H₂ ⇌ 2NH₃（放热），点击「开始」反应趋向平衡' },
                { icon: 'plus', text: '7 个扰动按钮：加 N₂ / 加 H₂ / 移除 NH₃ / 升温 / 降温 / 加压 / 减压' },
                { icon: 'bar-chart-2', text: '右侧曲线实时展示三组分浓度变化；K_c 只随温度改变，浓度/压强/催化剂不改变 K_c' },
                { icon: 'thermometer', text: '升温→平衡向吸热方向（逆反应）移动；加压→平衡向气体分子数减少的方向移动' },
                { icon: 'book-open', text: '勒夏特列原理：平衡总是向减弱外界扰动的方向移动；催化剂只改变达到平衡的快慢，不改变平衡位置' }
            ]
        },
        'electrochemistry': {
            title: '电化学操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部按钮切换两种模式：原电池（Zn-Cu，自发产电）/ 电解池（CuCl₂，外加电压）' },
                { icon: 'play', text: '播放/暂停按钮控制电子在外电路 + 离子在溶液中的迁移动画' },
                { icon: 'zap', text: '原电池：Zn 失电子（负极氧化），Cu²⁺ 得电子（正极还原），E°=1.10 V' },
                { icon: 'zap', text: '电解池：阳极氧化（2Cl⁻−2e⁻→Cl₂↑），阴极还原（Cu²⁺+2e⁻→Cu）' },
                { icon: 'book-open', text: '原电池负极为阳极、正极为阴极；电解池阳极接电源正极、阴极接负极。阳离子向阴极附近、阴离子向阳极附近维持电中性' }
            ]
        },
        'chemical-bond': {
            title: '化学键操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部按钮切换三种化学键：离子键 / 共价键 / 金属键' },
                { icon: 'circle', text: '离子键：阴阳离子静电引力（NaCl），无方向性、无饱和性' },
                { icon: 'link', text: '共价键：原子共用电子对（H₂O），有方向性、有饱和性' },
                { icon: 'sparkles', text: '金属键：金属阳离子 + 自由电子海，解释金属导电、延展性' },
                { icon: 'book-open', text: '右侧「化学键知识点」详解每种键的形成条件、特征与性质（人教版必修2）' }
            ]
        },
        'ionic-reaction': {
            title: '离子反应操作指南',
            steps: [
                { icon: 'list', text: '顶部下拉选择反应：NaOH+HCl / Na₂CO₃+HCl / BaCl₂+Na₂SO₄' },
                { icon: 'mouse-pointer-click', text: '三阶段按钮切换：化学方程式 → 全离子方程式 → 净离子方程式' },
                { icon: 'eye', text: '画布左右展示反应物/生成物粒子，标灰的是「旁观离子」（不参与净反应）' },
                { icon: 'arrow-right', text: '净离子方程式去掉旁观离子，揭示反应本质（如 OH⁻ + H⁺ → H₂O）' },
                { icon: 'book-open', text: '复分解反应发生条件：生成水、气体、沉淀（人教版必修1第2章）' }
            ]
        },
        'organic-chemistry': {
            title: '有机化学操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '左侧分子按钮切换 5 种典型有机物：甲烷 / 乙醇 / 乙酸 / 苯 / 丙烯' },
                { icon: 'move', text: '在 3D 视图上拖拽鼠标可任意角度旋转分子，观察空间构型' },
                { icon: 'pause', text: '暂停按钮停止自动旋转，便于专注观察特定角度' },
                { icon: 'tag', text: '右侧面板高亮官能团（—OH 羟基 / —COOH 羧基 / C=C 双键 / 苯环）' },
                { icon: 'book-open', text: '展示典型反应：取代、加成、消去、酯化等（人教版选必三第3章）' }
            ]
        },
        'atomic-structure': {
            title: '原子结构与电子排布操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部 3 模式：轨道形状（s/p/d 电子云）/ 电子排布（轨道方框图）/ 玻尔模型（壳层动画）' },
                { icon: 'list', text: '元素选择支持 Z=1~36（H 到 Kr），覆盖人教版必修一周期表前 4 周期' },
                { icon: 'circle', text: '轨道模式：电子云密度图直观展示电子出现概率（亮区概率高）' },
                { icon: 'arrow-up-down', text: '排布模式：方框 + ↑↓ 箭头展示泡利不相容、洪特规则填充顺序' },
                { icon: 'book-open', text: '玻尔模型展示分层 K-L-M-N 与跃迁吸/放光（人教版必修一第4章 / 选必二第1章）' }
            ]
        },
        'element-compounds': {
            title: '元素化合物操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部 2 模式：价-类二维图（物质转化网络）/ 焰色反应（金属焰色火焰模拟）' },
                { icon: 'list', text: '二维图模式选择元素 Na/Fe/Al/Cl/N/S，横轴=物质类别、纵轴=化合价' },
                { icon: 'circle', text: '点击图中物质节点，绿色箭头变金色高亮其参与的所有转化反应' },
                { icon: 'book-open', text: '信息面板列出方程式、反应条件与现象；横向转化多为复分解、纵向转化必为氧化还原' },
                { icon: 'flame', text: '焰色反应模式：选金属看特征焰色与谱线（人教版必修一第3章 / 必修二第3章）' }
            ]
        },
        'intermolecular-forces': {
            title: '分子间力与氢键操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部 2 模式：沸点趋势（四个主族氢化物沸点折线）/ 氢键模型（分子氢键网络动画）' },
                { icon: 'line-chart', text: '沸点模式：点击图例按钮可单独显示/隐藏某一族，对比趋势' },
                { icon: 'circle-dot', text: '点击折线上的数据点，查看该氢化物沸点与主要分子间作用力' },
                { icon: 'triangle-alert', text: 'NH₃ / H₂O / HF 被黄环标记为“氢键反常”高点；ⅣA 族无氢键作参照线' },
                { icon: 'book-open', text: '氢键模式：选水/HF/氨观察 X—H···Y 虚线氢键与实线共价键（选必二第2章）' }
            ]
        },
        'molecular-structure': {
            title: '分子结构操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '左侧选择经典分子：H₂O / CO₂ / CH₄ / NH₃ 等，含杂化与极性信息' },
                { icon: 'move', text: '画布上拖拽鼠标自由旋转 3D 球棍模型，观察分子立体构型' },
                { icon: 'crosshair', text: '测量模式：依次点选两/三个原子，自动显示键长 / 键角' },
                { icon: 'eye', text: '轨道模式：可视化孤对电子（lone pair）与杂化轨道方向' },
                { icon: 'book-open', text: 'VSEPR 价层电子对互斥理论：键角与构型由总电子对数决定（人教版选必二第2章）' }
            ]
        },
        'chemical-reactions': {
            title: '化学反应操作指南',
            steps: [
                { icon: 'play', text: '播放/暂停/重置按钮控制反应动画进度（progress 0→1）' },
                { icon: 'sliders-horizontal', text: '速度滑块调节动画快慢，便于观察断键-成键过程细节' },
                { icon: 'zap', text: '内置反应：甲烷燃烧 CH₄+2O₂→CO₂+2H₂O 等，展示原子重组' },
                { icon: 'bar-chart-2', text: '右侧能量条直观对比反应物 / 过渡态 / 生成物能量（含活化能 Eₐ）' },
                { icon: 'book-open', text: '化学反应本质：旧键断裂吸能 + 新键形成放能，二者代数和决定吸/放热（人教版必修2）' }
            ]
        },
        'solution-ionization': {
            title: '溶液与电离操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '6 种物质按钮：HCl / NaOH（强电解质）/ CH₃COOH / NH₃·H₂O（弱电解质）/ NaCl / NaHCO₃' },
                { icon: 'sliders-horizontal', text: '浓度滑块调节 c（mol/L），实时计算 pH 与电离度 α' },
                { icon: 'eye', text: '画布粒子可视化：强电解质完全电离（无原分子），弱电解质 ⇌ 平衡状态' },
                { icon: 'play', text: '速度 / 暂停按钮控制粒子动画；鼠标悬停显示离子标签' },
                { icon: 'book-open', text: '弱酸 Ka、弱碱 Kb 反映电离程度；HCO₃⁻ 为两性物种，水解强于电离使 NaHCO₃ 溶液呈弱碱性；pH+pOH=14 限定 25°C 水溶液' }
            ]
        },
        'trigonometry': {
            title: '三角函数操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部 3 个模式按钮：sin/cos 双线对照、tan 单线、全部叠加（含 sec/csc 等延伸）' },
                { icon: 'sliders-horizontal', text: '拖动 trig-angle 滑块（0°~360°）观察单位圆上的动点与右侧波形同步生成' },
                { icon: 'play', text: '点击「自动播放」按钮启用角度自动扫动，trig-speed 滑块控制每秒扫过角度' },
                { icon: 'corner-up-right', text: '快捷预设：30°/45°/60°/90°/180°/270° 一键定位特殊角，配合「特殊角」按钮显示精确值（如 sin30°=1/2）' },
                { icon: 'book-open', text: '掌握诱导公式与单位圆几何意义，理解 sinθ=y、cosθ=x、tanθ=y/x（高中数学相关内容）' }
            ]
        },
        'probability': {
            title: '概率统计操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '模式切换：🪙抛硬币（伯努利分布）/ 🎲掷骰子（古典概型 6 面均匀）' },
                { icon: 'play', text: 'prob-play-btn 启动连续随机试验，prob-reset-btn 清空重新开始' },
                { icon: 'plus-circle', text: '+1 按钮单次试验便于观察个例；+1000 按钮快速积累大样本对比理论概率' },
                { icon: 'sliders-horizontal', text: 'prob-speed 滑块调节动画速率，画布柱状图实时显示频率分布' },
                { icon: 'book-open', text: '理解大数定律：试验次数 n→∞ 时，频率 f → 理论概率 P；硬币 P=0.5、骰子各点 P=1/6（高中数学/选择性必修相关内容）' }
            ]
        },
        'vector-ops': {
            title: '向量运算操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '4 种运算按钮：A+B 平行四边形/三角形法则、A−B 反向相加、A·B 数量积、proj_B A 投影向量' },
                { icon: 'move', text: '直接在画布上拖拽 A、B 向量端点改变方向与模长，结果向量与公式实时更新' },
                { icon: 'bar-chart-2', text: 'vecops-result 区显示坐标分量、模 |V|、夹角 cosθ 等数值' },
                { icon: 'eye', text: '加减法看几何路径（首尾相连），数量积 A·B=|A||B|cosθ（标量），投影 = (A·B)/|B|' },
                { icon: 'book-open', text: '向量是高考解析几何与立体几何工具：垂直⇔A·B=0，共线⇔A=λB（高中数学相关内容）' }
            ]
        },
        'sequences': {
            title: '数列可视化操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部「等差数列 / 等比数列」两个 .seq-mode-btn 切换数列类型' },
                { icon: 'sliders-horizontal', text: '调节首项 a₁、公差 d（或公比 q）、项数 n 滑块，画布柱状图实时绘出 aₙ' },
                { icon: 'mouse-pointer-2', text: '鼠标悬停柱条高亮显示对应 (n, aₙ) 数值，便于读取具体项' },
                { icon: 'eye', text: '观察等差数列线性增长 vs 等比数列指数变化（|q|>1 时爆炸式增长）' },
                { icon: 'book-open', text: '等差通项 aₙ=a₁+(n−1)d，等比通项 aₙ=a₁·qⁿ⁻¹；前 n 项和 Sₙ 公式见教育面板（高中数学/选择性必修相关内容）' }
            ]
        },
        'inequality': {
            title: '不等式与线性规划操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '3 个约束滑块 ineq-c0/c1/c2 控制 ax+by≤c 中的常数项 c，可行域随之伸缩' },
                { icon: 'eye', text: '画布显示三条约束直线交叉围成的可行域（多边形），半平面阴影表示不等式方向' },
                { icon: 'sliders-horizontal', text: '勾选「显示目标函数」后，ineq-obj 滑块平移目标函数 z=ax+by 的等高线，找最大/最小值' },
                { icon: 'corner-up-right', text: '最优解通常出现在可行域的顶点（线性规划基本定理）' },
                { icon: 'book-open', text: '一元二次不等式：解集与抛物线开口/判别式有关；线性规划是高中数学/选择性必修相关应用题型' }
            ]
        },
        'conic-sections': {
            title: '圆锥曲线操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .conic-type-btn：椭圆 / 双曲线 / 抛物线，切换不同标准方程与几何性质' },
                { icon: 'sliders-horizontal', text: '滑块 conic-a / conic-b 控制椭圆/双曲线半轴；conic-p 控制抛物线焦准距' },
                { icon: 'eye', text: '画布动态描绘曲线轨迹，红色焦点、橙色准线、蓝色离心率几何意义同步可视化' },
                { icon: 'bar-chart-2', text: '右侧 conic-info 实时显示标准方程、离心率 e=c/a、焦点坐标、渐近线（双曲线）等' },
                { icon: 'book-open', text: '椭圆 0<e<1、双曲线 e>1、抛物线 e=1；统一定义：到焦点距离/到准线距离=e（高中数学/选择性必修相关内容）' }
            ]
        },
        'function-properties': {
            title: '函数性质探究操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部 3 个 .fp-mode-btn：📈单调性 / 🔄奇偶性 / 🔁周期性，切换分析角度' },
                { icon: 'mouse-pointer-click', text: '.fp-func-btn 切换不同函数（一次/二次/三次/绝对值/sin/exp/log 等）观察性质表现' },
                { icon: 'sliders-horizontal', text: '单调性模式下，调整 fp-int-a / fp-int-b 区间输入框（或拖拽画布上的菱形标记）框选研究区间' },
                { icon: 'eye', text: '画布以颜色高亮单调增/减区间、奇偶对称轴、周期 T；fp-info 给出严谨的数学判定' },
                { icon: 'book-open', text: '判定：单调性看 f(x₁)−f(x₂) 符号；奇函数 f(−x)=−f(x) 关于原点对称；偶函数 f(−x)=f(x) 关于 y 轴对称（高中数学相关内容）' }
            ]
        },
        'set-operations': {
            title: '集合运算操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '6 个 .setops-op-btn：A∪B（并）/ A∩B（交）/ A−B（差）/ B−A / Aᶜ（补）/ A∆B（对称差）' },
                { icon: 'edit-3', text: 'setops-input-a / setops-input-b 输入集合 A、B 元素（如 1,2,3）；setops-input-u 设置全集 U' },
                { icon: 'eye', text: '画布维恩图 (Venn) 高亮当前运算结果区域，深色填充表示属于结果集' },
                { icon: 'bar-chart-2', text: 'setops-result 区显示运算结果集合 + 元素个数；setops-edu 给出公式与运算律' },
                { icon: 'book-open', text: '德摩根律：(A∪B)ᶜ=Aᶜ∩Bᶜ、(A∩B)ᶜ=Aᶜ∪Bᶜ；分配律 A∩(B∪C)=(A∩B)∪(A∩C)（高中数学相关内容）' }
            ]
        },
        'permutation-combination': {
            title: '排列组合操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .permcomb-mode-btn：排列 P(n,r) 有序 / 组合 C(n,r) 无序 / 杨辉三角（C(n,k) 二项展开系数）' },
                { icon: 'sliders-horizontal', text: 'permcomb-n 滑块设置元素总数 n，permcomb-r 滑块设置抽取数 r（杨辉三角自动生成行）' },
                { icon: 'eye', text: '画布枚举或图示所有排列/组合方案，pc-info 同步显示公式 P(n,r)=n!/(n−r)!、C(n,r)=n!/(r!(n−r)!) 与具体值' },
                { icon: 'grid', text: '杨辉三角模式：每个数等于上方两数之和，第 n 行就是 (a+b)ⁿ 的展开系数 C(n,0)…C(n,n)' },
                { icon: 'book-open', text: '关键区分：排列考虑顺序（如班长副班长）、组合不考虑顺序（如选 r 人代表）；二项式定理是高中数学/选择性必修相关重点' }
            ]
        },
        'exp-log': {
            title: '指数与对数函数操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '#el-base 滑块（0.1~5）调整底数 a，#el-base-val 实时显示当前数值；4 个 .el-preset 一键切到 ½ / 2 / e / 10 等关键底数' },
                { icon: 'mouse-pointer-click', text: '3 个 .el-toggle 复选框分别开关 y=aˣ（指数）、y=logₐx（对数）、y=x（镜像参考线）' },
                { icon: 'eye', text: '画布同步绘制两条曲线，关于 y=x 严格对称即印证「指数与对数互为反函数」' },
                { icon: 'bar-chart-2', text: '滑动 a 越过 1：a>1 指数递增、对数递增；0<a<1 指数递减、对数递减；a=1 退化为常数函数（不构成函数）' },
                { icon: 'book-open', text: '关键性质：aˣ⋅aʸ=aˣ⁺ʸ；logₐ(MN)=logₐM+logₐN；换底公式 logₐb=lnb/lna（高中数学相关内容）' }
            ]
        },
        'binomial-theorem': {
            title: '二项式定理操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '#bt-n 滑块（0~12）调整指数 n，#bt-n-val 实时显示；5 个 .bt-preset 一键切到 2/3/5/8/12，杨辉三角随之逐行变化' },
                { icon: 'mouse-pointer-click', text: '点击三角形「内部」数字单元格：绿色箭头从上一行两个「肩」指向它，底部公式演示 C(n,k)=C(n−1,k−1)+C(n−1,k)' },
                { icon: 'play', text: '#bt-anim-btn「逐行生成」从顶端 1 开始逐行向下生长，直观感受帕斯卡递推如何构造整张三角' },
                { icon: 'eye', text: '取消「显示展开式各项」可隐藏 (a+b)ⁿ 通项；信息面板同步展示系数序列、系数和 2ⁿ、最大（中间）项系数' },
                { icon: 'book-open', text: '通项 T_{k+1}=C(n,k)·aⁿ⁻ᵏ·bᵏ；系数对称 C(n,k)=C(n,n−k)；ΣC(n,k)=2ⁿ、交错和为 0（高中数学/选择性必修相关内容）' }
            ]
        },
        'statistics-regression': {
            title: '统计与回归操作指南',
            steps: [
                { icon: 'layout-grid', text: '顶部 2 个 .sr-mode-btn 切换「线性回归」（散点+最小二乘）与「统计分布」（直方图+正态曲线）两种模式' },
                { icon: 'sliders-horizontal', text: '回归模式：调样本量 n、噪声强度、真实斜率；红线为最小二乘回归直线，橙色竖线为残差 eᵢ=yᵢ−ŷᵢ' },
                { icon: 'activity', text: '观察 r 与 R²：加大噪声→散点变散、|r| 下降、残差变长；回归直线始终过黄色中心点 (x̄, ȳ)' },
                { icon: 'bar-chart-3', text: '分布模式：调 σ 与分组数，蓝色直方图为频率/组距，红色为正态密度曲线；勾选 3σ 区间看分层阴影' },
                { icon: 'book-open', text: 'b̂=Σ(xᵢ−x̄)(yᵢ−ȳ)/Σ(xᵢ−x̄)²、â=ȳ−b̂x̄；3σ 原则 68.3%/95.4%/99.7%（高中数学/选择性必修统计相关内容）' }
            ]
        },
        'spatial-vector': {
            title: '空间向量操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '上方 6 个 .sv-slider 分别调节向量 a=(x,y,z) 与 b=(x,y,z) 的三个分量（范围 −5~5），画布实时重绘' },
                { icon: 'move-3d', text: '在画布上拖拽可旋转 3D 视角（偏航 yaw + 俯仰 pitch），从不同角度理解空间结构；勾选「自动旋转」可持续旋转' },
                { icon: 'check-square', text: '勾选「a+b」显示平行四边形法则；勾选「a×b」显示向量积（始终垂直于 a,b 所在平面，右手定则）' },
                { icon: 'activity', text: '勾选「投影」显示 a 在 b 上的投影向量；信息面板同步计算模长、数量积、夹角 θ、垂直判定' },
                { icon: 'book-open', text: 'a·b=|a||b|cosθ；a⊥b ⇔ a·b=0；|a×b| = 以 a,b 为邻边的平行四边形面积（高中数学/选择性必修相关内容）' }
            ]
        },
        'derivative-application': {
            title: '导数应用操作指南',
            steps: [
                { icon: 'function-square', text: '顶部 .da-fbtn 切换 4 个示例函数（三次/四次/正弦），观察不同函数的导数、单调性与极值' },
                { icon: 'move-horizontal', text: '拖动画布或调 #da-x0 滑块移动切点 x₀，红色切线随之变化，信息面板实时显示 f′(x₀) 斜率与切线方程' },
                { icon: 'palette', text: '勾选「单调性着色」：曲线绿色段表 f′>0 递增、红色段表 f′<0 递减，直观联系导数符号与升降' },
                { icon: 'circle-dot', text: '勾选「极值点」标记 f′=0 处：黄点为极大值、蓝点为极小值；勾选「导函数 f′(x)」叠加紫色虚线对照' },
                { icon: 'book-open', text: 'f′(x₀)=切线斜率；f′>0递增、f′<0递减；极值点处 f′=0 且左右变号（高中数学/选择性必修相关内容）' }
            ]
        },
        'geometry': {
            title: '几何变换操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '顶部 2 个 .geo-mode-btn 切换：「仿射变换」演示平移/缩放/旋转/错切，「三角形几何」演示外心/内心/重心/垂心' },
                { icon: 'sliders-horizontal', text: '仿射模式：调整 geo-tx/ty 平移、geo-sx/sy 缩放、geo-rot 旋转角、geo-shear 错切，画布同步显示原始与变换后图形' },
                { icon: 'play', text: '#geo-animate-btn 自动播放变换过程，可观察连续变化下的轨迹（旋转 + 缩放 = 螺线）' },
                { icon: 'eye', text: '三角形模式：拖拽顶点调整三角形，画布动态绘制四心，geo-edu 同步显示坐标与几何意义' },
                { icon: 'book-open', text: '仿射变换矩阵 [[a,b],[c,d]]+(tx,ty) 可表达 2D 所有线性变换；四心是初等几何核心定理（高中数学相关内容）' }
            ]
        },
        'complex-numbers': {
            title: '复数运算操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '4 个 .cx-mode-btn 切换模式：四则运算 ops / 单位根 roots / 函数变换 domain / 欧拉公式 euler' },
                { icon: 'edit-3', text: 'ops 模式：cx-z1-re/im、cx-z2-re/im 输入复数实/虚部；.cx-op-btn 选择 +、−、×、÷，画布显示复平面向量与平行四边形法则' },
                { icon: 'sliders-horizontal', text: 'roots：cx-root-n 滑块（n=2~12）设次数，画布动画演示 n 次单位根均匀分布在单位圆并构成正多边形；cx-roots-anim 一键播放' },
                { icon: 'play', text: 'euler 模式：cx-theta 滑块或 cx-euler-anim 演示 e^(iθ)=cosθ+isinθ；θ=π 时即著名公式 e^(iπ)+1=0' },
                { icon: 'book-open', text: '复数 z=a+bi 几何即向量；模 |z|=√(a²+b²)、辐角 arg(z)=arctan(b/a)；棣莫弗 (cosθ+isinθ)ⁿ=cos(nθ)+isin(nθ)（高中数学相关内容）' }
            ]
        },
        'solid-geometry': {
            title: '立体几何操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '5 个 .sg-shape-btn 切换几何体：正方体 / 正四面体 / 正八面体 / 圆柱体 / 圆锥体' },
                { icon: 'sliders-horizontal', text: '#sg-cross 滑块控制水平截面位置，#sg-cross-val 显示当前 z 坐标；可观察截面形状随高度的变化（圆柱→圆，圆锥→圆缩小到点）' },
                { icon: 'play', text: '#sg-speed 调旋转速度，#sg-pause 暂停/继续 3D 旋转动画；鼠标拖拽画布也可手动旋转视角' },
                { icon: 'eye', text: '画布以 3D 透视投影显示几何体，正面线段实线、背面虚线，截面平面以半透明色高亮' },
                { icon: 'book-open', text: '欧拉公式 V−E+F=2（凸多面体顶点−棱+面=2）；正多面体仅有 5 种（柏拉图体）；旋转体侧面积 S=2πrl（高中数学立体几何相关内容）' }
            ]
        },
        'circuit-analysis': {
            title: '电路分析操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .circuit-mode-btn：串联（电流处处相等）/ 并联（电压处处相等），切换不同等效电阻公式' },
                { icon: 'sliders-horizontal', text: '#circuit-voltage 滑块（1~24V）调电源电压，#circuit-r1 / #circuit-r2 调两个电阻；右侧 -val 实时显示数值' },
                { icon: 'play', text: '#circuit-pause 暂停电流粒子动画；#circuit-reset 复位时间。电流粒子流速正比于电流大小 I=U/R' },
                { icon: 'eye', text: '画布渲染电路图与电流方向，circuit-info 教育面板列出欧姆定律、分压/分流规则、功率分配 P=UI=I²R' },
                { icon: 'book-open', text: '串联：R=R₁+R₂、U=U₁+U₂、I 不变；并联：1/R=1/R₁+1/R₂、I=I₁+I₂、U 不变（人教版必修三第11章）' }
            ]
        },
        'waves': {
            title: '波动叠加操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .wave-mode-btn 切换：叠加 superposition / 驻波 standing / 多普勒 doppler' },
                { icon: 'sliders-horizontal', text: '叠加模式：wave-a1/f1/l1 调波 1 的振幅/频率/波长，wave-a2/f2/l2 调波 2；3 个复选框控制波 1、波 2、叠加波的显示' },
                { icon: 'play', text: '4 个 [data-wave-preset] 一键预设：加强（同相）/ 抵消（反相）/ 驻波（反向同频）/ 拍频（频率略差）' },
                { icon: 'eye', text: '画布同步绘制三条波形（红=波1、蓝=波2、紫=合成）；驻波模式额外显示波节/波腹与 wave-sw-n 谐波次数' },
                { icon: 'book-open', text: '波速 v=fλ；同相加强 A=A₁+A₂、反相抵消 A=|A₁−A₂|；驻波频率 fₙ=nv/(2L)；多普勒 f′=f·(v±v₀)/(v∓vₛ)（人教版选必一第3章）' }
            ]
        },
        'kinematics': {
            title: '匀变速直线运动操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '#kin-v0 滑块设初速度 v₀，#kin-a 设加速度（正/负代表加速/减速），#kin-t 设时间；右侧 -val 实时显示数值' },
                { icon: 'play', text: '#kin-play-btn 自动播放小球运动并联动 t 滑块；#kin-reset-btn 复位 t=0 重新开始' },
                { icon: 'eye', text: '画布顶端是运动轨迹（小球+残影），下方是 v-t 图像；图线斜率即 a，图线下面积即位移 s' },
                { icon: 'bar-chart-2', text: 'kin-info 实时计算 v(t)=v₀+at、s(t)=v₀t+½at²；kin-edu 给出加/减速判定与不含 t 的推导式 v²−v₀²=2as' },
                { icon: 'book-open', text: '设 a<0 演示刹车：v 减小到 0 即停止；常用刹车距离公式 s=v₀²/(2|a|)（人教版必修一第2章）' }
            ]
        },
        'projectile': {
            title: '抛体运动操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: 'proj-v0 调初速度大小，proj-angle 调发射角 θ（0~90°），proj-g 调重力加速度（地球9.8/月球1.6/木星等）' },
                { icon: 'play', text: '#proj-play-btn 自动播放抛物线轨迹；#proj-reset-btn 复位；拖动 #proj-t 滑块手动定格任意时刻' },
                { icon: 'mouse-pointer-click', text: '#proj-vectors 复选框显示瞬时速度向量分量 (vₓ, vᵧ)；#proj-envelope 显示不同 θ 的射程包络曲线' },
                { icon: 'eye', text: '画布同步显示轨迹+顶点高度+落点；proj-info 给出 x/y/v 实时数值，proj-edu 解释水平匀速 + 竖直自由落体的独立叠加' },
                { icon: 'book-open', text: '射程 R=v₀²sin(2θ)/g，θ=45° 时最远；最大高度 H=v₀²sin²θ/(2g)；飞行时间 T=2v₀sinθ/g（人教版必修二第5章）' }
            ]
        },
        'circular-motion': {
            title: '圆周运动操作指南',
            steps: [
                { icon: 'sliders-horizontal', text: '#circ-radius 调半径 r，#circ-omega 调角速度 ω，#circ-mass 调质量 m；circ-stats 实时联动显示 v/a/F/T' },
                { icon: 'play', text: '#circ-play 暂停/继续小球绕圆心匀速圆周运动；#circ-reset 复位到起点角度 0' },
                { icon: 'mouse-pointer-click', text: '3 个复选框 #circ-show-v / circ-show-a / circ-show-f：分别显示速度向量（蓝色切线）、向心加速度（绿色径向）、向心力（红色径向）' },
                { icon: 'eye', text: '画布固定圆周轨道 + 小球；速度始终沿切线方向，向心加速度始终指向圆心，二者垂直恒定不变（匀速圆周）' },
                { icon: 'book-open', text: '关键公式：v=ωr，a=ω²r=v²/r，F=ma=mω²r=mv²/r；周期 T=2π/ω；ω 与 r 独立可调（人教版必修二第6章）' }
            ]
        },
        'optics': {
            title: '光学操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '6 个 .optics-mode-btn 切换模式：透镜成像 lens / 双缝干涉 doubleslit / 折射与全反射 refraction / 棱镜色散 prism / 衍射光栅 grating / 偏振 polarization' },
                { icon: 'sliders-horizontal', text: '透镜模式：optics-focal 调焦距 f、optics-objdist 调物距 u；折射模式：optics-n1/n2 调两介质折射率；双缝模式：optics-slitsep 缝距、optics-wavelength 波长' },
                { icon: 'play', text: 'optics-pause/reset 控制动画；双缝模式额外有 optics-slit-toggle 单独控制干涉条纹动画播放/暂停' },
                { icon: 'eye', text: '画布按当前模式渲染：透镜画三条特殊光线 + 像；双缝画明暗条纹；折射画入射/折射/反射光线 + 临界角；棱镜分光 7 色' },
                { icon: 'book-open', text: '透镜公式 1/u + 1/v = 1/f；折射定律 n₁sinθ₁ = n₂sinθ₂；干涉条纹间距 Δy = λL/d；全反射临界角 sinC = n₂/n₁（人教版选必一第4章）' }
            ]
        },
        'electromagnetic-induction': {
            title: '电磁感应操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .emi-mode-btn 切换：手动 manual（鼠标/触屏拖拽磁铁）/ 自动 auto（磁铁匀速往复穿过线圈）' },
                { icon: 'hand', text: '手动模式：拖拽磁铁穿过线圈，速度越快感应电动势 ε 越大；emi-info 实时显示磁通量 Φ 与电动势 ε' },
                { icon: 'play', text: '#emi-pause 暂停/继续，#emi-reset 复位时间与磁铁位置（自动切回 manual）' },
                { icon: 'eye', text: '画布渲染线圈 + 磁铁 + 电流方向箭头 + 安培计读数；磁铁靠近线圈→Φ 增大、远离→Φ 减小，感应电流方向相反（楞次"来拒去留"）' },
                { icon: 'book-open', text: '法拉第 ε = −dΦ/dt；磁通量 Φ = BS·cosθ；导体切割 ε = BLv；楞次定律：感应电流的磁场总阻碍引起它的磁通量变化（人教版选必二第2章）' }
            ]
        },
        'alternating-current': {
            title: '交变电流操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .ac-mode-btn 切换：波形（u-t 正弦曲线）/ 相量图（旋转矢量）/ 变压器（原副线圈匝数比）' },
                { icon: 'sliders-horizontal', text: 'ac-freq 调频率 f（中国 50 Hz、美国 60 Hz）、ac-phase 调初相位 φ；变压器模式：ac-n1 / ac-n2 分别调原/副线圈匝数 N₁/N₂' },
                { icon: 'play', text: 'ac-speed 调动画速度；ac-pause 暂停/继续；ac-reset 复位时间与所有参数（频率回 50、相位回 30°）' },
                { icon: 'eye', text: '波形模式：u = U₀sin(2πft+φ) 滚动绘制；相量模式：旋转矢量 + 投影；变压器模式：原副线圈电压条形图实时联动 N₂/N₁' },
                { icon: 'book-open', text: '正弦交流 u=U₀sin(ωt)；有效值 U=U₀/√2（≈0.707U₀）；变压器电压比 U₁/U₂=N₁/N₂、电流比反比 I₁/I₂=N₂/N₁；功率守恒 U₁I₁=U₂I₂（人教版选必二第3章）' }
            ]
        },
        'force-composition': {
            title: '力的合成与分解操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .fc-mode-btn 切换：力的合成（平行四边形定则）/ 正交分解（Fx Fy）/ 斜面分析（重力沿/垂直斜面分解 + 摩擦）' },
                { icon: 'hand', text: '合成/分解模式：直接拖拽红蓝箭头端点改变力 F₁/F₂ 的大小和方向；fc-info 实时显示合力 R 和角度' },
                { icon: 'sliders-horizontal', text: '斜面模式专属：fc-inc-slider 调斜面角 α、fc-mass-slider 调质量 m、fc-mu-slider 调摩擦系数 μ；面板同步显示 mg/N/sin/cos 各分量' },
                { icon: 'eye', text: '画布同步绘制力的箭头 + 平行四边形/三角形（合成）、正交虚线投影（分解）、斜面 + 重力分解 + 摩擦力（斜面）' },
                { icon: 'book-open', text: '平行四边形定则：R = √(F₁²+F₂²+2F₁F₂cosθ)；正交分解 Fx=Fcosθ、Fy=Fsinθ；斜面分解 N=mgcosα、F∥=mgsinα、f=μN（人教版必修一第3章）' }
            ]
        },
        'momentum-conservation': {
            title: '动量守恒操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .mc-mode-btn 切换：弹性碰撞 elastic（动量+动能都守恒）/ 非弹性 inelastic（动量守恒、e 可调）/ 完全非弹性 perfectly（碰后粘在一起）' },
                { icon: 'sliders-horizontal', text: '4 个滑块：mc-m1 / mc-m2 调两物块质量，mc-v1 / mc-v2 调初速度（正负代表方向）；非弹性模式额外有 mc-e 恢复系数（0~1）' },
                { icon: 'play', text: '#mc-play-btn 开始模拟，#mc-reset-btn 重置；mc-info 实时显示碰前碰后动量 p 与动能 Eₖ' },
                { icon: 'eye', text: '画布同步绘制 A、B 两物块的运动 + 速度向量 + 碰撞瞬间高亮；mc-edu 给出动量与能量守恒计算与等质量"交换速度"等典型结论' },
                { icon: 'book-open', text: '动量守恒（外力为 0 或可忽略）：m₁v₁+m₂v₂=m₁v₁′+m₂v₂′；弹性碰撞额外 ½m₁v₁²+½m₂v₂²=½m₁v₁′²+½m₂v₂′²；完全非弹性 v′=(m₁v₁+m₂v₂)/(m₁+m₂)（人教版选必一第1章）' }
            ]
        },
        'gravitation': {
            title: '万有引力操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .grav-mode-btn 切换：轨道模拟（行星绕中心天体椭圆/圆轨道）/ 引力场（场线与等势面可视化）' },
                { icon: 'sliders-horizontal', text: '中心质量 M 滑块（100~1500）：M 越大引力越强、轨道周期越短、近距离弯曲越剧烈' },
                { icon: 'play', text: '"力向量"按钮切换是否显示行星受到的瞬时引力箭头；grav-pause 暂停/继续；grav-reset 复位轨道初值' },
                { icon: 'eye', text: '轨道模式：行星沿椭圆运动、近日点速度大、远日点速度小（开普勒第二定律面积速度恒定）；场模式：场线由质点中心向四周辐射' },
                { icon: 'book-open', text: 'F = GMm/r²（牛顿万有引力）；圆轨道 v=√(GM/r)、T=2π√(r³/GM)；开普勒三定律 T²/r³=4π²/GM；地表 g≈GM地/R地²≈9.8（人教版必修二第7章）' }
            ]
        },
        'electromagnetic': {
            title: '电磁场操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '5 个 .em-mode-btn 切换：电力线 / 等势线 / 电势图（热力图）/ 粒子轨迹 / 磁场（B 由电流产生）' },
                { icon: 'hand', text: '直接在画布上拖拽红/蓝点电荷（+/−）改变位置；4 个 .em-preset-btn 一键加载：偶极子 / 四极子 / 平行板 / 三角形' },
                { icon: 'sliders-horizontal', text: 'em-pause 暂停场动画、em-reset 复位电荷分布；em-toggle-probe 显示测量探针，em-toggle-lines / em-toggle-vectors 切换电力线与场矢量箭头' },
                { icon: 'eye', text: '电力线由 +Q 出发指向 −Q（不相交）；等势线垂直于电力线；磁场模式按右手定则给出环绕电流的磁感线' },
                { icon: 'book-open', text: '点电荷场强 E=kQ/r²、电势 φ=kQ/r、势能 W=qφ；安培环路 ∮B·dl=μ₀I；洛伦兹力 F=qv×B；右手定则 + 左手定则（人教版必修三 + 选必二）' }
            ]
        },
        'charged-particle': {
            title: '带电粒子运动操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .cp-mode-btn 切换：洛伦兹力偏转（圆周运动）/ 质谱仪（V 加速 + B 偏转分离同位素）/ 速度选择器（电场磁场正交相消）' },
                { icon: 'sliders-horizontal', text: '洛伦兹模式：q / m / v₀ / B 四滑块；质谱模式：accV（加速电压）+ B；选择器：E + B；cp-info 实时显示 r=mv/(qB) 与周期 T=2πm/(qB)' },
                { icon: 'play', text: 'cp-play 开始模拟、cp-reset 复位粒子初始位置；可在三种模式之间随时切换观察不同物理图景' },
                { icon: 'eye', text: '洛伦兹模式：单粒子做圆周运动；质谱模式：H⁺/D⁺/He⁺ 三种粒子分离成不同半径圆弧；选择器：当 v=E/B 时直线通过、其他偏转' },
                { icon: 'book-open', text: '洛伦兹力 F=qvB（v⊥B）→ 圆周 r=mv/(qB)、T=2πm/(qB)（与 v 无关！）；质谱仪 r=√(2mV/q)/B；速度选择器 v=E/B（人教版选必二第1章）' }
            ]
        },
        'relativity': {
            title: '相对论操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '7 个 .rel-mode-btn 切换：时间膨胀 / 长度收缩 / 质能等价 / 时空图 / 速度叠加 / 双生子 / 多普勒 / Lorentz 变换' },
                { icon: 'sliders-horizontal', text: 'rel-velocity 滑块调相对速度 β=v/c（0~0.99c）；γ=1/√(1−β²) 实时显示；某些模式额外有 u（叠加速度）和双生子距离滑块' },
                { icon: 'play', text: 'rel-pause 暂停/继续；rel-reset 复位时间 t、时空事件；时空图模式可在画布上双击添加事件、拖拽调整' },
                { icon: 'eye', text: '时间膨胀：动钟变慢 Δt=γΔτ；长度收缩：L=L₀/γ；时空图：世界线 + 光锥 + Lorentz 变换坐标系；多普勒：红/蓝移频率比' },
                { icon: 'book-open', text: 'γ=1/√(1−v²/c²)；时间膨胀 Δt=γΔτ；长度收缩 L=L₀/γ；质能 E=mc²、E²=(pc)²+(mc²)²；速度叠加 w=(u+v)/(1+uv/c²)（人教版选必三第5章）' }
            ]
        },
        'energy-conservation': {
            title: '机械能守恒操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '机械能守恒过山车演示：小球沿轨道做曲线运动，势能 Eₚ=mgh 与动能 Eₖ=½mv² 不断转化' },
                { icon: 'sliders-horizontal', text: 'energy-friction 滑块调摩擦系数：0 时为无摩擦理想情况（机械能严格守恒）；> 0 时摩擦做负功，总机械能逐渐减少' },
                { icon: 'play', text: 'energy-play 开始/暂停小球运动；energy-reset 复位小球到起始最高点（重新积累势能）' },
                { icon: 'eye', text: '画布同步绘制：过山车轨道 + 小球 + 实时能量条形图（红=Eₖ 动能、蓝=Eₚ 势能、绿=总能 E）；energy-info 显示数值' },
                { icon: 'book-open', text: '机械能守恒条件：只有重力做功（无摩擦/无外力做功）；½mv²+mgh=const；摩擦时 Wf=ΔE机械（消耗的机械能转化为内能）（人教版必修二第8章）' }
            ]
        },
        'fluid-dynamics': {
            title: '流体力学操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '3 个 .fluid-mode-btn 切换：势流叠加（自定义点源/汇/涡）/ 圆柱绕流（Magnus 升力效应）/ 伯努利管（变截面流速压强变化）' },
                { icon: 'sliders-horizontal', text: '不同模式滑块：fluid-uniform-u 来流速度；fluid-cyl-gamma 圆柱环量 Γ；fluid-bern-constrict 管道收缩比；4 个 .fluid-preset-btn 一键载入 Rankine/偶极子/双源/涡对' },
                { icon: 'play', text: 'fluid-pause 暂停/继续流场动画；fluid-reset 复位粒子；fluid-bern-toggle 切换是否显示压强场色彩' },
                { icon: 'eye', text: '画布绘制：流线 + 等势线 + 示踪粒子；圆柱绕流模式可观察 Γ ≠ 0 时上下流速不对称、产生升力 L=ρUΓ' },
                { icon: 'book-open', text: '连续性方程 A₁v₁=A₂v₂（不可压）；伯努利方程 p+½ρv²+ρgh=const（流速大处压强小）；Magnus 升力 L=ρUΓ（球类弧线球原理）（人教版选必三第3章）' }
            ]
        },
        'sorting-compare': {
            title: '排序对比操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '5 种排序算法 5 个画布并排同步演示：冒泡 Bubble / 选择 Selection / 插入 Insertion / 快排 Quick / 归并 Merge' },
                { icon: 'sliders-horizontal', text: 'sortcmp-size 调数组规模 N（默认 30）；sortcmp-speed 调动画速度（步/秒）；可直观对比 O(n²) 与 O(n log n) 的差距' },
                { icon: 'play', text: 'sortcmp-start 同时开始所有算法、随时暂停继续；sortcmp-gen 重新生成随机数据再次对比' },
                { icon: 'eye', text: '每个画布显示该算法的当前比较元素（红色高亮）、已排序部分（绿色）、未排序部分（蓝色），底部实时显示比较次数与交换次数' },
                { icon: 'book-open', text: '冒泡/选择/插入：O(n²)；快排平均 O(n log n) 最坏 O(n²)；归并 O(n log n) 稳定但需 O(n) 额外空间；插入排序在小规模或基本有序数据上很快（高中信息技术算法基础）' }
            ]
        },
        'search-algorithms': {
            title: '搜索算法操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '页面有 3 个独立模块：① 数组搜索（4 个 .sc-mode-btn 线性 O(n)/二分 O(log n)/插值 O(log log n)/跳跃 O(√n)）；② 二叉搜索树（.tree-presets 选预设）；③ 哈希表搜索 hash-canvas' },
                { icon: 'sliders-horizontal', text: 'bs-target 输入查找目标（默认 1~100 整数）；bs-speed / tree-speed / hash-speed 分别调三个模块的动画速度' },
                { icon: 'play', text: '点 .sc-mode-btn 切换算法立即开始动画；树模块点节点观察查找路径；哈希模块演示插入冲突与开放寻址/链地址法' },
                { icon: 'eye', text: '数组：当前指针 + low/high/mid 高亮；树：从根递归向左/右子树高亮路径；哈希：哈希函数 h(k)=k%m 计算位置 + 冲突时探测' },
                { icon: 'book-open', text: '线性 O(n)（无序也行）；二分 O(log n)（必须有序）；插值适用于均匀分布；跳跃 O(√n) 介于两者；BST 平均 O(log n) 最坏 O(n)；哈希平均 O(1)（高中信息技术）' }
            ]
        },
        'dynamic-programming': {
            title: '动态规划操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '经典 0/1 背包问题动画演示：物品列表 + 容量 W → 二维 DP 表格 dp[i][j] = 前 i 个物品装入容量 j 的最大价值' },
                { icon: 'sliders-horizontal', text: 'dp-speed 调动画速度（0.5~5 步/秒），便于慢速观察每一格的状态转移' },
                { icon: 'play', text: 'dp-play 自动逐格填表；dp-step 手动单步填一格观察状态转移；dp-reset 复位整张 DP 表' },
                { icon: 'eye', text: '画布展示 DP 表格滚动填充过程：当前正在计算的 dp[i][j] 高亮 + 状态转移箭头来源（dp[i-1][j] 不取 / dp[i-1][j-w]+v 取）+ 最终回溯选中的物品' },
                { icon: 'book-open', text: '0/1 背包状态转移：dp[i][j]=max(dp[i-1][j], dp[i-1][j-w[i]]+v[i])（若 j≥w[i]）；时间 O(nW)、空间 O(nW)（可压一维 O(W)）（高中信息技术算法进阶）' }
            ]
        },
        'string-matching': {
            title: '字符串匹配操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .strmatch-algo-btn 切换：KMP（利用 next 数组跳过已比较前缀）/ 暴力匹配 Brute Force（每次失败回退一格）' },
                { icon: 'sliders-horizontal', text: '可在输入框修改主串 text 与模式串 pattern；strmatch-speed 调动画速度' },
                { icon: 'play', text: 'strmatch-play 自动播放、strmatch-step 单步执行、strmatch-reset 复位指针；KMP 模式额外显示 next/fail 数组的构建过程' },
                { icon: 'eye', text: '画布：主串字符 + 模式串字符 + 当前对齐位置 + 匹配/失配高亮（绿/红）；strmatch-info 显示比较次数与匹配成功位置' },
                { icon: 'book-open', text: '暴力 O(nm)；KMP O(n+m) — 通过 next 数组（最长前后缀）跳过已知不匹配位置；适用于大文本搜索（编辑器查找、DNA 序列、网络包检测）（高中信息技术）' }
            ]
        },
        'data-structures': {
            title: '数据结构操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '5 个 .ds-mode-btn 切换：栈 Stack / 队列 Queue / 二叉搜索树 BST / 链表 LinkedList / 堆 Heap（后两者由 JS 动态注入）' },
                { icon: 'sliders-horizontal', text: 'ds-speed 调动画速度；BST 面板可输入数值（1~99）插入/搜索/加载预设/清空' },
                { icon: 'play', text: 'Stack：ds-push 压栈 / ds-pop 弹栈；Queue：ds-enqueue 入队 / ds-dequeue 出队；BST：ds-bst-insert + ds-bst-search + 三种遍历（前序 / 中序 / 后序）按钮' },
                { icon: 'eye', text: '画布显示当前结构：栈竖直堆叠（top 标记）、队列水平排列（front/rear 标记）、BST 二叉树形结构（节点+左右子树连线），操作时高亮当前节点' },
                { icon: 'book-open', text: '栈 LIFO 后进先出（函数调用、撤销）；队列 FIFO 先进先出（任务调度、BFS）；BST 平均查找/插入/删除 O(log n) 最坏 O(n)；中序遍历 BST 得有序序列（高中信息技术）' }
            ]
        },
        'recursion-vis': {
            title: '递归可视化操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .recur-mode-btn 切换：Fibonacci 树（递归调用树展开）/ 汉诺塔（3 柱搬盘动画）' },
                { icon: 'sliders-horizontal', text: 'recur-fib-n 调 Fibonacci 的 n 值（推荐 ≤8 否则节点爆炸）；recur-hanoi-n 调汉诺塔盘子数（3~7）；recur-speed 调动画速度' },
                { icon: 'play', text: 'recur-play 自动播放、recur-step 单步执行（观察每个递归调用）、recur-reset 复位整棵调用树' },
                { icon: 'eye', text: 'Fibonacci 模式：当前展开的递归调用节点高亮 + 已计算返回值（绿色）+ 子树连线展示 fib(n)=fib(n-1)+fib(n-2)；汉诺塔：3 根柱子盘子移动 + 当前移动的盘子高亮 + 步数计数' },
                { icon: 'book-open', text: '递归三要素：基线条件 + 递归调用 + 子问题缩小；Fibonacci 朴素递归 O(2ⁿ)（重叠子问题需用 DP/记忆化优化）；汉诺塔最少步数 2ⁿ−1（高中信息技术算法基础）' }
            ]
        },
        'graph-algo': {
            title: '图算法操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '4 种算法按钮：Dijkstra 最短路径 / Prim 最小生成树（HTML 中已有）+ BFS 广度优先 / DFS 深度优先（JS 动态注入 ga-bfs/ga-dfs）；3 个 ga-presets 预设：加权图 / 简单图 / 稠密图' },
                { icon: 'sliders-horizontal', text: 'ga-speed 200~1200 ms 调步速；ga-directed-toggle 切换有向/无向图；点击节点更换起点' },
                { icon: 'play', text: '点算法按钮立即开始动画；ga-pause 暂停继续；ga-step 单步执行（详细观察每步入队/松弛操作）；ga-reset 复位重置图结构' },
                { icon: 'eye', text: '画布：节点+加权边；运行时高亮当前节点（红）+ 已确认节点（绿）+ MST/路径边（蓝粗）+ 候选边（橙虚线）+ 起点（金色）；ga-info 显示当前距离表/优先队列状态' },
                { icon: 'book-open', text: 'BFS 用队列 O(V+E) 解最短跳数；DFS 用栈/递归 O(V+E) 解连通性；Dijkstra 用优先队列 O((V+E)log V) 解非负权最短路；Prim 类似 Dijkstra 解最小生成树（高中信息技术算法进阶）' }
            ]
        },
        'sorting': {
            title: '排序算法操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '本演示聚焦"桶排序 Bucket Sort"算法 — 一种典型的非比较排序，把元素按值分到若干桶中再合并，时间 O(n+k)' },
                { icon: 'sliders-horizontal', text: 'sort-speed 滑块（100~1000 ms）调动画间隔，便于慢速观察每个元素入桶过程' },
                { icon: 'play', text: '"生成随机数组"按钮重新生成数据；"开始排序"按钮启动桶排序动画；"重置"按钮清空桶' },
                { icon: 'eye', text: '画布从上到下显示三层：原始数组（柱状图）→ 多个桶（每桶聚集相近值的元素）→ 排序结果（按桶顺序输出，自然有序）；sort-info 实时更新当前操作' },
                { icon: 'book-open', text: '桶排序是非比较排序，突破比较排序 Ω(n log n) 下界；时间 O(n+k)（n=元素数, k=桶数），适合数据均匀分布；不适合范围太大的整数（桶过多浪费空间）。计数排序、基数排序也属此类（高中信息技术）' }
            ]
        },
        'immune-system': {
            title: '免疫系统操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .immune-mode-btn 切换：非特异性免疫（皮肤+黏膜+吞噬细胞，先天就有）/ 特异性免疫（B 细胞产抗体+T 细胞攻击，需后天激活）' },
                { icon: 'sliders-horizontal', text: 'immune-speed 调动画速度（含 immune-speed-val 实时数值显示）' },
                { icon: 'play', text: 'immune-pause 暂停/继续观察；immune-reset 复位整个动画，重新开始病原体入侵流程' },
                { icon: 'eye', text: '画布：病原体（红色三角，入侵）+ 吞噬细胞（蓝色，巡逻吞噬）+ B 细胞（绿色，产抗体）+ T 细胞（黄色，攻击感染细胞）+ 抗体粒子（小白点中和病原）；immune-info 显示当前免疫阶段与活细胞数量' },
                { icon: 'book-open', text: '人教版必修 3 第 2 章：3 道防线（皮肤黏膜→体液中杀菌→特异性免疫）；体液免疫（B 细胞→效应 B→分泌抗体）+ 细胞免疫（T 细胞→效应 T→裂解感染细胞）；记忆细胞使二次免疫快速强烈（疫苗原理）' }
            ]
        },
        'ecosystem': {
            title: '生态系统操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '2 个 .eco-mode-btn 切换（JS 动态注入）：食物链与能量流（草→兔→狐三级营养级 + 能量金字塔）/ 种群动态模型（捕食者-猎物 Lotka-Volterra 振荡曲线）' },
                { icon: 'sliders-horizontal', text: 'eco 控件区动态生成的速度滑块；可在不同模式间切换观察不同生态过程' },
                { icon: 'play', text: '暂停/继续按钮控制动画；切换模式时自动重置；ecosystem-info 实时显示当前种群数量与能量传递效率' },
                { icon: 'eye', text: '食物链模式：3 层金字塔 + 能量传递箭头（递减约 10~20%）；种群模式：捕食者与猎物数量随时间振荡的相位曲线（猎物先增→捕食者增→猎物降→捕食者降）' },
                { icon: 'book-open', text: '人教版必修 3 第 5 章：能量沿食物链单向流动+逐级递减（10~20% 传递效率，不可循环）；物质循环（碳/氮/水）；种群密度调节通过出生率-死亡率-迁入迁出，K 值=环境容纳量（Logistic 增长）' }
            ]
        },
        'neural-regulation': {
            title: '神经调节操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '.neural-mode-btn[data-mode] 切换两种视图：突触传递（前膜释放神经递质 → 后膜受体结合）/ 动作电位（-70mV 静息电位 → +40mV 去极化 → 复极化曲线）' },
                { icon: 'zap', text: '#neural-fire 触发一次神经冲动（动作电位模式下产生一个"火花"沿轴突传导）；#neural-pause 暂停/继续；#neural-speed 滑块（同步显示在 #neural-speed-val）调节传导速度' },
                { icon: 'eye', text: '突触传递模式：可见突触小泡胞吐释放 ACh、Ca²⁺ 内流触发胞吐、递质扩散到后膜与受体结合开离子通道；动作电位模式：膜电位曲线随时间扫描显示去极化/复极化/超极化三相' },
                { icon: 'info', text: '#neural-info 面板分块显示突触小泡、Ca²⁺ 内流、受体结合、信号终止等关键过程，并标注 Na⁺/K⁺ 通道在去极化与复极化中的作用' },
                { icon: 'book-open', text: '人教版选必 1 第 2 章：静息电位由 K⁺ 外流形成（内负外正 -70mV）；动作电位由 Na⁺ 内流引起（峰值 +40mV）；突触传递单向（前膜→间隙→后膜），递质必须被酶降解（如 AChE）或回收终止信号' }
            ]
        },
        'cellular-respiration': {
            title: '细胞呼吸操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '#cell-resp-controls 内的 .cellresp-btn 切换三阶段：糖酵解（细胞质基质，1 葡萄糖 → 2 丙酮酸 + 2ATP + 2NADH，无需 O₂）/ 柠檬酸循环（线粒体基质，2 丙酮酸 → 6CO₂ + 2ATP + 8NADH + 2FADH₂）/ 电子传递链（线粒体内膜，NADH/FADH₂ + O₂ → 约34ATP + H₂O，高中教材近似）' },
                { icon: 'eye', text: '#cell-resp-canvas 上动态绘制对应细胞器场所（细胞质基质 / 线粒体基质 / 内膜嵴），底物分子流动 → 能量载体（NADH/ATP）生成的全过程' },
                { icon: 'info', text: '#cellresp-stage-display 显示当前阶段名称，#cellresp-stage-loc 显示反应场所，#cellresp-atp-info 显示高中教材常用近似与现代真核细胞常见产量差异' },
                { icon: 'gauge', text: '同步对比：糖酵解 = 2 ATP（厌氧也行）、柠檬酸 = 2 ATP、电子传递链约 34 ATP 是高中教材近似；现代真核常见约 30-32 ATP' },
                { icon: 'book-open', text: '人教版必修 1 第 5 章常用约 38 ATP 估算；现代产量受 NADH 穿梭系统、膜泄漏和细胞条件影响。无氧呼吸（发酵）只有糖酵解阶段，仅释放 2 ATP' }
            ]
        },
        'substance-transport': {
            title: '物质运输操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '#substance-transport-controls 内的 .strans-btn 切换四种跨膜运输方式：自由扩散（O₂/CO₂ 顺浓度，无载体无 ATP）/ 协助扩散（葡萄糖入红细胞，需载体不耗能）/ 主动运输（Na⁺-K⁺ 泵逆浓度，需载体+ATP）/ 胞吞胞吐（大分子囊泡进出）' },
                { icon: 'eye', text: '#substance-transport-canvas 动态展示磷脂双分子层、嵌入的载体蛋白构象变化、ATP 水解释能（主动运输模式下可见 ATP→ADP+Pi）、囊泡形成与融合' },
                { icon: 'info', text: '#strans-mode-display 实时显示当前方式名称，#strans-mode-desc 显示其特征（顺/逆浓度、是否需载体、是否耗能）' },
                { icon: 'gauge', text: '一表对比：自由扩散+协助扩散+渗透 = 被动过程（顺浓度/水势梯度，不耗能）；水跨膜可少量直接扩散，快速运输常经水通道蛋白' },
                { icon: 'book-open', text: '人教版必修 1 第 4 章：细胞膜的流动镶嵌模型（磷脂双分子层 + 蛋白质 + 多糖），运输方式由分子大小、极性、浓度梯度共同决定；胞吞胞吐体现膜的流动性，是大分子（如蛋白质、多糖）进出细胞的唯一方式' }
            ]
        },
        'meiosis': {
            title: '减数分裂操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '#meiosis-controls 内 3 个 .meio-btn：◀ 上一步 / ▶ 播放(切换暂停) / 下一步 ▶；按顺序遍历 8 个时期（前期 I → 中期 I → 后期 I → 末期 I → 前期 II → 中期 II → 后期 II → 末期 II）' },
                { icon: 'sliders-horizontal', text: '速度滑块 .meio-speed（0.2~3 倍速）控制 autoPlay 时的相变速度；当前阶段名/描述同步显示在 #meio-phase-name 和 #meio-phase-desc' },
                { icon: 'eye', text: '#meiosis-canvas 上分别绘制 8 个阶段的染色体形态：前期 I 同源染色体联会形成四分体并发生交叉互换 → 中期 I 同源染色体对排列于赤道板两侧 → 后期 I 同源分离 → ... → 末期 II 形成 4 个单倍体配子' },
                { icon: 'info', text: '#meio-info 面板显示染色体数变化：开始 2n，减 I 后 n（同源分离），减 II 后仍 n（着丝粒断裂，姐妹分开）；DNA 复制 1 次、细胞分裂 2 次 → 4 个 n 细胞' },
                { icon: 'book-open', text: '人教版必修 2 第 2 章：减数分裂是有性生殖细胞形成的特殊分裂；减 I 同源分离 + 减 II 着丝粒分离；交叉互换（前期 I）和自由组合（后期 I）是基因重组的两大来源，与基因突变共同构成可遗传变异' }
            ]
        },
        'gene-expression': {
            title: '基因表达操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '#gene-expression-controls 内 2 个 .btn 切换两阶段：转录 (DNA→mRNA) / 翻译 (mRNA→蛋白质)；当前模式显示在 #genexp-mode-display' },
                { icon: 'eye', text: '#gene-expression-canvas 转录模式：DNA 双链解开 → RNA 聚合酶沿模板链 3\u2032→5\u2032 移动 → 互补合成 mRNA（A-U/T-A/G-C/C-G）；翻译模式：核糖体大小亚基扣合在 mRNA 起始密码子（AUG）→ tRNA 携带氨基酸按密码子依次进入 A/P/E 位 → 肽键延伸→ 终止密码子（UAA/UAG/UGA）释放' },
                { icon: 'info', text: '#genexp-info 面板分块解释中心法则、5\u2032 端 3\u2032 端方向性、密码子兼并性（64 个密码子→ 20 种氨基酸+终止）；起始密码子 AUG 同时编码 Met（蛋氨酸）' },
                { icon: 'gauge', text: '场所对比：转录在细胞核内（真核生物，原核在细胞质）；翻译在核糖体（游离核糖体合成胞内蛋白，附着在内质网上的合成分泌蛋白）' },
                { icon: 'book-open', text: '人教版必修 2 第 4 章：中心法则 DNA→mRNA→蛋白质（转录+翻译），逆向有逆转录（HIV）和 RNA 复制（病毒）；密码子表是通用的，体现生物界的统一性；基因 = 有遗传效应的 DNA 片段，编码 1 条多肽链' }
            ]
        },
        'gene-mutation': {
            title: '基因突变操作指南',
            steps: [
                { icon: 'mouse-pointer-click', text: '#gene-mutation-controls 内 3 个 .gmut-btn[data-mode] 切换：碱基替换（第 5 位 A→G，错义点突变）/ 插入突变（第 5 位后插 C，移码突变）/ 缺失突变（删第 5 位 A，移码突变）' },
                { icon: 'zap', text: '#gmut-trigger 触发突变动画；#gmut-pause 暂停/继续；#gmut-reset 重置回原序列；#gmut-speed 滑块调速' },
                { icon: 'eye', text: '#gene-mutation-canvas 同时显示 3 行：原 DNA + 转录产生的 mRNA + 翻译出的氨基酸序列（密码子 3 个一组）；点突变后只有该位密码子改变 1 个氨基酸；移码突变后从突变位起所有密码子重排' },
                { icon: 'info', text: '#gmut-info 显示当前突变类型 + 颜色编码（替换=橙、插入=红、缺失=紫），并标注是否改变阅读框（reading frame）' },
                { icon: 'book-open', text: '人教版必修 2 第 5 章：基因突变（DNA 碱基增/缺/替换）+ 基因重组（同源染色体交叉互换 + 非同源染色体自由组合）+ 染色体变异（数目/结构）三类可遗传变异；移码突变常导致蛋白质完全失活，影响远大于点突变' }
            ]
        }
    },

    // ── Public API ──

    init() {
        this._createOverlay();
        this._createHelpButton();
    },

    // Called after experiment init — show guide if first time
    showIfFirstTime(page, moduleId) {
        const seen = this._getSeenSet();
        const key = `${page}:${moduleId}`;
        if (seen.has(key)) return;

        this._currentModule = { page, moduleId };
        this._show(page, moduleId);
        seen.add(key);
        this._saveSeenSet(seen);
    },

    // Force show (from "?" button)
    showForCurrent() {
        const current = this._currentModule || this._inferCurrentModule();
        if (!current) return;
        this._currentModule = current;
        this._show(current.page, current.moduleId);
    },

    // Show help button when an experiment is open
    showHelpButton(page, moduleId) {
        this._currentModule = { page, moduleId };
        if (this._helpBtn) this._helpBtn.style.display = 'flex';
    },

    // Hide help button when returning to gallery
    hideHelpButton() {
        this._currentModule = null;
        if (this._helpBtn) this._helpBtn.style.display = 'none';
        // v4.2.3：同时关闭可能仍处于显示状态的引导浮层，避免随页面切换残留
        this._dismiss();
    },

    // ── Internal ──

    _show(page, moduleId) {
        this._overlay = document.querySelector('#experiment-guide-overlay') || this._overlay;
        const guideId = this._resolveModuleId(moduleId);
        const guide = this._experimentGuides[guideId] || this._subjectGuides[page];
        if (!guide || !this._overlay) return;

        const card = this._overlay.querySelector('.guide-card');
        card.innerHTML = this._renderCard(guide);
        this._overlay.classList.add('active');
        this._attachEscapeOwner();

        // Render lucide icons in the guide card
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [card] });

        // Focus dismiss button for keyboard accessibility
        const btn = card.querySelector('.guide-dismiss-btn');
        if (this._focusTimer) clearTimeout(this._focusTimer);
        this._focusTimer = btn ? setTimeout(() => {
            this._focusTimer = null;
            if (this._overlay?.classList.contains('active') && btn.isConnected) btn.focus();
        }, 100) : null;
    },

    _dismiss(options = {}) {
        if (this._focusTimer) clearTimeout(this._focusTimer);
        this._focusTimer = null;
        const wasActive = !!(this._overlay && this._overlay.classList.contains('active'));
        if (this._overlay) this._overlay.classList.remove('active');
        this._detachEscapeOwner();
        if (!wasActive || options.restoreFocus !== true) return;
        const current = this._currentModule;
        setTimeout(() => {
            if (!current) return;
            const section = document.querySelector(
                `#page-${current.page} [data-module="${current.moduleId}"].module-active`
            );
            if (!section) return;
            const focusable = section.querySelector(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusable) focusable.focus();
        }, 0);
    },

    _attachEscapeOwner() {
        if (
            this._escapeOwnerAttached
            || typeof document === 'undefined'
            || typeof document.addEventListener !== 'function'
        ) return;
        if (!this._escapeOwnerHandler) {
            this._escapeOwnerHandler = (event) => {
                if (
                    !event
                    || event.key !== 'Escape'
                    || !this._overlay
                    || !this._overlay.classList.contains('active')
                ) return;
                const zoomModal = document.querySelector(
                    '.physics-zoom-modal.open, .biology-zoom-modal.open'
                );
                if (zoomModal) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                this._dismiss({ restoreFocus: true });
            };
        }
        document.addEventListener('keydown', this._escapeOwnerHandler, true);
        this._escapeOwnerAttached = true;
    },

    _detachEscapeOwner() {
        if (
            !this._escapeOwnerAttached
            || !this._escapeOwnerHandler
            || typeof document === 'undefined'
            || typeof document.removeEventListener !== 'function'
        ) return;
        document.removeEventListener('keydown', this._escapeOwnerHandler, true);
        this._escapeOwnerAttached = false;
    },

    _inferCurrentModule() {
        const activeModule = document.querySelector('[data-module].module-active');
        const moduleId = activeModule ? activeModule.getAttribute('data-module') : '';
        if (!moduleId) return null;

        const hash = window.location.hash.replace(/^#/, '');
        let page = hash.includes('/') ? hash.split('/')[0] : '';
        if (!page) {
            const activePage = document.querySelector('.page-section.active[id^="page-"]');
            page = activePage ? activePage.id.replace(/^page-/, '') : '';
        }

        return page ? { page, moduleId } : null;
    },

    _renderCard(guide) {
        const stepsHTML = guide.steps.map((step, i) => `
            <div class="guide-step">
                <div class="guide-step__number">${i + 1}</div>
                <div class="guide-step__icon"><i data-lucide="${step.icon}"></i></div>
                <div class="guide-step__text">${this._escapeHtml(this._publicGuideText(step.text))}</div>
            </div>
        `).join('');

        return `
            <div class="guide-card__header">
                <div class="guide-card__title">${this._escapeHtml(guide.title)}</div>
                <div class="guide-card__subtitle">首次进入实验时显示，可通过右下角 ? 按钮重新查看</div>
            </div>
            <div class="guide-card__steps">${stepsHTML}</div>
            <button class="btn btn--primary guide-dismiss-btn" tabindex="0">知道了，开始探索</button>
        `;
    },

    _publicGuideText(text) {
        const labels = {
            button: '对应按钮',
            switch: '显示开关',
            slider: '参数滑块',
            speed: '速度滑块',
            panel: '信息面板',
            canvas: '画布',
            input: '输入框',
            preset: '预设按钮'
        };
        const controlPrefixes = [
            'trig', 'prob', 'ineq', 'conic', 'fp', 'setops', 'permcomb', 'pc',
            'el', 'bt', 'sr', 'sv', 'da', 'geo', 'cx', 'sg', 'circuit',
            'wave', 'kin', 'proj', 'circ', 'optics', 'emi', 'ac', 'fc', 'mc',
            'grav', 'em', 'cp', 'rel', 'energy', 'fluid', 'sortcmp', 'bs',
            'tree', 'hash', 'sc', 'dp', 'strmatch', 'ds', 'recur', 'ga',
            'sort', 'immune', 'eco', 'neural', 'cellresp', 'cell-resp',
            'substance-transport', 'strans', 'meio', 'meiosis', 'genexp',
            'gene-expression', 'gene-mutation', 'gmut'
        ].join('|');

        const labelFor = (token) => {
            const value = String(token || '').toLowerCase();
            if (value.includes('canvas')) return labels.canvas;
            if (/(info|result|stats|edu|display|desc|loc|phase-name|phase-desc)/.test(value)) return labels.panel;
            if (value.includes('speed')) return labels.speed;
            if (/(input|target)/.test(value)) return labels.input;
            if (/(preset|gen\b)/.test(value)) return labels.preset;
            if (/(show|toggle|vectors|envelope|probe|lines|checkbox)/.test(value)) return labels.switch;
            if (/(play|pause|reset|step|start|trigger|anim|animate|btn|button|mode|fbtn|op)/.test(value)) return labels.button;
            return labels.slider;
        };

        return String(text ?? '')
            .replace(/[（(]?\s*(?:HTML\s*中已有|JS\s*动态注入)\s*[）)]?/g, '')
            .replace(/\[data-[^\]]+\]/gi, labels.preset)
            .replace(/#[A-Za-z][A-Za-z0-9_-]*/g, (token) => labelFor(token))
            .replace(/\.[A-Za-z][A-Za-z0-9_-]*(?:\[[^\]]+\])?/g, (token) => labelFor(token))
            .replace(new RegExp(`\\b(?:${controlPrefixes})(?:-[A-Za-z0-9]+)+\\b`, 'g'), (token) => labelFor(token))
            .replace(/\bautoPlay\b/g, '自动播放')
            .replace(/\s{2,}/g, ' ')
            .replace(/（\s*）/g, '')
            .replace(/\/\s*\//g, '/')
            .replace(/；\s*；/g, '；')
            .replace(/：\s*；/g, '：')
            .trim();
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _createOverlay() {
        const existing = document.getElementById('experiment-guide-overlay');
        if (existing) {
            this._overlay = existing;
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'experiment-guide-overlay';
        overlay.id = 'experiment-guide-overlay';
        overlay.innerHTML = '<div class="guide-card"></div>';

        // Click outside card to dismiss
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this._dismiss({ restoreFocus: true });
        });

        // Click dismiss button
        overlay.addEventListener('click', (e) => {
            if (e.target.closest('.guide-dismiss-btn')) this._dismiss({ restoreFocus: true });
        });

        document.body.appendChild(overlay);
        this._overlay = overlay;
    },

    _createHelpButton() {
        const existing = document.getElementById('experiment-guide-help');
        if (existing) {
            this._helpBtn = existing;
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'experiment-guide-help-btn';
        btn.id = 'experiment-guide-help';
        btn.setAttribute('aria-label', '查看操作提示');
        btn.setAttribute('data-tip', '操作提示');
        btn.textContent = '?';
        btn.style.display = 'none';

        const guide = this;
        btn.addEventListener('click', () => guide.showForCurrent());
        btn.addEventListener('click', () => {
            btn.classList.remove('is-rippling');
            void btn.offsetWidth;
            btn.classList.add('is-rippling');
            setTimeout(() => btn.classList.remove('is-rippling'), 600);
            // v4.2.22：单次动作后自动收起折叠菜单
            if (typeof FabTrigger !== 'undefined') FabTrigger.collapse();
        });
        document.body.appendChild(btn);
        this._helpBtn = btn;
    },

    _getSeenSet() {
        return new Set(this._seen);
    },

    _saveSeenSet(set) {
        this._seen = new Set(set);
    },

    _resolveModuleId(moduleId) {
        return this._moduleAliases[moduleId] || moduleId;
    }
};

window.ExperimentGuide = ExperimentGuide;
globalThis.ExperimentGuide = ExperimentGuide;
