/*
 * Code Space course manifest.
 * Stable identifiers are the only values passed to a future course-state API.
 * Visibility and release state are resolved by CvCourseStateAdapter below; do
 * not encode a teacher release plan in page markup.
 */
(function (global) {
    'use strict';

    const galaxy_key = 'code-space';

    function lesson(definition) {
        const fields = ['activity_key', 'title', 'goal', 'language', 'prediction', 'starter_code', 'trace_prompt', 'repair_hint', 'public_check', 'expected_output'];
        fields.forEach(field => { if (typeof definition[field] !== 'string' || !definition[field]) throw new Error('Invalid course manifest: ' + field); });
        return definition;
    }

    const courses = [
        {
            course_key: 'program-start', title: '程序起步', goal: '建立输入、变量与输出的可观察关系。',
            activities: [
                lesson({ activity_key: 'program-start.first-output', title: '第一条输出', goal: '让输出成为可验证的结果。', language: 'javascript', prediction: 'message 会输出什么文字？', starter_code: 'var message = "hello";\nprint(message);', trace_prompt: '观察变量建立后如何到达输出。', repair_hint: '把 hello 改成自己的词，再比较输出。', public_check: '公开样例：message 为 hello。', expected_output: 'hello' }),
                lesson({ activity_key: 'program-start.variable-box', title: '变量的盒子', goal: '观察变量赋值与重写。', language: 'python', prediction: 'score 经过两次赋值后是多少？', starter_code: 'score = 2\nscore = score + 3\nprint(score)', trace_prompt: '关注 score 在第二次赋值后的值。', repair_hint: '把加数改为 1，比较最后输出。', public_check: '公开样例：2 加 3 应得到 5。', expected_output: '5' }),
                lesson({ activity_key: 'program-start.input-response', title: '输入与回应', goal: '区分输入、处理和输出。', language: 'c', prediction: 'value 加一后会输出什么？', starter_code: 'int main() {\n  int value = 4;\n  value = value + 1;\n  printf("%d\\n", value);\n  return 0;\n}', trace_prompt: '观察 value 从初值到输出的变化。', repair_hint: '把 + 1 改为 + 2，观察回应如何改变。', public_check: '公开样例：4 加 1 应得到 5。', expected_output: '5' })
            ]
        },
        {
            course_key: 'control-flow', title: '控制流程', goal: '通过判断与循环理解程序的前进路线。',
            activities: [
                lesson({ activity_key: 'control-flow.branch-doors', title: '条件分支', goal: '根据条件选择不同路径。', language: 'python', prediction: 'temperature 为 12 时会选择哪条路径？', starter_code: 'temperature = 12\nif temperature < 15:\n    print("coat")\nelse:\n    print("light")', trace_prompt: '观察条件为真时哪一行会被执行。', repair_hint: '把 temperature 改为 18，验证另一条路径。', public_check: '公开样例：12 度应输出 coat。', expected_output: 'coat' }),
                lesson({ activity_key: 'control-flow.loop-boundary', title: '循环与边界', goal: '预测并验证循环何时停止。', language: 'javascript', prediction: '循环结束后，count 会停在哪个数？为什么？', starter_code: 'var count = 0;\nwhile (count < 3) {\n  count += 1;\n}\nprint(count);', trace_prompt: '观察 count 从 0 到 3 的变化，并找出结束条件。', repair_hint: '把 < 3 改成 <= 3，再运行一次，比较多出来的一步。', public_check: '公开样例：count 从 0 开始，目标为 3。', expected_output: '3', featured: true }),
                lesson({ activity_key: 'control-flow.nested-grid', title: '嵌套循环', goal: '用两层循环扫描规则网格。', language: 'c', prediction: '2×2 网格会被访问几次？', starter_code: 'int main() {\n  int visits = 0;\n  for (int row = 0; row < 2; row++) {\n    for (int col = 0; col < 2; col++) {\n      visits++;\n      markPtr(row, col, 0);\n      snapInt("visits", visits);\n    }\n  }\n  printf("%d\\n", visits);\n  return 0;\n}', trace_prompt: '追踪 row、col 与 visits 的配合。', repair_hint: '把内层上限改为 3，预测新增访问次数。', public_check: '公开样例：2×2 网格应访问 4 次。', expected_output: '4' })
            ]
        },
        {
            course_key: 'data-functions', title: '数据与函数', goal: '把数据组织成可复用的处理步骤。',
            activities: [
                lesson({ activity_key: 'data-functions.list-snapshot', title: '列表快照', goal: '在修改前后比较数据状态。', language: 'python', prediction: '替换第二个元素后列表会是什么？', starter_code: 'items = [3, 4, 5]\nitems[1] = 9\nmarkArray(items)\nprint(items[1])', trace_prompt: '在数组快照中比较修改前后的第二个位置。', repair_hint: '把索引 1 改为 2，观察被替换的元素。', public_check: '公开样例：第二个元素应为 9。', expected_output: '9' }),
                lesson({ activity_key: 'data-functions.parameter-return', title: '参数与返回', goal: '追踪值如何进入和离开函数。', language: 'javascript', prediction: 'double(4) 返回什么？', starter_code: 'function double(value) {\n  return value * 2;\n}\nprint(double(4));', trace_prompt: '观察 value 进入函数后怎样变成返回值。', repair_hint: '将 4 换成 6，比较参数和输出。', public_check: '公开样例：double(4) 应得到 8。', expected_output: '8' }),
                lesson({ activity_key: 'data-functions.array-scan', title: '数组扫描', goal: '使用索引读取连续数据。', language: 'c', prediction: '数组扫描后 sum 会是多少？', starter_code: 'int main() {\n  int values[3] = {1, 2, 3};\n  int sum = 0;\n  for (int i = 0; i < 3; i++) {\n    sum += values[i];\n    markPtr(i, 0, 0);\n    markArray(values, 3);\n    snapInt("sum", sum);\n  }\n  printf("%d\\n", sum);\n  return 0;\n}', trace_prompt: '沿着数组位置，记录 sum 的累加过程。', repair_hint: '把循环上限改成 i < 2，比较遗漏的元素。', public_check: '公开样例：[1, 2, 3] 应得到 6。', expected_output: '6' })
            ]
        },
        {
            course_key: 'algorithm-thinking', title: '算法思维', goal: '用有限步骤比较输入、过程与结果。',
            activities: [
                lesson({ activity_key: 'algorithm-thinking.linear-search', title: '线性查找', goal: '从头扫描并在命中时停下。', language: 'cpp', prediction: 'target 第一次出现的索引是多少？', starter_code: 'int main() {\n  int values[4] = {4, 7, 2, 7};\n  int target = 7;\n  for (int i = 0; i < 4; i++) {\n    markPtr(i, 0, 0);\n    markArray(values, 4);\n    if (values[i] == target) {\n      snapInt("index", i);\n      printf("%d\\n", i);\n      return 0;\n    }\n  }\n  return 0;\n}', trace_prompt: '比较每个元素和 target，观察第一次命中的位置。', repair_hint: '把 target 改成 2，验证查找何时停止。', public_check: '公开样例：target=7 时第一个索引为 1。', expected_output: '1' }),
                lesson({ activity_key: 'algorithm-thinking.bubble-pass', title: '冒泡的一趟', goal: '观察相邻元素比较与交换。', language: 'javascript', prediction: '一趟比较后最大值会在哪个位置？', starter_code: 'var values = [3, 1, 2];\nfor (var i = 0; i < 2; i++) {\n  if (values[i] > values[i + 1]) {\n    var temp = values[i]; values[i] = values[i + 1]; values[i + 1] = temp;\n  }\n  markPtr(i, i + 1);\n  markArray(values);\n}\nprint(values.join(","));', trace_prompt: '观察每次相邻比较后数组如何移动。', repair_hint: '改成逆序比较，观察最小值是否被推到末尾。', public_check: '公开样例：[3,1,2] 一趟后应为 1,2,3。', expected_output: '1,2,3' }),
                lesson({ activity_key: 'algorithm-thinking.binary-choice', title: '二分选择', goal: '用区间缩小寻找范围。', language: 'cpp', prediction: 'target=6 时中点会落在索引几？', starter_code: 'int main() {\n  int values[4] = {2, 4, 6, 8};\n  int left = 0, right = 3;\n  int mid = (left + right) / 2;\n  markPtr(left, mid, right);\n  markArray(values, 4);\n  printf("%d\\n", mid);\n  return 0;\n}', trace_prompt: '观察 left、mid、right 如何围住目标。', repair_hint: '把 right 改为 2，比较中点位置。', public_check: '公开样例：四个元素的初始中点索引为 1。', expected_output: '1' })
            ]
        },
        {
            course_key: 'debugging-testing', title: '调试与测试', goal: '用反例和最小修复定位问题。',
            activities: [
                lesson({ activity_key: 'debugging-testing.assert-boundary', title: '边界断言', goal: '为临界输入写下可检查的预期。', language: 'python', prediction: 'size=0 时会落在哪个分支？', starter_code: 'size = 0\nif size == 0:\n    print("boundary")\nelse:\n    print("inside")', trace_prompt: '观察临界值触发的分支。', repair_hint: '把 size 改为 1，验证另一个分支。', public_check: '公开样例：size=0 应输出 boundary。', expected_output: 'boundary' }),
                lesson({ activity_key: 'debugging-testing.trace-mismatch', title: '轨迹不一致', goal: '将预测与实际状态逐步对照。', language: 'javascript', prediction: '三个数累加的 total 是多少？', starter_code: 'var values = [1, 2, 3];\nvar total = 0;\nfor (var i = 0; i < values.length; i++) {\n  total += values[i];\n  markPtr(i, 0);\n  markArray(values);\n}\nprint(total);', trace_prompt: '将每一步的 total 与你的预测对照。', repair_hint: '故意把 i < values.length 改成 i < 2，找出不一致来源。', public_check: '公开样例：1、2、3 的和为 6。', expected_output: '6' }),
                lesson({ activity_key: 'debugging-testing.minimal-case', title: '最小反例', goal: '缩小输入以复现错误。', language: 'c', prediction: '最小数组 [0,1] 中非零元素有几个？', starter_code: 'int main() {\n  int values[2] = {0, 1};\n  int count = 0;\n  for (int i = 0; i < 2; i++) {\n    if (values[i] != 0) count++;\n    markPtr(i, 0, 0);\n    markArray(values, 2);\n  }\n  printf("%d\\n", count);\n  return 0;\n}', trace_prompt: '用最小输入观察条件是否按预期工作。', repair_hint: '把 != 0 改为 == 0，验证反例怎样翻转结果。', public_check: '公开样例：[0,1] 中非零元素为 1 个。', expected_output: '1' })
            ]
        },
        {
            course_key: 'challenge-submission', title: '挑战与提交', goal: '在公开样例后准备可追踪的正式提交。',
            activities: [
                lesson({ activity_key: 'challenge-submission.multi-language-counter', title: '多语言计数器', goal: '比较不同语言的相同算法步骤。', language: 'cpp', prediction: '从 0 计到 3 会执行几次加一？', starter_code: 'int main() {\n  int count = 0;\n  while (count < 3) {\n    count++;\n    snapInt("count", count);\n  }\n  printf("%d\\n", count);\n  return 0;\n}', trace_prompt: '观察 count 的每次递增与停止条件。', repair_hint: '把目标 3 改成 4，比较新增步骤。', public_check: '公开样例：计到目标 3 应输出 3。', expected_output: '3' }),
                lesson({ activity_key: 'challenge-submission.public-sample', title: '公开样例预检', goal: '把公开样例视为学习反馈而非判定。', language: 'javascript', prediction: 'target 是否出现在给定数组中？', starter_code: 'var values = [2, 4, 6];\nvar target = 4;\nvar found = false;\nfor (var i = 0; i < values.length; i++) {\n  if (values[i] === target) found = true;\n}\nprint(found);', trace_prompt: '观察 found 在命中前后是否变化。', repair_hint: '将 target 改为 5，比较公开样例的反馈。', public_check: '公开样例：4 出现在 [2,4,6] 中。', expected_output: 'true' }),
                lesson({ activity_key: 'challenge-submission.submission-record', title: '提交记录', goal: '理解等待、反馈与重试状态。', language: 'python', prediction: '第一次尝试的编号会是什么？', starter_code: 'attempt = 1\nprint(attempt)', trace_prompt: '观察一次可运行尝试产生的明确输出。', repair_hint: '把 attempt 改为 2，区分新的尝试与正式评测结果。', public_check: '公开样例：第一次尝试编号为 1。', expected_output: '1' })
            ]
        }
    ];

    const byActivity = new Map();
    courses.forEach(course => course.activities.forEach(activity => {
        activity.galaxy_key = galaxy_key;
        activity.course_key = course.course_key;
        byActivity.set(activity.activity_key, activity);
    }));

    function defaultOpen(activity) {
        return {
            status: 'available',
            source: 'legacy-default-open',
            detail: '',
            activity_key: activity.activity_key
        };
    }

    function normalize(activity, raw) {
        if (!raw || typeof raw !== 'object') {
            return { status: 'unavailable', source: 'adapter-invalid', detail: '' };
        }
        if (raw.availability === 'unavailable') {
            return { status: 'unavailable', source: 'adapter-unavailable', detail: '' };
        }
        const valid = new Set(['available', 'completed', 'locked', 'hidden']);
        if (!valid.has(raw.status)) return { status: 'unavailable', source: 'adapter-invalid', detail: '' };
        return {
            status: raw.status,
            source: raw.source || 'authority-adapter',
            detail: raw.detail || '',
            lock_reason: raw.status === 'locked' ? String(raw.lock_reason || raw.detail || '') : ''
        };
    }

    const activityKeyPattern = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;
    const httpState = { configured: false, phase: 'idle', courseIds: null, classId: null, fetcher: null, records: new Map(), unitIds: new Map(), generation: 0 };

    function unavailable(source) {
        return { status: 'unavailable', source, detail: '' };
    }

    function validUnit(unit) {
        return !!unit && typeof unit === 'object' && unit.id != null &&
            typeof unit.activity_key === 'string' && activityKeyPattern.test(unit.activity_key) &&
            typeof unit.title === 'string' && unit.title.length > 0 &&
            typeof unit.position === 'number' && Number.isInteger(unit.position) && unit.position >= 0 &&
            (unit.effective_release_state === 'open' || unit.effective_release_state === 'locked') &&
            Array.isArray(unit.lock_reasons) && unit.lock_reasons.every(reason => typeof reason === 'string');
    }

    function stateFromUnit(unit) {
        if (unit.effective_release_state === 'open') return { status: 'available', source: 'be-004', detail: '' };
        return { status: 'locked', source: 'be-004', detail: '', lock_reason: unit.lock_reasons.join('；') };
    }

    const CvCourseStateAdapter = {
        contract: {
            galaxy_key,
            activity_key_pattern: activityKeyPattern.source,
            endpoint: '/api/courses/{course_id}/units?class_id={class_id}',
            maps: { open: 'available', locked: 'locked', absent_from_authoritative_response: 'hidden', invalid_or_failed_adapter: 'unavailable' }
        },
        configureHttp({ course_ids, class_id, fetcher } = {}) {
            httpState.generation++;
            httpState.configured = true;
            httpState.phase = 'unavailable';
            httpState.courseIds = course_ids && typeof course_ids === 'object' ? Object.assign({}, course_ids) : null;
            httpState.classId = class_id == null ? null : String(class_id);
            httpState.fetcher = typeof fetcher === 'function' ? fetcher : global.fetch;
            httpState.records.clear();
            httpState.unitIds.clear();
        },
        async refresh() {
            if (!httpState.configured || !httpState.courseIds || !httpState.classId || typeof httpState.fetcher !== 'function') {
                httpState.phase = 'unavailable';
                return false;
            }
            const generation = httpState.generation;
            const courseIds = Object.assign({}, httpState.courseIds);
            const classId = httpState.classId;
            const fetcher = httpState.fetcher;
            try {
                const entries = await Promise.all(courses.map(async course => {
                    const courseId = courseIds[course.course_key];
                    if (courseId == null) throw new Error('missing course id');
                    const url = '/api/courses/' + encodeURIComponent(String(courseId)) + '/units?class_id=' + encodeURIComponent(classId);
                    const response = await fetcher(url, { credentials: 'same-origin' });
                    if (!response || !response.ok) throw new Error('request failed');
                    const units = await response.json();
                    if (!Array.isArray(units) || !units.every(validUnit)) throw new Error('invalid payload');
                    return [course.course_key, units];
                }));
                if (generation !== httpState.generation) return false;
                httpState.records.clear();
                httpState.unitIds.clear();
                entries.forEach(([courseKey, units]) => units.forEach(unit => {
                    const activity = byActivity.get(unit.activity_key);
                    if (activity && activity.course_key === courseKey) {
                        httpState.records.set(unit.activity_key, stateFromUnit(unit));
                        httpState.unitIds.set(unit.activity_key, Number(unit.id));
                    }
                }));
                httpState.phase = 'ready';
                return true;
            } catch (_) {
                if (generation !== httpState.generation) return false;
                httpState.records.clear();
                httpState.unitIds.clear();
                httpState.phase = 'unavailable';
                return false;
            }
        },
        resolve(activity) {
            const hasExternalAdapter = Object.prototype.hasOwnProperty.call(global, 'AstraCourseStateAdapter');
            const adapter = global.AstraCourseStateAdapter;
            if (hasExternalAdapter) {
                if (!adapter || typeof adapter.resolve !== 'function') return unavailable('adapter-invalid');
                try {
                    return normalize(activity, adapter.resolve({
                        galaxy_key,
                        course_key: activity.course_key,
                        activity_key: activity.activity_key
                    }));
                } catch (_) {
                    return unavailable('adapter-unavailable');
                }
            }
            if (httpState.configured) {
                if (httpState.phase !== 'ready') return unavailable('adapter-unavailable');
                return httpState.records.get(activity.activity_key) || { status: 'hidden', source: 'be-004', detail: '' };
            }
            return defaultOpen(activity);
        },
        unitIdFor(activity) {
            if (!activity || httpState.phase !== 'ready') return null;
            const value = Number(httpState.unitIds.get(activity.activity_key));
            return Number.isInteger(value) && value > 0 ? value : null;
        }
    };

    global.CvCourseManifest = {
        galaxy_key,
        courses,
        getActivity(activity_key) { return byActivity.get(activity_key) || null; },
        getTemplate(activity) { return activity || null; },
        defaultActivityKey: 'control-flow.loop-boundary'
    };
    global.CvCourseStateAdapter = CvCourseStateAdapter;
})(window);
