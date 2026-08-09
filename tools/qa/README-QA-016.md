# QA-016 关键教学旅程失败基线

本目录只记录 `QA-016 / V8.0.1` 的独立测试与证据，不修改任何产品实现。这里的 `baseline_assertion=PASS` 表示当前缺陷已被真实复现；`desired_gate=FAIL` 才表示产品语义仍未达到目标。二者不能互换。

## 入口

正反向自检（应退出 `0`）：

```powershell
node tools/qa/qa016-critical-journeys.cjs --mode self-test
```

在全新仓库外 SQLite 数据目录复现六项当前缺陷（当前基线应退出 `0`）：

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
