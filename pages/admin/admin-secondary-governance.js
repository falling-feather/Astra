(function attachAdminSecondaryGovernance(global) {
    'use strict';

    if (global.AdminSecondaryGovernance) return;

    const GROUPS = Object.freeze({
        identity: Object.freeze({
            label: '教师身份审核',
            description: '审核普通学生提交的教师身份申请；批准后账号才获得教师权限。',
            resources: Object.freeze([
                Object.freeze({
                    id: 'teacher-applications',
                    label: '待审教师申请',
                    path: '/api/v1/admin/teacher-applications',
                    params: Object.freeze({ status: 'pending' })
                })
            ])
        }),
        more: Object.freeze({
            label: '更多治理',
            description: '内容草稿等非首要治理能力，仅在进入后读取。',
            resources: Object.freeze([
                Object.freeze({ id: 'content-drafts', label: '内容草稿', path: '/api/admin/content/drafts' })
            ])
        }),
        advanced: Object.freeze({
            label: '高级诊断',
            description: '健康、脚本、快照、Outbox 与 Bug 诊断不会占用治理首屏网络。',
            resources: Object.freeze([
                Object.freeze({ id: 'health', label: '运行健康', pathKey: 'healthPath' }),
                Object.freeze({ id: 'script-assets', label: '脚本资产', path: '/api/admin/content/script-assets' }),
                Object.freeze({ id: 'script-hosts', label: '脚本 Host 策略', path: '/api/admin/content/script-host-policies' }),
                Object.freeze({ id: 'snapshot-runs', label: '知识快照运行', path: '/api/admin/knowledge-snapshot-runs' }),
                Object.freeze({ id: 'outbox', label: '告警 Outbox', path: '/api/admin/alert-outbox' }),
                Object.freeze({ id: 'bugs', label: 'Bug 台账', path: '/api/admin/bugs' })
            ])
        })
    });
    const OVERVIEW_RESOURCES = Object.freeze([
        Object.freeze({ id: 'pending-teacher-applications', path: '/api/v1/admin/teacher-applications', params: Object.freeze({ status: 'pending', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'pending-relationships', path: '/api/admin/class-join-requests', params: Object.freeze({ status: 'pending', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'disabled-accounts', path: '/api/admin/users', params: Object.freeze({ status: 'disabled', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'active-schools', path: '/api/admin/schools', params: Object.freeze({ status: 'active', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'archived-schools', path: '/api/admin/schools', params: Object.freeze({ status: 'archived', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'active-classes', path: '/api/admin/classes', params: Object.freeze({ status: 'active', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'archived-classes', path: '/api/admin/classes', params: Object.freeze({ status: 'archived', limit: 1, offset: 0 }), type: 'page' }),
        Object.freeze({ id: 'courses', path: '/api/courses', type: 'courses' }),
        Object.freeze({ id: 'recent-audit', path: '/api/admin/audit-logs', params: Object.freeze({ limit: 25, offset: 0 }), type: 'audit' })
    ]);
    const OVERVIEW_AUDIT_PAGE_LIMIT = 25;
    const OVERVIEW_AUDIT_PAGE_CAP = 4;
    const OVERVIEW_AUDIT_RECORD_CAP = OVERVIEW_AUDIT_PAGE_LIMIT * OVERVIEW_AUDIT_PAGE_CAP;
    const BUSINESS_AUDITS = new Set([
        'teacher.application.create:teacher_application',
        'teacher.application.approve:teacher_application',
        'teacher.application.reject:teacher_application',
        'admin.user.update:user',
        'admin.user.password_reset:user',
        'school.create:school',
        'admin.school.update:school',
        'admin.school.archive:school',
        'admin.school.restore:school',
        'class.create:class',
        'admin.class.update:class',
        'admin.class.archive:class',
        'admin.class.restore:class',
        'class.join.request.create:class_join_request',
        'class.join.request.approve:class_join_request',
        'class.join.request.reject:class_join_request',
        'class.join:class_membership',
        'class.teacher.transfer:class_membership',
        'class.student.transfer:class_membership',
        'class.member.status.update:class_membership',
        'class.student.batch_import:class_membership_batch',
        'class.member.status.batch_update:class_membership_batch',
        'course.create:course',
        'course.owner.transfer:course',
        'course.status.patch:course',
        'assignment.create:assignment',
        'assignment.audience.update:assignment',
        'assignment.class_policy.upsert:assignment_class_policy',
        'assignment.class_policy.delete:assignment_class_policy',
        'submission.create:submission',
        'submission.grade:submission'
    ]);
    const ADMIN_STATS_FIELDS = Object.freeze([
        'pending_class_join_requests', 'total_users', 'total_schools', 'total_classes',
        'total_courses', 'total_assignments', 'total_submissions',
        'total_learning_events', 'total_audit_logs'
    ]);
    const ADMIN_STATS_ROLES = new Set(['student', 'teacher', 'admin']);
    const state = {
        host: null,
        context: null,
        dialog: null,
        activeGroup: 'more',
        controller: null,
        generation: 0,
        loaded: new Set(),
        data: Object.create(null),
        errors: Object.create(null),
        trigger: null,
        clickHandler: null,
        cancelHandler: null,
        rafIds: new Set(),
        overviewHost: null,
        overviewController: null,
        overviewGeneration: 0,
        overviewLoaded: false,
        overviewData: Object.create(null),
        overviewErrors: Object.create(null),
        pendingTeacherReview: null,
        teacherReviewBusy: false,
        teacherReviewMessage: null
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function list(payload) {
        if (Array.isArray(payload)) return payload;
        if (payload && Array.isArray(payload.items)) return payload.items;
        return payload && typeof payload === 'object' ? [payload] : [];
    }

    function resourcePath(resource) {
        return resource.path || (state.context && state.context[resource.pathKey]) || '';
    }

    function begin() {
        if (state.controller && !state.controller.signal.aborted) state.controller.abort();
        state.controller = new AbortController();
        state.generation += 1;
        return { generation: state.generation, signal: state.controller.signal };
    }

    function current(scope) {
        return Boolean(
            state.host
            && scope
            && scope.generation === state.generation
            && state.controller
            && !scope.signal.aborted
        );
    }

    function request(path, options) {
        const context = state.context || {};
        return global.AstraApiClient.request(path, Object.assign({}, options || {}, {
            baseUrl: typeof context.getApiBase === 'function' ? context.getApiBase() : ''
        }));
    }

    function beginOverview() {
        if (state.overviewController && !state.overviewController.signal.aborted) {
            state.overviewController.abort();
        }
        state.overviewController = new AbortController();
        state.overviewGeneration += 1;
        return {
            generation: state.overviewGeneration,
            signal: state.overviewController.signal
        };
    }

    function currentOverview(scope) {
        return Boolean(
            state.host
            && state.overviewHost
            && scope
            && scope.generation === state.overviewGeneration
            && state.overviewController
            && !scope.signal.aborted
        );
    }

    function authoritativeTotal(payload) {
        const raw = payload && payload.total;
        if (raw === null || raw === undefined || raw === '') return null;
        const total = Number(raw);
        return Number.isInteger(total) && total >= 0 ? total : null;
    }

    function validateStatsPayload(payload) {
        const fail = () => { throw new Error('管理员统计响应结构无效'); };
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail();
        if (ADMIN_STATS_FIELDS.some((key) => !Number.isInteger(payload[key]) || payload[key] < 0)) fail();
        const roles = payload.users_by_role;
        if (!roles || typeof roles !== 'object' || Array.isArray(roles)) fail();
        const roleEntries = Object.entries(roles);
        if (roleEntries.some(([role, total]) => (
            !ADMIN_STATS_ROLES.has(role) || !Number.isInteger(total) || total < 0
        ))) fail();
        return payload;
    }

    function overviewAuditPage(payload, offset) {
        const valid = payload
            && typeof payload === 'object'
            && Array.isArray(payload.items)
            && Number.isInteger(payload.total) && payload.total >= 0
            && payload.limit === OVERVIEW_AUDIT_PAGE_LIMIT
            && payload.offset === offset
            && payload.items.length <= payload.limit
            && payload.offset <= payload.total
            && payload.offset + payload.items.length <= payload.total
            && !(payload.offset < payload.total && payload.items.length === 0)
            && payload.items.every((item) => (
                item && Number.isInteger(item.id) && item.id > 0
                && typeof item.action === 'string' && Boolean(item.action.trim())
                && typeof item.resource === 'string' && Boolean(item.resource.trim())
                && typeof item.resource_type === 'string' && Boolean(item.resource_type.trim())
            ));
        if (!valid) throw new Error('recent-audit 响应结构无效');
        return payload;
    }

    function overviewPayloadValid(resource, payload) {
        if (resource.type === 'courses') {
            return Array.isArray(payload) && payload.every((course) => (
                course
                && Number(course.id)
                && ['draft', 'published', 'archived'].includes(String(course.status || ''))
            ));
        }
        if (!payload || !Array.isArray(payload.items)) return false;
        return authoritativeTotal(payload) !== null;
    }

    function overviewRecord(id) {
        if (state.overviewErrors[id]) {
            return {
                state: 'error',
                message: global.AstraApiClient.message(state.overviewErrors[id])
            };
        }
        if (!Object.prototype.hasOwnProperty.call(state.overviewData, id)) {
            return { state: 'loading', message: '待读取' };
        }
        return { state: 'ready', value: state.overviewData[id] };
    }

    function overviewCard(kind, title, icon, body, status) {
        return `<article class="admin-summary admin-business-summary" data-admin-overview-kind="${kind}" data-admin-overview-status="${status}">
            <h2><i data-lucide="${icon}"></i>${escapeHtml(title)}</h2>
            ${body}
        </article>`;
    }

    function overviewUnavailable(kind, title, icon, records) {
        const failed = records.find((record) => record.state === 'error');
        if (failed) {
            return overviewCard(kind, title, icon, `<p class="admin-business-summary__state" role="status">读取失败：${escapeHtml(failed.message)}</p>`, 'error');
        }
        return overviewCard(kind, title, icon, '<p class="admin-business-summary__state" role="status">正在读取权威业务数据</p>', 'loading');
    }

    function renderTotalOverview(kind, title, icon, resourceId, emptyText) {
        const record = overviewRecord(resourceId);
        if (record.state !== 'ready') return overviewUnavailable(kind, title, icon, [record]);
        const total = authoritativeTotal(record.value);
        if (total === null) {
            return overviewCard(kind, title, icon, '<p class="admin-business-summary__state" role="status">响应缺少权威 total，未展示推测值</p>', 'error');
        }
        return overviewCard(kind, title, icon, `
            <strong class="admin-business-summary__total" data-admin-overview-total>${total.toLocaleString('zh-CN')}</strong>
            <p>${total ? '来自当前业务队列' : escapeHtml(emptyText)}</p>
        `, 'ready');
    }

    function renderTeacherApplicationsOverview() {
        const record = overviewRecord('pending-teacher-applications');
        if (record.state !== 'ready') {
            return overviewUnavailable('pending-teacher-applications', '教师身份申请', 'badge-check', [record]);
        }
        const total = authoritativeTotal(record.value);
        if (total === null) {
            return overviewCard('pending-teacher-applications', '教师身份申请', 'badge-check', '<p class="admin-business-summary__state" role="status">响应缺少权威 total，未展示推测值</p>', 'error');
        }
        return overviewCard('pending-teacher-applications', '教师身份申请', 'badge-check', `
            <strong class="admin-business-summary__total" data-admin-overview-total>${total.toLocaleString('zh-CN')}</strong>
            <p>${total ? '等待管理员核验教师身份' : '当前没有待审教师申请。'}</p>
            <button type="button" class="admin-text-button" data-admin-secondary-open="identity">进入教师审核</button>
        `, 'ready');
    }

    function renderOrganizationOverview(kind, label, activeId, archivedId) {
        const active = overviewRecord(activeId);
        const archived = overviewRecord(archivedId);
        if (active.state !== 'ready' || archived.state !== 'ready') {
            return overviewUnavailable(`archived-${kind}`, `${label}组织`, kind === 'schools' ? 'landmark' : 'school', [active, archived]);
        }
        const activeTotal = authoritativeTotal(active.value);
        const archivedTotal = authoritativeTotal(archived.value);
        if (activeTotal === null || archivedTotal === null) {
            return overviewCard(`archived-${kind}`, `${label}组织`, kind === 'schools' ? 'landmark' : 'school', '<p class="admin-business-summary__state" role="status">组织响应缺少权威 total，未展示推测值</p>', 'error');
        }
        return overviewCard(`archived-${kind}`, `${label}组织`, kind === 'schools' ? 'landmark' : 'school', `
            <dl data-admin-organization-summary-kind="${kind}">
                <div><dt>启用</dt><dd data-admin-overview-active>${activeTotal.toLocaleString('zh-CN')}</dd></div>
                <div><dt>归档</dt><dd data-admin-overview-archived>${archivedTotal.toLocaleString('zh-CN')}</dd></div>
            </dl>
        `, 'ready');
    }

    function renderCourseOverview() {
        const record = overviewRecord('courses');
        if (record.state !== 'ready') return overviewUnavailable('course-statuses', '课程状态分布', 'book-open-check', [record]);
        const counts = { draft: 0, published: 0, archived: 0 };
        record.value.forEach((course) => {
            const status = String(course && course.status || '');
            if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
        });
        return overviewCard('course-statuses', '课程状态分布', 'book-open-check', `
            <dl data-admin-course-status-summary>
                <div><dt>草稿</dt><dd data-admin-course-status="draft">${counts.draft.toLocaleString('zh-CN')}</dd></div>
                <div><dt>已发布</dt><dd data-admin-course-status="published">${counts.published.toLocaleString('zh-CN')}</dd></div>
                <div><dt>已归档</dt><dd data-admin-course-status="archived">${counts.archived.toLocaleString('zh-CN')}</dd></div>
            </dl>
        `, 'ready');
    }

    function isBusinessAudit(item) {
        const action = item && typeof item.action === 'string' ? item.action.trim() : '';
        const resourceType = item && typeof item.resource_type === 'string' ? item.resource_type.trim() : '';
        return BUSINESS_AUDITS.has(`${action}:${resourceType}`);
    }

    async function loadRecentOverviewAudits(scope) {
        let offset = 0;
        let total = null;
        const business = [];
        for (let pageIndex = 0; pageIndex < OVERVIEW_AUDIT_PAGE_CAP; pageIndex += 1) {
            if (!currentOverview(scope)) throw new Error('recent-audit 读取已失效');
            const payload = overviewAuditPage(await request('/api/admin/audit-logs', {
                params: { limit: OVERVIEW_AUDIT_PAGE_LIMIT, offset },
                signal: scope.signal
            }), offset);
            if (!currentOverview(scope)) throw new Error('recent-audit 读取已失效');
            if (total === null) total = payload.total;
            else if (payload.total !== total) throw new Error('recent-audit 分页总量在读取期间发生变化');
            business.push(...payload.items.filter(isBusinessAudit));
            if (business.length >= 3 || offset + payload.items.length >= total) {
                return { items: business.slice(0, 3), total: Math.min(3, business.length), limit: OVERVIEW_AUDIT_PAGE_LIMIT, offset: 0 };
            }
            offset += payload.items.length;
            if (offset >= OVERVIEW_AUDIT_RECORD_CAP) break;
        }
        if (total !== null && offset < total) throw new Error('recent-audit 超过有界读取上限');
        return { items: business.slice(0, 3), total: Math.min(3, business.length), limit: OVERVIEW_AUDIT_PAGE_LIMIT, offset: 0 };
    }

    function renderRecentAuditOverview() {
        const record = overviewRecord('recent-audit');
        if (record.state !== 'ready') return overviewUnavailable('recent-audit', '最近业务审计', 'scroll-text', [record]);
        const items = record.value.items.filter(isBusinessAudit).slice(0, 3);
        const body = items.length
            ? `<ol class="admin-business-audit" data-admin-recent-audit>${items.map((item) => `
                <li>
                    <strong>${escapeHtml(item.action || '未命名业务动作')}</strong>
                    <span>${escapeHtml(item.resource_type || '--')} #${escapeHtml(item.resource_id == null ? '--' : item.resource_id)}</span>
                    <code>${escapeHtml(item.request_id || '无 Request ID')}</code>
                </li>
            `).join('')}</ol>`
            : '<p class="admin-business-summary__state" data-admin-recent-audit-empty>最近记录中没有可展示的业务审计。</p>';
        return overviewCard('recent-audit', '最近业务审计', 'scroll-text', body, 'ready');
    }

    function renderOverview() {
        if (!state.overviewHost) return;
        const records = OVERVIEW_RESOURCES.map((resource) => overviewRecord(resource.id));
        const status = records.some((record) => record.state === 'error')
            ? 'partial'
            : records.every((record) => record.state === 'ready') ? 'ready' : 'loading';
        state.overviewHost.innerHTML = `
            <div class="admin-business-overview" data-admin-business-overview-state="${status}">
                <header class="admin-business-overview__header">
                    <div><span>BUSINESS AUTHORITY</span><h2>业务治理摘要</h2></div>
                    <p>仅展示正式业务 API 的当前权威数据；失败或空态会如实标注。</p>
                </header>
                <div class="admin-summary-grid admin-business-overview__grid">
                    ${renderTeacherApplicationsOverview()}
                    ${renderTotalOverview('pending-relationships', '待审关系', 'user-plus', 'pending-relationships', '当前没有待审关系。')}
                    ${renderTotalOverview('disabled-accounts', '停用账号', 'user-x', 'disabled-accounts', '当前没有停用账号。')}
                    ${renderOrganizationOverview('schools', '学校', 'active-schools', 'archived-schools')}
                    ${renderOrganizationOverview('classes', '班级', 'active-classes', 'archived-classes')}
                    ${renderCourseOverview()}
                    ${renderRecentAuditOverview()}
                </div>
            </div>
        `;
        refreshIcons();
    }

    async function loadOverview(options) {
        if (!state.host || !state.overviewHost) return false;
        const force = Boolean(options && options.force);
        if (state.overviewLoaded && !force) {
            renderOverview();
            return true;
        }
        const scope = beginOverview();
        state.overviewData = Object.create(null);
        state.overviewErrors = Object.create(null);
        renderOverview();
        const settled = await Promise.allSettled(OVERVIEW_RESOURCES.map((resource) => (
            resource.type === 'audit'
                ? loadRecentOverviewAudits(scope)
                : request(resource.path, { params: resource.params, signal: scope.signal })
        )));
        if (!currentOverview(scope)) return false;
        settled.forEach((result, index) => {
            const resource = OVERVIEW_RESOURCES[index];
            if (result.status === 'fulfilled' && overviewPayloadValid(resource, result.value)) {
                state.overviewData[resource.id] = result.value;
            } else {
                state.overviewErrors[resource.id] = result.status === 'rejected'
                    ? result.reason
                    : new Error(`${resource.id} 响应结构无效`);
            }
        });
        state.overviewLoaded = Object.keys(state.overviewErrors).length === 0;
        renderOverview();
        return state.overviewLoaded;
    }

    function invalidateOverview(renderAfter) {
        if (state.overviewController && !state.overviewController.signal.aborted) {
            state.overviewController.abort();
        }
        state.overviewController = null;
        state.overviewGeneration += 1;
        state.overviewLoaded = false;
        state.overviewData = Object.create(null);
        state.overviewErrors = Object.create(null);
        if (renderAfter && state.overviewHost) renderOverview();
        return true;
    }

    function refreshIcons() {
        if (state.context && typeof state.context.refreshIcons === 'function') {
            state.context.refreshIcons();
        }
    }

    function schedule(callback) {
        const id = global.requestAnimationFrame(() => {
            state.rafIds.delete(id);
            if (state.host) callback();
        });
        state.rafIds.add(id);
    }

    function summaryFields(item) {
        if (!item || typeof item !== 'object') return [];
        const preferred = [
            'id', 'title', 'target_slug', 'status', 'source_host', 'run_key',
            'event_code', 'severity', 'category', 'updated_at', 'created_at'
        ];
        return preferred
            .filter((key) => item[key] !== undefined && item[key] !== null && item[key] !== '')
            .slice(0, 6)
            .map((key) => [key, typeof item[key] === 'object' ? '[结构化摘要]' : String(item[key])]);
    }

    function teacherApplicationCards(payload) {
        const items = list(payload);
        const pending = state.pendingTeacherReview;
        const disabled = state.teacherReviewBusy ? ' disabled' : '';
        return `<article class="admin-secondary-resource admin-teacher-applications" data-admin-secondary-resource="teacher-applications">
            <header><h3>待审教师申请</h3><span>${Number(payload && payload.total == null ? items.length : payload.total || 0).toLocaleString('zh-CN')} 条</span></header>
            ${state.teacherReviewMessage ? `<div class="admin-teacher-review-message admin-teacher-review-message--${escapeHtml(state.teacherReviewMessage.type || 'info')}" role="status">${escapeHtml(state.teacherReviewMessage.text)}</div>` : ''}
            ${items.length ? `<div class="admin-teacher-application-list">${items.map((item) => {
                const applicationId = Number(item.id);
                const confirmation = pending && pending.id === applicationId ? pending.decision : '';
                const note = pending && pending.id === applicationId ? pending.note : '';
                return `<article class="admin-teacher-application-card" data-admin-teacher-application="${applicationId}">
                    <header>
                        <div><strong>${escapeHtml(item.applicant_display_name || item.applicant_username || '未命名申请者')}</strong><span>@${escapeHtml(item.applicant_username || '--')} · #${applicationId}</span></div>
                        <span class="admin-status-pill admin-status-pill--warn">${escapeHtml(item.status || 'pending')}</span>
                    </header>
                    <p>${escapeHtml(item.message || '申请者未填写补充说明。')}</p>
                    <small>提交于 ${escapeHtml(new Date(item.created_at).toLocaleString('zh-CN'))}</small>
                    <label>审核说明<input type="text" maxlength="1000" data-admin-teacher-review-note="${applicationId}" value="${escapeHtml(note)}" placeholder="拒绝时建议说明原因"${disabled}></label>
                    <div class="admin-teacher-application-card__actions">
                        <button type="button" class="admin-icon-button${confirmation === 'approved' ? ' admin-icon-button--confirming' : ''}" data-admin-teacher-review="${applicationId}" data-decision="approved"${disabled}><i data-lucide="badge-check"></i><span>${confirmation === 'approved' ? '再次确认批准' : '批准'}</span></button>
                        <button type="button" class="admin-icon-button admin-icon-button--danger${confirmation === 'rejected' ? ' admin-icon-button--confirming' : ''}" data-admin-teacher-review="${applicationId}" data-decision="rejected"${disabled}><i data-lucide="badge-x"></i><span>${confirmation === 'rejected' ? '再次确认拒绝' : '拒绝'}</span></button>
                    </div>
                </article>`;
            }).join('')}</div>` : '<p class="admin-empty">当前没有待审教师申请</p>'}
        </article>`;
    }

    function renderResource(resource) {
        const error = state.errors[resource.id];
        const payload = state.data[resource.id];
        if (error) {
            return `<article class="admin-secondary-resource">
                <h3>${escapeHtml(resource.label)}</h3>
                <div class="admin-error"><strong>读取失败</strong><span>${escapeHtml(global.AstraApiClient.message(error))}</span></div>
            </article>`;
        }
        if (!payload) {
            return `<article class="admin-secondary-resource">
                <h3>${escapeHtml(resource.label)}</h3>
                <div class="admin-loading"><i data-lucide="loader-circle"></i><span>按需读取中</span></div>
            </article>`;
        }
        if (resource.id === 'teacher-applications') return teacherApplicationCards(payload);
        const items = list(payload);
        return `<article class="admin-secondary-resource" data-admin-secondary-resource="${resource.id}">
            <header><h3>${escapeHtml(resource.label)}</h3><span>${Number(payload.total == null ? items.length : payload.total).toLocaleString('zh-CN')} 条</span></header>
            ${items.length ? `<div class="admin-secondary-items">${items.slice(0, 10).map((item) => `
                <dl>${summaryFields(item).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
            `).join('')}</div>` : '<p class="admin-empty">暂无记录</p>'}
        </article>`;
    }

    function render() {
        if (!state.host) return;
        const group = GROUPS[state.activeGroup] || GROUPS.more;
        state.host.innerHTML = `
            <dialog class="admin-secondary-dialog" data-admin-secondary-dialog aria-labelledby="admin-secondary-title">
                <header class="admin-secondary-dialog__header">
                    <div><span>SECONDARY GOVERNANCE</span><h2 id="admin-secondary-title">${escapeHtml(group.label)}</h2></div>
                    <button type="button" class="admin-icon-button admin-icon-button--compact" data-admin-secondary-close aria-label="关闭${escapeHtml(group.label)}"${state.teacherReviewBusy ? ' disabled' : ''}><i data-lucide="x"></i></button>
                </header>
                <p>${escapeHtml(group.description)}</p>
                <div class="admin-secondary-tabs" role="tablist" aria-label="次级治理类别">
                    ${Object.entries(GROUPS).map(([id, config]) => `
                        <button type="button" role="tab" data-admin-secondary-tab="${id}" aria-selected="${id === state.activeGroup ? 'true' : 'false'}" tabindex="${id === state.activeGroup ? '0' : '-1'}">${escapeHtml(config.label)}</button>
                    `).join('')}
                </div>
                <section class="admin-secondary-content" data-admin-secondary-content>
                    ${group.resources.map(renderResource).join('')}
                </section>
            </dialog>
        `;
        state.dialog = state.host.querySelector('[data-admin-secondary-dialog]');
        refreshIcons();
    }

    async function loadGroup(groupId, force) {
        const group = GROUPS[groupId];
        if (!group) return false;
        if (state.loaded.has(groupId) && !force) {
            render();
            openDialog(false);
            return true;
        }
        const scope = begin();
        group.resources.forEach((resource) => {
            delete state.data[resource.id];
            delete state.errors[resource.id];
        });
        render();
        openDialog(false);
        const settled = await Promise.allSettled(group.resources.map((resource) => (
            request(resourcePath(resource), {
                params: Object.assign({ limit: 10, offset: 0 }, resource.params || {}),
                signal: scope.signal
            })
        )));
        if (!current(scope)) return false;
        settled.forEach((result, index) => {
            const id = group.resources[index].id;
            if (result.status === 'fulfilled') state.data[id] = result.value;
            else state.errors[id] = result.reason;
        });
        if (settled.every((result) => result.status === 'fulfilled')) state.loaded.add(groupId);
        render();
        openDialog(false);
        return settled.every((result) => result.status === 'fulfilled');
    }

    function openDialog(focusTitle) {
        if (!state.dialog) return;
        if (!state.dialog.open) {
            if (typeof state.dialog.showModal === 'function') state.dialog.showModal();
            else state.dialog.setAttribute('open', '');
        }
        if (focusTitle !== false) {
            schedule(() => {
                const title = state.dialog && state.dialog.querySelector('#admin-secondary-title');
                if (title) {
                    title.tabIndex = -1;
                    title.focus();
                }
            });
        }
    }

    function open(groupId, trigger) {
        if (!GROUPS[groupId] || !state.host) return false;
        state.activeGroup = groupId;
        state.trigger = trigger || null;
        render();
        openDialog(true);
        loadGroup(groupId, false);
        return true;
    }

    function close() {
        if (state.teacherReviewBusy) return false;
        if (state.controller && !state.controller.signal.aborted) state.controller.abort();
        state.controller = null;
        state.generation += 1;
        state.pendingTeacherReview = null;
        state.teacherReviewMessage = null;
        if (state.dialog && state.dialog.open) state.dialog.close();
        else if (state.dialog) state.dialog.removeAttribute('open');
        const trigger = state.trigger;
        state.trigger = null;
        if (trigger && trigger.isConnected) schedule(() => trigger.focus());
        return true;
    }

    async function reviewTeacherApplication(button) {
        if (state.teacherReviewBusy) return false;
        const applicationId = Number(button && button.dataset.adminTeacherReview);
        const decision = String(button && button.dataset.decision || '');
        if (!Number.isInteger(applicationId) || applicationId <= 0 || !['approved', 'rejected'].includes(decision)) {
            state.teacherReviewMessage = { type: 'error', text: '教师申请审核参数无效。' };
            render();
            openDialog(false);
            return false;
        }
        const card = button.closest('[data-admin-teacher-application]');
        const noteInput = card && card.querySelector(`[data-admin-teacher-review-note="${applicationId}"]`);
        const note = String(noteInput && noteInput.value || '').trim();
        const pending = state.pendingTeacherReview;
        if (!pending || pending.id !== applicationId || pending.decision !== decision) {
            state.pendingTeacherReview = { id: applicationId, decision, note };
            state.teacherReviewMessage = {
                type: 'warning',
                text: decision === 'approved'
                    ? '请再次点击“批准”，确认将该账号升级为教师。'
                    : '请再次点击“拒绝”，确认退回本次申请。'
            };
            render();
            openDialog(false);
            return false;
        }

        state.teacherReviewBusy = true;
        state.teacherReviewMessage = { type: 'info', text: '正在提交审核结果…' };
        render();
        openDialog(false);
        try {
            await request(`/api/v1/admin/teacher-applications/${applicationId}`, {
                method: 'PATCH',
                body: { status: decision, note: note || null }
            });
            state.pendingTeacherReview = null;
            state.teacherReviewMessage = {
                type: 'success',
                text: decision === 'approved' ? '教师身份已批准。' : '教师申请已退回。'
            };
            state.loaded.delete('identity');
            await loadGroup('identity', true);
            invalidateOverview(true);
            await loadOverview({ force: true });
            return true;
        } catch (error) {
            state.teacherReviewMessage = { type: 'error', text: global.AstraApiClient.message(error) };
            return false;
        } finally {
            state.teacherReviewBusy = false;
            render();
            openDialog(false);
        }
    }

    function onClick(event) {
        if (event.target.closest('[data-admin-secondary-close]')) {
            close();
            return;
        }
        const teacherReview = event.target.closest('[data-admin-teacher-review]');
        if (teacherReview) {
            reviewTeacherApplication(teacherReview);
            return;
        }
        const tab = event.target.closest('[data-admin-secondary-tab]');
        if (tab) {
            const groupId = tab.dataset.adminSecondaryTab;
            if (GROUPS[groupId]) {
                state.activeGroup = groupId;
                state.pendingTeacherReview = null;
                state.teacherReviewMessage = null;
                loadGroup(groupId, false);
            }
        }
    }

    function onCancel(event) {
        if (!event.target.closest('[data-admin-secondary-dialog]')) return;
        event.preventDefault();
        close();
    }

    function resetAuthorityContext(renderAfter) {
        invalidateOverview(renderAfter);
        if (state.controller && !state.controller.signal.aborted) state.controller.abort();
        state.controller = null;
        state.generation += 1;
        state.rafIds.forEach((id) => global.cancelAnimationFrame(id));
        state.rafIds.clear();
        if (state.dialog && state.dialog.open) state.dialog.close();
        else if (state.dialog) state.dialog.removeAttribute('open');
        state.dialog = null;
        state.activeGroup = 'more';
        state.loaded.clear();
        state.data = Object.create(null);
        state.errors = Object.create(null);
        state.trigger = null;
        state.pendingTeacherReview = null;
        state.teacherReviewBusy = false;
        state.teacherReviewMessage = null;
        if (renderAfter && state.host) render();
        return true;
    }

    function invalidateContext() {
        return resetAuthorityContext(true);
    }

    function mount(host, context) {
        destroy();
        if (!(host instanceof Element)) return false;
        state.host = host;
        state.context = context || {};
        state.overviewHost = state.context.overviewHost instanceof Element
            ? state.context.overviewHost
            : null;
        state.clickHandler = onClick;
        state.cancelHandler = onCancel;
        host.addEventListener('click', state.clickHandler);
        host.addEventListener('cancel', state.cancelHandler, true);
        render();
        renderOverview();
        return true;
    }

    function destroy() {
        resetAuthorityContext(false);
        if (state.host) {
            if (state.clickHandler) state.host.removeEventListener('click', state.clickHandler);
            if (state.cancelHandler) state.host.removeEventListener('cancel', state.cancelHandler, true);
        }
        state.host = null;
        state.context = null;
        state.dialog = null;
        state.overviewHost = null;
        state.clickHandler = null;
        state.cancelHandler = null;
    }

    global.AdminSecondaryGovernance = Object.freeze({
        mount,
        open,
        close,
        loadOverview,
        invalidateOverview,
        invalidateContext,
        validateStatsPayload,
        destroy,
        snapshot: () => Object.freeze({
            activeGroup: state.activeGroup,
            loadedGroups: Object.freeze(Array.from(state.loaded)),
            dataKeys: Object.freeze(Object.keys(state.data)),
            generation: state.generation,
            dialogOpen: Boolean(state.dialog && state.dialog.open),
            overviewLoaded: state.overviewLoaded,
            overviewDataKeys: Object.freeze(Object.keys(state.overviewData)),
            overviewGeneration: state.overviewGeneration
        }),
        contract: Object.freeze({
            groups: () => Object.fromEntries(Object.entries(GROUPS).map(([id, group]) => [
                id,
                group.resources.map((resource) => resourcePath(resource))
            ])),
            overviewResources: () => OVERVIEW_RESOURCES.map((resource) => ({
                id: resource.id,
                path: resource.path,
                params: resource.params || null
            })),
            isBusinessAudit,
            overviewAuditPage,
            loadRecentOverviewAudits,
            validateStatsPayload
        })
    });
})(window);
