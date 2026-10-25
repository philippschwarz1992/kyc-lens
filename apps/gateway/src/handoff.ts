import { DurableObject } from 'cloudflare:workers';
import { json } from './http.js';

const HANDOFF_TTL_MS = 15 * 60_000;
const HANDOFF_ID = /^[A-Za-z0-9_-]{22,64}$/;

// One object per handoff id holds the phone's capture summary (metadata only, never media) for 15 minutes.
export class HandoffRelay extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const summary = await this.ctx.storage.get('summary');
      return summary ? json({ status: 'complete', summary }) : json({ status: 'pending' });
    }
    if (await this.ctx.storage.get('summary')) return json({ error: 'This handoff is already complete.' }, 409);
    const text = await request.text();
    if (text.length > 8192) return json({ error: 'Summary too large.' }, 413);
    let summary: unknown;
    try { summary = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!summary || typeof summary !== 'object' || Array.isArray(summary) || (summary as { status?: unknown }).status !== 'capture_complete') return json({ error: 'Invalid summary.' }, 400);
    await this.ctx.storage.put('summary', summary);
    await this.ctx.storage.setAlarm(Date.now() + HANDOFF_TTL_MS);
    return json({ status: 'complete' }, 201);
  }
  override async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

export async function handoff(request: Request, relay: DurableObjectNamespace, pathname: string): Promise<Response> {
  if (pathname === '/api/handoff') return request.method === 'GET' ? json({ available: true }) : json({ error: 'Method not allowed.' }, 405);
  const id = pathname.slice('/api/handoff/'.length);
  if (!HANDOFF_ID.test(id)) return json({ error: 'Unknown handoff.' }, 404);
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  } else if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  return relay.get(relay.idFromName(id)).fetch(request);
}
