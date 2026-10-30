// ===== Interactive Periodic Table v2 =====
// Modes: standard / electronegativity / radius / state / oxidation
// Event cleanup, destroy(), _listeners pattern

const PeriodicTable = {
    // ── Category definitions ──
    categories: {
        'alkali':     { label: '\u78b1\u91d1\u5c5e',     color: '#ef4444' },
        'alkaline':   { label: '\u78b1\u571f\u91d1\u5c5e',   color: '#f97316' },
        'transition': { label: '\u8fc7\u6e21\u91d1\u5c5e',   color: '#eab308' },
        'post-trans': { label: '\u540e\u8fc7\u6e21\u91d1\u5c5e', color: '#22c55e' },
        'metalloid':  { label: '\u7c7b\u91d1\u5c5e',     color: '#14b8a6' },
        'nonmetal':   { label: '\u975e\u91d1\u5c5e',     color: '#3b82f6' },
        'halogen':    { label: '\u5364\u7d20',       color: '#8b5cf6' },
        'noble':      { label: '\u7a00\u6709\u6c14\u4f53',   color: '#ec4899' },
        'lanthanide': { label: '\u9567\u7cfb',       color: '#06b6d4' },
        'actinide':   { label: '\u951d\u7cfb',       color: '#a855f7' },
    },

    // Format: [Z, symbol, name, mass, category, row(period), col(group), electronConfig, electronegativity, atomicRadius_pm, meltingPoint_C, commonOxidation]
    elements: [
        [1,'H','\u6c22',1.008,'nonmetal',1,1,'1s\u00b9',2.20,53,-259,'+1,-1'],
        [2,'He','\u6c26',4.003,'noble',1,18,'1s\u00b2',0,31,-272,'0'],
        [3,'Li','\u9502',6.941,'alkali',2,1,'[He]2s\u00b9',0.98,167,180,'+1'],
        [4,'Be','\u94cd',9.012,'alkaline',2,2,'[He]2s\u00b2',1.57,112,1287,'+2'],
        [5,'B','\u787c',10.81,'metalloid',2,13,'[He]2s\u00b22p\u00b9',2.04,87,2075,'+3'],
        [6,'C','\u78b3',12.01,'nonmetal',2,14,'[He]2s\u00b22p\u00b2',2.55,77,3550,'+4,-4'],
        [7,'N','\u6c2e',14.01,'nonmetal',2,15,'[He]2s\u00b22p\u00b3',3.04,75,-210,'+5,+3,-3'],
        [8,'O','\u6c27',16.00,'nonmetal',2,16,'[He]2s\u00b22p\u2074',3.44,73,-218,'-2'],
        [9,'F','\u6c1f',19.00,'halogen',2,17,'[He]2s\u00b22p\u2075',3.98,72,-220,'-1'],
        [10,'Ne','\u6c16',20.18,'noble',2,18,'[He]2s\u00b22p\u2076',0,69,-249,'0'],
        [11,'Na','\u94a0',22.99,'alkali',3,1,'[Ne]3s\u00b9',0.93,190,98,'+1'],
        [12,'Mg','\u9541',24.31,'alkaline',3,2,'[Ne]3s\u00b2',1.31,145,650,'+2'],
        [13,'Al','\u94dd',26.98,'post-trans',3,13,'[Ne]3s\u00b23p\u00b9',1.61,118,660,'+3'],
        [14,'Si','\u7845',28.09,'metalloid',3,14,'[Ne]3s\u00b23p\u00b2',1.90,111,1410,'+4,-4'],
        [15,'P','\u78f7',30.97,'nonmetal',3,15,'[Ne]3s\u00b23p\u00b3',2.19,106,44,'+5,+3,-3'],
        [16,'S','\u786b',32.07,'nonmetal',3,16,'[Ne]3s\u00b23p\u2074',2.58,102,115,'+6,+4,-2'],
        [17,'Cl','\u6c2f',35.45,'halogen',3,17,'[Ne]3s\u00b23p\u2075',3.16,99,-101,'+7,-1'],
        [18,'Ar','\u6c29',39.95,'noble',3,18,'[Ne]3s\u00b23p\u2076',0,97,-189,'0'],
        [19,'K','\u94be',39.10,'alkali',4,1,'[Ar]4s\u00b9',0.82,243,63,'+1'],
        [20,'Ca','\u9499',40.08,'alkaline',4,2,'[Ar]4s\u00b2',1.00,194,842,'+2'],
        [21,'Sc','\u9492',44.96,'transition',4,3,'[Ar]3d\u00b94s\u00b2',1.36,184,1541,'+3'],
        [22,'Ti','\u949b',47.87,'transition',4,4,'[Ar]3d\u00b24s\u00b2',1.54,176,1668,'+4,+3'],
        [23,'V','\u94d2',50.94,'transition',4,5,'[Ar]3d\u00b34s\u00b2',1.63,171,1910,'+5,+4,+3'],
        [24,'Cr','\u94ec',52.00,'transition',4,6,'[Ar]3d\u20754s\u00b9',1.66,166,1907,'+6,+3'],
        [25,'Mn','\u9530',54.94,'transition',4,7,'[Ar]3d\u20754s\u00b2',1.55,161,1246,'+7,+4,+2'],
        [26,'Fe','\u94c1',55.85,'transition',4,8,'[Ar]3d\u20764s\u00b2',1.83,156,1538,'+3,+2'],
        [27,'Co','\u94b4',58.93,'transition',4,9,'[Ar]3d\u20774s\u00b2',1.88,152,1495,'+3,+2'],
        [28,'Ni','\u954d',58.69,'transition',4,10,'[Ar]3d\u20784s\u00b2',1.91,149,1455,'+2'],
        [29,'Cu','\u94dc',63.55,'transition',4,11,'[Ar]3d\u00b9\u20704s\u00b9',1.90,145,1085,'+2,+1'],
        [30,'Zn','\u950c',65.38,'transition',4,12,'[Ar]3d\u00b9\u20704s\u00b2',1.65,142,420,'+2'],
        [31,'Ga','\u9563',69.72,'post-trans',4,13,'[Ar]3d\u00b9\u20704s\u00b24p\u00b9',1.81,136,30,'+3'],
        [32,'Ge','\u9517',72.63,'metalloid',4,14,'[Ar]3d\u00b9\u20704s\u00b24p\u00b2',2.01,125,938,'+4'],
        [33,'As','\u7837',74.92,'metalloid',4,15,'[Ar]3d\u00b9\u20704s\u00b24p\u00b3',2.18,114,817,'+5,+3,-3'],
        [34,'Se','\u7852',78.97,'nonmetal',4,16,'[Ar]3d\u00b9\u20704s\u00b24p\u2074',2.55,103,221,'+6,+4,-2'],
        [35,'Br','\u6eb4',79.90,'halogen',4,17,'[Ar]3d\u00b9\u20704s\u00b24p\u2075',2.96,94,-7,'+5,-1'],
        [36,'Kr','\u6c2a',83.80,'noble',4,18,'[Ar]3d\u00b9\u20704s\u00b24p\u2076',3.00,88,-157,'0'],
        [37,'Rb','\u94f7',85.47,'alkali',5,1,'[Kr]5s\u00b9',0.82,265,39,'+1'],
        [38,'Sr','\u9536',87.62,'alkaline',5,2,'[Kr]5s\u00b2',0.95,219,777,'+2'],
        [39,'Y','\u94c7',88.91,'transition',5,3,'[Kr]4d\u00b95s\u00b2',1.22,212,1526,'+3'],
        [40,'Zr','\u9506',91.22,'transition',5,4,'[Kr]4d\u00b25s\u00b2',1.33,206,1855,'+4'],
        [41,'Nb','\u94cc',92.91,'transition',5,5,'[Kr]4d\u20745s\u00b9',1.60,198,2477,'+5'],
        [42,'Mo','\u94bc',95.95,'transition',5,6,'[Kr]4d\u20755s\u00b9',2.16,190,2623,'+6'],
        [43,'Tc','\u9521',98,'transition',5,7,'[Kr]4d\u20755s\u00b2',1.90,183,2157,'+7'],
        [44,'Ru','\u94cc',101.1,'transition',5,8,'[Kr]4d\u20775s\u00b9',2.20,178,2334,'+4,+3'],
        [45,'Rh','\u94d1',102.9,'transition',5,9,'[Kr]4d\u20785s\u00b9',2.28,173,1964,'+3'],
        [46,'Pd','\u94af',106.4,'transition',5,10,'[Kr]4d\u00b9\u2070',2.20,169,1555,'+4,+2'],
        [47,'Ag','\u94f6',107.9,'transition',5,11,'[Kr]4d\u00b9\u20705s\u00b9',1.93,165,962,'+1'],
        [48,'Cd','\u9549',112.4,'transition',5,12,'[Kr]4d\u00b9\u20705s\u00b2',1.69,161,321,'+2'],
        [49,'In','\u94df',114.8,'post-trans',5,13,'[Kr]4d\u00b9\u20705s\u00b25p\u00b9',1.78,156,157,'+3'],
        [50,'Sn','\u9521',118.7,'post-trans',5,14,'[Kr]4d\u00b9\u20705s\u00b25p\u00b2',1.96,145,232,'+4,+2'],
        [51,'Sb','\u9511',121.8,'metalloid',5,15,'[Kr]4d\u00b9\u20705s\u00b25p\u00b3',2.05,133,631,'+5,+3,-3'],
        [52,'Te','\u7880',127.6,'metalloid',5,16,'[Kr]4d\u00b9\u20705s\u00b25p\u2074',2.10,123,450,'+6,+4,-2'],
        [53,'I','\u7898',126.9,'halogen',5,17,'[Kr]4d\u00b9\u20705s\u00b25p\u2075',2.66,115,114,'+7,-1'],
        [54,'Xe','\u6c19',131.3,'noble',5,18,'[Kr]4d\u00b9\u20705s\u00b25p\u2076',2.60,108,-112,'0'],
        [55,'Cs','\u94ef',132.9,'alkali',6,1,'[Xe]6s\u00b9',0.79,298,28,'+1'],
        [56,'Ba','\u94a1',137.3,'alkaline',6,2,'[Xe]6s\u00b2',0.89,253,727,'+2'],
        [57,'La','\u9567',138.9,'lanthanide',9,3,'[Xe]5d\u00b96s\u00b2',1.10,195,920,'+3'],
        [58,'Ce','\u94c8',140.1,'lanthanide',9,4,'[Xe]4f\u00b95d\u00b96s\u00b2',1.12,185,798,'+4,+3'],
        [59,'Pr','\u9528',140.9,'lanthanide',9,5,'[Xe]4f\u00b36s\u00b2',1.13,185,931,'+3'],
        [60,'Nd','\u94d5',144.2,'lanthanide',9,6,'[Xe]4f\u20746s\u00b2',1.14,185,1024,'+3'],
        [61,'Pm','\u9537',145,'lanthanide',9,7,'[Xe]4f\u20756s\u00b2',1.13,185,1042,'+3'],
        [62,'Sm','\u9490',150.4,'lanthanide',9,8,'[Xe]4f\u20766s\u00b2',1.17,185,1072,'+3,+2'],
        [63,'Eu','\u94d5',152.0,'lanthanide',9,9,'[Xe]4f\u20776s\u00b2',1.20,185,822,'+3,+2'],
        [64,'Gd','\u9486',157.3,'lanthanide',9,10,'[Xe]4f\u20775d\u00b96s\u00b2',1.20,180,1313,'+3'],
        [65,'Tb','\u94fd',158.9,'lanthanide',9,11,'[Xe]4f\u20796s\u00b2',1.20,175,1356,'+3'],
        [66,'Dy','\u9561',162.5,'lanthanide',9,12,'[Xe]4f\u00b9\u20706s\u00b2',1.22,175,1412,'+3'],
        [67,'Ho','\u94ac',164.9,'lanthanide',9,13,'[Xe]4f\u00b9\u00b96s\u00b2',1.23,175,1474,'+3'],
        [68,'Er','\u94d2',167.3,'lanthanide',9,14,'[Xe]4f\u00b9\u00b26s\u00b2',1.24,175,1529,'+3'],
        [69,'Tm','\u94e5',168.9,'lanthanide',9,15,'[Xe]4f\u00b9\u00b36s\u00b2',1.25,175,1545,'+3'],
        [70,'Yb','\u9540',173.0,'lanthanide',9,16,'[Xe]4f\u00b9\u20746s\u00b2',1.10,175,824,'+3,+2'],
        [71,'Lu','\u9525',175.0,'lanthanide',9,17,'[Xe]4f\u00b9\u20745d\u00b96s\u00b2',1.27,175,1663,'+3'],
        [72,'Hf','\u94ea',178.5,'transition',6,4,'[Xe]4f\u00b9\u20745d\u00b26s\u00b2',1.30,208,2233,'+4'],
        [73,'Ta','\u94bd',180.9,'transition',6,5,'[Xe]4f\u00b9\u20745d\u00b36s\u00b2',1.50,200,3017,'+5'],
        [74,'W','\u94a8',183.8,'transition',6,6,'[Xe]4f\u00b9\u20745d\u20746s\u00b2',2.36,193,3422,'+6'],
        [75,'Re','\u94fc',186.2,'transition',6,7,'[Xe]4f\u00b9\u20745d\u20756s\u00b2',1.90,188,3186,'+7,+4'],
        [76,'Os','\u9587',190.2,'transition',6,8,'[Xe]4f\u00b9\u20745d\u20766s\u00b2',2.20,185,3033,'+8,+4'],
        [77,'Ir','\u94f1',192.2,'transition',6,9,'[Xe]4f\u00b9\u20745d\u20776s\u00b2',2.20,180,2466,'+4,+3'],
        [78,'Pt','\u94c2',195.1,'transition',6,10,'[Xe]4f\u00b9\u20745d\u20796s\u00b9',2.28,177,1768,'+4,+2'],
        [79,'Au','\u91d1',197.0,'transition',6,11,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b9',2.54,174,1064,'+3,+1'],
        [80,'Hg','\u6c5e',200.6,'transition',6,12,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b2',2.00,171,-39,'+2,+1'],
        [81,'Tl','\u94ca',204.4,'post-trans',6,13,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b26p\u00b9',1.62,156,304,'+3,+1'],
        [82,'Pb','\u94c5',207.2,'post-trans',6,14,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b26p\u00b2',2.33,154,327,'+4,+2'],
        [83,'Bi','\u94cb',209.0,'post-trans',6,15,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b26p\u00b3',2.02,143,271,'+5,+3'],
        [84,'Po','\u948b',209,'post-trans',6,16,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b26p\u2074',2.00,135,254,'+4,+2'],
        [85,'At','\u7839',210,'halogen',6,17,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b26p\u2075',2.20,127,302,'-1'],
        [86,'Rn','\u6c21',222,'noble',6,18,'[Xe]4f\u00b9\u20745d\u00b9\u20706s\u00b26p\u2076',0,120,-71,'0'],
        [87,'Fr','\u94ab',223,'alkali',7,1,'[Rn]7s\u00b9',0.70,348,27,'+1'],
        [88,'Ra','\u9573',226,'alkaline',7,2,'[Rn]7s\u00b2',0.90,283,700,'+2'],
        [89,'Ac','\u951d',227,'actinide',10,3,'[Rn]6d\u00b97s\u00b2',1.10,195,1050,'+3'],
        [90,'Th','\u948d',232.0,'actinide',10,4,'[Rn]6d\u00b27s\u00b2',1.30,180,1750,'+4'],
        [91,'Pa','\u9564',231.0,'actinide',10,5,'[Rn]5f\u00b26d\u00b97s\u00b2',1.50,180,1572,'+5,+4'],
        [92,'U','\u94c0',238.0,'actinide',10,6,'[Rn]5f\u00b36d\u00b97s\u00b2',1.38,175,1135,'+6,+4'],
        [93,'Np','\u9538',237,'actinide',10,7,'[Rn]5f\u20746d\u00b97s\u00b2',1.36,175,644,'+5,+4,+3'],
        [94,'Pu','\u949a',244,'actinide',10,8,'[Rn]5f\u20767s\u00b2',1.28,175,640,'+4'],
        [95,'Am','\u9545',243,'actinide',10,9,'[Rn]5f\u20777s\u00b2',1.30,175,1176,'+3'],
        [96,'Cm','\u9514',247,'actinide',10,10,'[Rn]5f\u20775d\u00b97s\u00b2',1.30,176,1340,'+3'],
        [97,'Bk','\u951b',247,'actinide',10,11,'[Rn]5f\u20797s\u00b2',1.30,176,1050,'+3'],
        [98,'Cf','\u950e',251,'actinide',10,12,'[Rn]5f\u00b9\u20707s\u00b2',1.30,176,900,'+3'],
        [99,'Es','\u953f',252,'actinide',10,13,'[Rn]5f\u00b9\u00b97s\u00b2',1.30,176,860,'+3'],
        [100,'Fm','\u9544',257,'actinide',10,14,'[Rn]5f\u00b9\u00b27s\u00b2',1.30,176,1527,'+3'],
        [101,'Md','\u9494',258,'actinide',10,15,'[Rn]5f\u00b9\u00b37s\u00b2',1.30,176,827,'+3,+2'],
        [102,'No','\u9518',259,'actinide',10,16,'[Rn]5f\u00b9\u20747s\u00b2',1.30,176,827,'+3,+2'],
        [103,'Lr','\u94f9',266,'actinide',10,17,'[Rn]5f\u00b9\u20747s\u00b27p\u00b9',1.30,176,1627,'+3'],
        [104,'Rf','\U0002b71b',267,'transition',7,4,'[Rn]5f\u00b9\u20746d\u00b27s\u00b2',0,157,null,'+4'],
        [105,'Db','\U0002b74a',268,'transition',7,5,'[Rn]5f\u00b9\u20746d\u00b37s\u00b2',0,149,null,'+5'],
        [106,'Sg','\U0002b773',269,'transition',7,6,'[Rn]5f\u00b9\u20746d\u20746s\u00b2',0,143,null,'+6'],
        [107,'Bh','\U0002b71b',270,'transition',7,7,'[Rn]5f\u00b9\u20746d\u20756s\u00b2',0,141,null,'+7'],
        [108,'Hs','\U0002b776',269,'transition',7,8,'[Rn]5f\u00b9\u20746d\u20766s\u00b2',0,134,null,'+8'],
        [109,'Mt','\u9fbf',278,'transition',7,9,'[Rn]5f\u00b9\u20746d\u20776s\u00b2',0,129,null,null],
        [110,'Ds','\U0002b7fc',281,'transition',7,10,'[Rn]5f\u00b9\u20746d\u20786s\u00b2',0,128,null,null],
        [111,'Rg','\U0002b72d',282,'transition',7,11,'[Rn]5f\u00b9\u20746d\u20796s\u00b2',0,121,null,null],
        [112,'Cn','\u9fd4',285,'transition',7,12,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b2',0,122,null,'+2'],
        [113,'Nh','\u9fed',286,'post-trans',7,13,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b27p\u00b9',0,136,null,null],
        [114,'Fl','\U0002b4e7',289,'post-trans',7,14,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b27p\u00b2',0,143,null,null],
        [115,'Mc','\u9546',290,'post-trans',7,15,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b27p\u00b3',0,162,null,null],
        [116,'Lv','\U0002b7f7',293,'post-trans',7,16,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b27p\u2074',0,175,null,null],
        [117,'Ts','\u9fec',294,'halogen',7,17,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b27p\u2075',0,165,null,null],
        [118,'Og','\u9feb',294,'noble',7,18,'[Rn]5f\u00b9\u20746d\u00b9\u20706s\u00b27p\u2076',0,157,null,null],
    ],

    // Mainland Simplified Chinese names, cross-checked by atomic number.
    // Kept separate from the property table so a copied row cannot silently shift names.
    mainlandNames: [
        null,
        '氢', '氦', '锂', '铍', '硼', '碳', '氮', '氧', '氟', '氖',
        '钠', '镁', '铝', '硅', '磷', '硫', '氯', '氩', '钾', '钙',
        '钪', '钛', '钒', '铬', '锰', '铁', '钴', '镍', '铜', '锌',
        '镓', '锗', '砷', '硒', '溴', '氪', '铷', '锶', '钇', '锆',
        '铌', '钼', '锝', '钌', '铑', '钯', '银', '镉', '铟', '锡',
        '锑', '碲', '碘', '氙', '铯', '钡', '镧', '铈', '镨', '钕',
        '钷', '钐', '铕', '钆', '铽', '镝', '钬', '铒', '铥', '镱',
        '镥', '铪', '钽', '钨', '铼', '锇', '铱', '铂', '金', '汞',
        '铊', '铅', '铋', '钋', '砹', '氡', '钫', '镭', '锕', '钍',
        '镤', '铀', '镎', '钚', '镅', '锔', '锫', '锎', '锿', '镄',
        '钔', '锘', '铹', '\u{2CB3B}', '\u{2CB4A}', '\u{2CB73}', '\u{2CB5B}', '\u{2CB76}', '鿏', '\u{2B7FC}',
        '\u{2CB2D}', '鿔', '鿭', '\u{2B4E7}', '镆', '\u{2B7F7}', '鿬', '鿫'
    ],

    selectedElement: null,
    _listeners: [],
    mode: 'standard', // standard | electronegativity | radius

    /* ============ Init / Destroy ============ */

    init() {
        const container = document.getElementById('periodic-table-grid');
        if (!container) return;
        this._normalizeElementNames();
        this.buildTable(container);
        this.buildLegend();
        this.bindSearch();
        this._injectModeButtons();
        this.updateInfo();

        const closeBtn = document.getElementById('pt-detail-close');
        this._on(closeBtn, 'click', () => this.closeDetail());

        // Click overlay to close
        const overlay = document.getElementById('pt-detail-overlay');
        if (overlay) this._on(overlay, 'click', () => this.closeDetail());
    },

    _normalizeElementNames() {
        if (this._namesNormalized) return;
        this.elements.forEach((element) => {
            const expectedName = this.mainlandNames[element[0]];
            if (expectedName) element[2] = expectedName;
        });
        this._namesNormalized = true;
    },

    destroy() {
        this._listeners.forEach(([el, evt, fn, opts]) => el.removeEventListener(evt, fn, opts));
        this._listeners = [];
    },

    _on(el, evt, fn, opts) {
        if (!el) return;
        el.addEventListener(evt, fn, opts);
        this._listeners.push([el, evt, fn, opts]);
    },

    /* ============ Mode Toggle ============ */

    _injectModeButtons() {
        const grid = document.getElementById('periodic-table-grid');
        if (!grid || document.getElementById('pt-mode-buttons')) return;

        const wrap = document.createElement('div');
        wrap.id = 'pt-mode-buttons';
        wrap.className = 'pt-modes';
        wrap.innerHTML = '<button class="pt-mode-btn active" data-mode="standard">\u6807\u51c6\u5206\u7c7b</button>'
            + '<button class="pt-mode-btn" data-mode="electronegativity">\u7535\u8d1f\u6027</button>'
            + '<button class="pt-mode-btn" data-mode="radius">\u539f\u5b50\u534a\u5f84</button>';
        grid.parentElement.insertBefore(wrap, grid);

        wrap.querySelectorAll('.pt-mode-btn').forEach(btn => {
            this._on(btn, 'click', () => {
                this.mode = btn.dataset.mode;
                wrap.querySelectorAll('.pt-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
                this._applyMode();
                this.updateInfo();
            });
        });
    },

    _applyMode() {
        const grid = document.getElementById('periodic-table-grid');
        if (!grid) return;
        const cells = grid.querySelectorAll('.pt-element');
        const legendWrap = document.getElementById('pt-legend');

        if (this.mode === 'standard') {
            cells.forEach(cell => {
                const cat = cell.dataset.cat;
                const color = this.categories[cat]?.color || '#888';
                cell.style.setProperty('--el-color', color);
                cell.style.removeProperty('--el-bg');
                const overlay = cell.querySelector('.pt-overlay');
                if (overlay) overlay.remove();
            });
            if (legendWrap) legendWrap.style.display = '';
            this._updateScaleLegend(null);
        } else if (this.mode === 'electronegativity') {
            cells.forEach(cell => {
                const z = parseInt(cell.dataset.z);
                const el = this.elements.find(e => e[0] === z);
                if (!el) return;
                const en = el[8]; // electronegativity
                if (!en || en === 0) {
                    cell.style.setProperty('--el-color', '#444');
                    cell.style.setProperty('--el-bg', 'rgba(40,40,40,0.5)');
                } else {
                    const t = (en - 0.7) / (3.98 - 0.7);
                    const color = this._interpolateColor(t);
                    cell.style.setProperty('--el-color', color);
                    cell.style.setProperty('--el-bg', color.replace(')', ',0.15)').replace('rgb(', 'rgba('));
                }
            });
            if (legendWrap) legendWrap.style.display = 'none';
            this._updateScaleLegend('electronegativity');
        } else if (this.mode === 'radius') {
            cells.forEach(cell => {
                const z = parseInt(cell.dataset.z);
                const el = this.elements.find(e => e[0] === z);
                if (!el) return;
                const radius = el[9]; // atomic radius pm
                if (!radius) {
                    cell.style.setProperty('--el-color', '#444');
                } else {
                    const t = radius / 350; // max ~348 (Fr)
                    const color = this._interpolateColor(1 - t); // small=hot, large=cool
                    cell.style.setProperty('--el-color', color);
                    cell.style.setProperty('--el-bg', color.replace(')', ',0.15)').replace('rgb(', 'rgba('));
                }
            });
            if (legendWrap) legendWrap.style.display = 'none';
            this._updateScaleLegend('radius');
        }
    },

    _interpolateColor(t) {
        // Blue(0) -> Cyan(0.25) -> Green(0.5) -> Yellow(0.75) -> Red(1)
        t = Math.max(0, Math.min(1, t));
        let r, g, b;
        if (t < 0.25) {
            const s = t / 0.25;
            r = 0; g = Math.round(180 * s); b = Math.round(255 * (1 - s) + 200 * s);
        } else if (t < 0.5) {
            const s = (t - 0.25) / 0.25;
            r = 0; g = Math.round(180 + 75 * s); b = Math.round(200 * (1 - s));
        } else if (t < 0.75) {
            const s = (t - 0.5) / 0.25;
            r = Math.round(255 * s); g = 255; b = 0;
        } else {
            const s = (t - 0.75) / 0.25;
            r = 255; g = Math.round(255 * (1 - s)); b = 0;
        }
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    },

    _updateScaleLegend(type) {
        let existing = document.getElementById('pt-scale-legend');
        if (!type) {
            if (existing) existing.remove();
            return;
        }
        if (!existing) {
            existing = document.createElement('div');
            existing.id = 'pt-scale-legend';
            existing.className = 'pt-scale-legend';
            const grid = document.getElementById('periodic-table-grid');
            if (grid) grid.parentElement.insertBefore(existing, grid.nextSibling);
        }

        if (type === 'electronegativity') {
            existing.innerHTML = '<span class="pt-scale-label">\u7535\u8d1f\u6027 (Pauling)</span>'
                + '<div class="pt-scale-bar" style="background:linear-gradient(to right,rgb(0,0,255),rgb(0,180,200),rgb(0,255,0),rgb(255,255,0),rgb(255,0,0))"></div>'
                + '<div class="pt-scale-ticks"><span>0.7</span><span>1.5</span><span>2.2</span><span>3.0</span><span>4.0</span></div>';
        } else if (type === 'radius') {
            existing.innerHTML = '<span class="pt-scale-label">\u539f\u5b50\u534a\u5f84 (pm)</span>'
                + '<div class="pt-scale-bar" style="background:linear-gradient(to right,rgb(255,0,0),rgb(255,255,0),rgb(0,255,0),rgb(0,180,200),rgb(0,0,255))"></div>'
                + '<div class="pt-scale-ticks"><span>30</span><span>100</span><span>170</span><span>250</span><span>350</span></div>';
        }
    },

    /* ============ Build Table ============ */

    buildTable(container) {
        container.innerHTML = '';

        const placeholders = new Map();
        placeholders.set('6-3', { label: '57-71', sub: '\u9567\u7cfb' });
        placeholders.set('7-3', { label: '89-103', sub: '\u951d\u7cfb' });

        const posMap = new Map();
        for (const el of this.elements) {
            posMap.set(el[5] + '-' + el[6], el);
        }

        for (let r = 1; r <= 10; r++) {
            if (r === 8) {
                const spacer = document.createElement('div');
                spacer.className = 'pt-spacer';
                spacer.style.gridColumn = '1 / -1';
                container.appendChild(spacer);
                continue;
            }

            for (let c = 1; c <= 18; c++) {
                const key = r + '-' + c;

                if (placeholders.has(key)) {
                    const ph = placeholders.get(key);
                    const div = document.createElement('div');
                    div.className = 'pt-cell pt-placeholder';
                    div.innerHTML = '<span class="pt-symbol">' + ph.label + '</span><span class="pt-name">' + ph.sub + '</span>';
                    container.appendChild(div);
                    continue;
                }

                const el = posMap.get(key);
                if (!el) {
                    const empty = document.createElement('div');
                    empty.className = 'pt-cell pt-empty';
                    container.appendChild(empty);
                    continue;
                }

                const [num, sym, name, mass, cat] = el;
                const color = this.categories[cat]?.color || '#888';

                const cell = document.createElement('div');
                cell.className = 'pt-cell pt-element';
                cell.dataset.cat = cat;
                cell.dataset.z = num;
                cell.style.setProperty('--el-color', color);
                cell.innerHTML = '<span class="pt-number">' + num + '</span>'
                    + '<span class="pt-symbol">' + sym + '</span>'
                    + '<span class="pt-name">' + name + '</span>';

                this._on(cell, 'click', () => this.showDetail(el));
                this._on(cell, 'mouseenter', () => this.highlightCategory(cat));
                this._on(cell, 'mouseleave', () => this.clearHighlight());

                container.appendChild(cell);
            }
        }
    },

    buildLegend() {
        const legend = document.getElementById('pt-legend');
        if (!legend) return;
        legend.innerHTML = '';
        for (const [key, val] of Object.entries(this.categories)) {
            const item = document.createElement('span');
            item.className = 'pt-legend-item';
            item.innerHTML = '<span class="pt-legend-dot" style="background:' + val.color + '"></span>' + val.label;
            this._on(item, 'click', () => this.filterCategory(key));
            legend.appendChild(item);
        }
    },

    highlightCategory(cat) {
        if (this.mode !== 'standard') return;
        const grid = document.getElementById('periodic-table-grid');
        if (!grid) return;
        grid.querySelectorAll('.pt-element').forEach(el => {
            el.classList.toggle('pt-dim', el.dataset.cat !== cat);
        });
    },

    clearHighlight() {
        const grid = document.getElementById('periodic-table-grid');
        if (!grid) return;
        const activeCat = grid.dataset.filter;
        if (activeCat) {
            grid.querySelectorAll('.pt-element').forEach(el => {
                el.classList.toggle('pt-dim', el.dataset.cat !== activeCat);
            });
        } else {
            grid.querySelectorAll('.pt-element').forEach(el => el.classList.remove('pt-dim'));
        }
    },

    filterCategory(cat) {
        const grid = document.getElementById('periodic-table-grid');
        if (!grid) return;
        if (grid.dataset.filter === cat) {
            delete grid.dataset.filter;
            grid.querySelectorAll('.pt-element').forEach(el => el.classList.remove('pt-dim'));
        } else {
            grid.dataset.filter = cat;
            grid.querySelectorAll('.pt-element').forEach(el => {
                el.classList.toggle('pt-dim', el.dataset.cat !== cat);
            });
        }
    },

    showDetail(el) {
        const [num, sym, name, mass, cat, , , config, en, radius, mp, ox] = el;
        const panel = document.getElementById('pt-detail');
        if (!panel) return;

        const catInfo = this.categories[cat] || { label: cat, color: '#888' };

        panel.querySelector('.pt-detail-number').textContent = num;
        panel.querySelector('.pt-detail-symbol').textContent = sym;
        panel.querySelector('.pt-detail-symbol').style.color = catInfo.color;
        panel.querySelector('.pt-detail-name').textContent = name;
        panel.querySelector('.pt-detail-mass').textContent = mass;
        panel.querySelector('.pt-detail-cat').textContent = catInfo.label;
        panel.querySelector('.pt-detail-cat').style.color = catInfo.color;

        // Enhanced config section
        let configHTML = '<div class="pt-detail-section"><span class="label">\u7535\u5b50\u6784\u578b</span><span class="value">' + config + '</span></div>';
        if (en && en > 0) {
            configHTML += '<div class="pt-detail-section"><span class="label">\u7535\u8d1f\u6027</span><span class="value">' + en.toFixed(2) + ' (Pauling)</span></div>';
        }
        if (radius) {
            configHTML += '<div class="pt-detail-section"><span class="label">\u539f\u5b50\u534a\u5f84</span><span class="value">' + radius + ' pm</span></div>';
        }
        if (mp !== null && mp !== undefined) {
            configHTML += '<div class="pt-detail-section"><span class="label">\u7194\u70b9</span><span class="value">' + mp + ' \u00b0C</span></div>';
        }
        if (ox) {
            configHTML += '<div class="pt-detail-section"><span class="label">\u5e38\u89c1\u6c27\u5316\u6001</span><span class="value">' + ox + '</span></div>';
        }
        panel.querySelector('.pt-detail-config').innerHTML = configHTML;

        panel.classList.add('active');
        const overlay = document.getElementById('pt-detail-overlay');
        if (overlay) overlay.classList.add('active');
        this.selectedElement = el;
    },

    closeDetail() {
        const panel = document.getElementById('pt-detail');
        if (panel) panel.classList.remove('active');
        const overlay = document.getElementById('pt-detail-overlay');
        if (overlay) overlay.classList.remove('active');
        this.selectedElement = null;
    },

    /* ============ Search ============ */

    bindSearch() {
        const input = document.getElementById('pt-search');
        const results = document.getElementById('pt-search-results');
        if (!input || !results) return;

        this._on(input, 'input', () => {
            const q = input.value.trim().toLowerCase();
            this._clearSearchHighlight();
            if (!q) {
                results.classList.remove('active');
                results.innerHTML = '';
                return;
            }

            const matches = this.elements.filter(el => {
                const [num, sym, name] = el;
                return String(num) === q
                    || sym.toLowerCase().startsWith(q)
                    || name.includes(q);
            }).slice(0, 8);

            if (matches.length === 0) {
                results.classList.remove('active');
                results.innerHTML = '';
                return;
            }

            results.innerHTML = matches.map(el => {
                const [num, sym, name, , cat] = el;
                const color = this.categories[cat]?.color || '#888';
                return '<div class="pt-search-item" data-num="' + num + '">'
                    + '<span class="pt-sr-num">' + num + '</span>'
                    + '<span class="pt-sr-sym" style="color:' + color + '">' + sym + '</span>'
                    + '<span>' + name + '</span></div>';
            }).join('');
            results.classList.add('active');

            this._highlightSearchMatches(matches);

            results.querySelectorAll('.pt-search-item').forEach(item => {
                this._on(item, 'click', () => {
                    const num = parseInt(item.dataset.num);
                    const el = this.elements.find(e => e[0] === num);
                    if (el) this.showDetail(el);
                    input.value = '';
                    results.classList.remove('active');
                    results.innerHTML = '';
                    this._clearSearchHighlight();
                });
            });
        });

        this._on(input, 'blur', () => {
            setTimeout(() => {
                results.classList.remove('active');
                this._clearSearchHighlight();
            }, 150);
        });
    },

    _highlightSearchMatches(matches) {
        const grid = document.getElementById('periodic-table-grid');
        if (!grid) return;
        const nums = new Set(matches.map(e => e[0]));
        grid.querySelectorAll('.pt-element').forEach(cell => {
            const numEl = cell.querySelector('.pt-number');
            if (numEl && nums.has(parseInt(numEl.textContent))) {
                cell.classList.add('pt-search-match');
            }
        });
    },

    _clearSearchHighlight() {
        const grid = document.getElementById('periodic-table-grid');
        if (!grid) return;
        grid.querySelectorAll('.pt-search-match').forEach(c => c.classList.remove('pt-search-match'));
    },

    /* ── education panel ── */
    updateInfo() {
        const el = document.getElementById('pt-edu-info');
        if (!el) return;
        const modeLabels = { 'standard': '标准分类', 'electronegativity': '电负性趋势', 'radius': '原子半径趋势' };
        let h = `<div class="chem-hd"><span class="chem-tag">${modeLabels[this.mode] || '元素周期表'}</span>元素周期律知识点</div>
<div class="chem-row"><span class="chem-key">周期律</span>元素性质随原子序数递增而周期性变化，同周期从左到右金属性减弱、非金属性增强</div>
<div class="chem-row"><span class="chem-key chem-key--purple">族的规律</span>同主族元素最外层电子数相同，化学性质相似；从上到下金属性增强</div>`;
        if (this.mode === 'electronegativity') {
            h += `<div class="chem-row"><span class="chem-key chem-key--amber">电负性</span>同周期从左到右增大，同族从上到下减小。F 电负性最大(3.98)，Cs 最小(0.79)</div>`;
        } else if (this.mode === 'radius') {
            h += `<div class="chem-row"><span class="chem-key chem-key--amber">原子半径</span>同周期从左到右减小（核电荷增大），同族从上到下增大（电子层数增多）</div>`;
        } else {
            h += `<div class="chem-row"><span class="chem-key chem-key--amber">元素分类</span>金属元素(左下区)、非金属元素(右上区)、类金属(对角线)；过渡金属占据中部</div>`;
        }
        h += `<div class="chem-row"><span class="chem-key">电子排布</span>核外电子按能量最低原理填充：1s→2s→2p→3s→3p→4s→3d…</div>
<div class="chem-note">💡 人教版必修1：周期表中纵行为族、横行为周期。点击任意元素查看详细信息，切换模式观察属性趋势</div>`;
        el.innerHTML = h;
    }
};

function initPeriodicTable() {
    PeriodicTable.init();
}
