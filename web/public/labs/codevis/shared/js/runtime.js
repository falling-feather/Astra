/* ============================================================
 * Codevis · Runtime 抽象层
 * ============================================================
 * 目标：把"语言/沙箱"与"播放器 UI"解耦。
 *
 * 后端协议（backend object）必须实现：
 *   async trace({ code, input, maxSteps }) → { steps, error? }
 *
 * step 结构（与 code-trace 播放器约定一致）：
 *   {
 *     line: 1-indexed 当前源代码行号
 *     vars: { name: value, ... }  // 数组/对象会渲染为 JSON
 *     highlight?: { i?, j?, j2?, swap? }  // 数组指针指示
 *     arrOverride?: any[]  // 显式指定 ARRAY 面板内容；缺省时取 vars.arr
 *     msg?: string         // 当前步描述
 *     stdout: string[]     // 累计标准输出
 *   }
 * ============================================================ */
(function (global) {
    'use strict';

    const backends = Object.create(null);

    function normalizeStep(step) {
        const line = Number(step && step.line);
        const stdout = step && step.stdout;
        return {
            line: Number.isFinite(line) ? Math.max(0, Math.floor(line)) : 0,
            vars: step && step.vars && typeof step.vars === 'object' ? step.vars : {},
            highlight: step && step.highlight && typeof step.highlight === 'object' ? step.highlight : {},
            arrOverride: step ? step.arrOverride : undefined,
            msg: step && step.msg ? String(step.msg) : '',
            stdout: Array.isArray(stdout)
                ? stdout.map(String)
                : (stdout == null || stdout === '' ? [] : [String(stdout)])
        };
    }

    const CvRuntime = {
        register(language, backend) {
            if (!backend || typeof backend.trace !== 'function') {
                throw new Error(`[CvRuntime] backend "${language}" 必须实现 trace()`);
            }
            backends[language] = backend;
        },

        has(language) { return !!backends[language]; },

        list() { return Object.keys(backends); },

        cancel(language) {
            if (language) {
                const backend = backends[language];
                if (backend && typeof backend.cancel === 'function') backend.cancel();
                return;
            }
            Object.keys(backends).forEach(key => {
                if (typeof backends[key].cancel === 'function') backends[key].cancel();
            });
        },

        async trace({ language, code, input, maxSteps = 2000 } = {}) {
            const be = backends[language];
            if (!be) return { steps: [], error: `未注册的语言后端：${language}` };
            try {
                if (global.CvRuntimeLoader && language !== 'c' && language !== 'cpp') {
                    await global.CvRuntimeLoader.ensure(language);
                }
                const result = await be.trace({ code, input, maxSteps });
                if (!result || !Array.isArray(result.steps)) {
                    return { steps: [], error: '后端未返回有效 steps 数组' };
                }
                return Object.assign({}, result, {
                    steps: result.steps.map(normalizeStep)
                });
            } catch (err) {
                return { steps: [], error: (err && err.message) || String(err) };
            }
        }
    };

    global.CvRuntime = CvRuntime;
})(window);
