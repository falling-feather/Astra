import {
  FlagshipEvidenceAssessmentAdminCaseResponseV4Schema,
  FlagshipEvidenceAssessmentResponseV4Schema,
  type AssessmentCriterionIdV4,
  type FlagshipEvidenceAssessmentAdminCaseV4,
  type FlagshipEvidenceAssessmentViewV4,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";

export type {
  EvidenceAssessmentCriterionViewV4,
  FlagshipEvidenceAssessmentAdminCaseV4,
  FlagshipEvidenceAssessmentViewV4,
  StructuredAssessmentEvidenceFactViewV4,
  WorkQualityAssessmentRunReceiptV4,
} from "@ronggang/contracts";

export interface ReviewFlagshipAssessmentInputV4 {
  sessionId: string;
  bindingId: string;
  expectedAssessmentDecisionId: string;
  requestId: string;
  status: "confirmed" | "revised";
  rubricApplicabilityConfirmed: true;
  reason: string;
  criterionRevisions: Array<{
    criterionId: AssessmentCriterionIdV4;
    band: "low" | "medium" | "high";
    score: number;
    rationale: string;
  }>;
}

export function parseFlagshipEvidenceAssessmentResponseV4(
  value: unknown,
  expectedAudience: FlagshipEvidenceAssessmentViewV4["audience"],
): FlagshipEvidenceAssessmentViewV4 {
  const parsed = FlagshipEvidenceAssessmentResponseV4Schema.safeParse(value);
  if (!parsed.success) {
    throw new WireFormatError("FlagshipEvidenceAssessmentViewV4 字段不符合冻结接口");
  }
  if (parsed.data.assessment.audience !== expectedAudience) {
    throw new WireFormatError("V4 证据评价认证角色不一致");
  }
  return parsed.data.assessment;
}

export function parseFlagshipEvidenceAssessmentAdminCaseResponseV4(
  value: unknown,
): FlagshipEvidenceAssessmentAdminCaseV4 {
  const parsed = FlagshipEvidenceAssessmentAdminCaseResponseV4Schema.safeParse(value);
  if (!parsed.success) {
    throw new WireFormatError("FlagshipEvidenceAssessmentAdminCaseV4 字段不符合冻结接口");
  }
  return parsed.data.assessmentCase;
}
