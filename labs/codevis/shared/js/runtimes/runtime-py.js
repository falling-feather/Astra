/**
 * Codevis · Python Runtime backend
 *
 * 浏览器 Python 追踪后端；来源和许可证见 THIRD_PARTY_NOTICES.md。
 *
 * Trace 策略：call-site 模型 —— 用户主动调用 sandbox API 时记录帧。
 *
 *   print(*args)              输出到 STDOUT
 *   markPtr(i, j, j2)         高亮指针（产生一帧，并把 i/j/j2 塞入 vars）
 *   markSwap()                下一帧高亮 swap
 *   markArray(arr)            覆盖当前帧的数组渲染（同时塞 vars['arr'] = arr）
 *   snap(name, value)         显式追加变量到 vars，不产生新帧
 *
 * 行号取 Sk.currLineNo（Skulpt 在每条语句执行前更新）。
 */
(function (global) {
    'use strict';
    if (!global.CvRuntime) {
        console.error('[runtime-py] CvRuntime not loaded');
        return;
    }

    function py2js(v) {
        if (v == null) return v;
        if (typeof v !== 'object') return v;
        if (typeof Sk === 'undefined') return '[object]';
        try {
            if (Sk.ffi && Sk.ffi.remapToJs) return Sk.ffi.remapToJs(v);
        } catch (_) { /* ignore */ }
        return '[object]';
    }

    const pythonBackend = {
        async trace({ code, maxSteps = 3000 }) {
            if (typeof Sk === 'undefined') {
                return { steps: [], error: '浏览器运行组件暂不可用，请检查本地资源后重试。' };
            }

            const steps = [];
            const stdout = [];
            const lastVars = {};
            let pendingSwap = false;
            let pendingArr = null;
            let aborted = null;

            const curLine = () => (typeof Sk.currLineNo === 'number' ? Sk.currLineNo : 0);

            const pushFrame = (highlight) => {
                if (steps.length >= maxSteps) {
                    aborted = `执行超过最大步数 ${maxSteps}，已中断。`;
                    throw new Sk.builtin.RuntimeError('__cv_abort__');
                }
                const frame = {
                    line: curLine(),
                    vars: Object.assign({}, lastVars),
                    highlight: highlight || {},
                    msg: '',
                    stdout: stdout.slice()
                };
                if (pendingSwap) { frame.highlight.swap = true; pendingSwap = false; }
                if (pendingArr) { frame.arrOverride = pendingArr; pendingArr = null; }
                steps.push(frame);
            };

            // ── Sandbox API ──
            // markPtr(i, j, j2, arr=None)  ─ 可选 arr 同步更新数组
            Sk.builtins.markPtr = new Sk.builtin.func(function () {
                const args = Array.from(arguments).map(py2js);
                const h = {};
                if (args[0] !== undefined && args[0] !== null) { h.i = args[0]; lastVars.i = args[0]; }
                if (args[1] !== undefined && args[1] !== null) { h.j = args[1]; lastVars.j = args[1]; }
                if (args[2] !== undefined && args[2] !== null) { h.j2 = args[2]; }
                if (Array.isArray(args[3])) { lastVars.arr = args[3].slice(); pendingArr = args[3].slice(); }
                pushFrame(h);
                return Sk.builtin.none.none$;
            });
            // markSwap(arr=None)
            Sk.builtins.markSwap = new Sk.builtin.func(function () {
                const args = Array.from(arguments).map(py2js);
                if (Array.isArray(args[0])) { lastVars.arr = args[0].slice(); pendingArr = args[0].slice(); }
                pendingSwap = true;
                pushFrame(null);
                return Sk.builtin.none.none$;
            });
            // markArray(arr)  ─ 覆盖数组、产生一帧
            Sk.builtins.markArray = new Sk.builtin.func(function (arr) {
                const v = py2js(arr);
                pendingArr = Array.isArray(v) ? v.slice() : v;
                if (Array.isArray(v)) lastVars.arr = v.slice();
                pushFrame(null);
                return Sk.builtin.none.none$;
            });
            // snap(name, value)  ─ 只更新 vars、不产生帧
            Sk.builtins.snap = new Sk.builtin.func(function (name, value) {
                const n = py2js(name);
                if (typeof n === 'string') lastVars[n] = py2js(value);
                return Sk.builtin.none.none$;
            });

            Sk.configure({
                output: (text) => {
                    const s = String(text);
                    if (s === '\n' || s === '') return;
                    stdout.push(s.replace(/\n$/, ''));
                },
                read: (x) => {
                    if (Sk.builtinFiles === undefined || Sk.builtinFiles.files[x] === undefined) {
                        throw new Error("File not found: '" + x + "'");
                    }
                    return Sk.builtinFiles.files[x];
                },
                __future__: Sk.python3,
                execLimit: 10000,
                killableWhile: true,
                killableFor: true,
            });

            try {
                await Sk.misceval.asyncToPromise(() =>
                    Sk.importMainWithBody('<main>', false, code, true)
                );
            } catch (err) {
                let msg = (err && err.toString) ? err.toString() : String(err);
                if (msg.indexOf('__cv_abort__') >= 0) {
                    return { steps, error: aborted };
                }
                return { steps, error: 'Python 错误：' + msg };
            }

            if (stdout.length && (steps.length === 0 || stdout.length > steps[steps.length - 1].stdout.length)) {
                steps.push({
                    line: curLine() || 1,
                    vars: Object.assign({}, lastVars),
                    highlight: {},
                    msg: '',
                    stdout: stdout.slice(),
                    arrOverride: pendingArr || (Array.isArray(lastVars.arr) && lastVars.arr.slice())
                });
            }

            return { steps };
        }
    };

    global.CvRuntime.register('python', pythonBackend);
})(window);
