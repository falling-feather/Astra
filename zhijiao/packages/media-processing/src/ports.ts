import type {
  AdapterCapability,
  Material,
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProviderHealth,
} from "@ronggang/contracts";
import type {
  MediaProcessingWorkAttempt,
  MediaProcessingWorkItem,
} from "./models.js";

export interface MediaCapabilityExecutionInput {
  capability: AdapterCapability;
  sourceRef: string;
  mediaType: Material["mediaType"];
  prompt: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface MediaCapabilityExecutionResult {
  summary: string;
  extracted: Record<string, unknown>;
  confidence: number;
  providerRequestId?: string;
}

export interface MediaCapabilityExecutor {
  readonly provider: string;
  readonly mode: "mock" | "live";
  executeCapability(
    input: MediaCapabilityExecutionInput,
  ): Promise<MediaCapabilityExecutionResult>;
}

export interface GovernanceModelPort {
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult>;
  health(): ModelProviderHealth;
}

export interface ClaimMediaProcessingWorkInput {
  sessionId: string;
  sessionEpoch: string;
  workerId: string;
  now: string;
  leaseDurationMs: number;
  leaseToken: string;
}

export interface FinishMediaProcessingWorkInput {
  workItemId: string;
  leaseToken: string;
  workerId: string;
  finishedAt: string;
  attemptId: string;
  duplicateSuppressed: boolean;
}

export interface ReleaseMediaProcessingWorkInput {
  workItemId: string;
  leaseToken: string;
  workerId: string;
  releasedAt: string;
  attemptId: string;
  errorCode: string;
}

export interface FailMediaProcessingWorkInput {
  workItemId: string;
  leaseToken: string;
  workerId: string;
  failedAt: string;
  attemptId: string;
  errorCode: string;
}

export interface ReconcileMediaProcessingWorkInput {
  workItemId: string;
  workerId: string;
  reconciledAt: string;
  attemptId: string;
  status: "completed" | "failed";
  errorCode: string | null;
}

export interface AssertMediaProcessingLeaseInput {
  workItemId: string;
  leaseToken: string;
  workerId: string;
  now: string;
}

export interface MediaProcessingWorkStore {
  enqueue(
    workItems: readonly MediaProcessingWorkItem[],
  ): Promise<MediaProcessingWorkItem[]>;
  claimNext(
    input: ClaimMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem | null>;
  assertCurrentLease(
    input: AssertMediaProcessingLeaseInput,
  ): Promise<MediaProcessingWorkItem>;
  complete(
    input: FinishMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem>;
  release(
    input: ReleaseMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem>;
  fail(
    input: FailMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem>;
  reconcile(
    input: ReconcileMediaProcessingWorkInput,
  ): Promise<MediaProcessingWorkItem>;
  list(sessionId: string): Promise<MediaProcessingWorkItem[]>;
  listAttempts(sessionId: string): Promise<MediaProcessingWorkAttempt[]>;
  reset(sessionId: string): Promise<void>;
}

export class MediaProcessingLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingLeaseError";
  }
}
