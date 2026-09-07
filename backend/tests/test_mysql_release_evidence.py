from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import os
from threading import Barrier, Event, Thread
from time import perf_counter, sleep
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect as sa_inspect, select, update
from sqlalchemy.exc import TimeoutError as SqlAlchemyTimeoutError

from app.core.config import Settings, get_settings
from app.db.session import get_session_factory, make_engine, reset_database_state
from app.main import create_app
from app.models import (
    Assignment,
    AuditChainHead,
    AuditLog,
    BackgroundTask,
    BugExternalSyncOperation,
    BugRecord,
    ClassGroup,
    ContentScriptAssetScanRun,
    Course,
    CourseUnit,
    KnowledgeSnapshotRun,
    School,
    Submission,
    User,
)
from app.models.base import utc_now
from app.services.audit import record_audit_log
from app.services.audit_chain import verify_audit_log_chain
from app.services.background_tasks import (
    cancel_background_task,
    claim_next_background_task,
    complete_background_task,
    enqueue_background_task,
    fail_background_task,
    heartbeat_background_task,
    retry_background_task,
)
from app.services.backend_performance import build_backend_performance_report
from app.services.content_script_asset_scan_runs import (
    acquire_content_script_asset_scan_job_lease,
    finish_content_script_asset_scan_run_failure,
    finish_content_script_asset_scan_run_success,
    heartbeat_content_script_asset_scan_job_lease,
)
from app.services.content_script_assets import ContentScriptAssetRemoteDriftReport
from app.services.knowledge_snapshot_runs import (
    cancel_knowledge_snapshot_run,
    rebuild_periodic_knowledge_snapshots,
    requeue_knowledge_snapshot_run,
    snapshot_run_key,
    snapshot_window,
)
from app.services.knowledge_snapshot_scheduler import (
    SnapshotScheduleJob,
    acquire_snapshot_job_lease,
    heartbeat_snapshot_job_lease,
)
from app.services.security_control_locks import ADMIN_AUTHORITY_LOCK, acquire_security_control_lock


pytestmark = pytest.mark.mysql_release_evidence


def _mysql_url() -> str:
    database_url = os.environ.get("ASTRA_TEST_MYSQL_URL", "").strip()
    expected_database = os.environ.get("ASTRA_TEST_MYSQL_DATABASE", "").strip()
    if not database_url or not expected_database:
        pytest.skip("set ASTRA_TEST_MYSQL_URL and ASTRA_TEST_MYSQL_DATABASE for the explicit MySQL release drill")
    engine = make_engine(database_url)
    try:
        assert engine.dialect.name == "mysql"
        assert engine.url.database == expected_database
        assert expected_database.startswith("astra_") and expected_database.endswith("_drill")
    finally:
        engine.dispose()
    return database_url


@pytest.fixture()
def mysql_url() -> str:
    return _mysql_url()


@pytest.fixture()
def mysql_client(mysql_url: str, monkeypatch):
    monkeypatch.setenv("ASTRA_ALLOW_LEGACY_LOCAL_BOOTSTRAP", "true")
    bootstrap_token = os.environ.get("ASTRA_TEST_ADMIN_BOOTSTRAP_TOKEN", "").strip()
    assert bootstrap_token
    monkeypatch.setenv("ASTRA_DATABASE_URL", mysql_url)
    monkeypatch.setenv("ASTRA_AUTO_CREATE_TABLES", "false")
    monkeypatch.setenv("ASTRA_ENVIRONMENT", "development")
    monkeypatch.setenv("ASTRA_ADMIN_BOOTSTRAP_TOKEN", bootstrap_token)
    get_settings.cache_clear()
    reset_database_state()
    with TestClient(create_app()) as client:
        yield client, bootstrap_token
    get_settings.cache_clear()
    reset_database_state()


def test_mysql_admin_organization_governance_schema(mysql_url: str):
    engine = make_engine(mysql_url)
    try:
        inspector = sa_inspect(engine)
        for table_name in ("schools", "class_groups"):
            columns = {column["name"]: column for column in inspector.get_columns(table_name)}
            assert columns["description"]["nullable"] is True
            version = columns["version"]
            assert version["nullable"] is False
            assert version["type"].python_type is int
            assert str(version["default"]).strip("()'\"") == "1"
    finally:
        engine.dispose()


def test_mysql_content_publish_and_rollback_conflicts(mysql_client):
    client, bootstrap_token = mysql_client
    password = "secret123"
    admin_username = "mysql_release_admin"
    bootstrap = client.post(
        "/api/admin/bootstrap",
        json={
            "username": admin_username,
            "password": password,
            "display_name": "MySQL Release Admin",
            "bootstrap_token": bootstrap_token,
        },
    )
    assert bootstrap.status_code in {201, 409}
    admin_token = _login(client, admin_username, password)
    run_token = uuid4().hex[:12]
    first_teacher_token = _register_or_login(client, f"mysql_teacher_a_{run_token}", password)
    second_teacher_token = _register_or_login(client, f"mysql_teacher_b_{run_token}", password)
    slug = f"物理/mysql-并发-{run_token}"

    first_draft = _create_and_submit_draft(client, first_teacher_token, slug, "MySQL 并发版本甲")
    second_draft = _create_and_submit_draft(client, second_teacher_token, slug, "MySQL 并发版本乙")
    publish_barrier = Barrier(2)

    def publish(draft_id: int):
        publish_barrier.wait(timeout=5)
        return client.post(
            f"/api/content/drafts/{draft_id}/publish",
            headers=_auth_header(admin_token),
            json={"note": "mysql concurrent publish"},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        publish_results = list(executor.map(publish, (first_draft, second_draft)))
    assert sorted(response.status_code for response in publish_results) == [200, 409]
    winning_index = next(index for index, response in enumerate(publish_results) if response.status_code == 200)
    first_publication = publish_results[winning_index].json()
    winning_teacher_token = (first_teacher_token, second_teacher_token)[winning_index]

    next_draft = _create_and_submit_draft(client, winning_teacher_token, slug, "MySQL 当前版本")
    second_publication_response = client.post(
        f"/api/content/drafts/{next_draft}/publish",
        headers=_auth_header(admin_token),
        json={"note": "mysql second version"},
    )
    assert second_publication_response.status_code == 200
    assert second_publication_response.json()["version"] == "v2"
    rollback_barrier = Barrier(2)

    def rollback():
        rollback_barrier.wait(timeout=5)
        return client.post(
            f"/api/content/page-versions/{first_publication['version_id']}/rollback",
            headers=_auth_header(admin_token),
            json={"note": "mysql concurrent rollback"},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        rollback_results = list(executor.map(lambda _: rollback(), range(2)))
    assert sorted(response.status_code for response in rollback_results) == [200, 409]
    render = client.get(f"/api/render/page/{slug}")
    assert render.status_code == 200
    assert render.headers["Cache-Control"] == "no-store"
    assert render.json()["version"] == "v3"
    assert render.json()["slug"] == slug


def test_mysql_domain_leases_cancel_retry_and_stale_token_guards(mysql_url: str):
    session_factory = get_session_factory(mysql_url)
    # MySQL DATETIME without fractional precision may round bound values. Use
    # the persisted precision so the test measures lease contention, not a
    # sub-second availability boundary.
    now = utc_now().replace(microsecond=0)
    run_token = uuid4().hex
    task_type = f"mysql_release_{run_token[:12]}"

    with session_factory() as db:
        queued = enqueue_background_task(
            db,
            task_type=task_type,
            idempotency_key=f"mysql-release:{run_token}",
            source_type="mysql_release_evidence",
            source_id=None,
            payload={"evidence": True},
            max_attempts=3,
            available_at=now,
        )
        db.commit()
        task_id = queued.task.id

    task_barrier = Barrier(2)

    def claim_task(worker_id: str):
        with session_factory() as db:
            task_barrier.wait(timeout=5)
            return claim_next_background_task(
                db,
                worker_id=worker_id,
                lease_seconds=60,
                task_types={task_type},
                now=now,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        task_claims = list(executor.map(claim_task, ("mysql-worker-a", "mysql-worker-b")))
    leases = [lease for lease in task_claims if lease is not None]
    assert len(leases) == 1
    first_lease = leases[0]
    with session_factory() as db:
        assert heartbeat_background_task(db, first_lease, lease_seconds=60, now=now + timedelta(seconds=1))
        failure = fail_background_task(
            db,
            first_lease,
            error_code="mysql_release_retry",
            retryable=True,
            base_backoff_seconds=1,
            max_backoff_seconds=1,
            now=now + timedelta(seconds=2),
        )
        assert failure is not None and failure.status == "retry_wait"
    with session_factory() as db:
        second_lease = claim_next_background_task(
            db,
            worker_id="mysql-worker-retry",
            lease_seconds=60,
            task_types={task_type},
            now=now + timedelta(seconds=3),
        )
        assert second_lease is not None and second_lease.attempt_number == 2
    with session_factory() as db:
        _, cancelled = cancel_background_task(db, task_id, now=now + timedelta(seconds=4))
        assert cancelled
        assert complete_background_task(db, second_lease, now=now + timedelta(seconds=5)) is False
        _, retried = retry_background_task(db, task_id, now=now + timedelta(seconds=6))
        assert retried
        final_lease = claim_next_background_task(
            db,
            worker_id="mysql-worker-final",
            lease_seconds=60,
            task_types={task_type},
            now=now + timedelta(seconds=6),
        )
        assert final_lease is not None and final_lease.attempt_number == 3
        assert complete_background_task(db, final_lease, now=now + timedelta(seconds=7))

    job = SnapshotScheduleJob(granularity="day", reference_date=date.today() - timedelta(days=4000 + int(run_token[:3], 16)))
    knowledge_barrier = Barrier(2)

    def claim_knowledge(owner: str):
        with session_factory() as db:
            knowledge_barrier.wait(timeout=5)
            return acquire_snapshot_job_lease(
                db,
                job,
                retry_attempts=3,
                lease_owner=owner,
                lease_seconds=60,
                now=now,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        knowledge_claims = list(executor.map(claim_knowledge, ("mysql-knowledge-a", "mysql-knowledge-b")))
    knowledge_leases = [lease for lease in knowledge_claims if lease is not None]
    assert len(knowledge_leases) == 1
    old_knowledge_lease = knowledge_leases[0]
    with session_factory() as db:
        assert heartbeat_snapshot_job_lease(db, old_knowledge_lease, lease_seconds=60, now=now + timedelta(seconds=1))
        run = db.scalar(select(KnowledgeSnapshotRun).where(KnowledgeSnapshotRun.run_key == old_knowledge_lease.run_key))
        cancel_knowledge_snapshot_run(run, cancelled_by_user_id=0, clock=lambda: now + timedelta(seconds=2))
        db.commit()
        assert heartbeat_snapshot_job_lease(db, old_knowledge_lease, lease_seconds=60, now=now + timedelta(seconds=3)) is False
        run = db.scalar(select(KnowledgeSnapshotRun).where(KnowledgeSnapshotRun.run_key == old_knowledge_lease.run_key))
        requeue_knowledge_snapshot_run(
            run,
            requeued_by_user_id=0,
            lease_seconds=60,
            clock=lambda: now + timedelta(seconds=4),
        )
        db.commit()
        new_knowledge_lease = acquire_snapshot_job_lease(
            db,
            job,
            retry_attempts=3,
            lease_owner="mysql-knowledge-retry",
            lease_seconds=60,
            now=now + timedelta(seconds=5),
        )
        assert new_knowledge_lease is not None
        rebuilt = rebuild_periodic_knowledge_snapshots(
            db,
            granularity="day",
            reference_date=job.reference_date,
            trigger_source="mysql_release_evidence",
            scheduler_lease_owner=new_knowledge_lease.lease_owner,
            scheduler_lease_token=new_knowledge_lease.lease_token,
            clock=lambda: now + timedelta(seconds=6),
        )
        assert rebuilt.status == "success"

    scan_run_key = f"mysql-release-scan:{run_token}"
    scan_filters = {"evidence": "mysql_release"}
    scan_barrier = Barrier(2)

    def claim_scan(owner: str):
        with session_factory() as db:
            scan_barrier.wait(timeout=5)
            return acquire_content_script_asset_scan_job_lease(
                db,
                run_key=scan_run_key,
                trigger_source="scheduler",
                request_filters=scan_filters,
                lease_owner=owner,
                lease_seconds=60,
                now=now,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        scan_claims = list(executor.map(claim_scan, ("mysql-scan-a", "mysql-scan-b")))
    scan_leases = [lease for lease in scan_claims if lease is not None]
    assert len(scan_leases) == 1
    old_scan_lease = scan_leases[0]
    with session_factory() as db:
        assert heartbeat_content_script_asset_scan_job_lease(db, old_scan_lease, lease_seconds=60, now=now + timedelta(seconds=1))
        reclaimed = acquire_content_script_asset_scan_job_lease(
            db,
            run_key=scan_run_key,
            trigger_source="scheduler",
            request_filters=scan_filters,
            lease_owner="mysql-scan-reclaimed",
            lease_seconds=60,
            now=now + timedelta(seconds=62),
        )
        assert reclaimed is not None
        assert heartbeat_content_script_asset_scan_job_lease(
            db,
            old_scan_lease,
            lease_seconds=60,
            now=now + timedelta(seconds=63),
        ) is False
        failed = finish_content_script_asset_scan_run_failure(db, reclaimed, error=RuntimeError("redacted"))
        assert failed is not None
        db.commit()
        retried = acquire_content_script_asset_scan_job_lease(
            db,
            run_key=scan_run_key,
            trigger_source="scheduler",
            request_filters=scan_filters,
            lease_owner="mysql-scan-retry",
            lease_seconds=60,
            now=now + timedelta(seconds=64),
        )
        assert retried is not None
        final = finish_content_script_asset_scan_run_success(
            db,
            retried,
            report=ContentScriptAssetRemoteDriftReport(
                generated_at=now + timedelta(seconds=64),
                total_pages_scanned=0,
                total_external_references=0,
                total_scanned_references=0,
                total_remote_fetches=0,
                total_skipped_references=0,
                total_issues=0,
                issue_counts_by_code={},
                issue_counts_by_severity={},
                issues=[],
            ),
            finished_at=now + timedelta(seconds=65),
        )
        assert final is not None
        db.commit()
        stored = db.scalar(select(ContentScriptAssetScanRun).where(ContentScriptAssetScanRun.run_key == scan_run_key))
        assert stored.status == "success" and stored.attempt_count == 3


def test_mysql_audit_chain_and_security_control_lock_serialize(mysql_url: str):
    session_factory = get_session_factory(mysql_url)
    run_token = uuid4().hex
    with session_factory() as db:
        record_audit_log(
            db,
            action="mysql.release.audit.seed",
            resource_type="mysql_release_evidence",
            resource_id=run_token,
            event_result="success",
        )
        acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
        db.commit()

    writer_barrier = Barrier(6)
    writer_errors: list[str] = []

    def write_audit(index: int) -> None:
        try:
            with session_factory() as db:
                writer_barrier.wait(timeout=5)
                record_audit_log(
                    db,
                    action=f"mysql.release.audit.concurrent.{index}",
                    resource_type="mysql_release_evidence",
                    resource_id=run_token,
                    event_result="success",
                )
                db.commit()
        except Exception as exc:  # pragma: no cover - reported through assertion below
            writer_errors.append(exc.__class__.__name__)

    with ThreadPoolExecutor(max_workers=6) as executor:
        list(executor.map(write_audit, range(6)))
    assert writer_errors == []
    with session_factory() as db:
        logs = list(db.scalars(select(AuditLog).order_by(AuditLog.id.asc())).all())
        report = verify_audit_log_chain(logs)
        head = db.get(AuditChainHead, 1)
        matching = [item for item in logs if item.resource_id == run_token]
        assert len(matching) == 7
        assert report["status"] == "valid"
        assert head is not None and head.current_hash == logs[-1].current_hash

    holder_ready = Event()
    waiter_elapsed: list[float] = []

    def hold_lock() -> None:
        with session_factory() as db:
            acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
            holder_ready.set()
            sleep(0.35)
            db.commit()

    def wait_for_lock() -> None:
        assert holder_ready.wait(timeout=5)
        started = perf_counter()
        with session_factory() as db:
            acquire_security_control_lock(db, ADMIN_AUTHORITY_LOCK)
            db.commit()
        waiter_elapsed.append(perf_counter() - started)

    holder = Thread(target=hold_lock)
    waiter = Thread(target=wait_for_lock)
    holder.start()
    waiter.start()
    holder.join(timeout=5)
    waiter.join(timeout=5)
    assert not holder.is_alive() and not waiter.is_alive()
    assert len(waiter_elapsed) == 1 and 0.2 <= waiter_elapsed[0] < 5


def test_mysql_representative_dataset_runs_all_explain_analyze_profiles(mysql_url: str):
    session_factory = get_session_factory(mysql_url)
    run_token = uuid4().hex[:12]
    now = utc_now().replace(microsecond=0)
    with session_factory() as db:
        creator_id = db.scalar(select(User.id).order_by(User.id.asc()).limit(1))
        if creator_id is None:
            creator = User(
                username=f"mysql_perf_creator_{run_token}",
                normalized_username=f"mysql_perf_creator_{run_token}",
                display_name="MySQL Performance Creator",
                password_hash="not-a-login-hash",
                role="teacher",
                status="active",
            )
            db.add(creator)
            db.flush()
            creator_id = creator.id
        school = School(name=f"MySQL Performance School {run_token}", status="active")
        db.add(school)
        db.flush()
        class_group = ClassGroup(
            school_id=school.id,
            name=f"MySQL Performance Class {run_token}",
            status="active",
        )
        course = Course(
            school_id=school.id,
            creator_user_id=creator_id,
            galaxy_key="englab",
            course_key=f"mysql-perf-course-{run_token}",
            title=f"MySQL Performance Course {run_token}",
            status="published",
        )
        db.add_all([class_group, course])
        db.flush()
        unit = CourseUnit(
            course_id=course.id,
            activity_key=f"mysql-perf-unit-{run_token}",
            title=f"MySQL Performance Unit {run_token}",
            position=1,
            status="published",
        )
        db.add(unit)
        db.flush()
        assignment = Assignment(
            unit_id=unit.id,
            title=f"MySQL Performance Assignment {run_token}",
            status="active",
        )
        db.add(assignment)
        db.flush()
        students = [
            User(
                username=f"mysql_perf_{run_token}_{index}",
                normalized_username=f"mysql_perf_{run_token}_{index}",
                display_name=f"MySQL Performance Student {index}",
                password_hash="not-a-login-hash",
                role="student",
                status="active",
            )
            for index in range(250)
        ]
        db.add_all(students)
        db.flush()
        db.add_all(
            Submission(
                assignment_id=assignment.id,
                student_id=student.id,
                class_id=class_group.id,
                content={"evidence": True},
                status="submitted" if index % 2 == 0 else "returned",
                submitted_at=now - timedelta(seconds=index),
            )
            for index, student in enumerate(students)
        )
        db.add_all(_performance_knowledge_run(run_token, index, now) for index in range(250))
        db.add_all(
            ContentScriptAssetScanRun(
                run_key=f"mysql-perf-scan:{run_token}:{index}",
                scan_type="remote_drift",
                trigger_source="mysql_release_evidence",
                status="running" if index % 4 == 0 else "success",
                started_at=now - timedelta(seconds=index),
                finished_at=None if index % 4 == 0 else now - timedelta(seconds=index - 1),
                attempt_count=1,
                scheduler_lease_owner="mysql-performance-worker" if index % 4 == 0 else None,
                scheduler_lease_token=f"{run_token}{index:04d}" if index % 4 == 0 else None,
                scheduler_lease_expires_at=now + timedelta(hours=1) if index % 4 == 0 else None,
                scheduler_heartbeat_at=now if index % 4 == 0 else None,
                filters_json={},
                totals_json={},
                issue_counts_json={"by_code": {}, "by_severity": {}},
                issue_summary_json=[],
                alert_status="ok",
            )
            for index in range(250)
        )
        db.add_all(
            BackgroundTask(
                task_type="mysql_performance_probe",
                idempotency_key=f"mysql-perf-task:{run_token}:{index}",
                source_type="mysql_release_evidence",
                source_id=index,
                status="pending",
                priority=index % 10,
                payload_json={},
                result_summary_json={},
                available_at=now - timedelta(seconds=index),
                attempt_count=0,
                max_attempts=3,
            )
            for index in range(1000)
        )
        bugs = [
            BugRecord(
                title=f"MySQL Performance Bug {run_token} {index}",
                category="performance",
                severity="P2",
                status="open",
                source="mysql_release_evidence",
            )
            for index in range(250)
        ]
        db.add_all(bugs)
        db.flush()
        db.add_all(
            BugExternalSyncOperation(
                bug_record_id=bugs[0].id,
                provider="github",
                operation="observe",
                operation_key=f"mysql-perf-operation:{run_token}:{index}",
                status="pending",
                attempt_count=0,
            )
            for index in range(250)
        )
        db.commit()

    with session_factory() as db:
        for index in range(250):
            record_audit_log(
                db,
                action="mysql.release.performance.audit",
                resource_type="bug_record",
                resource_id=1,
                event_result="success",
                snapshot={"sample": index},
            )
        db.commit()
        report = build_backend_performance_report(
            db,
            settings=Settings(performance_probe_iterations=20),
            include_explain=True,
            include_benchmark=True,
            require_mysql=True,
        )
    assert report["ok"] is True
    assert report["summary"]["profile_count"] == 11
    assert report["summary"]["explain_analyze_count"] == 11
    assert report["summary"]["missing_index_count"] == 0
    assert report["summary"]["explain_error_count"] == 0
    assert report["summary"]["benchmark_error_count"] == 0
    assert report["summary"]["budget_exceeded_count"] == 0
    assert all(item["explain"]["analyze"]["plan_text_returned"] is False for item in report["profiles"])
    assert all(item["benchmark"]["maximum_rows"] <= 50 for item in report["profiles"])
    assert all(
        all(metric in item["benchmark"] for metric in ("p50_ms", "p95_ms", "p99_ms"))
        for item in report["profiles"]
    )

    # The representative rows must not become delayed production blockers.
    # Keep them for plan/row-count evidence, but terminalize synthetic active
    # states after EXPLAIN/benchmark collection so a later stage gate does not
    # correctly interpret expired drill leases as real stale work.
    cleanup_at = utc_now().replace(microsecond=0)
    with session_factory() as db:
        scan_cleanup = db.execute(
            update(ContentScriptAssetScanRun)
            .where(
                ContentScriptAssetScanRun.trigger_source == "mysql_release_evidence",
                ContentScriptAssetScanRun.status == "running",
            )
            .values(
                status="success",
                finished_at=cleanup_at,
                scheduler_lease_owner=None,
                scheduler_lease_token=None,
                scheduler_lease_expires_at=None,
                scheduler_heartbeat_at=None,
                error_message=None,
            )
        )
        knowledge_cleanup = db.execute(
            update(KnowledgeSnapshotRun)
            .where(
                KnowledgeSnapshotRun.trigger_source == "mysql_release_evidence",
                KnowledgeSnapshotRun.status == "running",
            )
            .values(
                status="success",
                finished_at=cleanup_at,
                scheduler_lease_owner=None,
                scheduler_lease_token=None,
                scheduler_lease_expires_at=None,
                scheduler_heartbeat_at=None,
                error_message=None,
            )
        )
        task_cleanup = db.execute(
            update(BackgroundTask)
            .where(
                BackgroundTask.source_type == "mysql_release_evidence",
                BackgroundTask.task_type == "mysql_performance_probe",
                BackgroundTask.status.in_(("pending", "leased", "retry_wait")),
            )
            .values(
                status="succeeded",
                finished_at=cleanup_at,
                lease_owner=None,
                lease_token=None,
                lease_expires_at=None,
                heartbeat_at=None,
                last_error_code=None,
                result_summary_json={"evidence_cleanup": True},
            )
        )
        db.commit()
    assert scan_cleanup.rowcount >= 63
    assert knowledge_cleanup.rowcount >= 63
    assert task_cleanup.rowcount >= 1000


def test_mysql_connection_pool_timeout_is_bounded_and_recovers(mysql_url: str):
    engine = create_engine(
        mysql_url,
        pool_size=2,
        max_overflow=0,
        pool_timeout=1,
        pool_pre_ping=True,
    )
    first = engine.connect()
    second = engine.connect()
    try:
        started = perf_counter()
        with pytest.raises(SqlAlchemyTimeoutError):
            engine.connect()
        elapsed = perf_counter() - started
        assert 0.8 <= elapsed < 3
        first.close()
        with engine.connect() as recovered:
            assert recovered.exec_driver_sql("SELECT 1").scalar_one() == 1
    finally:
        first.close()
        second.close()
        engine.dispose()


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Cookie": ""}


def _performance_knowledge_run(run_token: str, index: int, now) -> KnowledgeSnapshotRun:
    # Keep generated dates safely above date.min while retaining a wide,
    # deterministic range across repeated runs on the same drill database.
    day_offset = 10_000 + (int(run_token, 16) % 500_000) + index
    reference_date = date.today() - timedelta(days=day_offset)
    period_start, period_end = snapshot_window("day", reference_date)
    running = index % 4 == 0
    return KnowledgeSnapshotRun(
        run_key=snapshot_run_key("day", period_start, period_end),
        granularity="day",
        period_start=period_start,
        period_end=period_end,
        trigger_source="mysql_release_evidence",
        status="running" if running else "success",
        started_at=now - timedelta(seconds=index),
        finished_at=None if running else now - timedelta(seconds=max(index - 1, 0)),
        scheduler_lease_owner="mysql-performance-worker" if running else None,
        scheduler_lease_token=f"{run_token}{index:04d}" if running else None,
        scheduler_lease_expires_at=now + timedelta(hours=1) if running else None,
        scheduler_heartbeat_at=now if running else None,
        attempt_count=1,
        user_snapshot_count=0,
        class_snapshot_count=0,
        metadata_json={"evidence": True},
    )


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return str(response.json()["access_token"])


def _register_or_login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": password,
            "display_name": username,
            "role": "teacher",
        },
    )
    assert response.status_code in {201, 409}
    return _login(client, username, password)


def _create_and_submit_draft(client: TestClient, token: str, slug: str, title: str) -> int:
    response = client.post(
        "/api/content/drafts",
        headers=_auth_header(token),
        json={
            "target_slug": slug,
            "allow_script": False,
            "schema": {
                "slug": slug,
                "galaxy": "englab",
                "subject": "physics",
                "title": title,
                "layout": "experiment-page",
                "status": "draft",
                "version": "draft-local",
                "summary": f"{title} summary",
                "sections": [
                    {
                        "sectionId": "observe-task",
                        "type": "learning-task",
                        "title": "Observe",
                        "summary": "Compare the observed trend and explain the evidence.",
                        "props": {},
                    }
                ],
                "sources": [],
            },
        },
    )
    assert response.status_code == 201
    draft_id = int(response.json()["id"])
    submitted = client.post(
        f"/api/content/drafts/{draft_id}/submit",
        headers=_auth_header(token),
        json={"note": "mysql release evidence"},
    )
    assert submitted.status_code == 200
    return draft_id
