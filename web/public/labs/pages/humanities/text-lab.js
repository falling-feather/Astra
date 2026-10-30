// ===== Humanities Text Lab: terms, context, and co-occurrence =====

(function () {
    const SAMPLES = {
        learning: {
            label: '学习札记',
            note: '课堂练习文本',
            text: [
                '学习不是一次记住所有知识，而是在问题、解释和练习之间往返。',
                '当一个概念反复出现时，先看它连接了哪些例子，再判断它在文本中的作用。',
                '好的笔记会保留疑问，也会记录证据、条件和新的阅读方向。'
            ],
            prompts: {
                observe: '哪些词反复连接到“学习”和“知识”？',
                reflect: '重复出现的词是在定义概念，还是在组织学习过程？',
                question: '换一段文本后，词项关系是否仍然保持相同？'
            }
        },
        city: {
            label: '城市水利',
            note: '说明练习文本',
            text: [
                '城市沿河而建，河流提供交通、水源和市场联系，也带来洪水与淤积压力。',
                '修渠、筑堤和设置闸门能够改变水流路径，却需要长期维护与共同协作。',
                '阅读这类材料时，应同时关注自然条件、工程选择和居民生活之间的关系。'
            ],
            prompts: {
                observe: '“河流”“城市”“工程”分别和哪些词同句出现？',
                reflect: '文本把水利描述成自然问题、技术问题，还是社会协作问题？',
                question: '若换成真实地方志，需要补充哪些年代、地点和作者信息？'
            }
        },
        primary: {
            label: '史料方法',
            note: '仿写练习文本',
            text: [
                '一段史料常常同时包含事实记录、作者立场和时代语言。',
                '先观察文本写了什么，再追问谁在记录、为何记录、给谁阅读。',
                '数字图表可以提示词项分布，但解释仍要回到原文、背景和其他材料。'
            ],
            prompts: {
                observe: '文本中哪些词指向材料本身，哪些词指向解释过程？',
                reflect: '作者、读者和时代背景会怎样影响同一词语的意义？',
                question: '如果只看高频词，会遗漏哪些句子中的限定条件？'
            }
        }
    };

    const STOPWORDS = new Set([
        '的', '了', '和', '与', '在', '是', '也', '而', '不', '先', '再', '会', '它', '其',
        '一个', '一些', '这类', '同一', '哪些', '可以', '能够', '需要', '仍然', '之间',
        '同时', '当', '时', '后', '中', '里', '把', '给', '更', '从', '到', '为', '或'
    ]);

    const LEXICON = [
        '学习', '知识', '问题', '解释', '练习', '概念', '文本', '证据', '条件', '阅读方向',
        '例子', '作用', '笔记', '疑问', '城市', '河流', '交通', '水源', '市场', '洪水',
        '淤积', '压力', '修渠', '筑堤', '闸门', '水流', '路径', '维护', '协作', '工程',
        '自然条件', '居民生活', '材料', '史料', '事实记录', '作者', '立场', '时代语言',
        '观察', '追问', '记录', '读者', '数字图表', '词项', '分布', '原文', '背景',
        '其他材料', '限定条件', '关系', '方向'
    ].sort((a, b) => b.length - a.length);

    const MODES = {
        terms: '词项分布',
        contexts: '上下文',
        network: '共现网络'
    };

    const HumanitiesLab = {
        canvas: null,
        ctx: null,
        infoRoot: null,
        focusRoot: null,
        sampleButtons: [],
        modeButtons: [],
        thresholdInput: null,
        thresholdValue: null,
        sampleId: 'primary',
        mode: 'terms',
        focusTerm: '',
        connectionThreshold: 1,
        dpr: 1,
        _boundResize: null,

        init() {
            this.canvas = document.getElementById('humanities-canvas');
            if (!this.canvas) return;
            this.ctx = typeof this.canvas.getContext === 'function'
                ? this.canvas.getContext('2d')
                : null;
            this.infoRoot = document.getElementById('humanities-info');
            this.focusRoot = document.getElementById('humanities-focus-list');
            this.sampleButtons = Array.from(document.querySelectorAll('[data-humanities-sample]'));
            this.modeButtons = Array.from(document.querySelectorAll('[data-humanities-mode]'));
            this.thresholdInput = document.getElementById('humanities-threshold');
            this.thresholdValue = document.getElementById('humanities-threshold-value');
            this._bindControls();
            if (!this._boundResize) this._boundResize = () => this.render();
            window.addEventListener('resize', this._boundResize);
            this.render();
        },

        destroy() {
            if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        },

        render() {
            const model = this._buildModel();
            if (!model.topTerms.some(item => item.term === this.focusTerm)) {
                this.focusTerm = model.topTerms[0] ? model.topTerms[0].term : '';
            }
            this._syncControls(model);
            if (this.canvas && this.ctx) {
                this._resizeCanvas();
                this._draw(model);
            }
            this._updateInfo(model);
        },

        _bindControls() {
            this.sampleButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.sampleId = button.dataset.humanitiesSample || 'primary';
                    this.focusTerm = '';
                    this.render();
                });
            });

            this.modeButtons.forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.mode = button.dataset.humanitiesMode || 'terms';
                    this.render();
                });
            });

            if (this.thresholdInput && !this.thresholdInput.dataset.bound) {
                this.thresholdInput.dataset.bound = 'true';
                this.thresholdInput.addEventListener('input', () => {
                    this.connectionThreshold = Math.max(1, Math.min(3, Number(this.thresholdInput.value) || 1));
                    this.render();
                });
            }
        },

        _bindFocusButtons() {
            if (!this.focusRoot) return;
            Array.from(this.focusRoot.querySelectorAll('[data-humanities-focus]')).forEach(button => {
                if (button.dataset.bound) return;
                button.dataset.bound = 'true';
                button.addEventListener('click', () => {
                    this.focusTerm = button.dataset.humanitiesFocus || this.focusTerm;
                    this.render();
                });
            });
        },

        _syncControls(model) {
            this.sampleButtons.forEach(button => {
                const active = button.dataset.humanitiesSample === this.sampleId;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            this.modeButtons.forEach(button => {
                const active = button.dataset.humanitiesMode === this.mode;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            if (this.thresholdInput) this.thresholdInput.value = String(this.connectionThreshold);
            if (this.thresholdValue) this.thresholdValue.textContent = `${this.connectionThreshold} 次`;

            if (this.focusRoot) {
                this.focusRoot.innerHTML = model.topTerms.slice(0, 6).map(item => {
                    const active = item.term === this.focusTerm;
                    return `<button type="button" data-humanities-focus="${this._escapeHtml(item.term)}" class="${active ? 'is-active' : ''}" aria-pressed="${active}">${this._escapeHtml(item.term)} · ${item.count}</button>`;
                }).join('');
                this._bindFocusButtons();
            }
        },

        _buildModel() {
            const sample = SAMPLES[this.sampleId] || SAMPLES.primary;
            const sentences = sample.text.slice();
            const sentenceTokens = sentences.map(sentence => this._tokens(sentence));
            const counts = new Map();
            const positions = new Map();

            sentenceTokens.forEach((tokens, sentenceIndex) => {
                tokens.forEach((token, tokenIndex) => {
                    counts.set(token, (counts.get(token) || 0) + 1);
                    if (!positions.has(token)) positions.set(token, []);
                    positions.get(token).push({ sentenceIndex, tokenIndex });
                });
            });

            const topTerms = Array.from(counts.entries())
                .map(([term, count]) => ({ term, count }))
                .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'zh-Hans-CN'))
                .slice(0, 12);

            const allFocus = this.focusTerm || (topTerms[0] && topTerms[0].term) || '';
            const contextSentences = sentences
                .map((sentence, index) => ({ sentence, index }))
                .filter(item => sentenceTokens[item.index].includes(allFocus));

            const coMap = new Map();
            sentenceTokens.forEach(tokens => {
                if (!tokens.includes(allFocus)) return;
                Array.from(new Set(tokens)).forEach(token => {
                    if (token === allFocus) return;
                    coMap.set(token, (coMap.get(token) || 0) + 1);
                });
            });
            const coTerms = Array.from(coMap.entries())
                .map(([term, count]) => ({ term, count }))
                .filter((item) => item.count >= this.connectionThreshold)
                .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'zh-Hans-CN'))
                .slice(0, 8);

            return {
                sample,
                sentences,
                sentenceTokens,
                counts,
                positions,
                topTerms,
                focusTerm: allFocus,
                contextSentences,
                coTerms,
                mode: this.mode,
                connectionThreshold: this.connectionThreshold
            };
        },

        _tokens(text) {
            const normalized = text.replace(/[，。；：、“”‘’（）()？！·]/g, ' ');
            const tokens = [];
            let i = 0;
            while (i < normalized.length) {
                const ch = normalized[i];
                if (/\s/.test(ch)) {
                    i += 1;
                    continue;
                }
                const latin = normalized.slice(i).match(/^[A-Za-z0-9_-]+/);
                if (latin) {
                    tokens.push(latin[0]);
                    i += latin[0].length;
                    continue;
                }
                const match = LEXICON.find(term => normalized.startsWith(term, i));
                if (match) {
                    tokens.push(match);
                    i += match.length;
                    continue;
                }
                if (/[\u4e00-\u9fff]/.test(ch)) tokens.push(ch);
                i += 1;
            }
            return tokens.filter(token => token.length > 1 && !STOPWORDS.has(token));
        },

        _draw(model) {
            const ctx = this.ctx;
            const w = this.canvas.clientWidth;
            const h = this.canvas.clientHeight;
            ctx.clearRect(0, 0, w, h);

            const compact = w < 720;
            const leftBox = compact
                ? { x: 28, y: 28, w: w - 56, h: Math.max(150, h * 0.3) }
                : { x: 42, y: 42, w: Math.max(250, w * 0.34), h: h - 84 };
            const rightTop = compact
                ? { x: 28, y: leftBox.y + leftBox.h + 24, w: w - 56, h: Math.max(138, h * 0.26) }
                : { x: leftBox.x + leftBox.w + 34, y: 42, w: w - leftBox.x - leftBox.w - 76, h: Math.max(218, h * 0.44) };
            const rightBottom = compact
                ? { x: 28, y: rightTop.y + rightTop.h + 24, w: w - 56, h: Math.max(112, h - rightTop.y - rightTop.h - 56) }
                : { x: rightTop.x, y: rightTop.y + rightTop.h + 30, w: rightTop.w, h: h - rightTop.y - rightTop.h - 72 };

            this._drawPanel(ctx, leftBox, model.sample.label, model.sample.note);
            this._drawTermBars(ctx, leftBox, model);

            this._drawPanel(ctx, rightTop, MODES[model.mode] || MODES.terms, model.focusTerm || 'term');
            if (model.mode === 'contexts') {
                this._drawContextLanes(ctx, rightTop, model);
            } else if (model.mode === 'network') {
                this._drawNetwork(ctx, rightTop, model);
            } else {
                this._drawArcMap(ctx, rightTop, model);
            }

            this._drawPanel(ctx, rightBottom, '观察 · 反思 · 提问', 'close reading');
            this._drawPromptPanel(ctx, rightBottom, model);
        },

        _drawPanel(ctx, box, title, tag) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.035)';
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            this._roundRect(ctx, box.x, box.y, box.w, box.h, 8);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(220,228,238,0.82)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText(title, box.x + 16, box.y + 24);
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(126,215,193,0.9)';
            ctx.fillText(tag, box.x + box.w - 16, box.y + 24);
            ctx.restore();
        },

        _drawTermBars(ctx, box, model) {
            const items = model.topTerms.slice(0, 8);
            const max = Math.max(1, ...items.map(item => item.count));
            const x = box.x + 22;
            const y = box.y + 52;
            const width = box.w - 44;
            const rowH = Math.max(24, Math.min(34, (box.h - 86) / Math.max(1, items.length)));

            ctx.save();
            items.forEach((item, index) => {
                const yy = y + index * rowH;
                const active = item.term === model.focusTerm;
                ctx.fillStyle = active ? 'rgba(126,215,193,0.16)' : 'rgba(255,255,255,0.035)';
                this._roundRect(ctx, x, yy, width, Math.max(18, rowH - 8), 6);
                ctx.fill();
                ctx.fillStyle = active ? '#7ed7c1' : 'rgba(238,241,248,0.88)';
                ctx.font = `${active ? 600 : 500} 13px ${this._fontSans()}`;
                ctx.textAlign = 'left';
                ctx.fillText(item.term, x + 10, yy + rowH * 0.5 + 4);
                ctx.fillStyle = active ? 'rgba(126,215,193,0.84)' : 'rgba(224,181,106,0.72)';
                const barW = Math.max(18, (width - 112) * (item.count / max));
                this._roundRect(ctx, x + 86, yy + rowH * 0.5 - 4, barW, 8, 5);
                ctx.fill();
                ctx.fillStyle = 'rgba(166,176,192,0.86)';
                ctx.font = `11px ${this._fontMono()}`;
                ctx.textAlign = 'right';
                ctx.fillText(String(item.count), x + width - 10, yy + rowH * 0.5 + 4);
            });
            ctx.fillStyle = 'rgba(166,176,192,0.84)';
            ctx.font = `11px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText('词频是数量线索；语境、体裁和出处仍要回读。', x, box.y + box.h - 22);
            ctx.restore();
        },

        _drawArcMap(ctx, box, model) {
            const tokens = model.sentenceTokens.flat();
            const focus = model.focusTerm;
            const usable = tokens.slice(0, 42);
            const baseY = box.y + box.h * 0.66;
            const startX = box.x + 26;
            const endX = box.x + box.w - 26;
            const step = usable.length > 1 ? (endX - startX) / (usable.length - 1) : 1;

            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.13)';
            ctx.beginPath();
            ctx.moveTo(startX, baseY);
            ctx.lineTo(endX, baseY);
            ctx.stroke();

            usable.forEach((token, index) => {
                const x = startX + step * index;
                const active = token === focus;
                ctx.beginPath();
                ctx.arc(x, baseY, active ? 5 : 3, 0, Math.PI * 2);
                ctx.fillStyle = active ? '#7ed7c1' : 'rgba(224,181,106,0.58)';
                ctx.fill();
            });

            const focusIndexes = usable.map((token, index) => token === focus ? index : -1).filter(index => index >= 0);
            focusIndexes.forEach((from, i) => {
                const to = focusIndexes[i + 1];
                if (to === undefined) return;
                const x1 = startX + step * from;
                const x2 = startX + step * to;
                const mid = (x1 + x2) / 2;
                const height = Math.max(18, Math.min(86, (to - from) * 7));
                ctx.beginPath();
                ctx.moveTo(x1, baseY);
                ctx.quadraticCurveTo(mid, baseY - height, x2, baseY);
                ctx.strokeStyle = 'rgba(126,215,193,0.52)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });

            ctx.fillStyle = 'rgba(238,241,248,0.88)';
            ctx.font = `15px ${this._fontDisplay()}`;
            ctx.textAlign = 'left';
            ctx.fillText(`“${focus}”在文本中的回读位置`, box.x + 24, box.y + 58);
            ctx.fillStyle = 'rgba(166,176,192,0.88)';
            ctx.font = `12px ${this._fontMono()}`;
            ctx.fillText(`共 ${focusIndexes.length} 处；间距可提示段落节奏`, box.x + 24, box.y + 82);
            ctx.restore();
        },

        _drawContextLanes(ctx, box, model) {
            const rows = model.sentences;
            const maxLen = Math.max(1, ...rows.map(row => row.length));
            const laneX = box.x + 24;
            const laneY = box.y + 58;
            const laneW = box.w - 48;
            const laneH = Math.max(28, (box.h - 94) / rows.length);

            ctx.save();
            rows.forEach((sentence, index) => {
                const y = laneY + index * laneH;
                const hasFocus = model.sentenceTokens[index].includes(model.focusTerm);
                ctx.fillStyle = hasFocus ? 'rgba(126,215,193,0.13)' : 'rgba(255,255,255,0.035)';
                this._roundRect(ctx, laneX, y, laneW, laneH - 8, 7);
                ctx.fill();
                ctx.fillStyle = hasFocus ? '#7ed7c1' : 'rgba(166,176,192,0.9)';
                ctx.font = `11px ${this._fontMono()}`;
                ctx.fillText(`S${index + 1}`, laneX + 10, y + 18);
                ctx.fillStyle = 'rgba(224,181,106,0.72)';
                this._roundRect(ctx, laneX + 44, y + 10, Math.max(24, (laneW - 68) * (sentence.length / maxLen)), 8, 5);
                ctx.fill();
                ctx.fillStyle = 'rgba(238,241,248,0.86)';
                ctx.font = `12px ${this._fontSans()}`;
                this._truncateText(ctx, sentence, laneX + 44, y + laneH - 14, laneW - 60);
            });
            ctx.restore();
        },

        _drawNetwork(ctx, box, model) {
            const cx = box.x + box.w * 0.5;
            const cy = box.y + box.h * 0.54;
            const radius = Math.min(box.w, box.h) * 0.28;
            const terms = model.coTerms.length
                ? model.coTerms
                : model.connectionThreshold > 1
                    ? []
                    : model.topTerms.filter(item => item.term !== model.focusTerm).slice(0, 6);

            ctx.save();
            ctx.fillStyle = 'rgba(126,215,193,0.14)';
            ctx.beginPath();
            ctx.arc(cx, cy, 28, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(126,215,193,0.58)';
            ctx.stroke();
            ctx.fillStyle = '#eafdf8';
            ctx.font = `600 14px ${this._fontSans()}`;
            ctx.textAlign = 'center';
            ctx.fillText(model.focusTerm, cx, cy + 5);

            terms.forEach((item, index) => {
                const angle = -Math.PI / 2 + (index / Math.max(1, terms.length)) * Math.PI * 2;
                const x = cx + Math.cos(angle) * radius;
                const y = cy + Math.sin(angle) * radius * 0.72;
                const strength = Math.min(1, item.count / Math.max(1, terms[0].count || 1));
                ctx.strokeStyle = `rgba(224,181,106,${0.22 + strength * 0.42})`;
                ctx.lineWidth = 1 + strength * 2;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(x, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 14 + strength * 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(224,181,106,0.14)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(224,181,106,0.54)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = 'rgba(238,241,248,0.9)';
                ctx.font = `12px ${this._fontSans()}`;
                ctx.fillText(item.term, x, y + 4);
            });

            ctx.fillStyle = 'rgba(166,176,192,0.88)';
            ctx.font = `11px ${this._fontMono()}`;
            ctx.textAlign = 'left';
            ctx.fillText('连线表示近邻共现，不直接证明因果或作者意图。', box.x + 24, box.y + box.h - 24);
            ctx.restore();
        },

        _drawPromptPanel(ctx, box, model) {
            const prompts = [
                ['观察', model.sample.prompts.observe, '#7ed7c1'],
                ['反思', model.sample.prompts.reflect, '#e0b56a'],
                ['提问', model.sample.prompts.question, '#8aa7ff']
            ];
            const x = box.x + 24;
            let y = box.y + 58;

            ctx.save();
            prompts.forEach(([label, body, color]) => {
                ctx.fillStyle = color;
                ctx.font = `12px ${this._fontMono()}`;
                ctx.fillText(label, x, y);
                ctx.fillStyle = 'rgba(238,241,248,0.88)';
                ctx.font = `13px ${this._fontSans()}`;
                y = this._wrapText(ctx, body, x + 48, y, box.w - 78, 18, 2) + 12;
            });

            ctx.fillStyle = 'rgba(166,176,192,0.86)';
            ctx.font = `11px ${this._fontMono()}`;
            ctx.fillText('先观察图形线索，再回到原文、出处和同类材料。', x, box.y + box.h - 22);
            ctx.restore();
        },

        _updateInfo(model) {
            if (!this.infoRoot) return;
            const focusCount = model.counts.get(model.focusTerm) || 0;
            const contextText = model.contextSentences.length
                ? model.contextSentences.map(item => `S${item.index + 1}`).join('、')
                : '未在句子中出现';
            const topList = model.topTerms.slice(0, 4).map(item => `${item.term}(${item.count})`).join(' · ');
            const coList = model.coTerms.length
                ? model.coTerms.slice(0, 4).map(item => `${item.term}(${item.count})`).join(' · ')
                : '暂无明显同句词项';
            const method = this._methodHint(model);

            this.infoRoot.innerHTML = `
                <div class="humanities-panel">
                    <span class="humanities-panel__label">证据阈值</span>
                    <strong>至少 ${model.connectionThreshold} 次共现</strong>
                    <p>提高阈值会移除较弱连接；它检验证据强度，不会把留下的连接变成因果关系。</p>
                </div>
                <div class="humanities-panel">
                    <span class="humanities-panel__label">词项分布</span>
                    <strong>${this._escapeHtml(topList || '暂无词项')}</strong>
                    <p>词频显示某词出现多少次；它保留数量线索，但会忽略语序和语气。</p>
                </div>
                <div class="humanities-panel">
                    <span class="humanities-panel__label">回读位置</span>
                    <strong>“${this._escapeHtml(model.focusTerm)}”出现 ${focusCount} 次</strong>
                    <p>关键词上下文把目标词放回左右邻词，适合比较不同句子的用法。关联句子：${this._escapeHtml(contextText)}。</p>
                </div>
                <div class="humanities-panel">
                    <span class="humanities-panel__label">共现线索</span>
                    <strong>${this._escapeHtml(coList)}</strong>
                    <p>共现是近邻线索，不等同于作者意图、主题归因或因果关系。</p>
                </div>
                <div class="humanities-panel">
                    <span class="humanities-panel__label">方法边界</span>
                    <strong>${this._escapeHtml(method.title)}</strong>
                    <p>${this._escapeHtml(method.copy)}</p>
                </div>`;
        },

        _methodHint(model) {
            if (model.mode === 'terms') {
                return {
                    title: '词频不是自动主题',
                    copy: '词频受分词、停用词和语料范围影响；高频词需要回到句子中确认它的具体作用。'
                };
            }
            if (model.mode === 'contexts') {
                return {
                    title: '上下文负责支持解释',
                    copy: '比较同一词在不同句子中的邻近词，再判断它是否在定义概念、组织叙述或表达立场。'
                };
            }
            return {
                title: '共现只说明距离近',
                copy: '连线越密越需要回读原句；同句出现不能直接证明因果、主题或作者意图。'
            };
        },

        _resizeCanvas() {
            const rect = this.canvas.getBoundingClientRect();
            const width = rect.width || this.canvas.offsetWidth || 720;
            const height = rect.height || this.canvas.offsetHeight || 560;
            const dpr = window.devicePixelRatio || 1;
            if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
                this.canvas.width = Math.round(width * dpr);
                this.canvas.height = Math.round(height * dpr);
                this.canvas.style.width = `${width}px`;
                this.canvas.style.height = `${height}px`;
                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        },

        _truncateText(ctx, text, x, y, maxWidth) {
            let value = text;
            while (value.length > 4 && ctx.measureText(value + '...').width > maxWidth) {
                value = value.slice(0, -1);
            }
            ctx.fillText(value.length < text.length ? value + '...' : value, x, y);
        },

        _wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
            let line = '';
            let lineCount = 0;
            for (let i = 0; i < text.length; i += 1) {
                const test = line + text[i];
                if (ctx.measureText(test).width > maxWidth && line) {
                    ctx.fillText(line, x, y);
                    y += lineHeight;
                    line = text[i];
                    lineCount += 1;
                    if (lineCount >= maxLines - 1) break;
                } else {
                    line = test;
                }
            }
            if (line) ctx.fillText(line, x, y);
            return y + lineHeight;
        },

        _roundRect(ctx, x, y, w, h, r) {
            const radius = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.arcTo(x + w, y, x + w, y + h, radius);
            ctx.arcTo(x + w, y + h, x, y + h, radius);
            ctx.arcTo(x, y + h, x, y, radius);
            ctx.arcTo(x, y, x + w, y, radius);
            ctx.closePath();
        },

        _escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        _fontSans() {
            return '"Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif';
        },

        _fontDisplay() {
            return '"Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif';
        },

        _fontMono() {
            return 'Consolas, "SFMono-Regular", "Liberation Mono", monospace';
        }
    };

    window.HumanitiesLab = HumanitiesLab;
    window.initHumanitiesLab = () => HumanitiesLab.init();
    window.destroyHumanitiesLab = () => HumanitiesLab.destroy();
})();
