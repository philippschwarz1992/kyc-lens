// Deploy: npm run deploy:cloudflare. Upload the SFace model to R2 once per model change:
// npx wrangler@4 r2 object put kyc-lens-demo-assets/kyc-assets/matching/face_recognition_sface_2021dec.onnx --file demo/public/kyc-assets/matching/face_recognition_sface_2021dec.onnx --remote
// Serves the static playground; files above the 25 MiB asset limit come from R2 on the same origin,
// because the matching worker rejects cross-origin model URLs and redirects.
import { DurableObject } from 'cloudflare:workers';

const HANDOFF_TTL_MS = 15 * 60_000;
const HANDOFF_ID = /^[A-Za-z0-9_-]{22,64}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// One object per handoff id holds the phone's capture summary (metadata only, never media) for 15 minutes.
export class HandoffRelay extends DurableObject {
  async fetch(request) {
    if (request.method === 'GET') {
      const summary = await this.ctx.storage.get('summary');
      return summary ? json({ status: 'complete', summary }) : json({ status: 'pending' });
    }
    if (await this.ctx.storage.get('summary')) return json({ error: 'This handoff is already complete.' }, 409);
    const text = await request.text();
    if (text.length > 8192) return json({ error: 'Summary too large.' }, 413);
    let summary;
    try { summary = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!summary || typeof summary !== 'object' || Array.isArray(summary) || summary.status !== 'capture_complete') return json({ error: 'Invalid summary.' }, 400);
    await this.ctx.storage.put('summary', summary);
    await this.ctx.storage.setAlarm(Date.now() + HANDOFF_TTL_MS);
    return json({ status: 'complete' }, 201);
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

async function handoff(request, env, pathname) {
  if (pathname === '/api/handoff') return request.method === 'GET' ? json({ available: true }) : json({ error: 'Method not allowed.' }, 405);
  const id = pathname.slice('/api/handoff/'.length);
  if (!HANDOFF_ID.test(id)) return json({ error: 'Unknown handoff.' }, 404);
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  } else if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  return env.HANDOFF.get(env.HANDOFF.idFromName(id)).fetch(request);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/handoff' || pathname.startsWith('/api/handoff/')) return handoff(request, env, pathname);
    if (pathname.startsWith('/kyc-assets/matching/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const object = await env.LARGE_ASSETS.get(pathname.slice(1));
      if (object) {
        const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', ETag: object.httpEtag, 'X-Content-Type-Options': 'nosniff' });
        return new Response(request.method === 'HEAD' ? null : object.body, { headers });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
