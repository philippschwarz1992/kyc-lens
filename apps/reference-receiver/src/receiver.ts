import { SIGNATURE_HEADER, verifyDelivery, type VerificationEvent } from '@kyc-lens/contracts';

/**
 * Reference receiver for gateway deliveries: the part a CRM or case-management system implements.
 * It verifies the signature over the raw body, stores the case once per session and serves a small case list.
 */
export interface CaseRow { sessionId: string; reference: string | null; status: string | null; receivedAt: string; deliveredAt: string; event: VerificationEvent }
export interface CaseStore {
  /** Returns false when the session is already stored (a redelivery). */
  insert(row: CaseRow): Promise<boolean>;
  list(limit: number): Promise<CaseRow[]>;
  get(sessionId: string): Promise<CaseRow | null>;
}
export interface FileStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
export interface ReceiverDeps { secret: string; cases: CaseStore; files: FileStore; now(): number; username?: string; password?: string }

const SESSION_ID = /^[0-9a-f-]{36}$/;
const FILE_NAME = /^(?:selfie|face-video|document-front|document-back)\.(?:jpg|png|webp|webm|mp4)$/;
const text = (body: string, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'" } });
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const fileKey = (sessionId: string, filename: string) => `cases/${sessionId}/${filename}`;

export async function receive(request: Request, deps: ReceiverDeps): Promise<Response> {
  const body = new Uint8Array(await request.arrayBuffer());
  // Verify before parsing: an unsigned body is never read further.
  if (!(await verifyDelivery(deps.secret, request.headers.get(SIGNATURE_HEADER), body, Math.floor(deps.now() / 1000)))) return text('Invalid signature.', 401);
  let form: FormData;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' }, body }).formData(); }
  catch { return text('Invalid body.', 400); }
  const eventPart = form.get('event');
  if (!(eventPart instanceof Blob)) return text('Missing event.', 400);
  const event = JSON.parse(await eventPart.text()) as VerificationEvent;
  if (event.type !== 'verification.completed' || !SESSION_ID.test(event.sessionId)) return text('Unknown event.', 400);
  for (const file of event.files) {
    const part = form.get(file.field);
    if (!(part instanceof Blob) || !FILE_NAME.test(file.filename)) return text('Missing media.', 400);
    await deps.files.put(fileKey(event.sessionId, file.filename), new Uint8Array(await part.arrayBuffer()), file.type);
  }
  const inserted = await deps.cases.insert({ sessionId: event.sessionId, reference: event.reference ?? null, status: event.analysis?.status ?? null,
    receivedAt: event.receivedAt, deliveredAt: new Date(deps.now()).toISOString(), event });
  // 200 for a redelivery too, so the gateway stops retrying.
  return text(inserted ? 'Stored.' : 'Already stored.');
}

function authorized(request: Request, deps: ReceiverDeps): boolean {
  if (!deps.username || !deps.password) return false;
  const expected = `Basic ${btoa(`${deps.username}:${deps.password}`)}`;
  const supplied = request.headers.get('Authorization') ?? '';
  let difference = expected.length ^ supplied.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
  return difference === 0;
}

const page = (title: string, content: string) => text(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px auto;max-width:960px;padding:0 16px;color:#17202a}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #dde3ea;text-align:left}
.approved{color:#137a3f}.review{color:#a15c00}.rejected{color:#b42318}img,video{max-width:100%;border-radius:8px;border:1px solid #dde3ea}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}pre{background:#f4f6f8;padding:12px;overflow:auto;border-radius:8px}</style></head><body>${content}</body></html>`, 200, 'text/html; charset=utf-8');

export async function browse(request: Request, deps: ReceiverDeps, pathname: string): Promise<Response> {
  if (!authorized(request, deps)) return new Response('Authentication required.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="KYC cases"' } });
  if (pathname === '/') {
    const rows = await deps.cases.list(100);
    return page('KYC cases', `<h1>KYC cases</h1><table><tr><th>Delivered</th><th>Reference</th><th>Status</th><th>Session</th></tr>${rows.map(row =>
      `<tr><td>${escape(row.deliveredAt)}</td><td>${escape(row.reference)}</td><td class="${escape(row.status)}">${escape(row.status ?? 'no verdict')}</td><td><a href="/cases/${escape(row.sessionId)}">${escape(row.sessionId)}</a></td></tr>`).join('')}</table>`);
  }
  const detail = /^\/cases\/([0-9a-f-]{36})$/.exec(pathname);
  if (detail) {
    const row = await deps.cases.get(detail[1]!);
    if (!row) return text('Not found.', 404);
    const media = row.event.files.map(file => file.type.startsWith('video/')
      ? `<figure><video controls src="/cases/${row.sessionId}/files/${escape(file.filename)}"></video><figcaption>${escape(file.field)}</figcaption></figure>`
      : `<figure><img alt="${escape(file.field)}" src="/cases/${row.sessionId}/files/${escape(file.filename)}"><figcaption>${escape(file.field)}</figcaption></figure>`).join('');
    const analysis = row.event.analysis;
    return page(`Case ${row.sessionId}`, `<p><a href="/">All cases</a></p><h1 class="${escape(row.status)}">${escape(row.status ?? 'No verdict')}</h1>
<p>Reference ${escape(row.reference ?? '–')} · received ${escape(row.receivedAt)}${row.event.analysisError ? ` · analysis: ${escape(row.event.analysisError)}` : ''}</p>
${analysis?.reasons.length ? `<p>Reasons: ${analysis.reasons.map(escape).join(', ')}</p>` : ''}<div class="grid">${media}</div><h2>Result</h2><pre>${escape(JSON.stringify(analysis, null, 2))}</pre>`);
  }
  const file = /^\/cases\/([0-9a-f-]{36})\/files\/([\w.-]+)$/.exec(pathname);
  if (file && FILE_NAME.test(file[2]!)) {
    const object = await deps.files.get(fileKey(file[1]!, file[2]!));
    if (!object) return text('Not found.', 404);
    return new Response(object.bytes, { headers: { 'Content-Type': object.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return text('Not found.', 404);
}
