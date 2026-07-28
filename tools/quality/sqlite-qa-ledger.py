#!/usr/bin/env python3

"""Read-only SQLite table ledger for isolated browser acceptance runs."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any


EXPECTED_REVISION = "20260727_0051"


def quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def read_ledger(database: Path) -> dict[str, Any]:
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
        revisions = [
            str(row[0])
            for row in connection.execute("SELECT version_num FROM alembic_version")
        ]
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
        revisions == [EXPECTED_REVISION]
        and audit_chain_heads == [[1, None, None]]
        and security_control_locks == ["admin-authority"]
        and all(count == 0 for count in business_counts.values())
    )
    return {
        "database": str(resolved),
        "mode": "read-only",
        "tableCounts": counts,
        "alembicVersions": revisions,
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
