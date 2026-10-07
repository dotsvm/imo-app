/**
 * In-memory twins of the platform ports. They back tests and the demo
 * profile, and every one passes the same conformance kit as its production
 * counterpart — so a test against memory says something true about prod.
 */
import type { Clock } from "@imo/core/ports/runtime";
import type {
  Cache,
  Channel,
  DomainEvent,
  EventBus,
  FeatureFlags,
  FlagContext,
  Job,
  JobOptions,
  JobQueue,
  MailMessage,
  Mailer,
  ObjectStorage,
  RealtimeFeed,
  RealtimeMessage,
  RealtimePublisher,
  StoredObject,
  UploadTicket,
} from "@imo/core/ports/platform";
import { safeStorageKey } from "@imo/core/ports/platform";
import { systemClock } from "./runtime";

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;

export class MemoryCache implements Cache {
  private entries = new Map<string, { value: unknown; expires: number }>();
  constructor(private readonly clock: Clock = systemClock) {}
  async get<T>(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.clock.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.value) as T;
  }
  async set<T>(key: string, value: T, ttlSeconds: number) {
    if (!(ttlSeconds > 0)) throw new RangeError("TTL must be positive");
    this.entries.set(key, {
      value: structuredClone(value),
      expires: this.clock.now().getTime() + ttlSeconds * 1000,
    });
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

interface Pending {
  job: Job;
  runAt: number;
  attempts: number;
  key?: string;
}

/**
 * Jobs run when `drain()` is called — deterministic for tests, and driven by
 * a timer in the demo. Failures retry with exponential backoff until their
 * attempts run out, then land in `dead`.
 */
export class MemoryJobQueue implements JobQueue {
  private pending: Pending[] = [];
  private handlers = new Map<string, (job: Job) => Promise<void>>();
  readonly dead: Job[] = [];
  constructor(
    private readonly clock: Clock = systemClock,
    private readonly backoffMs = (attempt: number) => 2 ** attempt * 1000,
  ) {}

  async enqueue<P>(name: string, payload: P, options: JobOptions = {}) {
    if (options.key && this.pending.some((p) => p.key === options.key))
      return null;
    const job: Job = {
      id: nextId("job"),
      name,
      payload: structuredClone(payload),
      attempt: 0,
    };
    this.pending.push({
      job,
      runAt: (options.runAt ?? this.clock.now()).getTime(),
      attempts: options.attempts ?? 5,
      key: options.key,
    });
    return job.id;
  }

  work<P>(name: string, handler: (job: Job<P>) => Promise<void>) {
    this.handlers.set(name, handler as (job: Job) => Promise<void>);
    return () => void this.handlers.delete(name);
  }

  /** Run every job that's due and has a handler. */
  async drain() {
    const now = this.clock.now().getTime();
    const due = this.pending.filter(
      (p) => p.runAt <= now && this.handlers.has(p.job.name),
    );
    let ran = 0;
    for (const item of due) {
      this.pending.splice(this.pending.indexOf(item), 1);
      const job = { ...item.job, attempt: item.job.attempt + 1 };
      try {
        await this.handlers.get(job.name)!(job);
        ran++;
      } catch {
        if (job.attempt >= item.attempts) this.dead.push(job);
        else
          this.pending.push({
            ...item,
            job,
            runAt: now + this.backoffMs(job.attempt),
          });
      }
    }
    return { ran, waiting: this.pending.length };
  }
}

export class MemoryEventBus implements EventBus {
  readonly published: DomainEvent[] = [];
  private handlers = new Map<
    string,
    Set<(event: DomainEvent) => Promise<void> | void>
  >();
  async publish(event: DomainEvent) {
    this.published.push(event);
    for (const handler of this.handlers.get(event.type) ?? [])
      await handler(event);
  }
  subscribe(
    type: string,
    handler: (event: DomainEvent) => Promise<void> | void,
  ) {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler);
    this.handlers.set(type, set);
    return () => void set.delete(handler);
  }
}

export class MemoryRealtime implements RealtimePublisher, RealtimeFeed {
  readonly messages: RealtimeMessage[] = [];
  private listeners = new Set<{
    channels: ReadonlySet<Channel>;
    handler: (message: RealtimeMessage) => void;
  }>();
  async publish(channel: Channel, event: string, payload: unknown) {
    const message = { channel, event, payload: structuredClone(payload) };
    this.messages.push(message);
    for (const listener of this.listeners)
      if (listener.channels.has(channel)) listener.handler(message);
  }
  subscribe(
    channels: readonly Channel[],
    handler: (message: RealtimeMessage) => void,
  ) {
    const listener = { channels: new Set(channels), handler };
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  private keys = new Set<string>();
  async send(message: MailMessage) {
    if (this.keys.has(message.idempotencyKey)) return;
    this.keys.add(message.idempotencyKey);
    this.sent.push(structuredClone(message));
  }
}

/** Tickets are remembered; `put` stands in for the browser's upload. */
export class MemoryStorage implements ObjectStorage {
  readonly tickets = new Map<string, { contentType: string; maxBytes: number }>();
  readonly objects = new Map<string, StoredObject>();
  constructor(private readonly clock: Clock = systemClock) {}
  async signUpload(
    key: string,
    options: { contentType: string; maxBytes: number },
  ): Promise<UploadTicket> {
    if (!safeStorageKey(key)) throw new RangeError(`Unsafe storage key: ${key}`);
    this.tickets.set(key, options);
    return {
      url: `memory://uploads/${key}`,
      expiresAt: new Date(
        this.clock.now().getTime() + 5 * 60_000,
      ).toISOString(),
    };
  }
  /** The upload itself: refused without a ticket or past its limits. */
  put(key: string, contentType: string, bytes: number) {
    const ticket = this.tickets.get(key);
    if (!ticket || ticket.contentType !== contentType || bytes > ticket.maxBytes)
      throw new RangeError(`Upload refused: ${key}`);
    this.objects.set(key, { contentType, bytes });
  }
  publicUrl(key: string) {
    return `/memory-storage/${key}`;
  }
  async stat(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.tickets.delete(key);
  }
}

/** Flags from a fixed set, optionally targeted by a predicate. */
export class MemoryFlags implements FeatureFlags {
  constructor(
    private readonly on: Record<
      string,
      boolean | ((context: FlagContext) => boolean)
    > = {},
  ) {}
  async enabled(flag: string, context: FlagContext = {}) {
    const rule = this.on[flag];
    return typeof rule === "function" ? rule(context) : rule === true;
  }
}
