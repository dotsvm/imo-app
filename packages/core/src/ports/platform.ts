/**
 * Platform ports: what the application needs from infrastructure, stated
 * without naming a provider. Each has an in-memory twin (packages/server/src/adapters/memory)
 * and a conformance kit; production adapters are chosen in the composition
 * root. Swapping a provider never touches code that uses these.
 */

// ------------------------------------------------------------------ cache
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  /** Store a value until `ttlSeconds` pass. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// ------------------------------------------------------------------- jobs
export interface JobOptions {
  /** At most one pending job per key: a duplicate enqueue is dropped. */
  key?: string;
  /** Run no earlier than this. */
  runAt?: Date;
  /** Attempts before the job is dead-lettered. Defaults to 5. */
  attempts?: number;
}

export interface Job<P = unknown> {
  id: string;
  name: string;
  payload: P;
  attempt: number;
}

/** At-least-once delivery: handlers must be idempotent. */
export interface JobQueue {
  /** The job id, or null when a pending job with the same key exists. */
  enqueue<P>(
    name: string,
    payload: P,
    options?: JobOptions,
  ): Promise<string | null>;
  /** Register a handler. Throwing retries the job with backoff. */
  work<P>(name: string, handler: (job: Job<P>) => Promise<void>): () => void;
  /** Claim and run due jobs that have a handler here. Workers call this on a
      timer; tests call it to run jobs deterministically. */
  drain(): Promise<{ ran: number; waiting: number }>;
}

// ----------------------------------------------------------------- events
/** Something that happened, recorded in the same transaction as the change
    that caused it, then relayed to realtime, notifications and analytics. */
export interface DomainEvent<P = unknown> {
  id: string;
  type: string;
  /** What changed: "order:…", "post:…", "room:…". */
  subject: string;
  payload: P;
  at: string;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(
    type: string,
    handler: (event: DomainEvent) => Promise<void> | void,
  ): () => void;
}

// --------------------------------------------------------------- realtime
/** Logical channels. Adapters map them onto a provider's naming and auth. */
export type Channel =
  `market:${string}` | `user:${string}` | `room:${string}` | `post:${string}`;

export const channels = {
  market: (id: string): Channel => `market:${id}`,
  user: (id: string): Channel => `user:${id}`,
  room: (id: string): Channel => `room:${id}`,
  post: (id: string): Channel => `post:${id}`,
};

export interface RealtimePublisher {
  publish(channel: Channel, event: string, payload: unknown): Promise<void>;
}

/** Market and post channels are open to anyone; user and room channels only
    to their owner and members. */
export const isPrivateChannel = (channel: Channel) =>
  channel.startsWith("user:") || channel.startsWith("room:");

export interface RealtimeMessage {
  channel: Channel;
  event: string;
  payload: unknown;
}

/** Listening on the server, for transports the API relays itself (SSE). */
export interface RealtimeFeed {
  subscribe(
    channels: readonly Channel[],
    handler: (message: RealtimeMessage) => void,
  ): () => void;
}

/** How a browser connects: straight to the provider, or through the API. */
export type RealtimeTransport =
  | { kind: "supabase"; url: string; key: string }
  | { kind: "sse"; url: string }
  | { kind: "none" };

// ------------------------------------------------------------------- mail
export interface MailMessage {
  /** One of our own templates; providers only deliver. */
  template: string;
  to: string;
  data: Record<string, unknown>;
  /** Sending twice with the same key delivers once. */
  idempotencyKey: string;
  /** One-click unsubscribe (RFC 8058) for this kind of email. */
  unsubscribeUrl?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

// ---------------------------------------------------------------- storage
export interface UploadTicket {
  url: string;
  /** Form fields to send with the upload, when the provider needs them. */
  fields?: Record<string, string>;
  expiresAt: string;
}

export interface StoredObject {
  contentType: string;
  bytes: number;
}

export interface ObjectStorage {
  /** Permission for the browser to upload one object straight to storage. */
  signUpload(
    key: string,
    options: { contentType: string; maxBytes: number },
  ): Promise<UploadTicket>;
  publicUrl(key: string): string;
  /** What was actually uploaded, or null when nothing was. */
  stat(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Present on stores the API serves itself (local disk). */
  serve?: {
    /** Take an upload made with a ticket's token. */
    accept(
      key: string,
      token: string,
      contentType: string,
      body: ReadableStream<Uint8Array>,
    ): Promise<StoredObject>;
    open(
      key: string,
    ): Promise<(StoredObject & { body: ReadableStream<Uint8Array> }) | null>;
  };
}

/** Keys are paths of safe segments: no traversal, no surprises. */
export const safeStorageKey = (key: string) =>
  /^[A-Za-z0-9][\w\-]*(\/[\w\-]+)*\.[a-z0-9]{2,5}$/.test(key) &&
  !key.includes("..");

// ------------------------------------------------------------------ flags
export interface FlagContext {
  userId?: string;
  cohort?: string;
  venueId?: string;
}

export interface FeatureFlags {
  enabled(flag: string, context?: FlagContext): Promise<boolean>;
  /** Drop any cached values: after an admin changes a flag. */
  invalidate?(): void;
}
