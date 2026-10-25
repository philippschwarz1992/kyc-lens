// Deploy: npm run deploy:cloudflare. Upload the SFace model to R2 once per model change:
// npx wrangler@4 r2 object put kyc-lens-demo-assets/kyc-assets/matching/face_recognition_sface_2021dec.onnx --file apps/playground/public/kyc-assets/matching/face_recognition_sface_2021dec.onnx --remote
// Serves the static playground; files above the 25 MiB asset limit come from R2 on the same origin,
// because the matching worker rejects cross-origin model URLs and redirects.
// With the verification bindings (`--env verify`), it also runs the capture API and delivers to the customer backend.
import { Container, getRandom } from '@cloudflare/containers';
import { handleApi, type DeliveryJob } from './api.js';
import { deliver, retryDelaySeconds } from './delivery.js';
import { handoff } from './handoff.js';
import { json } from './http.js';
import { durableSessionStore, type CaptureSession } from './sessions.js';
import { r2Staging } from './staging.js';

export { HandoffRelay } from './handoff.js';
export { CaptureSession } from './sessions.js';

export interface Env {
  ASSETS: Fetcher;
  HANDOFF: DurableObjectNamespace;
  LARGE_ASSETS: R2Bucket;
  // Verification pipeline: absent in the playground-only deployment.
  SESSIONS?: DurableObjectNamespace<CaptureSession>;
  KYC_STAGING?: R2Bucket;
  DELIVERY?: Queue<DeliveryJob>;
  ANALYSIS?: DurableObjectNamespace<AnalysisContainer>;
  /** Overrides the container, e.g. `http://127.0.0.1:8080` for a locally running analysis service. */
  ANALYSIS_URL?: string;
  ANALYSIS_SECRET?: string;
  ANALYSIS_INSTANCES?: string;
  SESSION_MODE?: string;
  SESSION_TTL_MINUTES?: string;
  API_KEY?: string;
  WEBHOOK_URL?: string;
  WEBHOOK_SECRET?: string;
}

/** The Python analysis service (`services/analysis`) in a Cloudflare Container. */
export class AnalysisContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '10m';
  override envVars = { ANALYSIS_SECRET: this.env.ANALYSIS_SECRET ?? '' };
}

async function analyze(env: Env, form: FormData): Promise<unknown> {
  const headers = { 'X-Analysis-Secret': env.ANALYSIS_SECRET ?? '' };
  let response: Response;
  if (env.ANALYSIS_URL) response = await fetch(new Request(`${env.ANALYSIS_URL.replace(/\/$/, '')}/analyze`, { method: 'POST', body: form, headers }));
  else if (env.ANALYSIS) {
    const container = await getRandom(env.ANALYSIS, Math.max(1, Number(env.ANALYSIS_INSTANCES) || 2));
    response = await container.fetch(new Request('http://analysis/analyze', { method: 'POST', body: form, headers }));
  } else throw new Error('No analysis service configured.');
  if (!response.ok) throw new Error(`Analysis responded ${response.status}.`);
  return response.json();
}

function pipeline(env: Env) {
  if (!env.SESSIONS || !env.KYC_STAGING || !env.DELIVERY || !env.WEBHOOK_URL || !env.WEBHOOK_SECRET) return null;
  return { sessions: durableSessionStore(env.SESSIONS), staging: r2Staging(env.KYC_STAGING), queue: env.DELIVERY, webhookUrl: env.WEBHOOK_URL, webhookSecret: env.WEBHOOK_SECRET };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/handoff' || pathname.startsWith('/api/handoff/')) return handoff(request, env.HANDOFF, pathname);
    if (pathname.startsWith('/api/kyc/')) {
      const parts = pipeline(env);
      if (!parts) return json({ error: 'Server-side verification is not configured on this deployment.' }, 404);
      return handleApi(request, {
        config: { sessionMode: env.SESSION_MODE === 'open' ? 'open' : 'server', apiKey: env.API_KEY, sessionTtlMs: (Number(env.SESSION_TTL_MINUTES) || 15) * 60_000 },
        sessions: parts.sessions, staging: parts.staging, now: Date.now,
        enqueue: async job => { await parts.queue.send(job); },
      }, pathname);
    }
    if (pathname.startsWith('/kyc-assets/matching/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const object = await env.LARGE_ASSETS.get(pathname.slice(1));
      if (object) {
        const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', ETag: object.httpEtag, 'X-Content-Type-Options': 'nosniff' });
        return new Response(request.method === 'HEAD' ? null : object.body, { headers });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<DeliveryJob>, env: Env): Promise<void> {
    const parts = pipeline(env);
    if (!parts) { batch.retryAll(); return; }
    for (const message of batch.messages) {
      const outcome = await deliver(message.body.sessionId, message.attempts, {
        config: { webhookUrl: parts.webhookUrl, webhookSecret: parts.webhookSecret, analysisAttempts: 3, deliveryAttempts: 10 },
        sessions: parts.sessions, staging: parts.staging, now: Date.now,
        analyze: form => analyze(env, form), fetch: request => fetch(request),
      }).catch(() => 'retry' as const);
      if (outcome === 'retry') message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      else message.ack();
    }
  },
};
