/* ============================================================
 * Codevis · JavaScript Runtime backend
 * 依赖由 runtime-loader 按需载入；来源和许可证见 THIRD_PARTY_NOTICES.md。
 *
 * 注入的沙箱 API：
 *   print(...args)       — 写入 stdout
 *   markArray(arr)       — 指定 ARRAY 面板渲染的数组（可选）
 *   markPtr(i, j, j2)    — 标记当前数组指针（可选）
 *   markSwap()           — 标记当前步发生交换（下一步自动清除）
 * ============================================================ */
(function (global) {
    'use strict';

    if (!global.CvRuntime) { console.warn('[runtime-js] 缺少 CvRuntime'); return; }

    const RESERVED = new Set(['print', 'markArray', 'markPtr', 'markSwap', 'console']);

    function pseudoToNative(interpreter, val) {
        try {
            if (val === undefined || val === null) return val;
            if (typeof val !== 'object') return val;
            return interpreter.pseudoToNative(val);
        } catch (_) {
            return '[unreadable]';
        }
    }

    function snapshotScope(interpreter, scope) {
        const out = {};
        if (!scope || !scope.object) return out;
        const props = scope.object.properties || {};
        for (const key of Object.keys(props)) {
            if (RESERVED.has(key)) continue;
            const v = props[key];
            // 跳过函数与未定义
            if (v && typeof v === 'object' && v.class === 'Function') continue;
            out[key] = pseudoToNative(interpreter, v);
        }
        return out;
    }

    function pickArray(vars) {
        if (Array.isArray(vars.arr)) return vars.arr;
        for (const k of Object.keys(vars)) {
            if (Array.isArray(vars[k])) return vars[k];
        }
        return null;
    }

    const JsBackend = {
        async trace({ code, maxSteps = 2000 }) {
            if (typeof Interpreter !== 'function') {
                return { steps: [], error: '浏览器运行组件暂不可用，请检查本地资源后重试。' };
            }
            const stdout = [];
            let pendingHighlight = null;       // 由 markPtr 设置，下一步随 step 写入
            let pendingSwap = false;
            let pendingArrOverride = null;     // 由 markArray 设置

            const initFunc = function (interp, globalObj) {
                interp.setProperty(globalObj, 'print', interp.createNativeFunction(function (...args) {
                    const line = args.map(a => {
                        const native = pseudoToNative(interp, a);
                        if (typeof native === 'object') {
                            try { return JSON.stringify(native); } catch (_) { return String(native); }
                        }
                        return String(native);
                    }).join(' ');
                    stdout.push(line);
                }));
                interp.setProperty(globalObj, 'markPtr', interp.createNativeFunction(function (i, j, j2) {
                    pendingHighlight = {};
                    if (i !== undefined) pendingHighlight.i = i;
                    if (j !== undefined) pendingHighlight.j = j;
                    if (j2 !== undefined) pendingHighlight.j2 = j2;
                }));
                interp.setProperty(globalObj, 'markSwap', interp.createNativeFunction(function () {
                    pendingSwap = true;
                }));
                interp.setProperty(globalObj, 'markArray', interp.createNativeFunction(function (arr) {
                    pendingArrOverride = pseudoToNative(interp, arr);
                }));
                // console.log 兼容
                const consoleObj = interp.createObject(interp.OBJECT);
                interp.setProperty(consoleObj, 'log', interp.createNativeFunction(function (...args) {
                    const line = args.map(a => {
                        const n = pseudoToNative(interp, a);
                        if (typeof n === 'object') { try { return JSON.stringify(n); } catch (_) { return String(n); } }
                        return String(n);
                    }).join(' ');
                    stdout.push(line);
                }));
                interp.setProperty(globalObj, 'console', consoleObj);
            };

            let interpreter;
            try {
                interpreter = new Interpreter(code, initFunc);
            } catch (err) {
                return { steps: [], error: '语法错误：' + (err.message || err) };
            }

            // 内置全局符号黑名单（JS-Interpreter 默认注入的标准库）
            const BUILTIN_GLOBALS = new Set([
                'NaN', 'Infinity', 'undefined', 'window', 'self', 'this',
                'Math', 'JSON', 'Array', 'Boolean', 'Date', 'Function',
                'Number', 'Object', 'RegExp', 'String', 'Error',
                'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
                'TypeError', 'URIError', 'parseInt', 'parseFloat',
                'isNaN', 'isFinite', 'escape', 'unescape',
                'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
                'eval', 'arguments'
            ]);

            function snapshotScopeFiltered(scope) {
                const out = {};
                if (!scope || !scope.object) return out;
                const props = scope.object.properties || {};
                for (const key of Object.keys(props)) {
                    if (RESERVED.has(key) || BUILTIN_GLOBALS.has(key)) continue;
                    const v = props[key];
                    if (v && typeof v === 'object' && v.class === 'Function') continue;
                    out[key] = pseudoToNative(interpreter, v);
                }
                return out;
            }

            const steps = [];
            let count = 0;
            let lastLine = -1;

            while (true) {
                if (count++ > maxSteps) {
                    return { steps, error: `执行步数超过 ${maxSteps}（疑似死循环）` };
                }
                let hasMore;
                try { hasMore = interpreter.step(); }
                catch (err) { return { steps, error: '运行时错误：' + (err.message || err) }; }
                if (!hasMore) break;

                const state = interpreter.stateStack && interpreter.stateStack[interpreter.stateStack.length - 1];
                if (!state || !state.node || !state.node.loc) continue;
                const line = state.node.loc.start.line;

                // 仅在"行号变化"时记录一帧，避免步数爆炸
                if (line === lastLine && !pendingHighlight && !pendingSwap && pendingArrOverride === null) continue;
                lastLine = line;

                // 取当前函数作用域 + 全局作用域合并
                const localScope = interpreter.getScope ? interpreter.getScope() : null;
                const globalScope = interpreter.globalScope || (interpreter.global && interpreter.global.scope);
                const vars = Object.assign(
                    {},
                    snapshotScopeFiltered(globalScope),
                    localScope && localScope !== globalScope ? snapshotScopeFiltered(localScope) : {}
                );

                const arr = pendingArrOverride !== null ? pendingArrOverride : pickArray(vars);
                const step = {
                    line,
                    vars,
                    highlight: pendingHighlight || {},
                    stdout: stdout.slice(),
                    msg: ''
                };
                if (arr !== null && arr !== undefined) step.arrOverride = arr;
                if (pendingSwap) step.highlight.swap = true;

                steps.push(step);

                pendingHighlight = null;
                pendingSwap = false;
                pendingArrOverride = null;
            }

            return { steps };
        }
    };

    global.CvRuntime.register('javascript', JsBackend);
})(window);
