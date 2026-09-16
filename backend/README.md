# 星序 Astra · Python 业务后端

当前实现与数据边界见 [01 开发者手册](../doc/01-开发者手册.md#6-后端能力与数据闭环)，后续任务见 [02](../doc/02-更新规划.md)，真实提交与验收见 [03](../doc/03-发布历史.md)。本文只保留后端运行与代码入口，不复制历史运维报告。

## 1. 运行

本机完整版本从仓库根目录使用 `astra-local.ps1`；前端构建、数据目录、管理员引导和隔离演示的约束见 [04](../doc/04-部署指南.md)。

单独运行 API 时，在本目录执行：

```powershell
python -X utf8 -m pip install --require-hashes -r requirements.lock
python -X utf8 -m alembic upgrade head
python -X utf8 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Python 使用 3.12+。安装消费 requirements.lock，requirements.txt 仅作直接依赖输入。锁更新入口为 [compile_requirements_lock.py](scripts/compile_requirements_lock.py)；升级属于单独变更，不手改哈希锁。

## 2. 代码与数据

| 入口 | 职责 |
| --- | --- |
| [app/main.py](app/main.py)、[api/router.py](app/api/router.py) | 应用工厂与 HTTP 路由注册 |
| [core/config.py](app/core/config.py) | 环境、认证、存储和外部能力配置原件 |
| [schemas](app/schemas/)、[models](app/models/) | DTO 与持久化模型 |
| [services](app/services/) | 授权、业务事务、查询、学习结果与后台任务 |
| [alembic/versions](alembic/versions/) | 数据库迁移，当前 head 为 `20260916_0063` |
| [tests](tests/) | 权限、并发、迁移和业务回归 |
| [scripts](scripts/) | 初始化、依赖锁、运维与验证工具；参数按实际 `--help` 使用 |

默认本机使用 SQLite；MySQL 另有专项回归。课程资料、共享草稿、不可变发布、活动运行、操作事实与完成评价是不同对象，不复用同名字段猜测身份。

## 3. 权限与外部能力

默认只注册学生；教师、成员及课程操作必须通过相应权限。既有学生不能借旧直接入班入口批准自己。`allow_legacy_local_bootstrap` 仅供显式本机预置，生产环境不生效。

HTTP 入口不自行执行学生源码。浏览器预检不等于正式判题；隔离 runner、Webhook、外部 issue 与审计外投默认关闭，启用需独立任务和验证。

## 4. 验证

从仓库根目录运行 `.venv/Scripts/python.exe -X utf8 -m pytest backend`；平时优先指定受影响测试文件。无隔离 MySQL 时专项跳过须如实报告，不能把 SQLite 通过当成生产部署证明。

旧服务包和演练报告的历史依据见 [Git 追溯](../doc/03-发布历史.md#3-旧材料的git追溯)。新门户静态目录和 API 分离方式以当前 04 为准。
