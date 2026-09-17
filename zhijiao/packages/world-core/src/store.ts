import {
  OutboxRecordSchema,
  WorldEventSchema,
  type OutboxRecord,
  type WorldEvent,
} from "@ronggang/contracts";

export class StateVersionConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`状态版本冲突：期望 ${expected}，实际 ${actual}`);
    this.name = "StateVersionConflictError";
  }
}

export interface EventStoreJournalSnapshot {
  events: WorldEvent[];
  outbox: OutboxRecord[];
}

export function validateCommittedOutbox(
  sessionId: string,
  events: readonly WorldEvent[],
  outboxRecords: readonly OutboxRecord[],
  existingEvents: readonly WorldEvent[] = [],
  existingOutbox: readonly OutboxRecord[] = [],
): OutboxRecord[] {
  if (events.length !== outboxRecords.length) {
    throw new Error(`世界提交必须为每个事件生成且只生成一条 Outbox：events=${events.length}, outbox=${outboxRecords.length}`);
  }
  const existingEventIds = new Set(existingEvents.map((event) => event.eventId));
  const existingOutboxIds = new Set(existingOutbox.map((record) => record.outboxId));
  const parsedEvents = events.map((event) => WorldEventSchema.parse(event));
  const eventsById = new Map<string, WorldEvent>();
  let sessionEpoch = `legacy-${sessionId}`;
  for (const event of [...existingEvents, ...parsedEvents]) {
    if (
      event.eventType === "session_started"
      && typeof event.payload.sessionEpoch === "string"
      && event.payload.sessionEpoch.length > 0
    ) {
      sessionEpoch = event.payload.sessionEpoch;
    }
  }
  for (const event of parsedEvents) {
    if (
      event.sessionId !== sessionId
      || existingEventIds.has(event.eventId)
      || eventsById.has(event.eventId)
    ) {
      throw new Error(`世界事件 ID 在当前会话中不唯一：${event.eventId}`);
    }
    eventsById.set(event.eventId, event);
  }
  const seenEventIds = new Set<string>();
  const seenOutboxIds = new Set<string>();
  return outboxRecords.map((record) => {
    const parsed = OutboxRecordSchema.parse(record);
    const event = eventsById.get(parsed.eventId);
    if (
      parsed.sessionId !== sessionId
      || !event
      || seenEventIds.has(parsed.eventId)
    ) {
      throw new Error(`Outbox 记录未唯一绑定本次事件提交：${parsed.outboxId}`);
    }
    if (existingOutboxIds.has(parsed.outboxId) || seenOutboxIds.has(parsed.outboxId)) {
      throw new Error(`Outbox ID 在当前会话中不唯一：${parsed.outboxId}`);
    }
    if (
      parsed.sceneId !== event.sceneId
      || parsed.sessionEpoch !== sessionEpoch
      || parsed.eventType !== event.eventType
      || parsed.stateVersion !== event.stateVersion
      || parsed.correlationId !== event.correlationId
      || parsed.createdAt !== event.timestamp
      || parsed.availableAt !== event.timestamp
      || parsed.status !== "pending"
      || parsed.attempts !== 0
      || parsed.deliveredAt !== null
      || parsed.lastErrorCode !== null
    ) {
      throw new Error(`Outbox 元数据与所绑定世界事件不一致：${parsed.outboxId}`);
    }
    seenEventIds.add(parsed.eventId);
    seenOutboxIds.add(parsed.outboxId);
    return parsed;
  });
}

export interface EventStore {
  listSessionIds(): Promise<string[]>;
  load(sessionId: string): Promise<WorldEvent[]>;
  loadJournalSnapshot(sessionId: string): Promise<EventStoreJournalSnapshot>;
  append(
    sessionId: string,
    expectedVersion: number,
    events: WorldEvent[],
    outboxRecords: OutboxRecord[],
  ): Promise<void>;
  loadOutbox(sessionId: string): Promise<OutboxRecord[]>;
  markOutboxDelivered(sessionId: string, outboxId: string, deliveredAt: string): Promise<void>;
  markOutboxAttemptFailed(
    sessionId: string,
    outboxId: string,
    failedAt: string,
    errorCode: string,
    availableAt: string,
  ): Promise<void>;
  reset(sessionId: string): Promise<void>;
}

export class InMemoryEventStore implements EventStore {
  readonly #sessions = new Map<string, WorldEvent[]>();
  readonly #outbox = new Map<string, OutboxRecord[]>();

  async listSessionIds(): Promise<string[]> {
    return [...this.#sessions.keys()].sort();
  }

  async load(sessionId: string): Promise<WorldEvent[]> {
    return structuredClone(this.#sessions.get(sessionId) ?? []);
  }

  async loadJournalSnapshot(sessionId: string): Promise<EventStoreJournalSnapshot> {
    return {
      events: structuredClone(this.#sessions.get(sessionId) ?? []),
      outbox: structuredClone(this.#outbox.get(sessionId) ?? []),
    };
  }

  async append(
    sessionId: string,
    expectedVersion: number,
    events: WorldEvent[],
    outboxRecords: OutboxRecord[],
  ): Promise<void> {
    const current = this.#sessions.get(sessionId) ?? [];
    const actual = current.at(-1)?.stateVersion ?? 0;
    if (actual !== expectedVersion) {
      throw new StateVersionConflictError(expectedVersion, actual);
    }

    let nextVersion = actual + 1;
    for (const event of events) {
      WorldEventSchema.parse(event);
      if (event.sessionId !== sessionId || event.stateVersion !== nextVersion) {
        throw new Error(`事件序列非法：${event.eventId}`);
      }
      nextVersion += 1;
    }
    const currentOutbox = this.#outbox.get(sessionId) ?? [];
    const parsedOutbox = validateCommittedOutbox(
      sessionId,
      events,
      outboxRecords,
      current,
      currentOutbox,
    );
    this.#sessions.set(sessionId, [...current, ...structuredClone(events)]);
    this.#outbox.set(sessionId, [...currentOutbox, ...structuredClone(parsedOutbox)]);
  }

  async loadOutbox(sessionId: string): Promise<OutboxRecord[]> {
    return structuredClone(this.#outbox.get(sessionId) ?? []);
  }

  async markOutboxDelivered(sessionId: string, outboxId: string, deliveredAt: string): Promise<void> {
    const current = this.#outbox.get(sessionId) ?? [];
    const index = current.findIndex((record) => record.outboxId === outboxId);
    if (index === -1) throw new Error(`Outbox 记录不存在：${outboxId}`);
    if (current[index]?.status === "delivered") return;
    const updated = OutboxRecordSchema.parse({
      ...current[index],
      status: "delivered",
      attempts: (current[index]?.attempts ?? 0) + 1,
      deliveredAt,
      lastErrorCode: null,
    });
    this.#outbox.set(
      sessionId,
      current.map((record, recordIndex) => recordIndex === index ? updated : record),
    );
  }

  async markOutboxAttemptFailed(
    sessionId: string,
    outboxId: string,
    _failedAt: string,
    errorCode: string,
    availableAt: string,
  ): Promise<void> {
    const current = this.#outbox.get(sessionId) ?? [];
    const index = current.findIndex((record) => record.outboxId === outboxId);
    if (index === -1) throw new Error(`Outbox 记录不存在：${outboxId}`);
    if (current[index]?.status === "delivered") return;
    const updated = OutboxRecordSchema.parse({
      ...current[index],
      status: "pending",
      attempts: (current[index]?.attempts ?? 0) + 1,
      availableAt,
      deliveredAt: null,
      lastErrorCode: errorCode,
    });
    this.#outbox.set(
      sessionId,
      current.map((record, recordIndex) => recordIndex === index ? updated : record),
    );
  }

  async reset(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    this.#outbox.delete(sessionId);
  }
}

export type EventSubscriber = (event: WorldEvent) => void | Promise<void>;

export interface MessageBus {
  publish(event: WorldEvent): Promise<void>;
  subscribe(sessionId: string, subscriber: EventSubscriber): () => void;
}

export class InProcessMessageBus implements MessageBus {
  readonly #subscribers = new Map<string, Set<EventSubscriber>>();

  async publish(event: WorldEvent): Promise<void> {
    const subscribers = [...(this.#subscribers.get(event.sessionId) ?? [])];
    await Promise.all(subscribers.map(async (subscriber) => subscriber(structuredClone(event))));
  }

  subscribe(sessionId: string, subscriber: EventSubscriber): () => void {
    const subscribers = this.#subscribers.get(sessionId) ?? new Set<EventSubscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(sessionId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(sessionId);
    };
  }
}
