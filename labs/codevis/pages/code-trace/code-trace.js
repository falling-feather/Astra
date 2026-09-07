/* ===== Code Trace · 代码执行追踪 (v5.0) =====
 * 纯前端 JS：预先生成 trace 步骤，回放展示。
 * 后续可接 Pyodide / 自研解释器以支持真实代码运行。
 */
(function (global) {
    'use strict';

    // ============== Trace 生成器 ==============
    function traceBubbleSort(input) {
        const arr = input.slice();
        const steps = [];
        const out = [];
        const snap = (line, vars, hi, msg) => steps.push({
            line, vars: Object.assign({ arr: arr.slice() }, vars),
            highlight: hi || {}, msg: msg || '', stdout: out.slice()
        });
        snap(1, { n: arr.length }, {}, '开始排序');
        const n = arr.length;
        for (let i = 0; i < n - 1; i++) {
            snap(2, { i, n }, { i }, `外层循环 i = ${i}`);
            let swapped = false;
            snap(3, { i, swapped, n }, { i }, '');
            for (let j = 0; j < n - i - 1; j++) {
                snap(4, { i, j, swapped, n }, { i, j, j2: j + 1 }, `比较 arr[${j}] 与 arr[${j + 1}]`);
                snap(5, { i, j, swapped, n, 'arr[j]': arr[j], 'arr[j+1]': arr[j + 1] }, { i, j, j2: j + 1 }, '');
                if (arr[j] > arr[j + 1]) {
                    snap(6, { i, j, swapped, n }, { i, j, j2: j + 1, swap: true }, `交换 ${arr[j]} ↔ ${arr[j + 1]}`);
                    const t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
                    swapped = true;
                    snap(7, { i, j, swapped, n }, { i, j, j2: j + 1, swap: true }, '已交换');
                }
            }
            if (!swapped) {
                out.push(`第 ${i + 1} 轮无交换，提前结束`);
                snap(9, { i, swapped, n }, { i }, '提前结束');
                break;
            }
            out.push(`第 ${i + 1} 轮结束 → [${arr.join(', ')}]`);
        }
        snap(10, { n }, {}, '排序完成');
        out.push(`最终: [${arr.join(', ')}]`);
        steps[steps.length - 1].stdout = out.slice();
        return steps;
    }

    function traceBinarySearch(input, target) {
        const arr = input.slice().sort((a, b) => a - b);
        const steps = [];
        const out = [`输入数组（已排序）: [${arr.join(', ')}], 查找 ${target}`];
        const snap = (line, vars, hi, msg) => steps.push({
            line, vars: Object.assign({ arr: arr.slice(), target }, vars),
            highlight: hi || {}, msg: msg || '', stdout: out.slice()
        });
        let lo = 0, hi = arr.length - 1;
        snap(1, { lo, hi }, {}, '初始化 lo, hi');
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            snap(2, { lo, hi, mid }, { i: lo, j: mid, j2: hi }, `mid = ${mid}`);
            snap(3, { lo, hi, mid, 'arr[mid]': arr[mid] }, { i: lo, j: mid, j2: hi }, '');
            if (arr[mid] === target) {
                out.push(`找到 ${target} 在下标 ${mid}`);
                snap(4, { lo, hi, mid }, { j: mid, swap: true }, '命中！');
                steps[steps.length - 1].stdout = out.slice();
                return steps;
            } else if (arr[mid] < target) {
                lo = mid + 1;
                snap(6, { lo, hi, mid }, { i: lo, j: mid, j2: hi }, `arr[mid] < target → lo = mid + 1`);
            } else {
                hi = mid - 1;
                snap(8, { lo, hi, mid }, { i: lo, j: mid, j2: hi }, `arr[mid] > target → hi = mid - 1`);
            }
        }
        out.push(`未找到 ${target}`);
        snap(10, { lo, hi }, {}, '未找到');
        steps[steps.length - 1].stdout = out.slice();
        return steps;
    }

    function traceFib(n) {
        const steps = [];
        const out = [];
        const callStack = [];
        const snap = (line, vars, hi, msg) => steps.push({
            line, vars: Object.assign({ stack: callStack.slice() }, vars),
            highlight: hi || {}, msg: msg || '', stdout: out.slice(), arrOverride: callStack.slice()
        });
        function fib(k, depth) {
            callStack.push(`fib(${k})`);
            snap(2, { k, depth }, {}, `调用 fib(${k})`);
            if (k < 2) {
                snap(3, { k, depth }, { swap: true }, `基线 → 返回 ${k}`);
                callStack.pop();
                return k;
            }
            snap(4, { k, depth }, {}, '');
            const a = fib(k - 1, depth + 1);
            const b = fib(k - 2, depth + 1);
            snap(5, { k, depth, a, b }, { swap: true }, `fib(${k}) = ${a + b}`);
            callStack.pop();
            return a + b;
        }
        const r = fib(n, 0);
        out.push(`fib(${n}) = ${r}`);
        snap(6, { n, result: r }, {}, '完成');
        steps[steps.length - 1].stdout = out.slice();
        return steps;
    }

    // ============== Source 代码（与 trace 的 line 对应） ==============
    const SAMPLES = {
        bubble: {
            label: '冒泡排序',
            input: [5, 2, 8, 1, 9, 3],
            source: [
                'def bubble_sort(arr):',
                '    n = len(arr)',
                '    for i in range(n - 1):',
                '        swapped = False',
                '        for j in range(n - i - 1):',
                '            if arr[j] > arr[j+1]:',
                '                arr[j], arr[j+1] = arr[j+1], arr[j]',
                '                swapped = True',
                '        if not swapped:',
                '            break',
                '    return arr'
            ],
            build: (input) => traceBubbleSort(input)
        },
        binsearch: {
            label: '二分查找',
            input: [1, 3, 5, 7, 9, 11, 13, 15],
            target: 11,
            source: [
                'def binary_search(arr, target):',
                '    lo, hi = 0, len(arr) - 1',
                '    while lo <= hi:',
                '        mid = (lo + hi) // 2',
                '        if arr[mid] == target:',
                '            return mid',
                '        elif arr[mid] < target:',
                '            lo = mid + 1',
                '        else:',
                '            hi = mid - 1',
                '    return -1'
            ],
            build: (input, sample) => traceBinarySearch(input, sample.target)
        },
        fib: {
            label: '斐波那契递归',
            input: 5,
            source: [
                'def fib(n):',
                '    # 计算 fib(n)',
                '    if n < 2:',
                '        return n',
                '    # 递归两次',
                '    return fib(n - 1) + fib(n - 2)'
            ],
            build: (input) => traceFib(input)
        }
    };

    // ============== JS 可运行示例（供 JS-Interpreter 沙箱执行）==============
    const JS_SAMPLES = {
        bubble: `// 冒泡排序·使用 markPtr / markSwap 突出指针
var arr = [5, 2, 8, 1, 9, 3];
var n = arr.length;
print('开始排序', JSON.stringify(arr));
for (var i = 0; i < n - 1; i++) {
  var swapped = false;
  for (var j = 0; j < n - i - 1; j++) {
    markPtr(i, j, j + 1);
    if (arr[j] > arr[j + 1]) {
      var t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
      markSwap();
      swapped = true;
    }
  }
  if (!swapped) break;
}
print('完成', JSON.stringify(arr));`,
        binsearch: `// 二分查找
var arr = [1, 3, 5, 8, 13, 21, 34, 55, 89];
var target = 21;
var lo = 0, hi = arr.length - 1;
while (lo <= hi) {
  var mid = (lo + hi) >> 1;
  markPtr(lo, mid, hi);
  if (arr[mid] === target) { print('找到 index =', mid); break; }
  else if (arr[mid] < target) lo = mid + 1;
  else hi = mid - 1;
}
if (lo > hi) print('未找到');`,
        fib: `// 递归斐波那契
function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
var result = fib(6);
print('fib(6) =', result);`
    };

    // ============== Python 可运行示例（供 Skulpt 执行）==============
    // Python 后端采用 call-site trace：每次调用 markPtr/markSwap/markArray 才记录一帧。
    // 调用 markPtr(i, j, j+1, arr) 可一次性把指针 + 当前数组都推到帧里。
    const PY_SAMPLES = {
        bubble: `# 冒泡排序·call-site trace
arr = [5, 2, 8, 1, 9, 3]
n = len(arr)
markArray(arr)
print('开始排序', arr)
for i in range(n - 1):
    swapped = False
    for j in range(n - i - 1):
        markPtr(i, j, j + 1, arr)
        snap('swapped', swapped)
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]
            swapped = True
            markSwap(arr)
    if not swapped:
        break
markArray(arr)
print('完成', arr)`,
        binsearch: `# 二分查找·call-site trace
arr = [1, 3, 5, 8, 13, 21, 34, 55, 89]
target = 21
markArray(arr)
snap('target', target)
lo, hi = 0, len(arr) - 1
found = False
while lo <= hi:
    mid = (lo + hi) // 2
    markPtr(lo, mid, hi, arr)
    if arr[mid] == target:
        print('找到 index =', mid)
        found = True
        break
    elif arr[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1
if not found:
    print('未找到')`,
        fib: `# 递归斐波那契
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

result = fib(6)
snap('result', result)
print('fib(6) =', result)`
    };

    // ============== C/C++ 可运行示例（供 JSCPP 执行）==============
    // C/C++ 后端采用 prelude + stdout 协议：prelude 会被自动拼接到代码开头，
    // 其中定义了 markPtr / markPtr2 / markSwap / markArray / snapInt 辅助函数。
    // 用户代码不必 #include；请使用 std::cout 输出。
    const CPP_SAMPLES = {
        bubble: `// 冒泡排序·C++ call-site trace
#include <iostream>
using namespace std;
int main() {
    int arr[] = {5, 2, 8, 1, 9, 3};
    int n = 6;
    markArray(arr, n);
    cout << "start" << endl;
    for (int i = 0; i < n - 1; i++) {
        bool swapped = false;
        for (int j = 0; j < n - i - 1; j++) {
            markPtr(i, j, j + 1);
            if (arr[j] > arr[j + 1]) {
                int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
                swapped = true;
                markArray(arr, n);
                markSwap();
            }
        }
        if (!swapped) break;
    }
    markArray(arr, n);
    cout << "done" << endl;
    return 0;
}`,
        binsearch: `// 二分查找·C++ call-site trace
#include <iostream>
using namespace std;
int main() {
    int arr[] = {1, 3, 5, 8, 13, 21, 34, 55, 89};
    int n = 9;
    int target = 21;
    markArray(arr, n);
    snapInt("target", target);
    int lo = 0, hi = n - 1;
    bool found = false;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        markPtr(lo, mid, hi);
        if (arr[mid] == target) {
            cout << "found index = " << mid << endl;
            found = true;
            break;
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (!found) cout << "not found" << endl;
    return 0;
}`,
        fib: `// 递归斐波那契·C++
#include <iostream>
using namespace std;
int fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}
int main() {
    int r = fib(6);
    snapInt("result", r);
    cout << "fib(6) = " << r << endl;
    return 0;
}`
    };

    // ============== Player ==============
    const CodeTrace = {
        _inited: false,
        steps: [],
        sample: 'bubble',
        language: 'demo',
        currentSampleData: null,
        idx: 0,
        playing: false,
        speed: 450,
        _timer: null,
        _statusTimer: null,
        _prevVars: {},

        init() {
            if (!this._inited) {
                this._inited = true;
                this._cacheDOM();
                this._bind();
                this._maybeShowIntro();
                this._applyLanguage(this.language || 'demo');
            }
            this._bindKeyboard();
            this._syncControls();
        },

        destroy() {
            this._stop();
            this._unbindKeyboard();
        },

        _cacheDOM() {
            this.$lang = document.getElementById('code-trace-lang');
            this.$sampleField = document.getElementById('code-trace-sample-field');
            this.$sample = document.getElementById('code-trace-sample');
            this.$run = document.getElementById('code-trace-run');
            this.$editorWrap = document.getElementById('code-trace-editor-wrap');
            this.$editor = document.getElementById('code-trace-editor');
            this.$status = document.getElementById('code-trace-status');
            this.$prev = document.getElementById('code-trace-prev');
            this.$next = document.getElementById('code-trace-next');
            this.$play = document.getElementById('code-trace-play');
            this.$speed = document.getElementById('code-trace-speed');
            this.$source = document.getElementById('code-trace-source');
            this.$vars = document.getElementById('code-trace-vars');
            this.$array = document.getElementById('code-trace-array');
            this.$stdout = document.getElementById('code-trace-stdout');
            this.$seek = document.getElementById('code-trace-seek');
            this.$stepLabel = document.getElementById('code-trace-step-label');
            // v5.1.3 新增
            this.$copy = document.getElementById('code-trace-copy');
            this.$reset = document.getElementById('code-trace-reset');
            this.$timeline = document.getElementById('code-trace-timeline');
        },

        _bind() {
            this.$lang.addEventListener('change', (e) => { this._stop(); this._applyLanguage(e.target.value); });
            this.$sample.addEventListener('change', (e) => {
                this._stop();
                if (this.language === 'demo') this._loadSample(e.target.value);
                else this._loadEditorSample(e.target.value);
            });
            this.$run.addEventListener('click', () => { this._stop(); this._runEditorTrace(); });
            // Ctrl+Enter 在编辑器中也触发运行
            this.$editor.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    this._stop(); this._runEditorTrace();
                }
            });
            this.$prev.addEventListener('click', () => { this._stop(); this._goto(this.idx - 1); });
            this.$next.addEventListener('click', () => { this._stop(); this._goto(this.idx + 1); });
            this.$play.addEventListener('click', () => this.playing ? this._stop() : this._play());
            this.$speed.addEventListener('change', (e) => {
                this.speed = parseInt(e.target.value, 10) || 450;
                if (this.playing) { this._stop(); this._play(); }
            });
            this.$seek.addEventListener('input', (e) => {
                this._stop();
                this._goto(parseInt(e.target.value, 10) || 0);
            });
            // v5.1.2 引导关闭
            const intro = document.getElementById('code-trace-intro');
            const dismiss = document.getElementById('code-trace-intro-dismiss');
            if (dismiss && intro) {
                dismiss.addEventListener('click', () => {
                    intro.hidden = true;
                    try { localStorage.setItem('cv-trace-intro-v1', '1'); } catch (e) { /* noop */ }
                });
            }
            // v5.1.3 复制 / 重置
            if (this.$copy) {
                this.$copy.addEventListener('click', async () => {
                    const code = this.$editor.value || '';
                    try {
                        await navigator.clipboard.writeText(code);
                        this._flashStatus('✓ 已复制代码到剪贴板', 'ok');
                    } catch (e) {
                        this._flashStatus('✕ 复制失败（请手动选中）', 'error');
                    }
                });
            }
            if (this.$reset) {
                this.$reset.addEventListener('click', () => {
                    this._stop();
                    this._loadEditorSample(this.sample);
                    this._flashStatus('↻ 已重置为原始示例代码', 'ok');
                });
            }
            // v5.1.3 面板折叠
            document.querySelectorAll('.code-trace-panel__toggle').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-target');
                    const panel = btn.closest('.code-trace-panel');
                    if (!panel) return;
                    const collapsed = panel.classList.toggle('code-trace-panel--collapsed');
                    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                });
            });
            // V6.1.0-alpha11 滚动时自动收束快捷键提示行
            this._setupShortcutCollapse();
        },

        _setupShortcutCollapse() {
            const shortcut = document.querySelector('.code-trace-shortcut');
            if (!shortcut) return;
            const apply = () => {
                const y = window.scrollY || document.documentElement.scrollTop || 0;
                shortcut.classList.toggle('code-trace-shortcut--collapsed', y > 40);
            };
            let ticking = false;
            window.addEventListener('scroll', () => {
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(() => { apply(); ticking = false; });
            }, { passive: true });
            apply();
        },

        _flashStatus(text, kind) {
            this._setStatus(text, kind);
            clearTimeout(this._statusTimer);
            this._statusTimer = setTimeout(() => { this._setStatus(''); }, 2200);
        },

        _maybeShowIntro() {
            let seen = false;
            try { seen = localStorage.getItem('cv-trace-intro-v1') === '1'; } catch (e) { /* noop */ }
            const intro = document.getElementById('code-trace-intro');
            if (intro && !seen) intro.hidden = false;
        },

        _bindKeyboard() {
            if (this._keyHandler) return;
            this._keyHandler = (e) => {
                // 在输入控件里不抓取（避免干扰代码编辑）
                const tag = (e.target && e.target.tagName) || '';
                if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
                // 仅在 trace 页可见时生效
                const page = document.getElementById('cv-page-trace');
                if (!page || !page.classList.contains('cv-page--active')) return;
                if (e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    this.playing ? this._stop() : this._play();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this._stop(); this._goto(this.idx - 1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this._stop(); this._goto(this.idx + 1);
                }
            };
            window.addEventListener('keydown', this._keyHandler);
        },

        _unbindKeyboard() {
            if (this._keyHandler) {
                window.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }
        },

        _setStatus(text, kind) {
            this.$status.className = 'code-trace-status' + (kind ? ' is-' + kind : '');
            this.$status.textContent = text || '';
        },

        _applyLanguage(lang) {
            this.language = lang;
            if (lang === 'demo') {
                this.$editorWrap.hidden = true;
                this.$editorWrap.setAttribute('aria-hidden', 'true');
                this.$run.hidden = true;
                this._loadSample(this.$sample.value || 'bubble');
            } else if (lang === 'javascript' || lang === 'python' || lang === 'cpp' || lang === 'c') {
                this.$editorWrap.hidden = false;
                this.$editorWrap.removeAttribute('aria-hidden');
                this.$run.hidden = false;
                this._loadEditorSample(this.$sample.value || 'bubble');
            }
            this._syncControls();
        },

        _editorSamplesFor(lang) {
            if (lang === 'python') return PY_SAMPLES;
            if (lang === 'cpp' || lang === 'c') return CPP_SAMPLES;
            return JS_SAMPLES;
        },

        _editorTitleFor(lang) {
            if (lang === 'python') return '# 编辑 Python 代码';
            if (lang === 'cpp') return '// 编辑 C++ 代码';
            if (lang === 'c') return '// 编辑 C 代码';
            return '// 编辑 JavaScript 代码';
        },

        _loadEditorSample(key) {
            const samples = this._editorSamplesFor(this.language);
            const code = samples[key] || samples.bubble;
            this.sample = key;
            this.$editor.value = code;
            // 更新编辑器标题
            const titleEl = this.$editorWrap.querySelector('.code-trace-editor__title');
            if (titleEl) titleEl.textContent = this._editorTitleFor(this.language);
            this._setStatus('已载入示例代码，按「运行追踪」或 Ctrl+Enter 执行。');
            this._renderStaticCode(code);
        },

        _renderStaticCode(code) {
            const lines = code.split('\n');
            this._renderSource(lines);
            this.steps = [];
            this.idx = 0;
            this.$seek.max = '0';
            this.$seek.value = '0';
            this.$seek.style.setProperty('--cv-seek-pct', '0%');
            this.$stepLabel.textContent = '0 / 0';
            this.$vars.innerHTML = '<div class="code-trace-empty">(尚未运行)</div>';
            this.$array.innerHTML = '';
            this.$stdout.textContent = '';
            this._renderTimeline();
            this._syncControls();
        },

        // v5.1.3 关键步骤时间轴
        _renderTimeline() {
            if (!this.$timeline) return;
            this.$timeline.innerHTML = '';
            const steps = this.steps || [];
            const n = steps.length;
            if (n < 2) return;
            const markers = [];
            steps.forEach((st, i) => {
                const hi = st.highlight || {};
                const msg = st.msg || '';
                let kind = null, label = '';
                if (hi.swap === true) {
                    if (/交换|swap/i.test(msg)) { kind = 'swap'; label = '交换'; }
                    else if (/命中|返回|完成|基线|hit|return/i.test(msg)) { kind = 'return'; label = msg || '返回'; }
                    else { kind = 'mark'; label = msg || '标记'; }
                } else if (/提前结束|break/i.test(msg)) {
                    kind = 'break'; label = '提前结束';
                } else if (/完成|done/i.test(msg) && i === n - 1) {
                    kind = 'done'; label = '完成';
                } else if (/外层循环|round|轮/i.test(msg) && /i\s*=\s*0/.test(msg) === false && hi.j === undefined && hi.j2 === undefined) {
                    kind = 'loop'; label = msg;
                }
                if (kind) markers.push({ i, kind, label });
            });
            // 限流：避免过多标记
            const MAX = 24;
            let list = markers;
            if (markers.length > MAX) {
                const stride = Math.ceil(markers.length / MAX);
                list = markers.filter((_, k) => k % stride === 0);
            }
            const frag = document.createDocumentFragment();
            list.forEach((m) => {
                const pct = (m.i / (n - 1)) * 100;
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = `code-trace-timeline__dot code-trace-timeline__dot--${m.kind}`;
                dot.style.left = pct.toFixed(2) + '%';
                dot.title = `第 ${m.i + 1} 步 · ${m.label}`;
                dot.setAttribute('aria-label', dot.title);
                dot.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._stop();
                    this._goto(m.i);
                });
                frag.appendChild(dot);
            });
            this.$timeline.appendChild(frag);
        },

        async _runEditorTrace() {
            const lang = this.language;
            if (!global.CvRuntime || !global.CvRuntime.has(lang)) {
                this._setStatus(`${lang} 运行时尚未就绪（脚本仍在加载？）`, 'error');
                return;
            }
            const code = this.$editor.value;
            this._setStatus('执行中…');
            this.$run.disabled = true;
            const t0 = performance.now();
            const result = await global.CvRuntime.trace({ language: lang, code, maxSteps: 3000 });
            this.$run.disabled = false;
            const ms = (performance.now() - t0).toFixed(0);
            if (result.error) {
                this._setStatus(`✕ ${result.error}（${result.steps.length} 步）`, 'error');
            }
            if (!result.steps.length) {
                this._renderStaticCode(code);
                if (!result.error) this._setStatus('未产生任何步骤（代码可能为空）', 'error');
                return;
            }
            this._prevVars = {};
            this.steps = result.steps;
            this._renderSource(code.split('\n'));
            this.idx = 0;
            this.$seek.max = String(Math.max(0, this.steps.length - 1));
            this.$seek.value = '0';
            this.$seek.style.setProperty('--cv-seek-pct', '0%');
            this._renderTimeline();
            this._renderStep();
            if (!result.error) {
                this._setStatus(`✓ 共 ${this.steps.length} 步 · 用时 ${ms} ms`, 'ok');
            }
        },

        _loadSample(key) {
            const s = SAMPLES[key];
            if (!s) return;
            this.sample = key;
            this.currentSampleData = s;
            this.steps = s.build(s.input, s);
            this.idx = 0;
            this._prevVars = {};
            this._renderSource(s.source);
            this.$seek.max = String(Math.max(0, this.steps.length - 1));
            this.$seek.value = '0';
            this.$seek.style.setProperty('--cv-seek-pct', '0%');
            this._renderTimeline();
            this._renderStep();
        },

        _renderSource(lines) {
            this.$source.innerHTML = lines
                .map((ln) => `<span class="code-trace-line">${this._highlight(ln) || ' '}</span>`)
                .join('');
        },

        _esc(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },

        // 轻量 Python 风格语法高亮（后续接入真实 runtime 后可替换为 prismjs 之类）
        _highlight(line) {
            if (!line) return '';
            const KW = new Set(['def','for','in','if','elif','else','return','while','break','continue','and','or','not','True','False','None','import','from','as','class','pass','lambda','yield','try','except','finally','with','is','global']);
            const BI = new Set(['len','range','print','int','str','list','dict','set','tuple','abs','min','max','sum','sorted','enumerate','map','filter','zip']);
            const out = [];
            const re = /(#[^\n]*)|("[^"\n]*"|'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/%=<>!]=?|==|!=|<=|>=|->)|([\(\)\[\]\{\}:,.])|(\s+)/g;
            let m, last = 0;
            while ((m = re.exec(line)) !== null) {
                if (m.index > last) out.push(this._esc(line.slice(last, m.index)));
                if (m[1]) out.push(`<span class="ct-com">${this._esc(m[1])}</span>`);
                else if (m[2]) out.push(`<span class="ct-str">${this._esc(m[2])}</span>`);
                else if (m[3]) out.push(`<span class="ct-num">${m[3]}</span>`);
                else if (m[4]) {
                    const w = m[4];
                    // 紧跟 ( 视为函数名
                    const after = line[re.lastIndex];
                    if (KW.has(w))       out.push(`<span class="ct-kw">${w}</span>`);
                    else if (BI.has(w))  out.push(`<span class="ct-bi">${w}</span>`);
                    else if (after === '(') out.push(`<span class="ct-fn">${w}</span>`);
                    else                  out.push(this._esc(w));
                }
                else if (m[5]) out.push(`<span class="ct-op">${this._esc(m[5])}</span>`);
                else if (m[6]) out.push(`<span class="ct-punc">${this._esc(m[6])}</span>`);
                else if (m[7]) out.push(m[7]);
                last = re.lastIndex;
            }
            if (last < line.length) out.push(this._esc(line.slice(last)));
            return out.join('');
        },

        _goto(i) {
            if (!this.steps.length) return;
            this.idx = Math.max(0, Math.min(this.steps.length - 1, i));
            this.$seek.value = String(this.idx);
            const pct = this.steps.length > 1 ? (this.idx / (this.steps.length - 1)) * 100 : 0;
            this.$seek.style.setProperty('--cv-seek-pct', pct.toFixed(2) + '%');
            this._renderStep();
            this._syncControls();
        },

        _play() {
            if (!this.steps.length) return;
            this.playing = true;
            this.$play.textContent = '暂停';
            this.$play.setAttribute('aria-pressed', 'true');
            this._syncControls();
            this._timer = setInterval(() => {
                if (this.idx >= this.steps.length - 1) { this._stop(); return; }
                this._goto(this.idx + 1);
            }, this.speed);
        },

        _stop() {
            this.playing = false;
            this.$play.textContent = '播放';
            this.$play.setAttribute('aria-pressed', 'false');
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            this._syncControls();
        },

        _renderStep() {
            const step = this.steps[this.idx];
            if (!step) { this._syncControls(); return; }
            this.$stepLabel.textContent = `${this.idx + 1} / ${this.steps.length}`;

            // 高亮当前行
            const lines = this.$source.querySelectorAll('.code-trace-line');
            lines.forEach((el, i) => el.classList.toggle('code-trace-line--active', i === (step.line - 1)));
            const activeEl = lines[step.line - 1];
            if (activeEl && activeEl.scrollIntoView) {
                const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                activeEl.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
            }

            // 变量面板
            const varEntries = Object.entries(step.vars || {}).filter(([k]) => k !== 'arr' && k !== 'stack');
            this.$vars.innerHTML = varEntries.map(([k, v]) => {
                const changed = JSON.stringify(this._prevVars[k]) !== JSON.stringify(v);
                const valStr = this._fmtVal(v);
                return `<div class="code-trace-var${changed ? ' code-trace-var--changed' : ''}">
                    <span class="code-trace-var__name">${this._esc(k)}</span>
                    <span class="code-trace-var__val">${this._esc(valStr)}</span>
                </div>`;
            }).join('') || '<div class="code-trace-empty">(无变量)</div>';
            this._prevVars = {};
            varEntries.forEach(([k, v]) => { this._prevVars[k] = v; });

            // 数组
            const arr = step.arrOverride || step.vars.arr;
            if (Array.isArray(arr)) {
                this.$array.innerHTML = arr.map((v, i) => {
                    const hi = step.highlight || {};
                    const cls = ['code-trace-cell'];
                    if (hi.i === i || hi.j === i) cls.push('code-trace-cell--ptr');
                    if (hi.j2 === i) cls.push('code-trace-cell--ptr2');
                    if (hi.swap && (hi.j === i || hi.j2 === i)) cls.push('code-trace-cell--swap');
                    return `<div class="${cls.join(' ')}">
                        <span>${this._esc(String(v))}</span>
                        <span class="code-trace-cell__idx">[${i}]</span>
                    </div>`;
                }).join('');
            } else {
                this.$array.innerHTML = '<div class="code-trace-empty">(无数组)</div>';
            }

            // stdout
            this.$stdout.textContent = (step.stdout || []).join('\n') + (step.msg ? `\n# ${step.msg}` : '');
            this._syncControls();
        },

        _syncControls() {
            const hasSteps = this.steps.length > 0;
            const atStart = this.idx <= 0;
            const atEnd = !hasSteps || this.idx >= this.steps.length - 1;
            if (this.$prev) this.$prev.disabled = !hasSteps || atStart;
            if (this.$next) this.$next.disabled = !hasSteps || atEnd;
            if (this.$play) {
                this.$play.disabled = !hasSteps || this.steps.length < 2;
                this.$play.setAttribute('aria-pressed', this.playing ? 'true' : 'false');
            }
            if (this.$seek) this.$seek.disabled = !hasSteps || this.steps.length < 2;
        },

        _fmtVal(v) {
            if (Array.isArray(v)) return '[' + v.map(x => this._fmtVal(x)).join(', ') + ']';
            if (v === undefined) return 'undefined';
            if (v === null) return 'null';
            if (typeof v === 'string') return '"' + v + '"';
            if (typeof v === 'object') {
                try { return JSON.stringify(v); }
                catch (_) { return '[object]'; }
            }
            return String(v);
        }
    };

    global.CodeTrace = CodeTrace;
    global.initCodeTrace = function () { CodeTrace.init(); };
    global.destroyCodeTrace = function () { CodeTrace.destroy(); };
})(window);
