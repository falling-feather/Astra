/* 星序 Astra · 统一资源总览 v7.4.33
 * 契约：window.initPlanets / window.destroyPlanets 必须存在。
 */
(function attachPlanetsOverview(global) {
    'use strict';

    const PLANETS_ASSET_VERSION = '20260719v7437AstraWorkspaceP0';
    const ROLE_VIEW = Object.freeze({
        student: Object.freeze({
            label: '学生',
            code: 'STUDENT ORBIT',
            copy: '学习资源保持在同一张星图中；作业、提交与班级进度集中在“我的学习”。'
        }),
        teacher: Object.freeze({
            label: '教师',
            code: 'TEACHER ORBIT',
            copy: '在总览中进入任一星系备课；课程、班级、作业与审批集中在“教学工作台”。'
        }),
        admin: Object.freeze({
            label: '管理员',
            code: 'ADMIN ORBIT',
            copy: '三个星系共用一个治理入口；组织、账号、内容、运行状态与审计统一进入“全局治理”。'
        })
    });

    const view = {
        root: null,
        active: false,
        details: [],
        sessionHandler: null,
        actionHandler: null,
        roleHomeGeneration: 0,

        init() {
            if (this.active) this.destroy();
            this.root = document.getElementById('page-planets');
            if (!this.root) return;
            this.active = true;
            this.details = Array.from(this.root.querySelectorAll('details[data-galaxy]'));
            this.details.forEach((detail) => {
                const handler = () => this.syncDisclosure(detail);
                detail.__astraDisclosureHandler = handler;
                detail.addEventListener('toggle', handler);
                this.syncDisclosure(detail);
            });
            this.sessionHandler = () => this.syncSession();
            global.addEventListener('astra:session-ready', this.sessionHandler);
            this.actionHandler = (event) => this.handleAction(event);
            this.root.addEventListener('click', this.actionHandler);
            this.syncSession();
            this.refreshIcons();
        },

        destroy() {
            this.details.forEach((detail) => {
                if (detail.__astraDisclosureHandler) {
                    detail.removeEventListener('toggle', detail.__astraDisclosureHandler);
                    delete detail.__astraDisclosureHandler;
                }
            });
            if (this.sessionHandler) global.removeEventListener('astra:session-ready', this.sessionHandler);
            if (this.root && this.actionHandler) this.root.removeEventListener('click', this.actionHandler);
            this.details = [];
            this.sessionHandler = null;
            this.actionHandler = null;
            this.root = null;
            this.active = false;
            this.roleHomeGeneration += 1;
            if (global.AstraRoleHomeClient && typeof global.AstraRoleHomeClient.destroy === 'function') {
                global.AstraRoleHomeClient.destroy();
            }
        },

        syncDisclosure(detail) {
            const toggle = detail && detail.querySelector('.planets-galaxy-row__toggle');
            if (toggle) toggle.textContent = detail.open ? '收起资源' : '展开资源';
        },

        async handleAction(event) {
            const actionNode = event.target instanceof Element
                ? event.target.closest('[data-planets-session-action]')
                : null;
            if (!actionNode || !this.root || !this.root.contains(actionNode)) return;
            if (actionNode.dataset.planetsSessionAction !== 'logout') return;
            const session = global.AstraApplicationSession;
            if (!session || typeof session.logout !== 'function' || actionNode.disabled) return;
            actionNode.disabled = true;
            actionNode.setAttribute('aria-busy', 'true');
            try {
                await session.logout();
            } finally {
                actionNode.disabled = false;
                actionNode.removeAttribute('aria-busy');
            }
        },

        syncSession() {
            if (!this.root) return;
            const session = global.AstraApplicationSession;
            const user = session && typeof session.getUser === 'function' ? session.getUser() : null;
            const role = user && ROLE_VIEW[user.role] ? user.role : 'student';
            const roleView = ROLE_VIEW[role];
            this.root.dataset.sessionRole = role;

            const name = this.root.querySelector('[data-planets-identity-name]');
            const roleLabel = this.root.querySelector('[data-planets-identity-role]');
            const routeCode = this.root.querySelector('[data-planets-route-code]');
            const routeCopy = this.root.querySelector('[data-planets-route-copy]');
            if (name) name.textContent = user ? (user.display_name || user.username || '已验证用户') : '已验证用户';
            if (roleLabel) roleLabel.textContent = roleView.label + '视图';
            if (routeCode) routeCode.textContent = roleView.code;
            if (routeCopy) routeCopy.textContent = roleView.copy;

            if (session && typeof session.applyRoleUI === 'function') session.applyRoleUI();
            this.syncRoleHome(user);
        },

        async syncRoleHome(user) {
            if (!user || !this.root || !global.AstraLearningEvidenceLoader) return;
            const generation = ++this.roleHomeGeneration;
            try {
                await global.AstraLearningEvidenceLoader.ensure({ roleHome: true });
                if (!this.active || generation !== this.roleHomeGeneration || !this.root) return;
                const owner = global.AstraRoleHomeClient;
                const mounted = this.root.querySelector('[data-astra-role-home]');
                if (mounted && owner && typeof owner.setUser === 'function') owner.setUser(user);
                else if (owner && typeof owner.mount === 'function') owner.mount(this.root, user);
            } catch (error) {
                if (generation === this.roleHomeGeneration) {
                    console.warn('[PlanetsView] role home unavailable', error && (error.code || error.message));
                }
            }
        },

        refreshIcons() {
            if (!global.lucide || typeof global.lucide.createIcons !== 'function') return;
            try {
                global.lucide.createIcons({ attrs: { 'stroke-width': 1.7 }, root: this.root || document });
            } catch (error) {}
        }
    };

    global.PlanetsView = view;
    global.initPlanets = function initPlanets() { view.init(); };
    global.destroyPlanets = function destroyPlanets() { view.destroy(); };
    global.AstraPlanetsContract = Object.freeze({
        version: PLANETS_ASSET_VERSION,
        galaxies: Object.freeze(['englab', 'codespace', 'frontier']),
        roleViews: Object.freeze(Object.keys(ROLE_VIEW))
    });
})(window);
