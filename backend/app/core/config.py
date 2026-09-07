from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ASTRA_", env_file=".env", extra="ignore")

    app_name: str = "Astra Backend"
    app_version: str = "0.1.0-v6.5"
    environment: str = "development"
    api_prefix: str = "/api"
    api_cache_control: Literal["no-store"] = "no-store"
    auto_create_tables: bool = False
    allow_legacy_local_bootstrap: bool = False
    session_cookie_name: str = "astra_session"
    session_days: int = 7
    session_last_seen_update_seconds: int = Field(default=300, ge=0)
    password_reset_token_ttl_seconds: int = Field(default=30 * 60, ge=60)
    password_reset_request_cooldown_seconds: int = Field(default=5 * 60, ge=0)
    password_reset_token_retention_days: int = Field(default=30, ge=1)
    password_reset_return_token_for_dev: bool = False
    login_max_attempts: int = 5
    login_lockout_seconds: int = 15 * 60
    login_attempt_window_seconds: int = 15 * 60
    audit_log_retention_days: int = Field(default=365, ge=1)
    audit_ip_hash_salt: str = "astra-dev-audit-salt"
    audit_trust_forwarded_for: bool = False
    audit_trusted_proxy_hosts: str = ""
    audit_anchor_enabled: bool = False
    audit_anchor_provider: Literal["webhook"] = "webhook"
    audit_anchor_webhook_url: str | None = None
    audit_anchor_webhook_token: SecretStr | None = None
    audit_anchor_timeout_seconds: int = Field(default=5, ge=1, le=30)
    audit_anchor_max_attempts: int = Field(default=5, ge=1, le=20)
    external_issue_sync_enabled: bool = False
    external_issue_sync_provider: Literal["github"] = "github"
    external_issue_sync_github_api_url: str = "https://api.github.com"
    external_issue_sync_github_web_url: str = "https://github.com"
    external_issue_sync_github_owner: str | None = None
    external_issue_sync_github_repo: str | None = None
    external_issue_sync_github_token: SecretStr | None = None
    external_issue_sync_github_api_version: str = "2026-03-10"
    external_issue_sync_timeout_seconds: int = Field(default=10, ge=1, le=30)
    content_script_allowed_hosts: str = ""
    cors_origins: str = "http://127.0.0.1:8766,http://localhost:8766"
    admin_bootstrap_enabled: bool = True
    admin_bootstrap_token: str | None = None
    knowledge_snapshot_scheduler_enabled: bool = False
    knowledge_snapshot_scheduler_run_on_start: bool = False
    knowledge_snapshot_scheduler_interval_seconds: int = Field(default=300, ge=30)
    knowledge_snapshot_scheduler_lease_seconds: int = Field(default=3600, ge=60)
    knowledge_snapshot_scheduler_heartbeat_seconds: int = Field(default=120, ge=30)
    knowledge_snapshot_scheduler_pending_limit: int = Field(default=50, ge=1, le=1000)
    knowledge_snapshot_daily_enabled: bool = True
    knowledge_snapshot_daily_hour: int = Field(default=3, ge=0, le=23)
    knowledge_snapshot_weekly_enabled: bool = True
    knowledge_snapshot_weekly_weekday: int = Field(default=0, ge=0, le=6)
    knowledge_snapshot_weekly_hour: int = Field(default=4, ge=0, le=23)
    knowledge_snapshot_retry_attempts: int = Field(default=3, ge=0, le=20)
    content_script_remote_drift_scheduler_enabled: bool = False
    content_script_remote_drift_scheduler_run_on_start: bool = False
    content_script_remote_drift_scheduler_interval_seconds: int = Field(default=3600, ge=60)
    content_script_remote_drift_scheduler_lease_seconds: int = Field(default=3600, ge=60)
    content_script_remote_drift_scheduler_actor_user_id: int | None = Field(default=None, ge=1)
    content_script_remote_drift_scheduler_scan_limit: int = Field(default=25, ge=1, le=200)
    content_script_remote_drift_scheduler_source_host: str | None = None
    content_script_remote_drift_scheduler_slug: str | None = None
    alert_delivery_enabled: bool = False
    alert_delivery_provider: Literal["webhook"] = "webhook"
    alert_delivery_webhook_url: str | None = None
    alert_delivery_webhook_token: SecretStr | None = None
    alert_delivery_timeout_seconds: int = Field(default=5, ge=1, le=30)
    alert_delivery_retry_delay_seconds: int = Field(default=300, ge=30, le=24 * 60 * 60)
    alert_delivery_batch_limit: int = Field(default=10, ge=1, le=100)
    background_task_worker_enabled: bool = False
    background_task_worker_interval_seconds: int = Field(default=5, ge=1, le=3600)
    background_task_worker_lease_seconds: int = Field(default=300, ge=30, le=24 * 60 * 60)
    background_task_worker_batch_size: int = Field(default=10, ge=1, le=100)
    background_task_worker_base_backoff_seconds: int = Field(default=30, ge=1, le=3600)
    background_task_worker_max_backoff_seconds: int = Field(default=3600, ge=30, le=24 * 60 * 60)
    background_task_worker_content_scan_enabled: bool = False
    background_task_worker_audit_anchor_enabled: bool = False
    database_pool_size: int = Field(default=10, ge=1, le=100)
    database_max_overflow: int = Field(default=10, ge=0, le=100)
    database_pool_timeout_seconds: int = Field(default=30, ge=1, le=300)
    database_pool_recycle_seconds: int = Field(default=1800, ge=30, le=24 * 60 * 60)
    database_connect_timeout_seconds: int = Field(default=10, ge=1, le=60)
    database_read_timeout_seconds: int = Field(default=30, ge=1, le=300)
    database_write_timeout_seconds: int = Field(default=30, ge=1, le=300)
    performance_slow_query_logging_enabled: bool = True
    performance_slow_query_threshold_ms: int = Field(default=500, ge=1, le=60_000)
    performance_slow_request_logging_enabled: bool = True
    performance_slow_request_threshold_ms: int = Field(default=1000, ge=1, le=60_000)
    performance_core_api_budget_ms: int = Field(default=500, ge=1, le=60_000)
    performance_admin_api_budget_ms: int = Field(default=1000, ge=1, le=60_000)
    performance_export_budget_ms: int = Field(default=5000, ge=1, le=120_000)
    performance_probe_iterations: int = Field(default=3, ge=1, le=20)
    database_url: str = Field(
        default="sqlite+pysqlite:///./astra-dev.db",
        description="SQLAlchemy database URL. SQLite is the safe local default; MySQL is the production target.",
    )

    @property
    def safe_database_url(self) -> str:
        if "://" not in self.database_url or "@" not in self.database_url:
            return self.database_url
        scheme, rest = self.database_url.split("://", 1)
        _, host = rest.rsplit("@", 1)
        return f"{scheme}://***:***@{host}"

    @property
    def cors_origin_list(self) -> list[str]:
        origins: list[str] = []
        for value in self.cors_origins.split(","):
            origin = value.strip()
            if not origin:
                continue
            normalized = self._validated_credentialed_origin(origin)
            if normalized not in origins:
                origins.append(normalized)
        return origins

    @property
    def environment_name(self) -> str:
        return self.environment.strip().lower()

    @property
    def is_local_development(self) -> bool:
        return self.environment_name in {"dev", "development", "test", "testing"}

    @property
    def is_production_like(self) -> bool:
        return not self.is_local_development

    @property
    def legacy_local_bootstrap_allowed(self) -> bool:
        return self.is_local_development and self.allow_legacy_local_bootstrap

    def validate_runtime_security(self) -> None:
        # Force credentialed CORS parsing before middleware is installed.
        self.cors_origin_list
        if self.is_production_like and self.admin_bootstrap_enabled and not self.admin_bootstrap_token:
            raise ValueError(
                "ASTRA_ADMIN_BOOTSTRAP_TOKEN is required outside local development "
                "unless ASTRA_ADMIN_BOOTSTRAP_ENABLED=false"
            )

    @staticmethod
    def _validated_credentialed_origin(origin: str) -> str:
        if origin.lower() == "null" or "*" in origin:
            raise ValueError("ASTRA_CORS_ORIGINS must contain exact http/https origins")
        parsed = urlsplit(origin)
        try:
            parsed.port
        except ValueError as exc:
            raise ValueError("ASTRA_CORS_ORIGINS contains an invalid port") from exc
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("ASTRA_CORS_ORIGINS must contain exact http/https origins")
        return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"

    @property
    def content_script_allowed_host_list(self) -> list[str]:
        return [host.strip().lower() for host in self.content_script_allowed_hosts.split(",") if host.strip()]

    @property
    def audit_trusted_proxy_host_list(self) -> list[str]:
        return [host.strip() for host in self.audit_trusted_proxy_hosts.split(",") if host.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
