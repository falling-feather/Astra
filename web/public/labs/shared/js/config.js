// ===== Canvas Font Resolution =====
// CSS var() does not work in ctx.font — resolve once via getComputedStyle
const CF = {
    _s: null, _m: null,
    get sans() { return this._s || (this._s = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'); },
    get mono() { return this._m || (this._m = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'); }
};

// ===== Application Configuration =====
const CONFIG = {
    backend: {
        apiBaseUrl: ''
    },

    // Page metadata
    pages: {
        mathematics: {
            label: '数学',
            accent: 'blue',
            icon: 'calculator',
            title: '数学可视化',
            subtitle: '可视化探索',
            desc: '通过交互式可视化探索数学的奥秘，从函数图像到微积分、几何变换，感受数学之美。'
        },
        physics: {
            label: '物理',
            accent: 'purple',
            icon: 'atom',
            title: '物理演示',
            subtitle: '动态模拟',
            desc: '通过动态模拟理解物理世界的运行规律，从力学到电磁场，沉浸式体验物理法则。'
        },
        chemistry: {
            label: '化学',
            accent: 'green',
            icon: 'flask-conical',
            title: '化学实验',
            subtitle: '微观探索',
            desc: '探索化学元素和反应的奥秘，从原子结构到化学平衡，理解物质的本质。'
        },
        algorithms: {
            label: '算法',
            accent: 'orange',
            icon: 'code',
            title: '算法可视化',
            subtitle: '逻辑之美',
            desc: '通过动画理解算法的工作原理，从排序到图论，用代码解构复杂问题。'
        },
        biology: {
            label: '生物',
            accent: 'teal',
            icon: 'leaf',
            title: '生物实验',
            subtitle: '生命科学',
            desc: '探索生命的奥秘，从细胞结构到遗传规律，可视化理解生物学核心概念。'
        },
        cosmos: {
            label: '地球与宇宙',
            accent: 'blue',
            icon: 'globe-2',
            title: '地球与宇宙科学',
            subtitle: '天文与地理',
            desc: '用太阳高度、昼长和季节模型理解地球运动与宇宙观察的基础。'
        },
        engineering: {
            label: '工程应用',
            accent: 'orange',
            icon: 'construction',
            title: '工程应用',
            subtitle: '结构与受力',
            desc: '把物理、数学和材料知识放进结构问题，理解荷载路径、支座反力和杆件拉压。'
        },
        datascience: {
            label: '数据科学',
            accent: 'purple',
            icon: 'scatter-chart',
            title: '数据科学与 AI',
            subtitle: '模型训练',
            desc: '从特征、标签、损失函数和线性回归开始，理解数据如何转化为可解释预测。'
        },
        infotech: {
            label: '信息技术',
            accent: 'teal',
            icon: 'network',
            title: '信息技术基础',
            subtitle: '网络与协议',
            desc: '从一次网页请求出发，观察 DNS、TCP、IPv6 和逐跳转发如何协同工作。'
        },
        materials: {
            label: '材料微观',
            accent: 'orange',
            icon: 'layers-3',
            title: '材料与微观结构',
            subtitle: '晶体与晶粒',
            desc: '从晶胞、堆积方式和晶粒边界理解微观结构与宏观性能之间的关系。'
        },
        humanities: {
            label: '人文可视化',
            accent: 'teal',
            icon: 'book-open',
            title: '语言与人文可视化',
            subtitle: '文本与史料',
            desc: '用词项、上下文和共现网络提出回读问题，并把图表线索放回原文解释。'
        }
    },

    // Experiment cards
    experiments: {
        mathematics: [
            { id: 'function-graph', title: '函数图像', description: '可视化各种数学函数', icon: 'function-square', variant: 'featured', anchor: 'func-graph-section' },
            { id: 'calculus', title: '微积分', description: '理解导数、积分和极限', icon: 'trending-up', variant: 'featured' },
            { id: 'geometry', title: '几何变换', description: '探索平移、旋转、缩放', icon: 'shapes', variant: 'featured' },
            { id: 'complex', title: '复数运算', description: '复平面上的运算', icon: 'calculator', variant: 'featured' },
            { id: 'trigonometry', title: '三角函数', description: '单位圆与sin/cos/tan联动', icon: 'circle-dot', variant: 'featured' },
            { id: 'set-operations', title: '集合运算', description: 'Venn图与集合操作可视化', icon: 'combine', variant: 'featured' },
            { id: 'probability', title: '概率统计', description: '抛硬币/掷骰子频率收敛与直方图', icon: 'bar-chart-2', variant: 'featured' },
            { id: 'vector-ops', title: '向量运算', description: '向量加减/数量积/投影可视化', icon: 'move', variant: 'featured' },
            { id: 'inequality', title: '不等式', description: '线性规划可行域与最优解', icon: 'maximize-2', variant: 'featured' },
            { id: 'conic-sections', title: '圆锥曲线', description: '椭圆/双曲线/抛物线焦点轨迹', icon: 'circle', variant: 'featured' },
            { id: 'solid-geometry', title: '立体几何', description: '三维多面体旋转与截面', icon: 'box', variant: 'featured' },
            { id: 'permutation-combination', title: '排列组合', description: '树状图/计数公式/杨辉三角', icon: 'layers', variant: 'featured' },
            { id: 'sequences', title: '数列可视化', description: '等差/等比数列图形化与前n项和', icon: 'bar-chart', variant: 'featured' },
            { id: 'function-properties', title: '函数性质探究', description: '单调性/奇偶性/周期性交互分析', icon: 'scan-line', variant: 'featured' },
            { id: 'exp-log', title: '指数与对数', description: '底数a对图像影响与互为反函数', icon: 'trending-up', variant: 'featured' },
            { id: 'binomial-theorem', title: '二项式定理', description: '杨辉三角与(a+b)ⁿ展开系数联动', icon: 'pyramid', variant: 'featured' },
            { id: 'statistics-regression', title: '统计与回归', description: '最小二乘回归/相关系数/正态分布与3σ', icon: 'scatter-chart', variant: 'featured' },
            { id: 'modeling-numerical', title: '建模与数值方法', description: '拟合误差·Euler步长·Newton迭代', icon: 'line-chart', variant: 'featured' },
            { id: 'spatial-vector', title: '空间向量', description: '3D 向量加法/数量积/向量积/夹角可视化', icon: 'box', variant: 'featured' },
            { id: 'derivative-application', title: '导数应用', description: '切线/单调性/极值与最值的导数分析', icon: 'spline', variant: 'featured' }
        ],
        physics: [
            { id: 'mechanics', title: '恢复系数与反弹高度', description: '固定落高，对照 e² 与第一次反弹峰值', icon: 'gauge', variant: 'featured' },
            { id: 'double-pendulum-chaos', title: '双摆混沌：初值差的放大', description: '近初值双摆轨迹与相空间对照', icon: 'orbit', variant: 'featured', guide: false },
            { id: 'gas-laws', title: '气体实验定律', description: 'Boyle/Charles/理想气体状态方程', icon: 'thermometer', variant: 'featured' },
            { id: 'thermodynamics', title: '热力学基础', description: '第一定律·热机效率·熵增方向', icon: 'flame', variant: 'featured' },
            { id: 'electromagnetism', title: '电磁场', description: '电场和磁场分布', icon: 'zap', variant: 'featured' },
            { id: 'waves', title: '波动演示', description: '声波、光波', icon: 'waves', variant: 'featured' },
            { id: 'relativity', title: '相对论', description: '时间膨胀、长度收缩', icon: 'orbit', variant: 'featured' },
            { id: 'kinematics', title: '匀变速运动', description: 'v-t图与s-t图联动', icon: 'move-right', variant: 'featured' },
            { id: 'projectile', title: '抛体运动', description: '轨迹、速度分解、射程', icon: 'rocket', variant: 'featured' },
            { id: 'circular-motion', title: '圆周运动', description: '向心加速度/向心力/线速度', icon: 'rotate-ccw', variant: 'featured' },
            { id: 'energy-conservation', title: '机械能守恒', description: '过山车PE/KE能量条', icon: 'activity', variant: 'featured' },
            { id: 'circuit-analysis', title: '电路分析', description: '串并联电路与欧姆定律', icon: 'cpu', variant: 'featured' },
            { id: 'em-induction', title: '电磁感应', description: '法拉第定律与感应电动力', icon: 'zap', variant: 'featured' },
            { id: 'alternating-current', title: '交变电流', description: 'AC波形、RMS与变压器', icon: 'radio', variant: 'featured' },
            { id: 'fluid-dynamics', title: '流体力学', description: '势流叠加、圆柱绕流与伯努利方程', icon: 'wind', variant: 'featured' },
            { id: 'optics', title: '光学', description: '透镜成像/双缝干涉/折射/色散/偏振', icon: 'eye', variant: 'featured' },
            { id: 'gravitation', title: '万有引力', description: '卫星轨道模拟与引力场', icon: 'orbit', variant: 'featured' },
            { id: 'force-composition', title: '力的合成与分解', description: '平行四边形定则与正交分解', icon: 'move-diagonal-2', variant: 'featured' },
            { id: 'momentum-conservation', title: '动量守恒', description: '一维碰撞与动量-动能柱状图', icon: 'arrow-right-left', variant: 'featured' },
            { id: 'charged-particle', title: '带电粒子运动', description: '洛伦兹力偏转·质谱仪·速度选择器', icon: 'atom', variant: 'featured' },
            { id: 'atomic-physics', title: '原子物理', description: '玻尔能级·光谱跃迁·光电效应', icon: 'orbit', variant: 'featured' }
        ],
        chemistry: [
            { id: 'chromatography-separation', title: '色谱分离：色带与峰同步', description: '柱中色带与检测峰的保留时间对照', icon: 'activity', variant: 'featured', guide: false },
            { id: 'periodic-table', title: '元素周期表', description: '交互式元素周期表', icon: 'table', variant: 'featured' },
            { id: 'molecular-structure', title: '分子结构', description: '3D可视化分子', icon: 'atom', variant: 'featured' },
            { id: 'hybrid-orbitals', title: '杂化轨道理论', description: 'sp/sp²/sp³ 与 VSEPR 构型联动', icon: 'orbit', variant: 'featured' },
            { id: 'crystal-structures', title: '晶体结构', description: '离子/金属/共价网络/分子晶体对比', icon: 'box', variant: 'featured' },
            { id: 'reactions', title: '化学反应', description: '模拟原子重排', icon: 'test-tube', variant: 'featured' },
            { id: 'chemical-equilibrium', title: '化学平衡', description: '勒夏特列原理与平衡移动', icon: 'scale', variant: 'featured' },
            { id: 'electrochemistry', title: '电化学', description: '原电池/电解池电子流动', icon: 'battery-charging', variant: 'featured' },
            { id: 'chemical-bond', title: '化学键', description: '离子键/共价键/金属键微观结构', icon: 'link', variant: 'featured' },
            { id: 'organic-chemistry', title: '有机化学', description: '碳链结构与常见有机分子', icon: 'hexagon', variant: 'featured' },
            { id: 'reaction-rate', title: '反应速率', description: '碰撞理论与温度/浓度/催化剂影响', icon: 'trending-up', variant: 'featured' },
            { id: 'solution-ionization', title: '溶液与电离', description: 'pH指示与强弱电解质', icon: 'droplet', variant: 'featured' },
            { id: 'ionic-reaction', title: '离子反应', description: '离子方程式拆分与旁观离子', icon: 'split', variant: 'featured' },
            { id: 'redox', title: '氧化还原', description: '电子转移可视化与双线桥法', icon: 'arrow-right-left', variant: 'featured' },
            { id: 'atomic-structure', title: '原子结构与电子排布', description: '电子云轨道·排布规则·玻尔模型', icon: 'atom', variant: 'featured' },
            { id: 'element-compounds', title: '元素化合物', description: 'Na/Fe/Al/Cl/N/S 价类二维图与焰色反应', icon: 'flame', variant: 'featured' },
            { id: 'intermolecular-forces', title: '分子间力与氢键', description: '氢化物沸点趋势·氢键网络模型', icon: 'droplets', variant: 'featured' },
            { id: 'experiments', title: '虚拟实验', description: '滴定·沉淀·指示剂虚拟观察', icon: 'beaker', variant: 'featured' }
        ],
        algorithms: [
            { id: 'sorting', title: '排序算法', description: '冒泡、快排、归并', icon: 'arrow-up-down', variant: 'featured' },
            { id: 'searching', title: '搜索算法', description: '二分查找、DFS/BFS', icon: 'search', variant: 'featured' },
            { id: 'hash-tables', title: '哈希表', description: '链地址法/线性探测与负载因子', icon: 'hash', variant: 'featured' },
            { id: 'bst-avl', title: '二叉搜索树', description: 'BST 插入/删除与 AVL 旋转', icon: 'git-branch', variant: 'featured' },
            { id: 'graph', title: '图算法', description: '最短路径、生成树', icon: 'network', variant: 'featured' },
            { id: 'mst-compare', title: '最小生成树对比', description: 'Prim 与 Kruskal 选边顺序对照', icon: 'git-compare', variant: 'featured' },
            { id: 'greedy-scheduling', title: '贪心算法', description: '活动选择与区间调度', icon: 'list-checks', variant: 'featured' },
            { id: 'data-structures', title: '数据结构', description: '栈、队列、树', icon: 'layers', variant: 'featured' },
            { id: 'sorting-compare', title: '排序对比', description: '5种排序算法动画对比', icon: 'bar-chart', variant: 'featured' },
            { id: 'recursion-vis', title: '递归可视化', description: 'Fibonacci树/汉诺塔动画', icon: 'git-branch', variant: 'featured' },
            { id: 'dynamic-programming', title: '动态规划', description: '0/1背包问题DP表填充', icon: 'grid', variant: 'featured' },
            { id: 'string-matching', title: '字符串匹配', description: 'KMP算法逐步动画', icon: 'search', variant: 'featured' }
        ],
        biology: [
            { id: 'cell-structure', title: '细胞结构', description: '动植物细胞的结构与功能', icon: 'microscope', variant: 'featured' },
            { id: 'dna', title: 'DNA结构', description: '双螺旋结构与复制过程', icon: 'dna', variant: 'featured' },
            { id: 'photosynthesis', title: '光合作用', description: '光反应与 Calvin 循环可视化', icon: 'sun', variant: 'featured' },
            { id: 'enzyme-properties', title: '酶的特性', description: '活化能、温度/pH 与底物浓度曲线', icon: 'activity', variant: 'featured' },
            { id: 'homeostasis', title: '内环境稳态', description: '血糖、体温与反馈调节模型', icon: 'gauge', variant: 'featured' },
            { id: 'humoral-regulation', title: '体液调节', description: 'HPT 轴、甲状腺激素与负反馈', icon: 'network', variant: 'featured' },
            { id: 'genetics', title: '遗传学', description: '孟德尔定律与遗传图谱', icon: 'git-branch', variant: 'featured' },
            { id: 'mitosis', title: '有丝分裂', description: '细胞分裂各时期动画演示', icon: 'split', variant: 'featured' },
            { id: 'neural-regulation', title: '神经调节', description: '突触传递与动作电位可视化', icon: 'zap', variant: 'featured' },
            { id: 'immune-system', title: '免疫系统', description: '巨噬细胞/抗体/T细胞免疫模拟', icon: 'shield', variant: 'featured' },
            { id: 'population-community', title: '种群与群落', description: 'J/S 型增长、K 值与种间关系', icon: 'network', variant: 'featured' },
            { id: 'material-cycles', title: '生态系统物质循环', description: '碳循环、氮循环与温室效应', icon: 'refresh-cw', variant: 'featured' },
            { id: 'ecosystem', title: '生态系统', description: '食物链能量流动与种群动态模拟', icon: 'trees', variant: 'featured' },
            { id: 'meiosis', title: '减数分裂', description: '同源染色体联会与分裂全过程', icon: 'git-merge', variant: 'featured' },
            { id: 'gene-expression', title: '基因表达', description: '转录(DNA→mRNA)与翻译(mRNA→蛋白质)', icon: 'dna', variant: 'featured' },
            { id: 'gene-engineering', title: '基因工程', description: '限制酶、连接酶与载体构建', icon: 'scissors', variant: 'featured' },
            { id: 'cellular-respiration', title: '细胞呼吸', description: '糖酵解/柠檬酸循环/电子传递链', icon: 'flame', variant: 'featured' },
            { id: 'substance-transport', title: '物质运输', description: '自由扩散/协助扩散/主动运输/胞吞胞吐', icon: 'arrow-left-right', variant: 'featured' },
            { id: 'gene-mutation', title: '基因突变', description: '碱基替换/插入/缺失对蛋白质的影响', icon: 'alert-triangle', variant: 'featured' }
        ]
    },

    // Color mapping
    accentColors: {
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
    },

    // v6.3：星系拓扑 — 星序总览只承载一级星系；各星系内部再组织二级知识目录
    galaxies: [
        {
            id: 'englab',
            label: '工科试验室',
            tagline: 'ENGINEERING · LAB',
            desc: '数学 · 物理 · 化学 · 算法 · 生物 五大学科 90 个可视化实验',
            color: '#3aa9ff',
            subjects: ['mathematics', 'physics', 'chemistry', 'algorithms', 'biology']
        },
        {
            id: 'codespace',
            label: '代码空间',
            tagline: 'CODE · SPACE',
            desc: 'JS · Python · C/C++ 代码执行追踪与数据结构动画（独立子站）',
            color: '#22ff88',
            subjects: ['codespace-viz'],
            externalUrl: 'codevis/index.html'
        },
        {
            id: 'frontier',
            label: '未来星系',
            tagline: 'FRONTIER · GALAXY',
            desc: '地球与宇宙科学 · 工程应用 · 数据科学与 AI · 信息技术 · 材料与人文可视化',
            color: '#f2c86b',
            subjects: ['cosmos', 'engineering', 'datascience', 'infotech', 'materials', 'humanities']
        }
    ],

    // v6.3：学习设计层 — 给画廊卡片、学科概览和后续星系扩展提供统一教学元数据
    learningDesign: {
        updatedAt: '2026-06-19',
        sourceNote: '学习内容参考高中课程主线与开放教材；拓展主题会说明模型假设、近似条件和适合的学习层级。',
        sources: [
            { label: 'OpenStax Chemistry 2e · Le Chatelier', url: 'https://openstax.org/books/chemistry-2e/pages/13-3-shifting-equilibria-le-chateliers-principle' },
            { label: 'OpenStax Chemistry 2e · Galvanic Cells', url: 'https://openstax.org/books/chemistry-2e/pages/17-2-galvanic-cells' },
            { label: 'OpenStax Chemistry 2e · Ideal Gas Law', url: 'https://openstax.org/books/chemistry-2e/pages/9-2-relating-pressure-volume-amount-and-temperature-the-ideal-gas-law' },
            { label: 'OpenStax Chemistry 2e · Kinetic Molecular Theory', url: 'https://openstax.org/books/chemistry-2e/pages/9-5-the-kinetic-molecular-theory' },
            { label: 'OpenStax College Physics 2e · First Law of Thermodynamics', url: 'https://openstax.org/books/college-physics-2e/pages/15-1-the-first-law-of-thermodynamics' },
            { label: 'OpenStax College Physics 2e · Thermodynamic Processes', url: 'https://openstax.org/books/college-physics-2e/pages/15-2-the-first-law-of-thermodynamics-and-some-simple-processes' },
            { label: 'OpenStax College Physics 2e · Heat Engines and Efficiency', url: 'https://openstax.org/books/college-physics-2e/pages/15-3-introduction-to-the-second-law-of-thermodynamics-heat-engines-and-their-efficiency' },
            { label: 'OpenStax College Physics 2e · Carnot Engine', url: 'https://openstax.org/books/college-physics-2e/pages/15-4-carnots-perfect-heat-engine-the-second-law-of-thermodynamics-restated' },
            { label: 'OpenStax College Physics 2e · Entropy and the Second Law', url: 'https://openstax.org/books/college-physics-2e/pages/15-6-entropy-and-the-second-law-of-thermodynamics-disorder-and-the-unavailability-of-energy' },
            { label: 'OpenStax Chemistry 2e · Molecular Structure and Polarity', url: 'https://openstax.org/books/chemistry-2e/pages/7-6-molecular-structure-and-polarity' },
            { label: 'OpenStax Chemistry 2e · Hybrid Atomic Orbitals', url: 'https://openstax.org/books/chemistry-2e/pages/8-2-hybrid-atomic-orbitals' },
            { label: 'OpenStax Chemistry 2e · Solid State of Matter', url: 'https://openstax.org/books/chemistry-2e/pages/10-5-the-solid-state-of-matter' },
            { label: 'OpenStax Chemistry 2e · Lattice Structures', url: 'https://openstax.org/books/chemistry-2e/pages/10-6-lattice-structures-in-crystalline-solids' },
            { label: 'IUPAC · Periodic Table of Elements', url: 'https://iupac.org/what-we-do/periodic-table-of-elements/' },
            { label: 'IUPAC · Names of Elements 113, 115, 117 and 118', url: 'https://iupac.org/iupac-announces-the-names-of-the-elements-113-115-117-and-118/' },
            { label: 'OpenStax Chemistry 2e · Acid-Base Titrations', url: 'https://openstax.org/books/chemistry-2e/pages/14-7-acid-base-titrations' },
            { label: 'OpenStax Chemistry 2e · pH and pOH', url: 'https://openstax.org/books/chemistry-2e/pages/14-2-ph-and-poh' },
            { label: 'OpenStax Chemistry 2e · Relative Strengths of Acids and Bases', url: 'https://openstax.org/books/chemistry-2e/pages/14-3-relative-strengths-of-acids-and-bases' },
            { label: 'OpenStax Chemistry 2e · Hydrolysis of Salts', url: 'https://openstax.org/books/chemistry-2e/pages/14-4-hydrolysis-of-salts' },
            { label: 'OpenStax Chemistry 2e · Classifying Chemical Reactions', url: 'https://openstax.org/books/chemistry-2e/pages/4-2-classifying-chemical-reactions' },
            { label: 'OpenStax Chemistry 2e · Chemical Reaction Rates', url: 'https://openstax.org/books/chemistry-2e/pages/12-1-chemical-reaction-rates' },
            { label: 'OpenStax Chemistry 2e · Factors Affecting Reaction Rates', url: 'https://openstax.org/books/chemistry-2e/pages/12-2-factors-affecting-reaction-rates' },
            { label: 'OpenStax Chemistry 2e · Collision Theory', url: 'https://openstax.org/books/chemistry-2e/pages/12-5-collision-theory' },
            { label: 'OpenStax Chemistry 2e · Redox Chemistry', url: 'https://openstax.org/books/chemistry-2e/pages/17-introduction' },
            { label: 'OpenStax College Physics 2e · Bohr’s Theory of the Hydrogen Atom', url: 'https://openstax.org/books/college-physics-2e/pages/30-3-bohrs-theory-of-the-hydrogen-atom' },
            { label: 'OpenStax University Physics Vol.3 · Photoelectric Effect', url: 'https://openstax.org/books/university-physics-volume-3/pages/6-2-photoelectric-effect' },
            { label: 'OpenStax Chemistry Atoms First 2e · Intermolecular Forces', url: 'https://openstax.org/books/chemistry-atoms-first-2e/pages/10-1-intermolecular-forces' },
            { label: 'OpenStax Biology 2e · Overview of Photosynthesis', url: 'https://openstax.org/books/biology-2e/pages/8-1-overview-of-photosynthesis' },
            { label: 'OpenStax Biology 2e · Light-Dependent Reactions', url: 'https://openstax.org/books/biology-2e/pages/8-2-the-light-dependent-reactions-of-photosynthesis' },
            { label: 'OpenStax Biology 2e · Calvin Cycle', url: 'https://openstax.org/books/biology-2e/pages/8-3-using-light-energy-to-make-organic-molecules' },
            { label: 'OpenStax Biology 2e · Enzymes', url: 'https://openstax.org/books/biology-2e/pages/6-5-enzymes' },
            { label: 'OpenStax Biology 2e · Oxidative Phosphorylation', url: 'https://openstax.org/books/biology-2e/pages/7-4-oxidative-phosphorylation' },
            { label: 'OpenStax Biology 2e · Meiosis', url: 'https://openstax.org/books/biology-2e/pages/11-1-the-process-of-meiosis' },
            { label: 'OpenStax Biology 2e · The Genetic Code', url: 'https://openstax.org/books/biology-2e/pages/15-1-the-genetic-code' },
            { label: 'OpenStax Biology 2e · Eukaryotic Transcription', url: 'https://openstax.org/books/biology-2e/pages/15-3-eukaryotic-transcription' },
            { label: 'OpenStax Biology 2e · RNA Processing', url: 'https://openstax.org/books/biology-2e/pages/15-4-rna-processing-in-eukaryotes' },
            { label: 'OpenStax Biology 2e · Protein Synthesis', url: 'https://openstax.org/books/biology-2e/pages/15-5-ribosomes-and-protein-synthesis' },
            { label: 'OpenStax Anatomy & Physiology 2e · The Action Potential', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/12-4-the-action-potential' },
            { label: 'OpenStax Anatomy & Physiology 2e · Communication Between Neurons', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/12-5-communication-between-neurons' },
            { label: 'NHGRI · Mutation', url: 'https://www.genome.gov/genetics-glossary/Mutation' },
            { label: 'NHGRI · Point Mutation', url: 'https://www.genome.gov/genetics-glossary/Point-Mutation' },
            { label: 'NHGRI · Substitution', url: 'https://www.genome.gov/genetics-glossary/Substitution' },
            { label: 'NHGRI · Missense Mutation', url: 'https://www.genome.gov/genetics-glossary/Missense-Mutation' },
            { label: 'NHGRI · Nonsense Mutation', url: 'https://www.genome.gov/genetics-glossary/Nonsense-Mutation' },
            { label: 'NHGRI · Frameshift Mutation', url: 'https://www.genome.gov/genetics-glossary/Frameshift-Mutation' },
            { label: 'OpenStax Biology 2e · Homeostasis', url: 'https://openstax.org/books/biology-2e/pages/33-3-homeostasis' },
            { label: 'OpenStax Biology 2e · Innate Immune Response', url: 'https://openstax.org/books/biology-2e/pages/42-1-innate-immune-response' },
            { label: 'OpenStax Biology 2e · Adaptive Immune Response', url: 'https://openstax.org/books/biology-2e/pages/42-2-adaptive-immune-response' },
            { label: 'OpenStax Biology 2e · Antibodies', url: 'https://openstax.org/books/biology-2e/pages/42-3-antibodies' },
            { label: 'OpenStax Anatomy & Physiology 2e · Pituitary and Hypothalamus', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/17-3-the-pituitary-gland-and-hypothalamus' },
            { label: 'OpenStax Anatomy & Physiology 2e · Thyroid Gland', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/17-4-the-thyroid-gland' },
            { label: 'OpenStax Biology 2e · Environmental Limits to Population Growth', url: 'https://openstax.org/books/biology-2e/pages/45-3-environmental-limits-to-population-growth' },
            { label: 'OpenStax Biology 2e · Population Dynamics and Regulation', url: 'https://openstax.org/books/biology-2e/pages/45-4-population-dynamics-and-regulation' },
            { label: 'OpenStax Biology 2e · Community Ecology', url: 'https://openstax.org/books/biology-2e/pages/45-6-community-ecology' },
            { label: 'OpenStax Biology 2e · Biogeochemical Cycles', url: 'https://openstax.org/books/biology-2e/pages/46-3-biogeochemical-cycles' },
            { label: 'NASA Science · The Causes of Climate Change', url: 'https://science.nasa.gov/climate-change/causes/' },
            { label: 'OpenStax Biology 2e · Biotechnology', url: 'https://openstax.org/books/biology-2e/pages/17-1-biotechnology' },
            { label: 'OpenStax Microbiology · Tools of Genetic Engineering', url: 'https://openstax.org/books/microbiology/pages/12-1-microbes-and-the-tools-of-genetic-engineering' },
            { label: 'NHGRI · Genetic Engineering', url: 'https://www.genome.gov/genetics-glossary/Genetic-Engineering' },
            { label: 'Open Data Structures · Hash Tables', url: 'https://opendatastructures.org/ods-python/5_Hash_Tables.html' },
            { label: 'Open Data Structures · ChainedHashTable', url: 'https://opendatastructures.org/ods-python/5_1_ChainedHashTable_Hashin.html' },
            { label: 'Open Data Structures · LinearHashTable', url: 'https://opendatastructures.org/ods-python/5_2_LinearHashTable_Linear_.html' },
            { label: 'Open Data Structures · Comparison-Based Sorting', url: 'https://opendatastructures.org/ods-java/11_1_Comparison_Based_Sorti.html' },
            { label: 'Open Data Structures · BinarySearchTree', url: 'https://opendatastructures.org/ods-python/6_2_BinarySearchTree_Unbala.html' },
            { label: 'OpenDSA · The AVL Tree', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/AVL.html' },
            { label: 'OpenStax Calculus Volume 1 · Newton’s Method', url: 'https://openstax.org/books/calculus-volume-1/pages/4-9-newtons-method' },
            { label: 'OpenStax Calculus Volume 2 · Direction Fields and Numerical Methods', url: 'https://openstax.org/books/calculus-volume-2/pages/4-2-direction-fields-and-numerical-methods' },
            { label: 'OpenStax Introductory Statistics 2e · The Regression Equation', url: 'https://openstax.org/books/introductory-statistics-2e/pages/12-3-the-regression-equation' },
            { label: 'Google ML Crash Course · Linear Regression', url: 'https://developers.google.com/machine-learning/crash-course/linear-regression' },
            { label: 'Google ML Crash Course · Linear Regression Loss', url: 'https://developers.google.com/machine-learning/crash-course/linear-regression/loss' },
            { label: 'Jeff Erickson · Algorithms, Greedy Algorithms', url: 'https://jeffe.cs.illinois.edu/teaching/algorithms/book/04-greedy.pdf' },
            { label: 'OpenDSA · Minimal Cost Spanning Trees', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/MCST.html' },
            { label: 'OpenDSA · Kruskal’s Algorithm', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/Kruskal.html' },
            { label: 'OpenDSA · 0/1 Knapsack Problem', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/Knapsack.html' },
            { label: 'NIST DADS · Knuth-Morris-Pratt Algorithm', url: 'https://xlinux.nist.gov/dads/HTML/knuthMorrisPratt.html' },
            { label: 'NASA Space Place · Seasons', url: 'https://spaceplace.nasa.gov/seasons/en/' },
            { label: 'NASA/JPL · The Change of Seasons', url: 'https://www.jpl.nasa.gov/edu/resources/gallery/the-change-of-seasons-views-from-space/' },
            { label: 'NOAA GML · Solar Calculation Details', url: 'https://gml.noaa.gov/grad/solcalc/calcdetails.html' },
            { label: 'OpenStax University Physics · Static Equilibrium', url: 'https://openstax.org/books/university-physics-volume-1/pages/12-2-examples-of-static-equilibrium' },
            { label: 'scikit-learn · LinearRegression', url: 'https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html' },
            { label: 'IETF RFC 1034 · Domain Names', url: 'https://www.rfc-editor.org/rfc/rfc1034.html' },
            { label: 'IETF RFC 9113 · HTTP/2', url: 'https://www.rfc-editor.org/rfc/rfc9113.html' },
            { label: 'IETF RFC 9293 · TCP', url: 'https://www.rfc-editor.org/rfc/rfc9293.html' },
            { label: 'IETF RFC 8200 · IPv6', url: 'https://www.rfc-editor.org/rfc/rfc8200.html' },
            { label: 'Engineering Statics · Trusses', url: 'https://engineeringstatics.org/Chapter_06-trusses.html' },
            { label: 'Engineering Statics · Method of Joints', url: 'https://engineeringstatics.org/method-of-joints.html' },
            { label: 'Library of Congress · Primary Sources', url: 'https://www.loc.gov/programs/teachers/getting-started-with-primary-sources/guides/' },
            { label: 'TEI P5 Guidelines', url: 'https://tei-c.org/guidelines/p5/' },
            { label: 'Voyant Tools · Tool Guide', url: 'https://voyant-tools.org/docs/#!/guide/tools' },
            { label: 'Stanford IR Book · Term Frequency', url: 'https://nlp.stanford.edu/IR-book/html/htmledition/term-frequency-and-weighting-1.html' },
            { label: 'Gu, Stiles & El-Awady · Hall-Petch Statistics', url: 'https://arxiv.org/abs/2209.04891' },
            { label: 'Dangwal et al. · Hall-Petch Breaks', url: 'https://arxiv.org/abs/2402.11798' }
        ],
        subjects: {
            mathematics: {
                overview: '20 个实验围绕函数、几何、概率统计、向量与导数主线展开，并加入建模误差、迭代逼近与数值方法入口；大学先修内容以拓展学习呈现。',
                teachingNote: '建议从定义域、参数条件和图像变化一起观察；涉及数值方法时，把误差来源和结论稳定性作为重点。',
                sources: [
                    { label: '教育部 · 普通高中课程标准（2017年版2020年修订）', url: 'https://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html' },
                    { label: 'OpenStax Calculus · Newton’s Method', url: 'https://openstax.org/books/calculus-volume-1/pages/4-9-newtons-method' },
                    { label: 'OpenStax Calculus · Numerical Methods', url: 'https://openstax.org/books/calculus-volume-2/pages/4-2-direction-fields-and-numerical-methods' },
                    { label: 'OpenStax Statistics · Regression', url: 'https://openstax.org/books/introductory-statistics/pages/12-3-the-regression-equation' }
                ],
                roadmap: []
            },
            physics: {
                overview: '20 个实验覆盖运动学、力学、气体定律、热力学、电磁、波动、原子物理与天体运动；相对论、流体等主题按拓展学习处理。',
                teachingNote: '建议先统一单位和符号约定，再围绕守恒、温标、过程方向与模型适用条件观察现象。',
                sources: [
                    { label: '教育部 · 普通高中课程标准（2017年版2020年修订）', url: 'https://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html' },
                    { label: 'OpenStax College Physics · Thermodynamics', url: 'https://openstax.org/books/college-physics-2e/pages/15-1-the-first-law-of-thermodynamics' },
                    { label: 'OpenStax University Physics · Photoelectric Effect', url: 'https://openstax.org/books/university-physics-volume-3/pages/6-2-photoelectric-effect' },
                    { label: 'OpenStax Chemistry · Ideal Gas Law', url: 'https://openstax.org/books/chemistry-2e/pages/9-2-relating-pressure-volume-amount-and-temperature-the-ideal-gas-law' }
                ],
                roadmap: []
            },
            chemistry: {
                overview: '17 个实验覆盖元素、结构、杂化轨道、晶体结构、反应、平衡、速率、电化学与虚拟实验观察；高中主线和现代化学补充内容分层呈现。',
                teachingNote: '建议把元素符号、结构模型、平衡常数、催化剂、离子迁移、氢键和酸碱/沉淀规则放在同一条概念链中比较。',
                sources: [
                    { label: 'IUPAC Periodic Table', url: 'https://iupac.org/what-we-do/periodic-table-of-elements/' },
                    { label: 'OpenStax Chemistry · Hybrid Orbitals', url: 'https://openstax.org/books/chemistry-2e/pages/8-2-hybrid-atomic-orbitals' },
                    { label: 'OpenStax Chemistry · Lattice Structures', url: 'https://openstax.org/books/chemistry-2e/pages/10-6-lattice-structures-in-crystalline-solids' },
                    { label: 'OpenStax Chemistry · Reaction Rates', url: 'https://openstax.org/books/chemistry-2e/pages/12-1-chemical-reaction-rates' },
                    { label: 'OpenStax Chemistry · Collision Theory', url: 'https://openstax.org/books/chemistry-2e/pages/12-5-collision-theory' },
                    { label: 'OpenStax Chemistry · pH and pOH', url: 'https://openstax.org/books/chemistry-2e/pages/14-2-ph-and-poh' },
                    { label: 'OpenStax Chemistry · Acid and Base Strengths', url: 'https://openstax.org/books/chemistry-2e/pages/14-3-relative-strengths-of-acids-and-bases' },
                    { label: 'OpenStax Chemistry · Hydrolysis of Salts', url: 'https://openstax.org/books/chemistry-2e/pages/14-4-hydrolysis-of-salts' },
                    { label: 'OpenStax Chemistry · Redox Chemistry', url: 'https://openstax.org/books/chemistry-2e/pages/17-introduction' },
                    { label: 'OpenStax Chemistry · Galvanic Cells', url: 'https://openstax.org/books/chemistry-2e/pages/17-2-galvanic-cells' },
                    { label: 'OpenStax Atoms First · Intermolecular Forces', url: 'https://openstax.org/books/chemistry-atoms-first-2e/pages/10-1-intermolecular-forces' }
                ],
                roadmap: []
            },
            algorithms: {
                overview: '12 个实验覆盖排序、搜索、哈希表、二叉搜索树、图、最小生成树、贪心调度、数据结构、递归、DP 与字符串匹配；普通高中用户优先看算法思想。',
                teachingNote: '建议先用直觉描述问题，再对照伪代码、复杂度、数据分布和选择依据，理解算法为什么可行。',
                sources: [
                    { label: 'Open Data Structures · Sorting', url: 'https://opendatastructures.org/ods-java/11_1_Comparison_Based_Sorti.html' },
                    { label: 'Open Data Structures · Hash Tables', url: 'https://opendatastructures.org/ods-python/5_Hash_Tables.html' },
                    { label: 'OpenDSA · AVL Tree', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/AVL.html' },
                    { label: 'OpenDSA · Spanning Trees', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/MCST.html' },
                    { label: 'OpenDSA · Knapsack', url: 'https://opendsa-server.cs.vt.edu/ODSA/Books/Everything/html/Knapsack.html' },
                    { label: 'NIST DADS · KMP', url: 'https://xlinux.nist.gov/dads/HTML/knuthMorrisPratt.html' }
                ],
                roadmap: []
            },
            biology: {
                overview: '19 个实验覆盖细胞、遗传、稳态、体液调节、种群与群落、物质循环、生态、酶学、基因工程与分子生物学；高中简化模型和现代补充内容分层呈现。',
                teachingNote: '建议围绕结构层级、反馈调节、能量与物质循环、遗传信息流和实验流程建立联系；遇到简化模型时留意适合的情境。',
                sources: [
                    { label: 'OpenStax Biology · Enzymes', url: 'https://openstax.org/books/biology-2e/pages/6-5-enzymes' },
                    { label: 'OpenStax Biology · Passive Transport', url: 'https://openstax.org/books/biology-2e/pages/5-2-passive-transport' },
                    { label: 'OpenStax Biology · Active Transport', url: 'https://openstax.org/books/biology-2e/pages/5-3-active-transport' },
                    { label: 'OpenStax Biology · Bulk Transport', url: 'https://openstax.org/books/biology-2e/pages/5-4-bulk-transport' },
                    { label: 'OpenStax Biology · Homeostasis', url: 'https://openstax.org/books/biology-2e/pages/33-3-homeostasis' },
                    { label: 'OpenStax A&P · Feedback Loops', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/1-5-homeostasis' },
                    { label: 'OpenStax A&P · Endocrine Pancreas', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/17-9-the-endocrine-pancreas' },
                    { label: 'OpenStax A&P · Pituitary and Hypothalamus', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/17-3-the-pituitary-gland-and-hypothalamus' },
                    { label: 'OpenStax A&P · Thyroid Gland', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/17-4-the-thyroid-gland' },
                    { label: 'OpenStax A&P · The Action Potential', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/12-4-the-action-potential' },
                    { label: 'OpenStax A&P · Communication Between Neurons', url: 'https://openstax.org/books/anatomy-and-physiology-2e/pages/12-5-communication-between-neurons' },
                    { label: 'OpenStax Biology · The Genetic Code', url: 'https://openstax.org/books/biology-2e/pages/15-1-the-genetic-code' },
                    { label: 'OpenStax Biology · RNA Processing', url: 'https://openstax.org/books/biology-2e/pages/15-4-rna-processing-in-eukaryotes' },
                    { label: 'OpenStax Biology · Protein Synthesis', url: 'https://openstax.org/books/biology-2e/pages/15-5-ribosomes-and-protein-synthesis' },
                    { label: 'NHGRI · Mutation', url: 'https://www.genome.gov/genetics-glossary/Mutation' },
                    { label: 'NHGRI · Point Mutation', url: 'https://www.genome.gov/genetics-glossary/Point-Mutation' },
                    { label: 'NHGRI · Frameshift Mutation', url: 'https://www.genome.gov/genetics-glossary/Frameshift-Mutation' },
                    { label: 'NHGRI · Missense Mutation', url: 'https://www.genome.gov/genetics-glossary/Missense-Mutation' },
                    { label: 'NHGRI · Nonsense Mutation', url: 'https://www.genome.gov/genetics-glossary/Nonsense-Mutation' },
                    { label: 'NHGRI · Substitution', url: 'https://www.genome.gov/genetics-glossary/Substitution' },
                    { label: 'OpenStax Biology · Innate Immune Response', url: 'https://openstax.org/books/biology-2e/pages/42-1-innate-immune-response' },
                    { label: 'OpenStax Biology · Adaptive Immune Response', url: 'https://openstax.org/books/biology-2e/pages/42-2-adaptive-immune-response' },
                    { label: 'OpenStax Biology · Antibodies', url: 'https://openstax.org/books/biology-2e/pages/42-3-antibodies' },
                    { label: 'OpenStax Biology · Biotechnology', url: 'https://openstax.org/books/biology-2e/pages/17-1-biotechnology' },
                    { label: 'OpenStax Microbiology · Genetic Engineering Tools', url: 'https://openstax.org/books/microbiology/pages/12-1-microbes-and-the-tools-of-genetic-engineering' },
                    { label: 'NHGRI · Genetic Engineering', url: 'https://www.genome.gov/genetics-glossary/Genetic-Engineering' },
                    { label: 'EPA · Agriculture Nutrient Pollution', url: 'https://www.epa.gov/nutrientpollution/sources-and-solutions-agriculture' },
                    { label: 'NASA Science · Climate Change Causes', url: 'https://science.nasa.gov/climate-change/causes/' }
                ],
                roadmap: []
            },
            cosmos: {
                overview: '地球与宇宙科学入口先聚焦太阳高度、昼长和季节变化，用可调纬度与日期把地轴倾角、昼夜更替和近似计算联系起来。',
                teachingNote: '建议先区分“季节来自地轴倾角”和“地日距离变化”；太阳高度与日出日落数值用于理解趋势，实际观测会受大气折射、地形和天气影响。',
                guardrail: '不要把四季简单归因于地日距离；本页呈现的是太阳高度、昼长和季节趋势，精确日出日落仍需回到 NOAA 计算说明。',
                sources: [
                    {
                        label: 'NASA Space Place · Seasons',
                        url: 'https://spaceplace.nasa.gov/seasons/en/',
                        type: '机构',
                        usage: '支撑四季来自地轴倾角而非地日距离的核心解释',
                        localSummary: '用于说明季节变化与太阳照射角度、昼长变化相关，适合作为页面第一层概念依据。',
                        boundary: 'NASA 科普解释不等同于本页太阳高度数值算法；具体日出日落仍需结合计算模型。'
                    },
                    {
                        label: 'NASA/JPL · The Change of Seasons',
                        url: 'https://www.jpl.nasa.gov/edu/resources/gallery/the-change-of-seasons-views-from-space/',
                        type: '机构',
                        usage: '支撑季节变化可视化和地球公转叙事',
                        localSummary: '用于把地轴倾角和季节图像联系起来，帮助学习者理解宇宙页视觉叙事来源。',
                        boundary: '图像材料用于概念和展示语境，不替代本页可调纬度、日期实验中的数值读数。'
                    },
                    {
                        label: 'NOAA GML · Solar Calculation Details',
                        url: 'https://gml.noaa.gov/grad/solcalc/calcdetails.html',
                        type: '机构',
                        usage: '支撑太阳高度、昼长和日出日落近似计算的边界说明',
                        localSummary: '用于提示太阳位置计算依赖近似公式，并解释页面读数为何只能作为趋势学习。',
                        boundary: '实际观测会受大气折射、海拔、地形和天气影响，页面不输出精密天文观测结论。'
                    }
                ],
                roadmap: []
            },
            engineering: {
                overview: '工程应用入口以 Warren 桁架为例，把荷载路径、支座反力、节点平衡和杆件拉压放在同一张结构图中观察。',
                teachingNote: '建议先判断简单桁架假设是否成立，再画受力图，用整体平衡求反力、节点平衡求杆力；页面模型服务入门理解，不替代真实结构设计中的规范、材料和安全系数计算。',
                guardrail: '不要把杆件拉压符号当成完整设计结论；简单桁架分析还需要确认二力杆、节点荷载和真实材料/稳定性边界。',
                sources: [
                    {
                        label: 'Engineering Statics · Trusses',
                        url: 'https://engineeringstatics.org/Chapter_06-trusses.html',
                        type: '教材',
                        usage: '支撑简单桁架、二力杆和节点荷载假设',
                        localSummary: '用于说明本页 Warren 桁架为何可以被简化为节点和杆件的入门模型。',
                        boundary: '真实桥梁还涉及材料、连接、稳定、规范荷载和安全系数，不能由本页直接完成设计。'
                    },
                    {
                        label: 'Engineering Statics · Method of Joints',
                        url: 'https://engineeringstatics.org/method-of-joints.html',
                        type: '教材',
                        usage: '支撑节点法求杆件拉压的操作路径',
                        localSummary: '用于解释从支座反力进入节点平衡，再判断杆件受拉或受压的学习流程。',
                        boundary: '页面只模拟二维静定桁架；超静定、节点刚接和空间结构需要其他方法。'
                    },
                    {
                        label: 'OpenStax University Physics · Static Equilibrium',
                        url: 'https://openstax.org/books/university-physics-volume-1/pages/12-2-examples-of-static-equilibrium',
                        type: '教材',
                        usage: '支撑整体平衡和力矩平衡的基础定义',
                        localSummary: '用于说明荷载、支座反力和力矩平衡如何构成工程页的第一层计算依据。',
                        boundary: '教材平衡例题不覆盖结构规范验算；页面读数只能用于理解平衡关系。'
                    },
                    {
                        label: 'Engineering Statics · Zero-Force Members',
                        url: 'https://engineeringstatics.org/Chapter_06-trusses.html#subsection-110',
                        type: '教材',
                        usage: '支撑零力杆和受力路径的判读提醒',
                        localSummary: '用于提示并非所有杆件在每种荷载情境下都承担明显轴力。',
                        boundary: '零力杆判断依赖特定节点和荷载条件，本页不作为完整杆件优化工具。'
                    },
                    {
                        label: 'Engineering Statics · Equilibrium',
                        url: 'https://engineeringstatics.org/Chapter_05.html',
                        type: '教材',
                        usage: '支撑受力图、力平衡和力矩平衡的通用背景',
                        localSummary: '用于把工程页的整体反力读数放回静力学基本方程中理解。',
                        boundary: '平衡方程是必要条件，不足以证明真实结构安全或耐久。'
                    }
                ],
                roadmap: []
            },
            datascience: {
                overview: '数据科学与 AI 入口从线性回归开始，展示特征、标签、损失函数、训练轮次和残差如何共同影响一条预测直线。',
                teachingNote: '建议先读懂特征、标签、斜率、截距和残差，再讨论模型能否外推；线性回归只能表达线性关系，样本偏差和异常值会改变结论。',
                guardrail: '不要把回归线当作因果证明或样本外保证；预测前要检查散点形状、残差、异常点和自变量范围。',
                sources: [
                    {
                        label: 'OpenStax Statistics · Regression',
                        url: 'https://openstax.org/books/introductory-statistics-2e/pages/12-3-the-regression-equation',
                        type: '教材',
                        usage: '支撑回归方程、斜率、截距和残差的统计定义',
                        localSummary: '用于把页面中的预测线和残差读数放回入门统计语境。',
                        boundary: '相关和回归不等于因果；页面不提供真实业务预测或统计显著性检验。'
                    },
                    {
                        label: 'Google ML Crash Course · Linear Regression',
                        url: 'https://developers.google.com/machine-learning/crash-course/linear-regression',
                        type: '工具文档',
                        usage: '支撑机器学习语境下的特征、标签和线性模型表达',
                        localSummary: '用于解释为什么数据科学页把样本点、模型参数和预测线放在同一实验台。',
                        boundary: '页面只展示单变量线性入门模型，不代表完整 AI 系统或深度学习能力。'
                    },
                    {
                        label: 'Google ML Crash Course · Loss',
                        url: 'https://developers.google.com/machine-learning/crash-course/linear-regression/loss',
                        type: '工具文档',
                        usage: '支撑损失函数和训练反馈的解释',
                        localSummary: '用于说明调参后损失变化如何帮助用户观察模型拟合程度。',
                        boundary: '损失下降只说明训练样本上的拟合改善，不保证样本外表现或公平性。'
                    },
                    {
                        label: 'scikit-learn · LinearRegression',
                        url: 'https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html',
                        type: '工具文档',
                        usage: '支撑线性回归 API 和工程实现边界',
                        localSummary: '用于提示真实工具会以明确 API、参数和数据矩阵接口承载线性回归。',
                        boundary: '本页不是 scikit-learn 的运行环境，也不暴露完整训练、验证和部署流程。'
                    }
                ],
                roadmap: []
            },
            infotech: {
                overview: '信息技术入口用一次网页请求串起 DNS、TCP、IPv6 和逐跳转发，帮助学习者看到应用数据如何被分层封装和传递。',
                teachingNote: '建议把“域名到地址”“可靠字节流”“网络包转发”和“链路帧承载”分开理解；页面字节数是教学近似，真实网络还会受到 TLS、MTU、拥塞控制和链路类型影响。',
                guardrail: '不要把教学包头图等同于完整抓包；真实传输会受协议版本、加密层、MTU、重传和拥塞控制影响。',
                sources: [
                    {
                        label: 'IETF RFC 1034 · Domain Names',
                        url: 'https://www.rfc-editor.org/rfc/rfc1034.html',
                        type: '标准',
                        usage: '支撑 DNS 将域名映射到资源记录的基础概念',
                        localSummary: '用于解释信息页请求链路中“域名到地址”阶段的角色。',
                        boundary: '页面不模拟完整递归解析、缓存策略、DNSSEC 或真实解析器行为。'
                    },
                    {
                        label: 'IETF RFC 9113 · HTTP/2',
                        url: 'https://www.rfc-editor.org/rfc/rfc9113.html',
                        type: '标准',
                        usage: '支撑应用层请求、帧和多路复用的概念边界',
                        localSummary: '用于说明网页请求不是单一包，而会经历应用层协议组织。',
                        boundary: '页面只展示分层入口，不实现 HTTP/2 帧细节、优先级或真实浏览器协商。'
                    },
                    {
                        label: 'IETF RFC 9293 · TCP',
                        url: 'https://www.rfc-editor.org/rfc/rfc9293.html',
                        type: '标准',
                        usage: '支撑可靠字节流、连接和传输层包头的解释',
                        localSummary: '用于把请求数据与 TCP 连接、顺序和可靠传输概念联系起来。',
                        boundary: '页面不模拟拥塞控制、重传、窗口缩放和真实网络抖动。'
                    },
                    {
                        label: 'IETF RFC 8200 · IPv6',
                        url: 'https://www.rfc-editor.org/rfc/rfc8200.html',
                        type: '标准',
                        usage: '支撑网络层寻址、逐跳转发和 IPv6 包头角色',
                        localSummary: '用于解释信息页中路径节点和网络包转发的基础语义。',
                        boundary: '页面不覆盖扩展头、路由策略、MTU 发现和链路层差异。'
                    }
                ],
                roadmap: []
            },
            materials: {
                overview: '材料与微观结构是未来星系的样板路线：从晶胞类型、配位数、堆积效率和晶粒边界出发，把微观结构、性能趋势、状态读数和可信回查串成完整交互路径。',
                teachingNote: '建议按“进入、选择、观察、判读、回查”推进：先分清理想晶体结构和多晶晶粒两个尺度，再用实验台验证趋势并回到模型边界。',
                guardrail: '不要把 Hall-Petch 趋势无限外推；晶粒进入纳米尺度后，缺陷、晶界稳定性和加工历史可能改变强化方向。',
                sources: [
                    {
                        label: 'OpenStax Chemistry · Lattice Structures',
                        url: 'https://openstax.org/books/chemistry-2e/pages/10-6-lattice-structures-in-crystalline-solids',
                        type: '教材',
                        usage: '支撑晶胞、配位数和堆积效率的基础定义',
                        localSummary: '用于说明 SC、BCC、FCC、HCP 等理想晶体结构的几何比较，不用于推断真实材料强度。',
                        boundary: '教材结构模型默认理想晶体；实际合金还受缺陷、相组成和加工历史影响。'
                    },
                    {
                        label: 'Gu, Stiles & El-Awady · Hall-Petch Statistics',
                        url: 'https://arxiv.org/abs/2209.04891',
                        type: '论文',
                        usage: '支撑 Hall-Petch 趋势的统计边界提醒',
                        localSummary: '用于提示晶粒尺寸与强度关系存在统计分散和样本依赖，页面只保留入门级趋势表达。',
                        boundary: '不能把本页强度指数等同于实验屈服强度或工程选材结论。'
                    },
                    {
                        label: 'Dangwal et al. · Hall-Petch Breaks',
                        url: 'https://arxiv.org/abs/2402.11798',
                        type: '论文',
                        usage: '支撑纳米尺度和机制改变的不可外推提醒',
                        localSummary: '用于解释 Hall-Petch 型趋势并非无限成立，纳米晶或复杂微结构中可能出现偏离。',
                        boundary: '页面不模拟纳米晶、析出相、孔隙、相变和温度耦合等复杂机制。'
                    }
                ],
                roadmap: [
                    '星序总览 -> 未来星系 -> 材料与微观结构',
                    '专题地图 -> 视觉图谱 -> 可信审查',
                    '晶体结构 -> 晶粒尺度 -> 性能趋势',
                    '尺度桥 -> 判断链 -> 晶体/晶粒实验台',
                    '状态读数 -> 来源索引 -> 模型边界'
                ]
            },
            humanities: {
                overview: '语言与人文可视化入口把词频、关键词上下文和共现网络当作阅读辅助，帮助学习者提出回读问题，并把图表线索放回原文、出处和材料背景解释。',
                teachingNote: '建议先说明分词、停用词和语料范围，再观察词项与上下文；词袋模型会弱化语序、语气和历史语境，解释时要补回材料背景。',
                guardrail: '不要把词频或共现直接等同文本意义；数量线索必须回到原文、出处、语境和标注规则中解释。',
                sources: [
                    {
                        label: 'Voyant Tools · Tool Guide',
                        url: 'https://voyant-tools.org/docs/#!/guide/tools',
                        type: '工具文档',
                        usage: '支撑词频、上下文和共现视图作为阅读辅助工具',
                        localSummary: '用于说明人文页图表的作用是提出回读线索，而不是替代文本解释。',
                        boundary: '页面不接入 Voyant 在线服务，也不处理真实大型语料的清洗和标注问题。'
                    },
                    {
                        label: 'Library of Congress · Primary Sources',
                        url: 'https://www.loc.gov/programs/teachers/getting-started-with-primary-sources/guides/',
                        type: '机构',
                        usage: '支撑原始资料需要回到出处、语境和提问框架',
                        localSummary: '用于提醒学习者：数量图表之后必须回读文本和材料背景。',
                        boundary: '本页样本文本仅用于演示方法，不代表完整历史研究或文献校勘。'
                    },
                    {
                        label: 'TEI P5 Guidelines',
                        url: 'https://tei-c.org/guidelines/p5/',
                        type: '标准',
                        usage: '支撑文本标注、结构化文本和数字人文材料处理背景',
                        localSummary: '用于提示文本可视化依赖清晰的文本结构和标注规则。',
                        boundary: '页面不实现 TEI 编码器，也不输出可用于学术发布的完整标注文档。'
                    },
                    {
                        label: 'Stanford IR Book · Term Frequency',
                        url: 'https://nlp.stanford.edu/IR-book/html/htmledition/term-frequency-and-weighting-1.html',
                        type: '教材',
                        usage: '支撑词频和项权重作为信息检索线索的基础概念',
                        localSummary: '用于解释词频为什么可以帮助发现文本线索，但需要结合语境解释。',
                        boundary: '词频会弱化语序、修辞和历史语境，不能直接等同文本意义。'
                    }
                ],
                roadmap: []
            }
        },
        focus: {
            'function-graph': { tier: '核心', scope: '基础主线', task: '改变参数后，先说出定义域、零点和单调区间，再观察图像是否支持判断。', note: '图像结论必须回到函数解析式，不能只凭视觉延伸。' },
            calculus: { tier: '拓展', scope: '分层学习', task: '移动切点，比较割线斜率逐步逼近切线斜率的过程。', note: '高中主线聚焦导数；积分与 Taylor 展开作为大学先修拓展。' },
            geometry: { tier: '核心', scope: '模型近似', task: '切换平移、旋转和缩放，观察哪些量保持不变。', note: '矩阵语言用于解释变换，本体仍以几何性质为主。' },
            complex: { tier: '核心', scope: '基础主线', task: '把乘以 i 看成复平面旋转，比较模长和辐角变化。', note: '复数几何意义以平面向量类比，避免把实数大小关系照搬到复数。' },
            trigonometry: { tier: '核心', scope: '基础主线', task: '从单位圆坐标读出 sin、cos、tan，再对照函数图像的周期变化。', note: 'tan 在 cos=0 时无定义，特殊角值需先回到单位圆。' },
            'set-operations': { tier: '核心', scope: '基础主线', task: '输入两个集合后，先预测交、并、差、补，再用 Venn 图验证。', note: '补集必须指定全集，空集和全集边界要单独检查。' },
            probability: { tier: '核心', scope: '模型近似', task: '增加试验次数，观察频率如何围绕理论概率波动并逐渐稳定。', note: '频率收敛是长期趋势，不表示小样本一定接近理论值。' },
            'vector-ops': { tier: '核心', scope: '基础主线', task: '拖动向量端点，判断点积正负、夹角和投影长度如何联动。', note: '点积为 0 表示垂直；投影是有方向的数量关系。' },
            inequality: { tier: '核心', scope: '条件限定', task: '拖动约束直线，让可行域改变，观察最优点为什么落在顶点。', note: '本实验聚焦线性规划；一元与二次不等式可结合代数解法继续练习。' },
            'conic-sections': { tier: '核心', scope: '基础主线', task: '调节离心率，比较椭圆、双曲线、抛物线的焦点定义差异。', note: '标准方程来自定义推导，参数变化需看焦点和准线条件。' },
            'solid-geometry': { tier: '核心', scope: '补充学习', task: '旋转立体并观察截面，判断点线面位置关系。', note: '先建立体积与截面直觉，再结合线面角、二面角和空间向量练习深化理解。' },
            'permutation-combination': { tier: '核心', scope: '基础主线', task: '先判断“是否考虑顺序”，再选择排列或组合公式。', note: '分类加法和分步乘法不能混用，情境条件要先拆清。' },
            sequences: { tier: '核心', scope: '基础主线', task: '比较等差和等比的增长速度，并解释前 n 项和曲线差异。', note: '等比数列 q=1 是特例，需要单独处理。' },
            'function-properties': { tier: '核心', scope: '基础主线', task: '判断单调、奇偶、周期前，先确认函数定义域是否对称或完整。', note: '性质判断必须满足定义域条件，不能只看局部图像。' },
            'exp-log': { tier: '核心', scope: '基础主线', task: '改变底数 a，观察指数函数和对数函数如何互为反函数。', note: 'a 必须大于 0 且 a≠1；a=1 不是合法指数/对数底数。' },
            'binomial-theorem': { tier: '核心', scope: '基础主线', task: '选定 n 和项号，找到杨辉三角系数与通项公式的对应。', note: '系数来自组合数 C(n,k)，展开式指数和为 n。' },
            'statistics-regression': { tier: '核心', scope: '条件限定', task: '拖动散点，观察相关系数、回归线和残差如何同步变化。', note: '样本方差、无偏估计和正态近似需明确采用的统计定义。' },
            'modeling-numerical': { tier: '拓展', scope: '教材模型', task: '比较拟合残差、Euler 步长误差与 Newton 迭代路径，说明模型假设如何影响结论。', note: '样本数据与微分方程为教学模型；Euler 步长影响误差，Newton 法依赖初值和导数不为 0。' },
            'spatial-vector': { tier: '拓展', scope: '分层学习', task: '在 3D 坐标中比较数量积、夹角和投影的几何意义。', note: '向量积偏大学内容，主线应服务线面角和距离问题。' },
            'derivative-application': { tier: '核心', scope: '基础主线', task: '找出导数零点，再用左右符号变化判断极值和单调区间。', note: '极值不只看 f’=0，还要看导数符号是否改变。' },

            mechanics: { tier: '核心', scope: '模型近似', task: '先预测，再运行 e=0.40 与 e=0.80 两组固定落高对照，用 h/H 修正恢复系数与反弹高度的关系。', note: 'h/H≈e² 只适用于本页固定落高、竖直碰撞、忽略空气阻力与额外耗散的理想条件；自由滑块不计课程完成。' },
            'gas-laws': { tier: '核心', scope: '重点概念', task: '切换等温、等压、等容和等温等压情境，判断哪两个状态量成正比或反比。', note: '气体定律必须使用 Kelvin 温度；理想气体模型在低压、较高温时更可靠。' },
            thermodynamics: { tier: '核心', scope: '重点概念', task: '切换第一定律、PV 过程、热机和熵增，区分能量守恒与过程方向限制。', note: '采用 ΔU=Q-W（系统对外做功为正）的符号约定；Carnot 效率和熵计算必须使用 Kelvin 温度。' },
            electromagnetism: { tier: '核心', scope: '条件限定', task: '切换电场线和等势线，比较两者是否垂直。', note: '场线是可视化工具，不是空间中真实存在的细线。' },
            waves: { tier: '核心', scope: '基础主线', task: '改变频率和波长，验证 v=fλ 的联动关系。', note: '叠加原理适用于线性近似；驻波节点/腹部要分清。' },
            relativity: { tier: '拓展', scope: '模型近似', task: '提高速度比例，观察时间膨胀和长度收缩的方向。', note: '作为现代物理拓展入口，重点理解参考系、光速不变和相对论效应的方向。' },
            kinematics: { tier: '核心', scope: '基础主线', task: '比较 s-t 图斜率和 v-t 图面积分别代表什么。', note: '图像面积和斜率有明确物理量含义，不能只看形状。' },
            projectile: { tier: '核心', scope: '模型近似', task: '拆分初速度，分别观察水平匀速和竖直变速运动。', note: '默认忽略空气阻力；有阻力情形需要额外模型。' },
            'circular-motion': { tier: '核心', scope: '基础主线', task: '改变半径和速度，验证向心加速度 v2/r 的变化。', note: '向心力不是一种新力，而是指向圆心的合力。' },
            'energy-conservation': { tier: '核心', scope: '基础主线', task: '打开耗散后，观察机械能为什么不再保持常量。', note: '非保守力做功会改变机械能，能量总量仍守恒。' },
            'circuit-analysis': { tier: '核心', scope: '基础主线', task: '切换串联/并联，比较电流、电压和等效电阻分配。', note: '欧姆定律需在线性电阻模型内使用。' },
            'em-induction': { tier: '核心', scope: '基础主线', task: '改变磁通量变化方向，用楞次定律预测感应电流方向。', note: '感应电动势来自磁通量变化，方向体现“阻碍变化”。' },
            'alternating-current': { tier: '拓展', scope: '条件限定', task: '比较峰值和有效值，解释为什么 RMS 可用于发热等效。', note: '有效值不是平均值，需从功率等效理解。' },
            'fluid-dynamics': { tier: '拓展', scope: '模型近似', task: '观察流线疏密和压力变化，判断模型是否满足理想流体假设。', note: '机翼升力不能只用伯努利单因解释。' },
            optics: { tier: '核心', scope: '基础主线', task: '切换模式时，先说出观察量：像距、条纹间距、折射角或偏振强度。', note: '几何光学和波动光学模型的适用条件不同。' },
            gravitation: { tier: '核心', scope: '模型近似', task: '改变初速度，观察轨道由坠落、椭圆到逃逸的转变。', note: '轨道模型默认二体近似，能量视角可解释逃逸速度。' },
            'force-composition': { tier: '核心', scope: '基础主线', task: '拖动两个力，画出平行四边形并判断合力方向。', note: '受力分析先选研究对象，再判断是否漏力。' },
            'momentum-conservation': { tier: '核心', scope: '基础主线', task: '比较弹性、非弹性碰撞中动量和动能是否都守恒。', note: '系统合外力近似为零时动量守恒；动能只在弹性碰撞中守恒。' },
            'charged-particle': { tier: '拓展', scope: '基础主线', task: '改变电荷正负和速度方向，预测洛伦兹力偏转方向。', note: '方向判断需明确电荷符号和左右手规则适用场景。' },
            'atomic-physics': { tier: '拓展', scope: '重点概念', task: '调节跃迁能级、光子能量和逸出功，区分谱线跃迁与光电效应的量子化证据。', note: '玻尔模型只作氢原子/类氢离子教学近似；多电子原子与真实电子云需用量子力学模型描述。' },

            'periodic-table': { tier: '核心', scope: '基础主线', task: '选择同周期或同主族元素，比较半径、电负性和金属性趋势。', note: '元素符号与中国大陆简体名称已按原子序数校准；趋势结论仍要限定周期/族范围。' },
            'molecular-structure': { tier: '核心', scope: '模型近似', task: '切换分子后，先用 VSEPR 预测键角，再观察 3D 模型。', note: '模型显示的是近似几何；苯等结构需强调离域 π 键。' },
            'hybrid-orbitals': { tier: '核心', scope: '重点概念', task: '先数中心原子的电子域，再匹配 sp/sp²/sp³ 与电子域几何。', note: '杂化轨道是价键理论模型；VSEPR 预测电子域几何，分子形状需扣除孤对电子。' },
            'crystal-structures': { tier: '拓展', scope: '重点概念', task: '比较 NaCl、铜、金刚石和干冰的粒子类型、作用力、晶胞计数和宏观性质。', note: '晶胞图是模型化表示；离子晶体比例来自晶胞计数，分子晶体由分子间作用力维系。' },
            reactions: { tier: '核心', scope: '基础主线', task: '拖动反应进程，观察原子如何重排且总数保持不变。', note: '方程式条件、状态符号和限量反应需要结合具体案例。' },
            'chemical-equilibrium': { tier: '核心', scope: '重点概念', task: '改变浓度、压强或温度，比较 Q 与 K 后预测平衡移动。', note: '浓度/压强改变 Q；温度改变 K；催化剂不改变平衡位置。' },
            electrochemistry: { tier: '核心', scope: '重点概念', task: '区分原电池和电解池，追踪电子、阳离子和阴离子的迁移方向。', note: '原电池电子经外电路由阳极到阴极，盐桥维持电中性。' },
            'chemical-bond': { tier: '核心', scope: '基础主线', task: '比较离子键、共价键和金属键中的微粒与作用方式。', note: '“溶于水导电”只适用于可溶性离子化合物。' },
            'organic-chemistry': { tier: '核心', scope: '条件限定', task: '识别官能团，判断 σ 键、π 键和杂化方式。', note: 'σ 键可相对旋转但存在构象能垒，不等于完全自由。' },
            'reaction-rate': { tier: '核心', scope: '基础主线', task: '改变温度、浓度和催化剂，比较碰撞频率、超过活化能的粒子比例和反应进度曲线。', note: '速率方程指数由实验确定；催化剂提供较低活化能路径，但不改变反应物和产物的热力学平衡关系。' },
            'solution-ionization': { tier: '核心', scope: '重点概念', task: '比较强酸强碱、弱酸弱碱和盐类水解时的电离程度、pH/pOH 与平衡表达。', note: 'pH+pOH=14 是 25℃ 水溶液常用近似；弱电解质和盐类水解数值为教学模型，真实体系受浓度、温度和活度影响。' },
            'ionic-reaction': { tier: '核心', scope: '基础主线', task: '先拆强酸强碱可溶盐，再删去旁观离子并检查电荷守恒。', note: '净离子方程式必须同时满足原子守恒和电荷守恒。' },
            redox: { tier: '核心', scope: '概念辨析', task: '先标出化合价升降，再写氧化/还原半反应并让电子得失数相等。', note: '氧化剂得电子被还原，还原剂失电子被氧化；动画中的电子移动是判读模型，不等同于所有真实反应路径。' },
            'atomic-structure': { tier: '核心', scope: '模型近似', task: '比较玻尔模型、轨道形状和电子排布规则的用途差异。', note: '玻尔模型是历史/直观模型；真实电子云表示概率密度。' },
            'element-compounds': { tier: '核心', scope: '基础主线', task: '沿价类二维图追踪 Na、Fe、Al、Cl、N、S 的转化路径。', note: '焰色和强反应演示只作虚拟观察，不代表线下可随意操作。' },
            'intermolecular-forces': { tier: '核心', scope: '重点概念', task: '比较同族氢化物沸点，判断范德华力和氢键分别在起作用。', note: '氢键是特殊分子间作用力；水的网络效应需区别于单个 HF 氢键强度。' },
            experiments: { tier: '核心', scope: '教材模型', task: '切换滴定、沉淀和指示剂观察，判断现象背后的 pH、离子反应和溶解性规则。', note: '仅作虚拟观察；不提供线下操作步骤，沉淀与颜色按教材规则和教学近似表达。' },

            sorting: { tier: '核心', scope: '教学模型', task: '观察比较和交换次数，解释为什么不同排序速度不同。', note: '算法复杂度讨论默认输入规模足够大，动画步数只是直观近似。' },
            searching: { tier: '核心', scope: '教学模型', task: '比较线性搜索和二分搜索，找出二分必须有序的前提。', note: '未排序数组不能直接使用二分查找。' },
            'hash-tables': { tier: '核心', scope: '重点概念', task: '输入同一个键，比较链地址法扫描链表与线性探测扫描连续槽位的路径差异。', note: '平均 O(1) 依赖负载因子受控和哈希分布较均匀；开放地址表删除时常用 tombstone 保持探测路径。' },
            'bst-avl': { tier: '核心', scope: '重点概念', task: '执行插入、删除和查找，观察 BST 有序性与 AVL 平衡因子如何变化。', note: 'BST 中序遍历保持有序；AVL 通过旋转维持左右子树高度差不超过 1，旋转不改变中序序列。' },
            graph: { tier: '拓展', scope: '条件限定', task: '切换 BFS、DFS、Dijkstra、Prim，观察边权是否影响算法选择。', note: 'Dijkstra 不适用于含负权边的最短路。' },
            'mst-compare': { tier: '拓展', scope: '教材模型', task: '并排比较 Prim 与 Kruskal 的选边顺序，判断每一步为什么不会破坏最小生成树条件。', note: '最小生成树限定在连通无向带权图；若图不连通，只能得到生成森林。' },
            'greedy-scheduling': { tier: '拓展', scope: '教材模型', task: '比较多种局部选择策略，解释为什么最早结束能解决无权区间调度，而加权版本不能直接套用。', note: '适用前提是单资源、无权、最大活动数量；加权区间调度通常需要动态规划。' },
            'data-structures': { tier: '核心', scope: '教学模型', task: '执行入栈、出队、插入等操作，比较结构约束带来的差异。', note: '同一数据可用不同结构组织，复杂度取决于操作目标。' },
            'sorting-compare': { tier: '核心', scope: '教学模型', task: '用同一数据集比较不同排序的比较次数和交换次数。', note: '随机、近乎有序、逆序数据会影响算法表现。' },
            'recursion-vis': { tier: '核心', scope: '教学模型', task: '沿递归树追踪重复子问题，为动态规划做铺垫。', note: '递归是表达方式；是否高效取决于是否重复计算。' },
            'dynamic-programming': { tier: '拓展', scope: '教学模型', task: '写出 dp[i][j] 的含义，再观察转移方程如何填表。', note: '0/1 背包的每件物品只能选或不选一次。' },
            'string-matching': { tier: '拓展', scope: '教学模型', task: '构造 lps/next 数组，观察 KMP 如何避免重复回退文本指针。', note: '前缀函数描述的是模式串自身的边界信息。' },

            'cell-structure': { tier: '核心', scope: '重点概念', task: '切换动植物细胞，判断哪些结构共有、哪些只在特定细胞中常见。', note: '叶绿体存在于绿色植物部分细胞；中心体是典型动物细胞常见结构。' },
            dna: { tier: '核心', scope: '基础主线', task: '旋转双螺旋，找出反向平行、互补配对和碱基堆积。', note: 'A-T 两个氢键、G-C 三个氢键；复制遵循半保留原则。' },
            photosynthesis: { tier: '核心', scope: '重点概念', task: '区分光反应和 Calvin 循环，追踪 ATP、NADPH 与 G3P。', note: 'O₂ 来自水的裂解；Calvin 循环不直接用光，但依赖光反应产物。' },
            'enzyme-properties': { tier: '核心', scope: '重点概念', task: '比较活化能、温度、pH、底物浓度和抑制剂曲线，判断速率改变来自哪个因素。', note: '酶降低活化能、加快反应速率，但不改变 ΔG、平衡位置或反应是否自发；曲线是趋势模型。' },
            homeostasis: { tier: '核心', scope: '重点概念', task: '在血糖和体温模型中标出变量偏离、感受器、调节中枢、效应器和反馈方向。', note: '稳态是围绕设定点和正常范围的动态平衡；负反馈抵消偏离，正反馈只在有终止点的过程里放大变化。' },
            'humoral-regulation': { tier: '核心', scope: '重点概念', task: '沿 TRH→TSH→T3/T4 追踪激素级联，观察甲状腺激素升高后如何抑制上游释放。', note: 'HPT 轴展示方向关系；T3/T4 调节代谢和产热，碘供应会限制甲状腺激素合成，画布数值不是化验结果。' },
            genetics: { tier: '核心', scope: '条件限定', task: '先判断基因是否位于非同源染色体，再使用自由组合定律。', note: '连锁与交换会造成偏离独立分配的情况。' },
            mitosis: { tier: '核心', scope: '条件限定', task: '沿阶段观察染色体形态变化，并区分细胞周期和有丝分裂本身。', note: '间期属于细胞周期准备阶段，不属于有丝分裂期。' },
            'neural-regulation': { tier: '拓展', scope: '条件限定', task: '沿动作电位到达突触末端、Ca²⁺内流、小泡胞吐、递质结合和突触后电位变化追踪神经信号。', note: '膜电位数值为教学近似；递质效应取决于受体和离子通道类型，乙酰胆碱只是常见示例之一。' },
            'immune-system': { tier: '拓展', scope: '条件限定', task: '区分先天免疫和适应性免疫，追踪 PRR/PAMP 识别、抗原呈递、B/T 细胞协作和免疫记忆。', note: 'B 细胞活化常需辅助 T 细胞参与；二次应答来自记忆细胞，画布是概念模型。' },
            'population-community': { tier: '核心', scope: '重点概念', task: '比较指数增长与逻辑斯蒂增长，调节 K 和资源压力后观察种群如何接近或越过环境容纳量。', note: 'J 型增长依赖理想资源条件；S 型增长体现 K 限制。种间关系用 +、-、0 表示影响方向，画布数值不是野外调查数据。' },
            'material-cycles': { tier: '核心', scope: '重点概念', task: '切换碳循环、氮循环和温室效应，先判断箭头表示能量流动还是物质转化，再观察人类活动如何改变循环强度。', note: '能量在生态系统中单向流动并以热散失；碳、氮等物质在生物群落和无机环境间循环。温室效应和低氧风险读数都是教学指数。' },
            ecosystem: { tier: '核心', scope: '模型近似', task: '改变种群参数，观察能量流动和种群数量如何响应。', note: '10% 能量传递效率是经验近似；Lotka-Volterra 是强简化模型。' },
            meiosis: { tier: '核心', scope: '重点概念', task: '标出减 I 分离同源染色体、减 II 分离姐妹染色单体。', note: '染色体数减半发生在减 I 完成后。' },
            'gene-expression': { tier: '核心', scope: '条件限定', task: '沿 DNA→mRNA→蛋白质追踪信息流，并找出起始密码子、读码框、终止密码子和真核 mRNA 加工步骤。', note: '“转录在细胞核”限定真核细胞；原核细胞可边转录边翻译，终止密码子不编码氨基酸。' },
            'gene-engineering': { tier: '拓展', scope: '重点概念', task: '按限制酶切割、连接酶连接、转化筛选和表达验证的顺序追踪重组质粒构建。', note: '蓝白斑或抗性筛选只是初筛；是否含正确插入片段仍需 PCR、酶切分析或测序确认。' },
            'cellular-respiration': { tier: '核心', scope: '重点概念', task: '追踪糖酵解、柠檬酸循环和电子传递链的 ATP 来源。', note: '34/38 ATP 是教材近似；真实产量会随穿梭系统、物种和细胞条件变化。' },
            'substance-transport': { tier: '核心', scope: '重点概念', task: '判断物质跨膜是否顺浓度梯度、是否需要载体和能量。', note: '被动运输顺浓度或水分子梯度；主动运输逆浓度/电化学梯度并需要能量；大分子依赖囊泡运输。' },
            'gene-mutation': { tier: '核心', scope: '条件限定', task: '比较替换、插入、缺失对读码框、密码子和氨基酸序列的影响。', note: '替换可同义/错义/无义；非 3 倍数插入或缺失通常造成移码，3 的倍数不一定移码。' }
        }
    }
};
