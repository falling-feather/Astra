export type SessionControlErrorCode =
  | "invalid_record"
  | "not_found"
  | "resource_conflict"
  | "idempotency_conflict"
  | "status_conflict"
  | "invalid_status_transition"
  | "scope_mismatch"
  | "inactive_resource"
  | "checkpoint_invalid"
  | "checkpoint_tampered"
  | "checkpoint_session_mismatch"
  | "checkpoint_version_unsupported"
  | "checkpoint_source_conflict"
  | "checkpoint_io_error";

export class SessionControlError extends Error {
  constructor(
    public readonly code: SessionControlErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SessionControlError";
  }
}

export function isSessionControlError(
  value: unknown,
  code?: SessionControlErrorCode,
): value is SessionControlError {
  return value instanceof SessionControlError && (code === undefined || value.code === code);
}
