import { DELIVERY_HEADER, isVerificationResult, SIGNATURE_HEADER, signDelivery, type VerificationEvent, type VerificationResult } from '@kyc-lens/contracts';
import type { SessionStore } from './sessions.js';
import { analysisKey, captureKey, stagingPrefix, type StagedCapture, type Staging } from './staging.js';

export interface DeliveryConfig {
  webhookUrl: string;
  webhookSecret: string;
  /** After this many failed analysis attempts the images are delivered without a verdict, for manual review. */
  analysisAttempts: number;
  /** After this many failed deliveries the job stops retrying; staged files stay until the bucket lifecycle removes them. */
  deliveryAttempts: number;
}
export interface DeliveryDeps {
  config: DeliveryConfig;
  sessions: SessionStore;
  staging: Staging;
  analyze(form: FormData): Promise<unknown>;
  fetch(request: Request): Promise<Response>;
  now(): number;
}
export type DeliveryOutcome = 'delivered' | 'already-delivered' | 'retry' | 'failed';

const decoder = new TextDecoder();

async function readJson<T>(staging: Staging, key: string): Promise<T | null> {
  const bytes = await staging.get(key);
  return bytes ? JSON.parse(decoder.decode(bytes)) as T : null;
}

async function mediaForm(staging: Staging, staged: StagedCapture, form = new FormData()): Promise<FormData> {
  for (const file of staged.files) {
    const bytes = await staging.get(file.key);
    if (!bytes) throw new Error('Staged media missing.');
    form.append(file.field, new Blob([bytes], { type: file.type }), file.filename);
  }
  return form;
}

/**
 * One delivery attempt for a session (a Queue message). `attempt` starts at 1.
 * Analysis results are cached in staging, so a failed webhook never re-runs analysis.
 */
export async function deliver(sessionId: string, attempt: number, deps: DeliveryDeps): Promise<DeliveryOutcome> {
  const staged = await readJson<StagedCapture>(deps.staging, captureKey(sessionId));
  if (!staged) return 'already-delivered';
  let cached = await readJson<{ analysis: VerificationResult | null; analysisError?: string }>(deps.staging, analysisKey(sessionId));
  if (!cached) {
    try {
      const form = await mediaForm(deps.staging, staged);
      form.append('metadata', JSON.stringify(staged.metadata));
      const result = await deps.analyze(form);
      if (!isVerificationResult(result)) throw new Error('Analysis returned an unexpected shape.');
      cached = { analysis: result };
    } catch (error) {
      console.error('analysis failed', error instanceof Error ? error.message.slice(0, 120) : 'unknown');
      if (attempt < deps.config.analysisAttempts) return 'retry';
      cached = { analysis: null, analysisError: 'analysis_unavailable' };
    }
    await deps.staging.put(analysisKey(sessionId), JSON.stringify(cached), 'application/json');
  }
  const event: VerificationEvent = {
    type: 'verification.completed', sessionId, receivedAt: staged.receivedAt, metadata: staged.metadata,
    analysis: cached.analysis, ...(cached.analysisError ? { analysisError: cached.analysisError } : {}),
    ...(staged.reference ? { reference: staged.reference } : {}),
    files: staged.files.map(({ field, filename, type, sizeBytes }) => ({ field, filename, type, sizeBytes })),
  };
  const form = new FormData();
  form.append('event', new Blob([JSON.stringify(event)], { type: 'application/json' }), 'event.json');
  await mediaForm(deps.staging, staged, form);
  // Sign the exact bytes sent: serialize the multipart body once.
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const signature = await signDelivery(deps.config.webhookSecret, body, Math.floor(deps.now() / 1000));
  let delivered = false;
  try {
    const response = await deps.fetch(new Request(deps.config.webhookUrl, {
      method: 'POST', body,
      headers: { 'Content-Type': encoded.headers.get('Content-Type')!, [SIGNATURE_HEADER]: signature, [DELIVERY_HEADER]: sessionId, 'User-Agent': 'kyc-lens-gateway' },
    }));
    delivered = response.ok;
    if (!delivered) console.error('webhook rejected', response.status);
  } catch (error) {
    console.error('webhook unreachable', error instanceof Error ? error.name : 'unknown');
  }
  if (!delivered) {
    if (attempt < deps.config.deliveryAttempts) return 'retry';
    await deps.sessions.setStatus(sessionId, 'failed', deps.now());
    return 'failed';
  }
  // The customer backend now holds the case: remove every staged copy.
  await deps.staging.deletePrefix(stagingPrefix(sessionId));
  await deps.sessions.setStatus(sessionId, 'delivered', deps.now());
  return 'delivered';
}

/** Exponential backoff for Queue retries: 10 s, 20 s, 40 s … capped at 15 minutes. */
export const retryDelaySeconds = (attempt: number) => Math.min(900, 10 * 2 ** Math.max(0, attempt - 1));
