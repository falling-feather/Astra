import type {
  GovernanceFinding,
  GovernanceRecommendation,
  GovernanceVerdict,
  MediaProcessingOutput,
} from "@ronggang/contracts";
import { hashValue } from "@ronggang/context-engine";

export const governancePolicyVersion = "governance-priority/1.0.0";

export function isGovernanceVerdictReleasable(
  verdict: GovernanceVerdict,
): boolean {
  return verdict === "allow" || verdict === "review" || verdict === "revise";
}

const recommendationRank: Record<GovernanceRecommendation, number> = {
  allow: 1,
  review: 2,
  revise: 3,
  unavailable: 4,
  block: 5,
};

const recommendationVerdict: Record<
  GovernanceRecommendation,
  GovernanceVerdict
> = {
  allow: "allow",
  review: "review",
  revise: "revise",
  unavailable: "degraded",
  block: "block",
};

function canonicalRecommendation(value: unknown): GovernanceRecommendation | null {
  if (typeof value !== "string") return null;
  switch (value.trim().toLowerCase()) {
    case "allow":
    case "allowed":
    case "approve":
    case "approved":
    case "pass":
    case "passed":
    case "safe":
    case "compliant":
    case "cleared":
      return "allow";
    case "review":
    case "review_required":
    case "manual_review":
    case "pending_review":
    case "unknown":
    case "inconclusive":
      return "review";
    case "revise":
    case "revision_required":
    case "needs_edit":
    case "warn":
    case "warning":
    case "restricted":
      return "revise";
    case "block":
    case "blocked":
    case "reject":
    case "rejected":
    case "unsafe":
    case "noncompliant":
    case "forbidden":
      return "block";
    case "unavailable":
    case "failed":
    case "timeout":
    case "timed_out":
      return "unavailable";
    default:
      return null;
  }
}

export function recommendationFromExtracted(
  extracted: Record<string, unknown>,
): GovernanceRecommendation {
  return (
    canonicalRecommendation(extracted.recommendation)
    ?? canonicalRecommendation(extracted.decision)
    ?? canonicalRecommendation(extracted.suggest)
    ?? "review"
  );
}

export function recommendationFromOutput(
  output: MediaProcessingOutput | null,
): GovernanceRecommendation {
  if (!output) return "unavailable";
  return recommendationFromExtracted(output.extracted);
}

export interface GovernanceArbitrationResult {
  verdict: GovernanceVerdict;
  conflict: boolean;
  winningFindingId: string;
  findingSetHash: string;
  decisionHash: string;
}

export function arbitrateGovernanceFindings(
  findings: readonly GovernanceFinding[],
): GovernanceArbitrationResult {
  if (findings.length === 0) {
    throw new Error("治理仲裁至少需要一个 Finding");
  }
  const canonical = [...findings].sort((left, right) => (
    left.domain.localeCompare(right.domain)
    || right.branchPriority - left.branchPriority
    || left.findingId.localeCompare(right.findingId)
  ));
  const winner = [...canonical].sort((left, right) => (
    recommendationRank[right.recommendation]
      - recommendationRank[left.recommendation]
    || right.branchPriority - left.branchPriority
    || left.findingId.localeCompare(right.findingId)
  ))[0]!;
  const findingSetHash = hashValue(canonical.map((finding) => ({
    findingId: finding.findingId,
    domain: finding.domain,
    recommendation: finding.recommendation,
    severity: finding.severity,
    branchPriority: finding.branchPriority,
    executionStatus: finding.executionStatus,
    providerMode: finding.providerMode,
    errorCode: finding.errorCode,
    node: finding.node,
    executionTrace: finding.executionTrace,
    toolRecommendation: finding.toolRecommendation,
    modelRecommendation: finding.modelRecommendation,
  })));
  const verdict = recommendationVerdict[winner.recommendation];
  const conflict = new Set(
    canonical.map((finding) => finding.recommendation),
  ).size > 1;
  const decisionHash = hashValue({
    policyVersion: governancePolicyVersion,
    findingSetHash,
    verdict,
    conflict,
    winningFindingId: winner.findingId,
  });
  return {
    verdict,
    conflict,
    winningFindingId: winner.findingId,
    findingSetHash,
    decisionHash,
  };
}
