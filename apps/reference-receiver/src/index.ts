// Reference receiver: stand-in for the CRM that keeps verified cases. Replace it with your own system.
// Secrets: WEBHOOK_SECRET (same as the gateway's), VIEWER_USERNAME and VIEWER_PASSWORD for the case list.
import { browse, receive, type CaseRow, type CaseStore, type FileStore } from './receiver.js';

export interface Env { DB: D1Database; CASE_FILES: R2Bucket; WEBHOOK_SECRET: string; VIEWER_USERNAME?: string; VIEWER_PASSWORD?: string }

function d1Cases(db: D1Database): CaseStore {
  const toRow = (row: Record<string, unknown>): CaseRow => ({ sessionId: String(row.session_id), reference: row.reference as string | null, status: row.status as string | null,
    receivedAt: String(row.received_at), deliveredAt: String(row.delivered_at), event: JSON.parse(String(row.event_json)) });
  return {
    async insert(row) {
      const result = await db.prepare('INSERT OR IGNORE INTO cases (session_id, reference, status, received_at, delivered_at, event_json) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.sessionId, row.reference, row.status, row.receivedAt, row.deliveredAt, JSON.stringify(row.event)).run();
      return result.meta.changes > 0;
    },
    async list(limit) { return (await db.prepare('SELECT * FROM cases ORDER BY delivered_at DESC LIMIT ?').bind(limit).all()).results.map(toRow); },
    async get(sessionId) { const row = await db.prepare('SELECT * FROM cases WHERE session_id = ?').bind(sessionId).first(); return row ? toRow(row) : null; },
  };
}

function r2Files(bucket: R2Bucket): FileStore {
  return {
    async put(key, bytes, contentType) { await bucket.put(key, bytes, { httpMetadata: { contentType } }); },
    async get(key) {
      const object = await bucket.get(key);
      return object ? { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType ?? 'application/octet-stream' } : null;
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const deps = { secret: env.WEBHOOK_SECRET, cases: d1Cases(env.DB), files: r2Files(env.CASE_FILES), now: Date.now, username: env.VIEWER_USERNAME, password: env.VIEWER_PASSWORD };
    if (pathname === '/webhooks/kyc') return request.method === 'POST' ? receive(request, deps) : new Response('Method not allowed.', { status: 405 });
    if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 });
    return browse(request, deps, pathname);
  },
};
