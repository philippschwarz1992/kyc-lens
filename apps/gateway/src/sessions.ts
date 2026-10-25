import { DurableObject } from 'cloudflare:workers';

export type SessionStatus = 'pending_capture' | 'processing' | 'delivered' | 'failed';
export interface SessionRecord {
  id: string;
  /** SHA-256 of the bearer token; the token itself is never stored. */
  tokenHash: string;
  reference?: string;
  status: SessionStatus;
  createdAt: number;
  /** End of the capture window. */
  expiresAt: number;
  captureDigest?: string;
  receivedAt?: string;
  deliveredAt?: string;
}
export type BeginCapture = { result: 'started'; record: SessionRecord } | { result: 'duplicate'; record: SessionRecord } | { result: 'conflict' } | { result: 'expired' } | { result: 'missing' };

/** The gateway's view of session state; a Durable Object per session in production, a Map in tests. */
export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  /** Atomically claims the session for one capture digest. */
  beginCapture(id: string, digest: string, receivedAt: string, now: number): Promise<BeginCapture>;
  /** Undoes a claim whose files could not be staged, so the client can retry. */
  abandonCapture(id: string, digest: string): Promise<void>;
  setStatus(id: string, status: SessionStatus, now: number): Promise<void>;
}

/** Session records outlive the capture window so the customer backend can still read the final status. */
const RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class CaptureSession extends DurableObject {
  async create(record: SessionRecord): Promise<void> {
    if (await this.ctx.storage.get('record')) throw new Error('Session exists.');
    await this.ctx.storage.put('record', record);
    await this.ctx.storage.setAlarm(record.expiresAt);
  }
  async read(): Promise<SessionRecord | null> { return (await this.ctx.storage.get<SessionRecord>('record')) ?? null; }
  async beginCapture(digest: string, receivedAt: string, now: number): Promise<BeginCapture> {
    const record = await this.read();
    if (!record) return { result: 'missing' };
    if (record.captureDigest) return record.captureDigest === digest ? { result: 'duplicate', record } : { result: 'conflict' };
    if (record.expiresAt <= now) return { result: 'expired' };
    const next = { ...record, captureDigest: digest, receivedAt, status: 'processing' as const };
    await this.ctx.storage.put('record', next);
    await this.ctx.storage.setAlarm(now + RECORD_RETENTION_MS);
    return { result: 'started', record: next };
  }
  async abandonCapture(digest: string): Promise<void> {
    const record = await this.read();
    if (!record || record.captureDigest !== digest || record.status !== 'processing') return;
    const { captureDigest: _digest, receivedAt: _received, ...rest } = record;
    await this.ctx.storage.put('record', { ...rest, status: 'pending_capture' });
    await this.ctx.storage.setAlarm(record.expiresAt);
  }
  async setStatus(status: SessionStatus, now: number): Promise<void> {
    const record = await this.read();
    if (!record) return;
    await this.ctx.storage.put('record', { ...record, status, ...(status === 'delivered' ? { deliveredAt: new Date(now).toISOString() } : {}) });
  }
  /** A session that never received a capture disappears after its window; others after the retention period. */
  override async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

export function durableSessionStore(namespace: DurableObjectNamespace<CaptureSession>): SessionStore {
  const stub = (id: string) => namespace.get(namespace.idFromName(id));
  return {
    create: record => stub(record.id).create(record),
    get: id => stub(id).read(),
    beginCapture: (id, digest, receivedAt, now) => stub(id).beginCapture(digest, receivedAt, now),
    abandonCapture: (id, digest) => stub(id).abandonCapture(digest),
    setStatus: (id, status, now) => stub(id).setStatus(status, now),
  };
}
