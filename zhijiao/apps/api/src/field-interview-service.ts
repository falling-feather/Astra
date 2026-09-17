import {
  FieldInterviewActionRequestV1Schema, FieldInterviewSpeechDecisionV1Schema, characterWorkflowOrder,
  type FieldInterviewActionRequestV1, type FieldInterviewModelReceiptV1, type FieldInterviewSpeechDecisionV1,
} from "@ronggang/contracts";
import { hashCanonical, type ExplorationLesson, type ExplorationPerson, type XunpuNpcV4 } from "@ronggang/course-content";
import {
  availableFieldChoices, createFieldInterview, resolveFieldSpeech, FieldInterviewRuleError, fieldMemoryContext,
  type WorldSimulationEngineV3,
  type SimulationSessionRecord,
} from "@ronggang/world-core";

export interface FieldInterviewModelInput {
  person: Pick<ExplorationPerson, "id" | "name" | "role" | "activity" | "goal" | "unknown" | "topics" | "personality" | "workflow" | "social">;
  professionalContext: Pick<XunpuNpcV4, "publicGoal" | "privatePressure" | "refusalConditions" | "recoveryConditions" | "disclosureRules"> | null;
  utterance: string;
  history: Array<{ studentText: string; npcText: string }>;
  choices: Array<{ id: string; label: string; effect: ExplorationLesson["choices"][number]["effect"] }>;
  pendingChoiceId: string | null;
  context: { presence: string; virtualMinute: number; recentMessages: Array<{ text: string; minute: number }>; commitments: string[]; proactiveCue: string | null;
    relationship?: ReturnType<typeof fieldMemoryContext> };
  evidence: Array<{ citationId: string; title: string; locator: string; text: string; sourceRevisionId: string; fragmentId: string; sourceByteHash: string | null }>;
  sceneMaterials?: Array<{ id: string; title: string; body: string; kind: string; evidenceStatus: string }>;
}
export interface FieldInterviewModel {
  decide(input: FieldInterviewModelInput, control?: { signal: AbortSignal; invocationId: string }): Promise<{ decision: FieldInterviewSpeechDecisionV1; traceRef: string; costMicros: number | null; execution?: FieldModelExecution }>;
}
export class FieldInterviewModelResultError extends Error {
  constructor(readonly failureCode: string, readonly traceRef: string, readonly costMicros: number | null, readonly execution?: FieldModelExecution) {
    super(failureCode); this.name = "FieldInterviewModelResultError";
  }
}
import { InMemoryFieldModelAttemptStore, type FieldModelAttempt, type FieldModelAttemptStore, type FieldModelExecution, type FieldModelLedger } from "./field-model-attempt-store.js";
import { FieldCharacterMcp } from "./field-character-mcp.js";

type Engine = Pick<WorldSimulationEngineV3, "getRecord" | "getFieldInterview" | "commitFieldInterview" | "assertFieldInterviewWritable">;
const unknownCallReserveMicros = 10_000;

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error("model_cancelled"));
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    })]);
  } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}

/** Conversation inference stays outside the world transaction; the kernel validates and commits all effects. */
export class FieldInterviewService {
  readonly #pending = new Map<string, { hash: string; promise: ReturnType<Engine["commitFieldInterview"]> }>();
  readonly #sessionTails = new Map<string, Promise<void>>();
  readonly #controllers = new Set<AbortController>();
  readonly #attempts: FieldModelAttemptStore;
  #closed = false;
  #characterTools: FieldCharacterMcp | null = null;
  constructor(readonly options: { engine: Engine; lesson: ExplorationLesson; courseId: string; model?: FieldInterviewModel; modelTimeoutMs?: number; maximumModelCalls?: number; modelBudgetMicros?: number;
    attemptStore?: FieldModelAttemptStore; now?: () => string;
    characterProfiles?: readonly XunpuNpcV4[];
    publishedLessons?: readonly ExplorationLesson[];
    retrieveEvidence?: (input: { principalId: string; query: string; knowledgeIds: string[] }) => Promise<FieldInterviewModelInput["evidence"]>;
    readProactiveCue?: (sessionId: string, npcId: string) => Promise<string | null> }) { this.#attempts = options.attemptStore ?? new InMemoryFieldModelAttemptStore(); }

  lessonFor(world: Pick<SimulationSessionRecord, "fieldInterview">): ExplorationLesson {
    const reference = world.fieldInterview?.lessonRef;
    if (!reference) return this.options.lesson;
    const lesson = (this.options.publishedLessons ?? [this.options.lesson]).find(lesson => lesson.contentHash === reference.contentHash);
    if (!lesson || lesson.lessonId !== reference.lessonId || lesson.version !== reference.version) throw new FieldInterviewRuleError("本场课程发布版本未装载，原记录已保留。", "conflict");
    return lesson;
  }

  async read(input: { sessionId: string; actorId: string; bindingId: string }) {
    const world = await this.options.engine.getRecord(input.sessionId);
    if (!world.fieldInterview && world.release.courseReleaseRef.courseId !== this.options.courseId) return null;
    return this.options.engine.getFieldInterview({ ...input, lessonHash: this.lessonFor(world).contentHash });
  }

  async perform(input: { request: FieldInterviewActionRequestV1; actorId: string; principalId: string }) {
    const request = FieldInterviewActionRequestV1Schema.parse(input.request);
    const key = `${request.sessionId}:${input.actorId}:${request.requestId}`;
    const hash = hashCanonical({ actorId: input.actorId, request });
    const pending = this.#pending.get(key);
    if (pending) {
      if (pending.hash !== hash) throw new FieldInterviewRuleError("同一请求编号不能提交不同内容。", "conflict");
      return pending.promise;
    }
    const promise = this.#inSession(request.sessionId, () => this.#perform({ request, actorId: input.actorId, principalId: input.principalId }));
    this.#pending.set(key, { hash, promise });
    try { return await promise; }
    finally { if (this.#pending.get(key)?.promise === promise) this.#pending.delete(key); }
  }

  async #perform(input: { request: FieldInterviewActionRequestV1; actorId: string; principalId: string }) {
    this.#assertOpen();
    const { engine } = this.options;
    const { request } = input;
    // Check ownership and availability before a model sees any history.
    const view = await this.read({ sessionId: request.sessionId, actorId: input.actorId, bindingId: request.bindingId });
    if (!view) throw new FieldInterviewRuleError("当前课程没有启用这份采访课，不能跨课程提交。", "ownership");
    const world = await engine.getRecord(request.sessionId);
    const lesson = this.lessonFor(world);
    const record = world.fieldInterview ?? createFieldInterview(lesson, input.actorId, request.bindingId, request.sessionId);
    if (record.events.some(event => event.requestId === request.requestId)) {
      await this.#loadForUse(world);
      return engine.commitFieldInterview({ ...input, lessonHash: lesson.contentHash });
    }
    await engine.assertFieldInterviewWritable(request);
    if (request.action.kind !== "talk") return engine.commitFieldInterview({ ...input, lessonHash: lesson.contentHash });
    const action = request.action;
    const available = view.people.find(person => person.id === action.npcId);
    if (available?.interactionKind === "scripted") return engine.commitFieldInterview({ ...input, lessonHash: lesson.contentHash });
    const person = lesson.people.find(person => person.id === action.npcId);
    if (!available || !person || (action.channel !== "scene" && !available.canMessage)) throw new FieldInterviewRuleError("目前还没有建立与这位人物的远程联络，请先在现场认识并取得同意。");
    if (action.channel === "scene" && (available.presence !== "present" || available.nodeId !== view.nodeId)) throw new FieldInterviewRuleError("对方目前不在你所在的现场，可以先通过手机联系。");
    let decision = resolveFieldSpeech(lesson, record, person.id, action.text);
    if (["greeting", "acknowledge", "farewell", "refuse", "decline"].includes(decision.kind)) return engine.commitFieldInterview({ ...input, lessonHash: lesson.contentHash, decision });
    const profile = this.options.characterProfiles?.find(profile => profile.entityId === person.id);
    const knowledgeEnabled = person.workflow?.nodes.find(node => node.kind === "knowledge")?.enabled !== false;
    const memoryEnabled = person.workflow?.nodes.find(node => node.kind === "memory")?.enabled !== false;
    const choices = availableFieldChoices(lesson, record, person.id);
    const observation: FieldInterviewModelInput = {
      evidence: [],
      sceneMaterials: lesson.materials.filter(material => knowledgeEnabled && person.topics.some(topic => topic.materialIds.includes(material.id)))
        .map(material => ({ id: material.id, title: material.title, body: material.body, kind: material.kind, evidenceStatus: material.evidenceStatus ?? "unspecified" })),
      person: { id: person.id, name: person.name, role: person.role, activity: person.activity, goal: person.goal, unknown: person.unknown,
        topics: knowledgeEnabled ? person.topics : [], ...(person.personality ? { personality: person.personality } : {}),
        ...(person.workflow ? { workflow: {memoryWindow:person.workflow.memoryWindow,nodes:characterWorkflowOrder(person.workflow).map(({position:_position,...node})=>node)} } : {}), ...(person.social ? { social: person.social } : {}) },
      professionalContext: profile ? { publicGoal: profile.publicGoal, privatePressure: profile.privatePressure,
        refusalConditions: profile.refusalConditions, recoveryConditions: profile.recoveryConditions, disclosureRules: profile.disclosureRules } : null,
      utterance: action.text,
      history: memoryEnabled ? record.turns.filter(turn => turn.npcId === person.id).slice(-Math.max(1, Math.min(16, person.workflow?.memoryWindow ?? 8))).map(turn => ({ studentText: turn.studentText, npcText: turn.npcText })) : [],
      choices: choices.map(choice => ({ id: choice.id, label: choice.label, effect: choice.effect })),
      pendingChoiceId: record.pendingOffers.find(offer => offer.npcId === person.id)?.choiceId ?? null,
      context: { presence: available.presence, virtualMinute: view.virtualMinute, proactiveCue: null,
        ...(person.social ? { relationship: fieldMemoryContext(person, record, action.text) } : {}),
        recentMessages: view.messages.filter(message => message.npcId === person.id && !message.id.startsWith("field-turn-")).slice(-4).map(message => ({ text: message.text, minute: message.minute })),
        commitments: [...view.appointments.filter(appointment => appointment.npcId === person.id).map(appointment => `约见：${appointment.atMinute}分钟，${appointment.status}`),
          ...view.promises.filter(promise => promise.npcId === person.id).map(promise => `发送资料：${promise.dueMinute}分钟，${promise.status}`)] },
    };
    let receipt: FieldInterviewModelReceiptV1 = { mode: "deterministic", traceRef: null, inputHash: hashCanonical(observation), outputHash: hashCanonical(decision), costMicros: 0, failureCode: null };
    let ledger = await this.#loadForUse(world);
    let attempt = ledger.attempts.find(item => item.requestId === request.requestId);
    if (attempt && (attempt.requestHash !== hashCanonical({ actorId: input.actorId, request }) || attempt.actorId !== input.actorId || attempt.bindingId !== request.bindingId)) {
      throw new FieldInterviewRuleError("同一模型请求不能更换内容或主体。", "conflict");
    }
    const modelCalls = ledger.attempts.filter(item => item.called !== false).length;
    const spent = ledger.attempts.reduce((sum, item) => sum + (item.costMicros ?? item.reservedCostMicros), 0);
    if (this.options.model) {
      if (!attempt && (modelCalls >= (this.options.maximumModelCalls ?? 100) || spent + unknownCallReserveMicros > (this.options.modelBudgetMicros ?? 1_000_000))) {
        receipt = { ...receipt, mode: "deterministic_fallback", failureCode: "lesson_model_budget_reached" };
      } else {
        const controller = new AbortController();
        this.#controllers.add(controller);
        const timer = setTimeout(() => controller.abort(new Error("model_timeout")), this.options.modelTimeoutMs ?? 12_000);
        let stage: "retrieval" | "model" = "retrieval";
        try {
          const materialIds = new Set(person.topics.flatMap(topic => topic.materialIds));
          const knowledgeIds = [...new Set([...lesson.materials.filter(material => materialIds.has(material.id)).flatMap(material => material.knowledgeRefs), ...(profile?.localKnowledgeRefs ?? [])])];
          const [evidence, proactiveCue] = await abortable(Promise.all([
            knowledgeEnabled ? this.options.retrieveEvidence?.({ principalId: input.principalId, query: action.text, knowledgeIds }) ?? [] : [],
            this.options.readProactiveCue?.(request.sessionId, person.id) ?? null,
          ]), controller.signal);
          observation.evidence = evidence;
          observation.context.proactiveCue = proactiveCue;
          receipt = { ...receipt, inputHash: hashCanonical(observation), retrievedCitationIds: evidence.map(citation => citation.citationId) };
          await engine.assertFieldInterviewWritable(request);
          this.#assertOpen();
          controller.signal.throwIfAborted();
          if (attempt) {
            if (!attempt.decision || attempt.inputHash !== receipt.inputHash) throw new FieldInterviewRuleError("上次模型尝试中断或资料已变化；调用记录已保留，请同步后发起新请求。", "conflict");
            decision = attempt.decision;
            receipt = this.#receipt(attempt);
          } else {
            const startedAt = this.#now();
            attempt = { attemptId: `field-attempt-${hashCanonical({ sessionId: request.sessionId, requestId: request.requestId }).slice(0, 28)}`,
              sessionId: request.sessionId, actorId: input.actorId, bindingId: request.bindingId, requestId: request.requestId,
              requestHash: hashCanonical({ actorId: input.actorId, request }), lessonHash: lesson.contentHash, inputHash: receipt.inputHash,
              outputHash: null, status: "started", called: null, reservedCostMicros: unknownCallReserveMicros, costMicros: null, traceRef: null, failureCode: null,
              decision: null, retrievedCitationIds: evidence.map(citation => citation.citationId), commitStatus: "pending", eventId: null, commitFailureCode: null,
              startedAt, settledAt: null, updatedAt: startedAt };
            stage = "model";
            ledger = await this.#saveAttempt(ledger, attempt);
            try {
              controller.signal.throwIfAborted();
              attempt = { ...attempt, called: true };
              const result = await abortable(this.options.model.decide(observation, { signal: controller.signal, invocationId: attempt.attemptId }), controller.signal);
              attempt = { ...attempt, traceRef: result.traceRef, costMicros: result.costMicros,
                ...(result.execution ? { execution: result.execution, called: result.execution.mode === "live" && result.execution.attempts > 0 } : {}) };
              const proposed = FieldInterviewSpeechDecisionV1Schema.parse(result.decision);
              if ((proposed.kind === "question" && !person.topics.some(topic => topic.id === proposed.topicId))
                || (proposed.kind === "offer" && !choices.some(choice => choice.id === proposed.choiceId))
                || (proposed.kind !== "question" && proposed.topicId !== null)
                || (proposed.kind !== "offer" && proposed.choiceId !== null)
                || proposed.citedTopicIds?.some(id => !person.topics.some(topic => topic.id === id))
                || (proposed.reply && proposed.kind === "question" && !proposed.citedTopicIds?.includes(proposed.topicId!))) throw new Error("model_reference_outside_person");
              decision = proposed;
              attempt = { ...attempt, status: "succeeded" };
            } catch (error) {
              if (error instanceof FieldInterviewModelResultError) attempt = { ...attempt, traceRef: error.traceRef, costMicros: error.costMicros,
                ...(error.execution ? { execution: error.execution, called: error.execution.mode === "live" && error.execution.attempts > 0 } : {}) };
              const called = attempt.called === true;
              attempt = { ...attempt, status: "failed", called, costMicros: called ? attempt.costMicros : 0,
                failureCode: error instanceof FieldInterviewModelResultError ? error.failureCode
                  : controller.signal.aborted ? (this.#closed ? "service_shutdown" : "model_timeout") : "model_response_unavailable" };
            }
            attempt = { ...attempt, decision, outputHash: hashCanonical(decision), settledAt: this.#now(), updatedAt: this.#now() };
            ledger = await this.#saveAttempt(ledger, attempt);
            receipt = this.#receipt(attempt);
          }
        } catch (error) {
          if (error instanceof FieldInterviewRuleError || stage === "model") throw error;
          receipt = { ...receipt, mode: "deterministic_fallback", costMicros: 0,
            failureCode: controller.signal.aborted ? "content_retrieval_timeout" : "content_retrieval_unavailable" };
        } finally { clearTimeout(timer); this.#controllers.delete(controller); }
      }
    }
    let committed: Awaited<ReturnType<Engine["commitFieldInterview"]>>;
    try {
      this.#assertOpen();
      if (lesson.socialLearning) {
        this.#characterTools ??= new FieldCharacterMcp();
        const toolName = decision.socialAction === "request_contact" ? "add_contact" : decision.socialAction === "request_referral" ? "request_referral" : decision.socialAction === "introduce_self" ? "meet_person" : "interview";
        committed = await this.#characterTools.invoke(toolName, callRef => engine.commitFieldInterview({ ...input, lessonHash: lesson.contentHash, decision,
          modelReceipt: { ...receipt, toolCallRef: callRef, toolName, toolTransport: "mcp-in-memory" } }));
      } else committed = await engine.commitFieldInterview({ ...input, lessonHash: lesson.contentHash, decision, modelReceipt: receipt });
    } catch (error) {
      if (attempt) await this.#saveAttempt(ledger, { ...attempt, commitStatus: "rejected", commitFailureCode: error instanceof FieldInterviewRuleError ? error.code : "world_commit_failed", updatedAt: this.#now() });
      throw error;
    }
    if (attempt) await this.#saveAttempt(ledger, { ...attempt, commitStatus: "committed", eventId: committed.eventId, updatedAt: this.#now() });
    return committed;
  }

  #now(): string { return (this.options.now ?? (() => new Date().toISOString()))(); }
  #assertOpen(): void { if (this.#closed) throw new FieldInterviewRuleError("服务正在关闭，原输入与调用记录已保留。"); }
  #receipt(attempt: FieldModelAttempt): FieldInterviewModelReceiptV1 {
    return { attemptRef: attempt.attemptId, mode: attempt.status === "succeeded" ? attempt.execution?.mode === "mock" ? "deterministic" : "live_model" : "deterministic_fallback",
      inputHash: attempt.inputHash, outputHash: attempt.outputHash!, costMicros: attempt.costMicros, traceRef: attempt.traceRef,
      failureCode: attempt.failureCode, retrievedCitationIds: attempt.retrievedCitationIds };
  }

  async #saveAttempt(ledger: FieldModelLedger, attempt: FieldModelAttempt): Promise<FieldModelLedger> {
    const next = { ...ledger, revision: ledger.revision + 1, attempts: [...ledger.attempts.filter(item => item.attemptId !== attempt.attemptId), attempt] };
    await this.#attempts.save(next, ledger.revision);
    return next;
  }

  #legacyAttempts(world: SimulationSessionRecord, ledger: FieldModelLedger): FieldModelAttempt[] {
    const field = world.fieldInterview;
    if (!field) return [];
    const attempts: FieldModelAttempt[] = [];
    for (const turn of field.turns) {
      const receipt = turn.modelReceipt;
      if (receipt.attemptRef) {
        const attempt = ledger.attempts.find(item => item.attemptId === receipt.attemptRef);
        if (!attempt) throw new FieldInterviewRuleError("采访记录引用的模型调用账本缺失，不能重新清零预算。", "conflict");
        const event = field.events.find(item => item.evidenceRefs.includes(turn.id));
        if (!event || attempt.requestId !== event.requestId || attempt.requestHash !== event.requestHash
          || attempt.actorId !== field.actorId || attempt.bindingId !== field.bindingId || attempt.lessonHash !== field.lessonRef.contentHash
          || attempt.inputHash !== receipt.inputHash || attempt.outputHash !== receipt.outputHash || attempt.traceRef !== receipt.traceRef
          || attempt.costMicros !== receipt.costMicros || (attempt.commitStatus === "committed" && attempt.eventId !== event.id)) {
          throw new FieldInterviewRuleError("模型调用账本与已提交采访来源不一致，不能重新计算预算。", "conflict");
        }
        continue;
      }
      if (receipt.mode === "deterministic" || ["lesson_model_budget_reached", "content_retrieval_unavailable", "content_retrieval_timeout"].includes(receipt.failureCode ?? "")) continue;
      const event = field.events.find(item => item.evidenceRefs.includes(turn.id));
      if (!event) throw new FieldInterviewRuleError("旧模型回合缺少原请求事件，不能重新计算预算。", "conflict");
      if (ledger.attempts.some(item => item.requestId === event.requestId)) continue;
      attempts.push({ attemptId: `field-legacy-${hashCanonical([world.sessionId, event.requestId]).slice(0, 28)}`,
        sessionId: world.sessionId, actorId: field.actorId, bindingId: field.bindingId, requestId: event.requestId, requestHash: event.requestHash,
        lessonHash: field.lessonRef.contentHash, inputHash: receipt.inputHash, outputHash: receipt.outputHash, status: "legacy", called: null,
        reservedCostMicros: unknownCallReserveMicros, costMicros: receipt.costMicros, traceRef: receipt.traceRef, failureCode: receipt.failureCode,
        decision: null, retrievedCitationIds: receipt.retrievedCitationIds ?? [], commitStatus: "committed", eventId: event.id, commitFailureCode: null,
        startedAt: event.committedAt, settledAt: event.committedAt, updatedAt: event.committedAt });
    }
    return attempts;
  }

  async #loadForUse(world: SimulationSessionRecord): Promise<FieldModelLedger> {
    let ledger = await this.#attempts.load(world.sessionId);
    for (const attempt of this.#legacyAttempts(world, ledger)) ledger = await this.#saveAttempt(ledger, attempt);
    for (const attempt of ledger.attempts.filter(item => item.status === "started")) {
      ledger = await this.#saveAttempt(ledger, { ...attempt, status: "interrupted", failureCode: "model_attempt_interrupted", settledAt: this.#now(), updatedAt: this.#now() });
    }
    for (const attempt of ledger.attempts.filter(item => item.commitStatus !== "committed")) {
      const event = world.fieldInterview?.events.find(item => item.requestId === attempt.requestId && item.requestHash === attempt.requestHash);
      const turn = world.fieldInterview?.turns.find(item => item.modelReceipt.attemptRef === attempt.attemptId);
      if (event && turn && event.evidenceRefs.includes(turn.id)) {
        ledger = await this.#saveAttempt(ledger, { ...attempt, commitStatus: "committed", eventId: event.id, updatedAt: this.#now() });
      }
    }
    return ledger;
  }

  async readModelAttempts(sessionId: string): Promise<FieldModelAttempt[]> {
    const ledger = await this.#attempts.load(sessionId);
    return [...ledger.attempts, ...this.#legacyAttempts(await this.options.engine.getRecord(sessionId), ledger)];
  }

  async recoverInterruptedAttempts(): Promise<void> {
    for (const ledger of await this.#attempts.list()) await this.#inSession(ledger.sessionId, async () => {
      await this.#loadForUse(await this.options.engine.getRecord(ledger.sessionId));
    });
  }

  async #inSession<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#sessionTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => done);
    this.#sessionTails.set(sessionId, tail);
    await previous;
    try { return await task(); }
    finally { release(); if (this.#sessionTails.get(sessionId) === tail) this.#sessionTails.delete(sessionId); }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort(new Error("service_shutdown"));
    await Promise.allSettled([...this.#pending.values()].map(item => item.promise));
    await this.#characterTools?.close();
  }

  async readForTeacher(sessionId: string) {
    const world = await this.options.engine.getRecord(sessionId);
    if (!world.fieldInterview) return { view: null, studentActorRef: null };
    const record = world.fieldInterview;
    return { view: await this.read({ sessionId, actorId: record.actorId, bindingId: record.bindingId }), studentActorRef: record.actorId };
  }
}
