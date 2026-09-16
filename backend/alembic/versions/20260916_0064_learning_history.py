"""Pin learning contexts and preserve attempt / grade / recognition history."""
from alembic import op
import sqlalchemy as sa
from datetime import UTC, datetime
import hashlib
import json

revision = "20260916_0064"
down_revision = "20260916_0063"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_context().as_sql:
        raise RuntimeError("Learning-history upgrade requires online legacy fact snapshots")
    op.create_table('learning_contexts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('context_key', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('school_id', sa.Integer(), nullable=True),
    sa.Column('course_id', sa.Integer(), nullable=True),
    sa.Column('course_unit_id', sa.Integer(), nullable=True),
    sa.Column('class_id', sa.Integer(), nullable=True),
    sa.Column('course_release_id', sa.Integer(), nullable=True),
    sa.Column('resource_version_id', sa.Integer(), nullable=True),
    sa.Column('assignment_id', sa.Integer(), nullable=True),
    sa.Column('assignment_snapshot_json', sa.JSON(), nullable=True),
    sa.Column('client_request_id', sa.String(length=128), nullable=False),
    sa.Column('request_sha256', sa.String(length=64), nullable=False),
    sa.Column('scope_sha256', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("mode <> 'formal' OR (course_id IS NOT NULL AND course_unit_id IS NOT NULL AND course_release_id IS NOT NULL AND class_id IS NOT NULL)", name='ck_learning_context_formal_scope'),
    sa.CheckConstraint("mode IN ('formal', 'explore', 'preview')", name='ck_learning_context_mode'),
    sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ),
    sa.ForeignKeyConstraint(['class_id'], ['class_groups.id'], ),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ),
    sa.ForeignKeyConstraint(['course_release_id'], ['course_releases.id'], ),
    sa.ForeignKeyConstraint(['course_unit_id'], ['course_units.id'], ),
    sa.ForeignKeyConstraint(['resource_version_id'], ['learning_resource_versions.id'], ),
    sa.ForeignKeyConstraint(['school_id'], ['schools.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('context_key'),
    sa.UniqueConstraint('user_id', 'client_request_id', name='uq_learning_context_request')
    )
    with op.batch_alter_table('learning_contexts', schema=None) as batch_op:
        batch_op.create_index('ix_learning_context_user_course', ['user_id', 'course_id', 'created_at', 'id'], unique=False)

    op.create_table('assignment_attempts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('submission_id', sa.Integer(), nullable=False),
    sa.Column('assignment_id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('class_id', sa.Integer(), nullable=True),
    sa.Column('course_id', sa.Integer(), nullable=False),
    sa.Column('course_unit_id', sa.Integer(), nullable=False),
    sa.Column('context_id', sa.Integer(), nullable=True),
    sa.Column('course_release_id', sa.Integer(), nullable=True),
    sa.Column('attempt_number', sa.Integer(), nullable=False),
    sa.Column('submission_revision', sa.Integer(), nullable=True),
    sa.Column('client_request_id', sa.String(length=128), nullable=False),
    sa.Column('request_sha256', sa.String(length=64), nullable=False),
    sa.Column('content_json', sa.JSON(), nullable=False),
    sa.Column('assignment_snapshot_json', sa.JSON(), nullable=False),
    sa.Column('provenance', sa.String(length=32), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('attempt_number > 0', name='ck_assignment_attempt_number'),
    sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ),
    sa.ForeignKeyConstraint(['class_id'], ['class_groups.id'], ),
    sa.ForeignKeyConstraint(['context_id'], ['learning_contexts.id'], ),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ),
    sa.ForeignKeyConstraint(['course_release_id'], ['course_releases.id'], ),
    sa.ForeignKeyConstraint(['course_unit_id'], ['course_units.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['submission_id'], ['submissions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'client_request_id', name='uq_assignment_attempt_request'),
    sa.UniqueConstraint('submission_id', 'attempt_number', name='uq_assignment_attempt_number')
    )
    with op.batch_alter_table('assignment_attempts', schema=None) as batch_op:
        batch_op.create_index('ix_assignment_attempt_release_student', ['course_release_id', 'student_id', 'assignment_id', 'id'], unique=False)

    op.create_table('assignment_grades',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('score', sa.Integer(), nullable=True),
    sa.Column('max_score', sa.Integer(), nullable=True),
    sa.Column('feedback', sa.Text(), nullable=True),
    sa.Column('graded_by_user_id', sa.Integer(), nullable=True),
    sa.Column('client_request_id', sa.String(length=128), nullable=False),
    sa.Column('request_sha256', sa.String(length=64), nullable=False),
    sa.Column('graded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('provenance', sa.String(length=32), nullable=False),
    sa.Column('source_audit_log_id', sa.Integer(), nullable=True),
    sa.Column('feedback_retained', sa.Boolean(), nullable=False),
    sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('submission_revision', sa.Integer(), nullable=True),
    sa.Column('point_delta', sa.Integer(), nullable=True),
    sa.CheckConstraint("status IN ('graded', 'returned')", name='ck_assignment_grade_status'),
    sa.CheckConstraint('revision > 0', name='ck_assignment_grade_revision'),
    sa.ForeignKeyConstraint(['source_audit_log_id'], ['audit_logs.id'], ),
    sa.UniqueConstraint('source_audit_log_id'),
    sa.ForeignKeyConstraint(['attempt_id'], ['assignment_attempts.id'], ),
    sa.ForeignKeyConstraint(['graded_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('attempt_id', 'revision', name='uq_assignment_grade_revision'),
    sa.UniqueConstraint('graded_by_user_id', 'client_request_id', name='uq_assignment_grade_request')
    )
    with op.batch_alter_table('assignment_grades', schema=None) as batch_op:
        batch_op.create_index('ix_assignment_grade_attempt_latest', ['attempt_id', 'revision', 'id'], unique=False)

    op.create_table('learning_results',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('school_id', sa.Integer(), nullable=False),
    sa.Column('class_id', sa.Integer(), nullable=True),
    sa.Column('course_id', sa.Integer(), nullable=False),
    sa.Column('course_unit_id', sa.Integer(), nullable=False),
    sa.Column('course_release_id', sa.Integer(), nullable=True),
    sa.Column('context_id', sa.Integer(), nullable=True),
    sa.Column('checkpoint_attempt_id', sa.Integer(), nullable=True),
    sa.Column('assignment_grade_id', sa.Integer(), nullable=True),
    sa.Column('evidence_event_id', sa.Integer(), nullable=True),
    sa.Column('completion_event_id', sa.Integer(), nullable=True),
    sa.Column('completed', sa.Boolean(), nullable=False),
    sa.Column('provenance', sa.String(length=48), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('(CASE WHEN checkpoint_attempt_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN assignment_grade_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN evidence_event_id IS NOT NULL THEN 1 ELSE 0 END) = 1', name='ck_learning_result_one_fact'),
    sa.ForeignKeyConstraint(['assignment_grade_id'], ['assignment_grades.id'], ),
    sa.ForeignKeyConstraint(['checkpoint_attempt_id'], ['checkpoint_attempts.id'], ),
    sa.ForeignKeyConstraint(['class_id'], ['class_groups.id'], ),
    sa.ForeignKeyConstraint(['context_id'], ['learning_contexts.id'], ),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ),
    sa.ForeignKeyConstraint(['course_release_id'], ['course_releases.id'], ),
    sa.ForeignKeyConstraint(['course_unit_id'], ['course_units.id'], ),
    sa.ForeignKeyConstraint(['evidence_event_id'], ['learning_evidence_events.id'], ),
    sa.ForeignKeyConstraint(['completion_event_id'], ['learning_evidence_events.id'], ),
    sa.ForeignKeyConstraint(['school_id'], ['schools.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('assignment_grade_id', name='uq_learning_result_grade'),
    sa.UniqueConstraint('checkpoint_attempt_id', name='uq_learning_result_checkpoint'),
    sa.UniqueConstraint('evidence_event_id', name='uq_learning_result_event')
    )
    with op.batch_alter_table('learning_results', schema=None) as batch_op:
        batch_op.create_index('ix_learning_result_scope', ['course_id', 'student_id', 'course_unit_id', 'course_release_id', 'id'], unique=False)

    op.create_table('learning_result_recognitions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('result_id', sa.Integer(), nullable=False),
    sa.Column('target_release_id', sa.Integer(), nullable=False),
    sa.Column('course_unit_id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('candidate_id', sa.Integer(), nullable=False),
    sa.Column('authorized_by_user_id', sa.Integer(), nullable=False),
    sa.Column('target_class_id', sa.Integer(), nullable=False),
    sa.Column('completed', sa.Boolean(), nullable=False),
    sa.Column('basis_json', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['authorized_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['candidate_id'], ['course_candidates.id'], ),
    sa.ForeignKeyConstraint(['course_unit_id'], ['course_units.id'], ),
    sa.ForeignKeyConstraint(['result_id'], ['learning_results.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['target_class_id'], ['class_groups.id'], ),
    sa.ForeignKeyConstraint(['target_release_id'], ['course_releases.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('target_release_id', 'result_id', name='uq_learning_result_recognition')
    )
    with op.batch_alter_table('learning_result_recognitions', schema=None) as batch_op:
        batch_op.create_index('ix_learning_recognition_target_student', ['target_release_id', 'student_id', 'course_unit_id', 'id'], unique=False)

    with op.batch_alter_table('checkpoint_attempts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('learning_context_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('completion_eligible', sa.Boolean(), server_default='1', nullable=False))
        batch_op.create_foreign_key('fk_checkpoint_attempts_learning_context', 'learning_contexts', ['learning_context_id'], ['id'])

    with op.batch_alter_table('course_releases', schema=None) as batch_op:
        batch_op.add_column(sa.Column('result_contract_version', sa.Integer(), server_default='1', nullable=False))

    with op.batch_alter_table('learning_activity_runtimes', schema=None) as batch_op:
        batch_op.add_column(sa.Column('learning_context_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_activity_runtimes_learning_context', 'learning_contexts', ['learning_context_id'], ['id'])

    with op.batch_alter_table('submissions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('current_attempt_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('current_grade_revision', sa.Integer(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('revision', sa.Integer(), server_default='1', nullable=False))
        batch_op.create_foreign_key('fk_submissions_current_attempt', 'assignment_attempts', ['current_attempt_id'], ['id'], use_alter=True)
    _snapshot_existing_facts()


def downgrade():
    if op.get_context().as_sql:
        raise RuntimeError("Learning-history downgrade requires an online fact check")
    connection = op.get_bind()
    for statement in (
        "SELECT COUNT(*) FROM learning_contexts",
        "SELECT COUNT(*) FROM learning_result_recognitions",
        "SELECT COUNT(*) FROM course_releases WHERE result_contract_version > 1",
        "SELECT COUNT(*) FROM assignment_attempts WHERE provenance <> 'legacy_current_snapshot'",
        "SELECT COUNT(*) FROM assignment_grades WHERE provenance NOT IN ('legacy_current_snapshot', 'legacy_audit_record')",
        "SELECT COUNT(*) FROM learning_results WHERE provenance NOT LIKE 'legacy-%'",
    ):
        if connection.execute(sa.text(statement)).scalar_one():
            raise RuntimeError("Cannot downgrade new learning histories without losing their version coordinates")
    with op.batch_alter_table('submissions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_submissions_current_attempt', type_='foreignkey')
        batch_op.drop_column('revision')
        batch_op.drop_column('current_attempt_id')
        batch_op.drop_column('current_grade_revision')

    with op.batch_alter_table('learning_activity_runtimes', schema=None) as batch_op:
        batch_op.drop_constraint('fk_activity_runtimes_learning_context', type_='foreignkey')
        batch_op.drop_column('learning_context_id')

    with op.batch_alter_table('course_releases', schema=None) as batch_op:
        batch_op.drop_column('result_contract_version')

    with op.batch_alter_table('checkpoint_attempts', schema=None) as batch_op:
        batch_op.drop_constraint('fk_checkpoint_attempts_learning_context', type_='foreignkey')
        batch_op.drop_column('completion_eligible')
        batch_op.drop_column('learning_context_id')

    with op.batch_alter_table('learning_result_recognitions', schema=None) as batch_op:
        batch_op.drop_index('ix_learning_recognition_target_student')

    op.drop_table('learning_result_recognitions')
    with op.batch_alter_table('learning_results', schema=None) as batch_op:
        batch_op.drop_index('ix_learning_result_scope')

    op.drop_table('learning_results')
    with op.batch_alter_table('assignment_grades', schema=None) as batch_op:
        batch_op.drop_index('ix_assignment_grade_attempt_latest')

    op.drop_table('assignment_grades')
    with op.batch_alter_table('assignment_attempts', schema=None) as batch_op:
        batch_op.drop_index('ix_assignment_attempt_release_student')

    op.drop_table('assignment_attempts')
    with op.batch_alter_table('learning_contexts', schema=None) as batch_op:
        batch_op.drop_index('ix_learning_context_user_course')

    op.drop_table('learning_contexts')


def _snapshot_existing_facts():
    if op.get_context().as_sql:
        raise RuntimeError("Learning-history upgrade requires online legacy fact snapshots")
    connection = op.get_bind()
    metadata = sa.MetaData()
    names = ["submissions", "assignments", "course_units", "courses", "assignment_attempts", "assignment_grades", "checkpoint_attempts", "learning_results", "learning_evidence_events", "audit_logs"]
    tables = {name: sa.Table(name, metadata, autoload_with=connection) for name in names}
    submissions, assignments = tables["submissions"], tables["assignments"]
    units, courses = tables["course_units"], tables["courses"]
    attempts, grades, results = tables["assignment_attempts"], tables["assignment_grades"], tables["learning_results"]
    course_schools = dict(connection.execute(sa.select(courses.c.id, courses.c.school_id)).all())
    statement = sa.select(submissions, assignments.c.title.label("assignment_title"), assignments.c.description.label("assignment_description"), assignments.c.max_score, assignments.c.point_rule_json, assignments.c.unit_id, units.c.course_id).join(assignments, assignments.c.id == submissions.c.assignment_id).join(units, units.c.id == assignments.c.unit_id)
    for row in connection.execute(statement).mappings():
        # The original payload and latest retained grade are facts. Their release
        # and earlier overwritten grading history are unknown and stay unknown.
        definition = {"id": row["assignment_id"], "title": row["assignment_title"], "description": row["assignment_description"], "max_score": row["max_score"], "point_rule": row["point_rule_json"], "definition_origin": "migration_current_state"}
        fingerprint = hashlib.sha256(json.dumps({"submission_id": row["id"], "content": row["content"]}, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
        attempt_id = connection.execute(attempts.insert().values(submission_id=row["id"], assignment_id=row["assignment_id"], student_id=row["student_id"], class_id=row["class_id"], course_id=row["course_id"], course_unit_id=row["unit_id"], context_id=None, course_release_id=None, attempt_number=1, client_request_id=f"legacy-submission-{row['id']}", request_sha256=fingerprint, content_json=row["content"], assignment_snapshot_json=definition, provenance="legacy_current_snapshot", submitted_at=row["submitted_at"])).inserted_primary_key[0]
        connection.execute(submissions.update().where(submissions.c.id == row["id"]).values(current_attempt_id=attempt_id))
        audit = tables["audit_logs"]
        records = []
        for entry in connection.execute(sa.select(audit).where(audit.c.resource_type == "submission", audit.c.resource_id == str(row["id"]), audit.c.action == "submission.grade", audit.c.event_result == "success").order_by(audit.c.id)).mappings():
            after = (entry["snapshot_json"] or {}).get("after", {})
            score = after.get("score")
            if after.get("status") not in {"graded", "returned"} or not isinstance(score, int) or isinstance(score, bool):
                continue
            feedback = after.get("feedback")
            records.append({"status": after["status"], "score": score, "feedback": feedback if isinstance(feedback, str) else None, "graded_by_user_id": after.get("graded_by_user_id") or entry["actor_user_id"], "graded_at": None, "source_audit_log_id": entry["id"], "feedback_retained": not isinstance(feedback, dict), "recorded_at": entry["created_at"], "provenance": "legacy_audit_record"})
        if row["status"] in {"graded", "returned"}:
            last = records[-1] if records else None
            if last and (last["status"], last["score"], last["graded_by_user_id"]) == (row["status"], row["score"], row["graded_by_user_id"]):
                last.update(feedback=row["feedback"], feedback_retained=True, graded_at=row["graded_at"])
            else:
                records.append({"status": row["status"], "score": row["score"], "feedback": row["feedback"], "graded_by_user_id": row["graded_by_user_id"], "graded_at": row["graded_at"], "source_audit_log_id": None, "feedback_retained": True, "recorded_at": datetime.now(UTC), "provenance": "legacy_current_snapshot"})
        connection.execute(submissions.update().where(submissions.c.id == row["id"]).values(current_grade_revision=len(records)))
        for index, record in enumerate(records, 1):
            grade_id = connection.execute(grades.insert().values(attempt_id=attempt_id, revision=index, max_score=None, client_request_id=f"legacy-grade-{row['id']}-{index}", request_sha256=fingerprint, **record)).inserted_primary_key[0]
            connection.execute(results.insert().values(student_id=row["student_id"], school_id=course_schools[row["course_id"]], class_id=row["class_id"], course_id=row["course_id"], course_unit_id=row["unit_id"], course_release_id=None, context_id=None, assignment_grade_id=grade_id, checkpoint_attempt_id=None, evidence_event_id=None, completed=False, provenance="legacy-grade-snapshot", occurred_at=record["graded_at"] or record["recorded_at"]))
    checkpoints = tables["checkpoint_attempts"]
    events = tables["learning_evidence_events"]
    for row in connection.execute(sa.select(checkpoints)).mappings():
        completion_id = connection.scalar(sa.select(events.c.id).where(events.c.client_event_id == f"@assessment:checkpoint:{row['id']}"))
        connection.execute(results.insert().values(student_id=row["student_id"], school_id=course_schools[row["course_id"]], class_id=row["class_id"], course_id=row["course_id"], course_unit_id=row["course_unit_id"], course_release_id=row["course_release_id"], context_id=None, checkpoint_attempt_id=row["id"], assignment_grade_id=None, evidence_event_id=None, completed=row["is_correct"], completion_event_id=completion_id, provenance="legacy-checkpoint", occurred_at=row["submitted_at"]))
