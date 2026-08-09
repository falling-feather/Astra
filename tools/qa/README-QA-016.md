# QA-016 关键教学旅程失败基线

本目录只记录 `QA-016 / V8.0.1` 的独立测试与证据，不修改任何产品实现。这里的 `baseline_assertion=PASS` 表示当前缺陷已被真实复现；`desired_gate=FAIL` 才表示产品语义仍未达到目标。二者不能互换。

## 入口

正反向自检（应退出 `0`）：

```powershell
node tools/qa/qa016-critical-journeys.cjs --mode self-test
```

在全新仓库外 SQLite 数据目录复跑六项历史缺陷（原始 `aec0587f6431` 基线退出 `0`；当前修复态应诚实退出 `2`）：

```powershell
node tools/qa/qa016-critical-journeys.cjs --mode baseline --python python
```

按目标语义执行独立红门禁（当前基线应退出 `1`；修复后六项都关闭才退出 `0`）：

```powershell
node tools/qa/qa016-critical-journeys.cjs --mode gate --python python
```

后端 expected-failure 合同默认不置红；`--runxfail` 可显式展示当前失败：

```powershell
python -m pytest backend/tests/test_qa016_critical_journeys.py -q
python -m pytest --runxfail backend/tests/test_qa016_critical_journeys.py -q
```

## 数据安全

后端 runner 每次只在系统临时根目录新建名称以 `astra-qa016-` 开头的数据目录。清理前会再次验证：父目录必须等于系统临时根、名称前缀必须匹配、目标不能是符号链接。默认完成后删除；只有显式传入 `--keep-data` 才保留。runner 不读取、复用或删除任何旧 QA TEMP、真实用户库或仓库内数据库。

## 当前 owner

| 编号 | 后续 owner | 目标语义 |
| --- | --- | --- |
| `FUTURE-01` | `FE-024` | 没有有效变量变化和观察快照时不可判断 |
| `FUTURE-02` | `FE-024` | 判断进入权威学习证据并可被教师回读 |
| `TEACH-01` | `FE-023` | Physics 范围的 pending 请求和 DOM 只含 Physics |
| `CODE-01` | `BE-014` | 学生修订与网络重放分离，允许第二条不同源码 submission |
| `MECH-01` | `FE-025` | e=0.40 完成前 e=0.80 不可执行 |
| `DEMO-01` | `PM` 建立 DATA 后续任务 | 新演示学生默认为未开始，种子证据与现场账号分离 |

结构化证据固定记录前置、步骤、期望、实际、请求/响应、数据库或状态、精确 revision、重跑命令和 owner。浏览器证据另记录桌面与 `390×844` 视口、网络和可访问状态；截图只作为辅助，不代替状态或账本对账。

## 基线证据

- `evidence/qa016-baseline-aec0587f6431.json`：六条合同的动态 VM、真实 API 与临时 SQLite 对账快照。
- `evidence/qa016-browser-aec0587f6431.json`：外部 Edge/Chrome 真实旅程、键盘路径、`390×844` 响应式与可访问状态快照。

证据文件不包含临时目录绝对路径、口令、Cookie 或访问令牌。提交内快照只用于锁定 `aec0587f6431`；修复验收仍必须重新运行 probe，不能只对静态 JSON 做断言。

## QA-020 当前 TEACH 报告语义

`QA-020 / V8.0.8` 只修正报告生成层，不改写上述 QA-016 历史失败快照或产品实现。TEACH-01 现在由真实执行 `pages/teacher/teacher.js` 后捕获的请求参数、进入状态的课程 ID 和 DOM 结果共同派生 `observation_facts`、`defect_observed` 与 `actual`：

- 当前修复构建携带同一 `class_id=11` 与 `course_id=101`；夹具中的混课响应被整页拒绝，零行进入状态且 DOM 未渲染 submission row，因此不把空集合表述成“已正常呈现 Physics 行”，`defect_observed=false`。
- 正式 `baseline`/`gate` 保留 QA-016 原有 TEACH 顶层组合语义：只有“缺少 `course_id`、状态混入 `course_id=202`、DOM 渲染 foreign row”三项同时成立，`historical_issue_defect_observed` 才为真。自检另以显式 `controlled_positive` 语义分别对当前产品源码施加“移除 pending 的 `course_id`”和“绕过混课页拒绝”两类受控变异；单项正控的 `defect_observed=true` 用于证明报告能识别并准确描述对应子事实，但不会静默改写正式 gate 的历史组合布尔。报告同时保留 `historical_issue_defect_observed`、`controlled_positive_defect_observed` 与 `selected_semantic`。
- 这些变异只存在于 Node VM 的内存源码和合同进程中，不写产品文件，也不更新 `tools/qa/evidence/qa016-*`。

正式 probe 的 stdout 是结构化 JSON，stderr 是由同一报告对象生成的一行 `human_summary`。`summary`、`overall`、`execution.status`、`execution.exit_code` 与实际进程退出码共用同一判定；合同会篡改 defect、actual、summary、human summary 与 exit 语义，任何不一致都必须失败。`baseline` 模式只有六项历史缺陷全部真实观察到时退出 `0`，否则退出 `2`；`gate` 模式只有六项目标语义全部关闭缺陷时退出 `0`，否则退出 `1`。因此原始 `aec0587f6431` 的历史 baseline PASS 仍保留，而当前部分或全部修复构建不会被旧基线文案冒充为 PASS。

## QA-021 原始证据独立重算

`QA-021 / V8.0.10` 在报告层增加 `astra-raw-evidence-provenance-v1` 门禁，不改变 QA-016 历史 evidence。现有 Future、Teacher、Mechanics Node VM 捕获点以及 backend probe 的真实 API/SQLite 返回，被整理为最小原始记录：

```text
raw_record = source_id + source_kind(request|response|state|dom)
             + canonical captured_at + { issue_id, channel, data }
```

`tools/qa/qa016-provenance-verifier.cjs` 与 runner 解耦；其 `recompute` 精确只接受 `schema_version`、`envelope_id`、`raw_records`，拒绝 `canonical_facts`、issue 结论或任何上层报告字段。它从 raw records 独立重算六个 canonical facts；runner 随后按重算结果逐层核对 issue、`summary`、`overall`、`execution`、`human_summary` 和退出码。默认报告必须同时满足 verifier identity、唯一且存在的 source、规范 ISO timestamp、claimed facts 与重算 facts 完全一致。

自测明确覆盖 fact-only、raw-only、单派生层、全部派生层、facts 与全部派生层协同但 raw 不变、缺 source、重复 source、重复 raw ID、坏 timestamp 与坏 verifier identity；这些反例的报告一致性均为 FAIL，`exitCodeForReport` 与实际子进程均退出 `3`。未篡改当前构建的正式 `baseline`/`gate` 则分别保持退出 `2`/`1`，不会把旧失败基线或目标 gate 写绿。

该门禁的 assurance 只能是 `consistency-only`：如果有人协调修改 raw records、canonical facts 与全部派生层，内容仍可能自洽通过。它不证明原始来源真实，也不提供抗协同改写保证；外部来源真实性仍需要签名、可信采集器或独立传输审计。QA-021 未执行新 Browser 旅程，既有 `qa016-browser-aec0587f6431.json` 仅是已发生历史旁证，不能冒充当前浏览器 PASS。
