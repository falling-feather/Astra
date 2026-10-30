// ===== Related Experiments (v4.5-α3) =====
// 在每个实验底部追加 4 张跨学科推荐卡片
// 算法：bigram 重合度（标题 + 描述） + 同学科加权 + 相邻学科加权

const RelatedExperiments = {
    // 学科相邻关系（双向）
    NEIGHBORS: {
        mathematics: ['algorithms', 'physics'],
        physics:     ['mathematics', 'chemistry'],
        chemistry:   ['physics', 'biology'],
        algorithms:  ['mathematics', 'physics'],
        biology:     ['chemistry']
    },
    // 学科色（与 global-search 一致）
    COLORS: {
        mathematics: '#3aa9ff',
        physics:     '#a98aff',
        chemistry:   '#4ade80',
        algorithms:  '#fb923c',
        biology:     '#2dd4bf'
    },

    show(page, moduleId) {
        if (typeof CONFIG === 'undefined' || !CONFIG.experiments) return;
        const exps = CONFIG.experiments[page];
        if (!exps) return;
        const current = exps.find(e => e.id === moduleId);
        if (!current) return;

        const recs = this._recommend(page, current);
        if (!recs.length) return;

        // 找到当前活跃实验的最后一个 section 容器
        const pageEl = document.getElementById(`page-${page}`);
        if (!pageEl) return;
        const sections = pageEl.querySelectorAll(`[data-module="${moduleId}"].module-active`);
        if (!sections.length) return;
        const lastSection = sections[sections.length - 1];

        // 移除旧的推荐面板（若有）
        pageEl.querySelectorAll('.related-experiments').forEach(el => el.remove());

        const panel = document.createElement('section');
        panel.className = 'related-experiments';
        panel.setAttribute('aria-label', '相关实验推荐');
        panel.innerHTML = `
            <div class="related-experiments__header">
                <i data-lucide="sparkles"></i>
                <h3 class="related-experiments__title">相关实验推荐</h3>
                <span class="related-experiments__sub">基于内容关联与学科邻接</span>
            </div>
            <div class="related-experiments__grid">
                ${recs.map(r => this._cardHtml(r)).join('')}
            </div>
        `;
        lastSection.appendChild(panel);

        // 渲染 lucide
        if (typeof lucide !== 'undefined') {
            try { lucide.createIcons({ nameAttr: 'data-lucide' }); } catch (e) {}
        }

        // 绑定点击
        panel.addEventListener('click', (e) => {
            const card = e.target.closest('.related-experiments__card');
            if (!card) return;
            const subj = card.dataset.subject;
            const id = card.dataset.id;
            if (!subj || !id) return;
            if (subj === page) {
                if (typeof ModuleSelector !== 'undefined') ModuleSelector.openModule(subj, id);
            } else {
                location.hash = subj;
                setTimeout(() => {
                    try { if (typeof ModuleSelector !== 'undefined') ModuleSelector.openModule(subj, id); } catch (err) {}
                }, 700);
            }
        });
    },

    _cardHtml(r) {
        const upcoming = r.exp.variant === 'upcoming';
        const color = this.COLORS[r.subjectId] || '#3aa9ff';
        const subjectLabel = (CONFIG.pages && CONFIG.pages[r.subjectId] && CONFIG.pages[r.subjectId].label) || r.subjectId;
        return `<button type="button" class="related-experiments__card" data-subject="${r.subjectId}" data-id="${r.exp.id}" style="--re-color:${color}">
            <span class="related-experiments__icon"><i data-lucide="${r.exp.icon || 'square'}"></i></span>
            <span class="related-experiments__body">
                <span class="related-experiments__name">${this._esc(r.exp.title)}${upcoming ? ' <span class="related-experiments__badge">即将上线</span>' : ''}</span>
                <span class="related-experiments__desc">${this._esc(r.exp.description || '')}</span>
                <span class="related-experiments__tag">${this._esc(subjectLabel)}</span>
            </span>
            <span class="related-experiments__arrow" aria-hidden="true">→</span>
        </button>`;
    },

    _esc(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    },

    _recommend(currentSubject, currentExp) {
        const neighbors = this.NEIGHBORS[currentSubject] || [];
        const currentText = ((currentExp.title || '') + ' ' + (currentExp.description || '')).toLowerCase();
        const currentBigrams = this._bigrams(currentText);

        const candidates = [];
        for (const [subj, list] of Object.entries(CONFIG.experiments)) {
            for (const exp of list) {
                if (subj === currentSubject && exp.id === currentExp.id) continue;
                const text = ((exp.title || '') + ' ' + (exp.description || '')).toLowerCase();
                const bg = this._bigrams(text);
                let overlap = 0;
                for (const k of bg) if (currentBigrams.has(k)) overlap++;
                let score = overlap; // 内容重合
                if (subj === currentSubject) score += 3;       // 同学科加权
                else if (neighbors.includes(subj)) score += 1; // 相邻学科加权
                if (exp.variant === 'upcoming') score -= 1.5;  // 即将上线降权
                candidates.push({ subjectId: subj, exp, score });
            }
        }
        // 排序：score 降序；同分用学科 + id 排稳定
        candidates.sort((a, b) => b.score - a.score || a.exp.id.localeCompare(b.exp.id));
        // 取前 4，但保证至少 1 张跨学科
        const top = [];
        const seenSubj = new Set();
        for (const c of candidates) {
            if (top.length >= 4) break;
            top.push(c);
            seenSubj.add(c.subjectId);
        }
        // 如果全是同学科，强制把第 4 张换成最高分跨学科候选
        if (top.length === 4 && [...seenSubj].every(s => s === currentSubject)) {
            const crossTop = candidates.find(c => c.subjectId !== currentSubject);
            if (crossTop) top[3] = crossTop;
        }
        return top;
    },

    _bigrams(text) {
        const set = new Set();
        const cleaned = text.replace(/\s+/g, '');
        for (let i = 0; i < cleaned.length - 1; i++) {
            set.add(cleaned.slice(i, i + 2));
        }
        return set;
    }
};

if (typeof window !== 'undefined') window.RelatedExperiments = RelatedExperiments;
