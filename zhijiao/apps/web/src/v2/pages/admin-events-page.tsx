import { useCallback } from "react";
import { LoaderCircle } from "lucide-react";
import type { AdminGateway } from "../admin-gateway";
import { tracePageToAdminEvents } from "../admin-models";
import { AdminLogList } from "./admin-log-list";
import { useAdminResource } from "./use-admin-resource";

export default function AdminEventsPage({
  gateway,
  sessionId,
  bindingId,
}: {
  gateway: AdminGateway;
  sessionId: string;
  bindingId: string;
}) {
  const loader = useCallback(async (signal: AbortSignal) => (
    tracePageToAdminEvents(await gateway.getTracePage(sessionId, bindingId, signal))
  ), [bindingId, gateway, sessionId]);
  const { data, error } = useAdminResource(loader);
  if (error) {
    return <main className="v2-admin-page"><div className="v2-inline-error" role="alert">{error}</div></main>;
  }
  if (!data) {
    return <main className="v2-admin-page"><div className="v2-centered-state"><LoaderCircle className="spin" />正在读取事件日志</div></main>;
  }
  return (
    <AdminLogList
      title="事件日志"
      description="查看管理员可见的真实世界事件摘要；模型供应方与 Trace 留在运行追踪页。"
      entries={data}
      technical={false}
    />
  );
}
