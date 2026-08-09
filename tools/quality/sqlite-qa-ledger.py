#!/usr/bin/env python3

"""Read-only SQLite table ledger for isolated browser acceptance runs."""

from __future__ import annotations

import argparse
import ast
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any


ALEMBIC_SCRIPT_DIRECTORY = (
    Path(__file__).resolve().parents[2] / "backend" / "alembic"
)


def _literal_assignment(tree: ast.Module, name: str, source: Path) -> Any:
    values: list[ast.expr] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name
            for target in node.targets
        ):
            values.append(node.value)
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == name
            and node.value is not None
        ):
            values.append(node.value)
    if len(values) != 1:
        raise RuntimeError(f"{source} must define exactly one literal {name}")
    try:
        return ast.literal_eval(values[0])
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{source} has a non-literal {name}") from exc


def _parent_revisions(value: Any, source: Path) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        values = (value,)
    elif isinstance(value, (tuple, list)):
        values = tuple(value)
    else:
        raise RuntimeError(f"{source} has an invalid down_revision")
    if not values or any(
        not isinstance(revision, str)
        or not revision
        or revision != revision.strip()
        for revision in values
    ):
        raise RuntimeError(f"{source} has an invalid down_revision")
    if len(values) != len(set(values)):
        raise RuntimeError(f"{source} has duplicate down_revision values")
    return values


def resolve_alembic_heads(
    script_directory: Path = ALEMBIC_SCRIPT_DIRECTORY,
) -> list[str]:
    try:
        resolved_scripts = script_directory.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("backend Alembic script directory is unavailable") from exc
    versions_directory = resolved_scripts / "versions"
    if not versions_directory.is_dir():
        raise RuntimeError("backend Alembic versions directory is unavailable")

    parents_by_revision: dict[str, tuple[str, ...]] = {}
    migration_files = sorted(
        path
        for path in versions_directory.glob("*.py")
        if path.name != "__init__.py"
    )
    if not migration_files:
        raise RuntimeError("backend Alembic script directory has no revisions")
    for migration in migration_files:
        try:
            tree = ast.parse(
                migration.read_text(encoding="utf-8"),
                filename=str(migration),
            )
        except (OSError, SyntaxError, UnicodeError) as exc:
            raise RuntimeError(f"unable to parse Alembic revision {migration}") from exc
        revision = _literal_assignment(tree, "revision", migration)
        if not isinstance(revision, str) or not revision or revision != revision.strip():
            raise RuntimeError(f"{migration} has an invalid revision")
        if revision in parents_by_revision:
            raise RuntimeError(f"duplicate Alembic revision {revision}")
        parents_by_revision[revision] = _parent_revisions(
            _literal_assignment(tree, "down_revision", migration),
            migration,
        )

    revisions = set(parents_by_revision)
    referenced_revisions = {
        parent
        for parents in parents_by_revision.values()
        for parent in parents
    }
    missing_revisions = sorted(referenced_revisions - revisions)
    if missing_revisions:
        raise RuntimeError(
            "Alembic revision graph references missing revisions: "
            + ", ".join(missing_revisions)
        )
    heads = sorted(revisions - referenced_revisions)
    if len(heads) != 1:
        raise RuntimeError(
            f"backend Alembic script directory must have exactly one head; found {heads}"
        )

    visited: set[str] = set()
    active: set[str] = set()

    def visit(revision: str) -> None:
        if revision in active:
            raise RuntimeError("backend Alembic revision graph contains a cycle")
        if revision in visited:
            return
        active.add(revision)
        for parent in parents_by_revision[revision]:
            visit(parent)
        active.remove(revision)
        visited.add(revision)

    visit(heads[0])
    if visited != revisions:
        raise RuntimeError("backend Alembic revision graph is disconnected")
    return heads


def quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def read_ledger(database: Path) -> dict[str, Any]:
    expected_alembic_heads = resolve_alembic_heads()
    resolved = database.resolve(strict=True)
    connection = sqlite3.connect(f"{resolved.as_uri()}?mode=ro", uri=True)
    try:
        tables = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        counts = {
            table: int(
                connection.execute(
                    f"SELECT COUNT(*) FROM {quoted_identifier(table)}"
                ).fetchone()[0]
            )
            for table in tables
        }
        revisions = sorted(
            str(row[0])
            for row in connection.execute("SELECT version_num FROM alembic_version")
        )
        audit_chain_heads = [
            list(row)
            for row in connection.execute(
                "SELECT id, current_audit_log_id, current_hash "
                "FROM audit_chain_heads ORDER BY id"
            )
        ]
        security_control_locks = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM security_control_locks ORDER BY name"
            )
        ]
    finally:
        connection.close()

    business_counts = {
        table: count
        for table, count in counts.items()
        if table not in {
            "alembic_version",
            "audit_chain_heads",
            "security_control_locks",
        }
    }
    empty_baseline_ok = (
        revisions == expected_alembic_heads
        and audit_chain_heads == [[1, None, None]]
        and security_control_locks == ["admin-authority"]
        and all(count == 0 for count in business_counts.values())
    )
    return {
        "database": str(resolved),
        "mode": "read-only",
        "tableCounts": counts,
        "alembicVersions": revisions,
        "expectedAlembicHeads": expected_alembic_heads,
        "auditChainHeads": audit_chain_heads,
        "securityControlLocks": security_control_locks,
        "emptyBaselineOk": empty_baseline_ok,
    }


def write_evidence(output: Path, database: Path, rendered: str) -> None:
    resolved_database = database.resolve(strict=True)
    resolved_output = output.resolve(strict=False)
    if os.path.normcase(str(resolved_output)) == os.path.normcase(str(resolved_database)):
        raise ValueError("Output path must not replace the input database")
    if output.exists() and output.samefile(resolved_database):
        raise ValueError("Output path must not alias the input database")

    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=output.parent,
        prefix=f".{output.name}.",
        suffix=".tmp",
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--expect-empty-baseline", action="store_true")
    args = parser.parse_args()

    ledger = read_ledger(args.database)
    rendered = json.dumps(ledger, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        write_evidence(args.output, args.database, rendered)
    print(rendered, end="")
    if args.expect_empty_baseline and not ledger["emptyBaselineOk"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
