import type { BusinessOperationReceipt } from "@ronggang/contracts";
import type { AdminGateway } from "./admin-gateway";
import type { FlagshipAssessmentCaseV3 } from "./assessment-v3";
import type { FlagshipEvidenceAssessmentAdminCaseV4 } from "./assessment-v4";
import type { LearnerAdaptationCaseV3 } from "./learner-adaptation-v3";
import type { LearnerAdaptationAdminCaseV4 } from "./learner-adaptation-v4";
import { GatewayHttpError } from "./gateway";

type Diagnostics = { operations: BusinessOperationReceipt[]; operationsError: string | null };
export type AdminEvidenceLoad =
  | ({ kind: "assessment_case_v4"; value: FlagshipEvidenceAssessmentAdminCaseV4; adaptation: LearnerAdaptationAdminCaseV4 | null } & Diagnostics)
  | ({ kind: "assessment_not_ready_v4" | "assessment_unavailable_v4"; message: string } & Diagnostics)
  | { kind: "assessment_case"; value: FlagshipAssessmentCaseV3; adaptation: LearnerAdaptationCaseV3 | null }
  | { kind: "legacy"; value: Awaited<ReturnType<AdminGateway["getProjection"]>>["evidence"] };

const messageOf = (error: unknown) => error instanceof Error ? error.message : "管理数据暂时不可用";
const optionalCase = <T>(request: Promise<T> | undefined): Promise<T | null> => (request ?? Promise.resolve(null)).catch((error: unknown) => {
  if (error instanceof GatewayHttpError && error.status === 404) return null;
  throw error;
});

export async function loadAdminEvidence(gateway: AdminGateway, sessionId: string, bindingId: string, signal: AbortSignal): Promise<AdminEvidenceLoad> {
  const descriptor = await gateway.getSessionExperienceDescriptor(sessionId, bindingId, signal);
  if (descriptor.experienceGeneration === "flagship_v4") {
    const [assessment, operations] = await Promise.allSettled([
      (async () => {
        if (!gateway.getFlagshipEvidenceAssessmentCaseV4) throw new Error("客户端缺少描述符要求的 V4 管理员评价端口");
        const summary = await gateway.getFlagshipEvidenceAssessmentV4?.(sessionId, bindingId, signal);
        if (summary?.status === "not_ready") return { kind: "assessment_not_ready_v4" as const, message: summary.safeMessage };
        const [value, adaptation] = await Promise.all([
          gateway.getFlagshipEvidenceAssessmentCaseV4(sessionId, bindingId, signal),
          optionalCase(gateway.getLearnerAdaptationCaseV4?.(sessionId, bindingId, signal)),
        ]);
        return { kind: "assessment_case_v4" as const, value, adaptation };
      })(),
      gateway.getBusinessOperations ? gateway.getBusinessOperations(sessionId, bindingId, signal) : Promise.reject(new Error("客户端缺少业务恢复收据端口")),
    ]);
    const diagnostics: Diagnostics = { operations: operations.status === "fulfilled" ? operations.value : [], operationsError: operations.status === "rejected" ? messageOf(operations.reason) : null };
    if (assessment.status === "fulfilled") return { ...assessment.value, ...diagnostics };
    const cause: unknown = assessment.reason;
    return { kind: cause instanceof GatewayHttpError && cause.status === 409 && cause.code === "not_ready" ? "assessment_not_ready_v4" : "assessment_unavailable_v4", message: messageOf(cause), ...diagnostics };
  }
  if (descriptor.experienceGeneration === "flagship_v3") {
    if (!gateway.getFlagshipAssessmentCase) throw new Error("客户端缺少描述符要求的 V3 管理员评价端口");
    const [value, adaptation] = await Promise.all([
      gateway.getFlagshipAssessmentCase(sessionId, bindingId, signal),
      optionalCase(gateway.getLearnerAdaptationCase?.(sessionId, bindingId, signal)),
    ]);
    return { kind: "assessment_case", value, adaptation };
  }
  return { kind: "legacy", value: (await gateway.getProjection(sessionId, bindingId, signal)).evidence };
}
