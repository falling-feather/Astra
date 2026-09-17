import { useCallback } from "react";
import { LoaderCircle } from "lucide-react";
import type { AdminGateway } from "../admin-gateway";
import { tracePageToAdminLogs } from "../admin-models";
import { AdminLogList } from "./admin-log-list";
import { useAdminResource } from "./use-admin-resource";

export default function AdminTracePage({
  gateway,
  sessionId,
  bindingId,
}: {
  gateway: AdminGateway;
  sessionId: string;
  bindingId: string;
}) {
  const loader = useCallback(async (signal: AbortSignal) => (
    tracePageToAdminLogs(await gateway.getTracePage(sessionId, bindingId, signal))
  ), [bindingId, gateway, sessionId]);
  const { data, error } = useAdminResource(loader);
  if (error) {
    return <main className="v2-admin-page"><div className="v2-inline-error" role="alert">{error}</div></main>;
  }
  if (!data) {
    return <main className="v2-admin-page"><div className="v2-centered-state"><LoaderCircle className="spin" />正在读取运行追踪</div></main>;
  }
  return (
    <AdminLogList
      title="运行追踪"
      description="仅管理员可查看模型运行、供应方、降级状态与安全 Trace 引用。"
      entries={data}
      technical
    />
  );
}
