import {
  LearnerAdaptationAdminCaseResponseV4Schema,
  LearnerAdaptationResponseV4Schema,
  type LearnerAdaptationAdminCaseV4 as ContractLearnerAdaptationAdminCaseV4,
  type LearnerAdaptationViewV4 as ContractLearnerAdaptationViewV4,
} from "@ronggang/contracts";
import { WireFormatError } from "./wire";

export type LearnerAdaptationViewV4 = ContractLearnerAdaptationViewV4;
export type LearnerAdaptationAdminCaseV4 =
  ContractLearnerAdaptationAdminCaseV4;
export type LearnerAdaptationStateV4 = LearnerAdaptationViewV4["state"];

export interface RecordLearnerConsentInputV4 {
  sessionId: string;
  bindingId: string;
  requestId: string;
  accepted: boolean;
}

export interface RequestLearnerAdaptationAppealInputV4 {
  sessionId: string;
  bindingId: string;
  requestId: string;
  reason: string;
}

export interface ReviewLearnerAdaptationAppealInputV4 {
  sessionId: string;
  bindingId: string;
  requestId: string;
  expectedAppealRef: string;
  resolution: "confirmed" | "reopen_assessment";
  reason: string;
}

export interface AuthorizeSecondSessionInputV4 {
  sessionId: string;
  bindingId: string;
  requestId: string;
  expectedHandoffId: string;
}

function contractFailure(label: string, issues: readonly {
  path: PropertyKey[];
  message: string;
}[]): WireFormatError {
  const first = issues[0];
  const path = first?.path.length ? ` (${first.path.join(".")})` : "";
  const detail = first?.message ? `：${first.message}` : "";
  return new WireFormatError(`${label} 字段不符合冻结接口${path}${detail}`);
}

export function parseLearnerAdaptationResponseV4(
  value: unknown,
  audience: "student" | "teacher",
): LearnerAdaptationViewV4 {
  const parsed = LearnerAdaptationResponseV4Schema.safeParse(value);
  if (!parsed.success) {
    throw contractFailure("LearnerAdaptationResponseV4", parsed.error.issues);
  }
  if (parsed.data.adaptation.audience !== audience) {
    throw new WireFormatError("学习者自适应响应受众与当前身份不一致");
  }
  return parsed.data.adaptation;
}

export function parseLearnerAdaptationAdminCaseResponseV4(
  value: unknown,
): LearnerAdaptationAdminCaseV4 | null {
  const parsed = LearnerAdaptationAdminCaseResponseV4Schema.safeParse(value);
  if (!parsed.success) {
    throw contractFailure(
      "LearnerAdaptationAdminCaseResponseV4",
      parsed.error.issues,
    );
  }
  return parsed.data.adaptationCase;
}
