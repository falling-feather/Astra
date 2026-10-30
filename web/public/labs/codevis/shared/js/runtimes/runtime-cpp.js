/* C/C++ trace backend. The audited component's own Worker protocol is the only execution path. */
(function (global) {
    'use strict';
    if (!global.CvRuntime) return;

    const WORKER_URL = 'vendor/jscpp/2.0.9/JSCPP.es5.min.js';
    const PRELUDE = `
#include <cstdio>
inline void markPtr(int i, int j, int j2) { printf("@@CV_PTR %d %d %d\\n", i, j, j2); }
inline void markPtr2(int i, int j) { printf("@@CV_PTR %d %d -1\\n", i, j); }
inline void markSwap() { printf("@@CV_SWAP\\n"); }
inline void markArray(int* a, int n) { printf("@@CV_ARR %d", n); for (int _i = 0; _i < n; _i++) printf(" %d", a[_i]); printf("\\n"); }
inline void snapInt(const char* name, int v) { printf("@@CV_SNAP %s %d\\n", name, v); }
`;
    let activeRun = null;
    let generation = 0;

    function parseTraceLine(line, state) {
        const match = line.match(/^@@CV_(PTR|SWAP|ARR|SNAP)\b(.*)$/);
        if (!match) return null;
        const tag = match[1];
        const rest = match[2].trim();
        if (tag === 'PTR') {
            const parts = rest.split(/\s+/).map(Number);
            const highlight = { i: parts[0], j: parts[1] };
            if (!Number.isNaN(parts[2]) && parts[2] >= 0) highlight.j2 = parts[2];
            state.lastVars.i = highlight.i;
            state.lastVars.j = highlight.j;
            return { frame: { highlight } };
        }
        if (tag === 'SWAP') return { frame: { highlight: { swap: true } } };
        if (tag === 'ARR') {
            const parts = rest.split(/\s+/).map(Number);
            const values = parts.slice(1, 1 + parts[0]);
            state.lastArr = values;
            state.lastVars.arr = values.slice();
            return { frame: { highlight: {}, arrOverride: values.slice() } };
        }
        if (tag === 'SNAP') {
            const space = rest.indexOf(' ');
            state.lastVars[space > 0 ? rest.slice(0, space) : rest] = space > 0 ? Number(rest.slice(space + 1)) : 0;
            return { append: true };
        }
        return null;
    }

    function terminateActive(message) {
        if (!activeRun) return;
        const run = activeRun;
        activeRun = null;
        run.worker.terminate();
        clearTimeout(run.timer);
        run.resolve({ steps: run.steps, error: message || '已停止上一次运行。' });
    }

    const cppBackend = {
        cancel() { terminateActive(); },
        async trace({ code, input = '', maxSteps = 3000 }) {
            terminateActive();
            if (!('Worker' in global)) return { steps: [], error: '浏览器运行暂不可用，请稍后重试。' };
            const currentGeneration = ++generation;
            return new Promise(resolve => {
                let worker;
                try { worker = new Worker(WORKER_URL); }
                catch (_) { resolve({ steps: [], error: '浏览器运行暂不可用，请稍后重试。' }); return; }
                const steps = [];
                const stdout = [];
                const state = { lastVars: {}, lastArr: null };
                let buffer = '';
                const finish = result => {
                    if (!activeRun || activeRun.generation !== currentGeneration) return;
                    worker.terminate();
                    clearTimeout(activeRun.timer);
                    activeRun = null;
                    resolve(result);
                };
                const addLine = line => {
                    const parsed = parseTraceLine(line, state);
                    if (parsed && parsed.frame && steps.length < maxSteps) {
                        steps.push({ line: 0, vars: Object.assign({}, state.lastVars), highlight: parsed.frame.highlight || {}, msg: '', stdout: stdout.slice(), arrOverride: parsed.frame.arrOverride || (state.lastArr && state.lastArr.slice()) });
                    } else if (!parsed) stdout.push(line);
                };
                const addOutput = chunk => {
                    buffer += String(chunk);
                    let newline;
                    while ((newline = buffer.indexOf('\n')) >= 0) { addLine(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
                };
                activeRun = {
                    worker, resolve, steps, generation: currentGeneration,
                    timer: setTimeout(() => finish({ steps, error: '运行超过时限，已安全停止。可修改后重试。' }), 4200)
                };
                worker.onmessage = event => {
                    if (!activeRun || activeRun.generation !== currentGeneration) return;
                    const data = event.data || {};
                    if (data.type === 'stdio.write') { addOutput(data.data); return; }
                    if (!Object.prototype.hasOwnProperty.call(data, 'id')) return;
                    if (data.err) { finish({ steps, error: '运行错误：' + String(data.msg || '未知错误') }); return; }
                    if (buffer) addLine(buffer);
                    if (steps.length === 0 && (stdout.length || Object.keys(state.lastVars).length)) {
                        steps.push({ line: 0, vars: Object.assign({}, state.lastVars), highlight: {}, msg: '', stdout: stdout.slice(), arrOverride: state.lastArr && state.lastArr.slice() });
                    }
                    if (steps.length && stdout.length > steps[steps.length - 1].stdout.length) {
                        steps.push({ line: 0, vars: Object.assign({}, state.lastVars), highlight: {}, msg: '', stdout: stdout.slice(), arrOverride: state.lastArr && state.lastArr.slice() });
                    }
                    finish({ steps });
                };
                worker.onerror = () => finish({ steps, error: '浏览器运行暂不可用，请稍后重试。' });
                // The main thread owns the 4.2 s deadline above. Keep the vendor-side
                // timeout longer so an uncooperative program is always terminated here.
                worker.postMessage([String(currentGeneration), 'run', PRELUDE + '\n' + String(code || ''), String(input || ''), { unsigned_overflow: 'warn', maxTimeout: 10000 }]);
            });
        }
    };
    global.CvRuntime.register('cpp', cppBackend);
    global.CvRuntime.register('c', cppBackend);
})(window);
