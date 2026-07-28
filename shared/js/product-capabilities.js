// ===== Astra product capability registry =====
(function attachAstraProductCapabilities(global) {
    'use strict';

    if (global.AstraProductCapabilities) return;

    const statuses = Object.freeze(['available', 'partial', 'planned', 'unavailable']);
    const define = (record) => Object.freeze({
        key: record.key,
        label: record.label,
        roles: Object.freeze(record.roles.slice()),
        status: record.status,
        route: record.route || null,
        evidenceSource: record.evidenceSource,
        allowedClaim: record.allowedClaim,
        prohibitedClaims: Object.freeze(record.prohibitedClaims.slice())
    });
    const records = Object.freeze([
        define({
            key: 'session-role-isolation',
            label: '账号与角色会话',
            roles: ['student', 'teacher', 'admin'],
            status: 'available',
            route: '#planets',
            evidenceSource: 'Cookie Session、/api/users/me 与角色路由门禁',
            allowedClaim: '当前身份已验证',
            prohibitedClaims: ['前端已独立完成授权判断']
        }),
        define({
            key: 'student-assignments',
            label: '学生作业与截止',
            roles: ['student'],
            status: 'available',
            route: '#student',
            evidenceSource: '/api/assignments/me',
            allowedClaim: '今日任务、继续作业与截止状态',
            prohibitedClaims: ['已掌握课程', '浏览即完成']
        }),
        define({
            key: 'last-learning-position',
            label: '账号级上次学习位置',
            roles: ['student', 'teacher', 'admin'],
            status: 'planned',
            route: null,
            evidenceSource: 'BE-006 账号级续学投影尚未交付',
            allowedClaim: '当前仅为规划能力，不提供继续上次学习入口',
            prohibitedClaims: ['继续上次学习', '已支持跨设备续学', '本地访问记录即权威位置']
        }),
        define({
            key: 'course-release-plan',
            label: '班级课程发布节奏',
            roles: ['student', 'teacher', 'admin'],
            status: 'available',
            route: '#teacher',
            evidenceSource: '课程单元三态发布计划',
            allowedClaim: '开放、锁定、隐藏与开放时间',
            prohibitedClaims: ['隐藏内容可见', '学生可绕过教师节奏']
        }),
        define({
            key: 'authoritative-learning-evidence',
            label: '权威学习证据',
            roles: ['student', 'teacher', 'admin'],
            status: 'partial',
            route: '#student',
            evidenceSource: '0051 Learning Evidence API、共享证据客户端与显式 scope recovery',
            allowedClaim: '显式班级/课程范围内的事件确认、待同步状态与服务端学习投影',
            prohibitedClaims: ['访问即完成', '单次答对即掌握', '跨设备已无损恢复']
        }),
        define({
            key: 'teacher-progress',
            label: '教师学习进度',
            roles: ['teacher', 'admin'],
            status: 'partial',
            route: '#teacher',
            evidenceSource: '0051 教师 aggregate 与共享证据客户端（显式 class/course scope）',
            allowedClaim: '显式班级/课程范围内的服务端聚合状态；前端约每 4 秒发起轮询，显示时延另含接口耗时',
            prohibitedClaims: ['学生已掌握', '学习效果已证明']
        }),
        define({
            key: 'browser-precheck',
            label: '代码公开样例预检',
            roles: ['student', 'teacher', 'admin'],
            status: 'available',
            route: 'codevis/#catalog',
            evidenceSource: '浏览器本地运行与公开样例反馈',
            allowedClaim: '浏览器预检与学习反馈',
            prohibitedClaims: ['正式判题通过', 'accepted']
        }),
        define({
            key: 'formal-oj',
            label: '正式代码判题',
            roles: ['student', 'teacher', 'admin'],
            status: 'unavailable',
            route: null,
            evidenceSource: 'DisabledCodeRunnerAdapter',
            allowedClaim: '判题器未启用，提交可保存',
            prohibitedClaims: ['在线 OJ 已可用', '正式通过']
        }),
        define({
            key: 'galaxy-course-catalogs',
            label: '三星系课程目录',
            roles: ['student', 'teacher', 'admin'],
            status: 'available',
            route: '#planets',
            evidenceSource: '页面注册表与课程发布裁剪',
            allowedClaim: '真实可见的课程目录和发布状态',
            prohibitedClaims: ['全部课程均已验证', '全部活动均计入掌握']
        }),
        define({
            key: 'content-authoring',
            label: '教师内容创作',
            roles: ['teacher', 'admin'],
            status: 'partial',
            route: '#teacher',
            evidenceSource: '受约束草稿、审核和版本发布',
            allowedClaim: '内容草稿、审核与发布版本',
            prohibitedClaims: ['任意页面低代码生成', '任意脚本编辑']
        }),
        define({
            key: 'admin-governance',
            label: '学校全局治理',
            roles: ['admin'],
            status: 'partial',
            route: '#admin',
            evidenceSource: '组织、审批、审计与受约束领域操作',
            allowedClaim: '组织关系与审计治理',
            prohibitedClaims: ['任意数据库编辑', '直接修改原始表']
        }),
        define({
            key: 'ai-tutor',
            label: 'AI 助教',
            roles: ['student', 'teacher', 'admin'],
            status: 'unavailable',
            route: null,
            evidenceSource: '未进入 V8 必备范围',
            allowedClaim: '当前不提供',
            prohibitedClaims: ['AI 助教', '智能诊断']
        }),
        define({
            key: 'target-deployment',
            label: '目标环境发布',
            roles: ['admin'],
            status: 'unavailable',
            route: null,
            evidenceSource: '当前只有本机 9001 与仓库合同',
            allowedClaim: '本地预览',
            prohibitedClaims: ['已正式上线', '生产可用']
        })
    ]);
    const byKey = new Map(records.map((record) => [record.key, record]));

    const api = Object.freeze({
        statuses,
        all: () => records.slice(),
        get: (key) => byKey.get(String(key || '')) || null,
        forRole: (role) => records.filter((record) => record.roles.includes(String(role || ''))),
        canPresentAsPrimary: (key) => {
            const record = byKey.get(String(key || ''));
            return Boolean(record && record.status === 'available' && record.route);
        }
    });

    Object.defineProperty(global, 'AstraProductCapabilities', {
        value: api,
        configurable: false,
        enumerable: true,
        writable: false
    });
})(window);
