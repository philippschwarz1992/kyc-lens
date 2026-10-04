import type { CapturePayload, KycApi, KycSession } from './types';

export class KycHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'KycHttpError';
    this.status = status;
  }
}

async function checkedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    let reason = `Request failed (${response.status}).`;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') reason = body.error;
    } catch { /* Keep the HTTP status if the server did not send JSON. */ }
    throw new KycHttpError(reason, response.status);
  }
  return response.json();
}

/** Same-origin-friendly HTTP contract. Token is scoped to one capture session. */
export function createHttpApi(baseUrl: string, extraHeaders?: HeadersInit): KycApi {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async createSession(signal) {
      const headers = new Headers(extraHeaders);
      headers.set('Content-Type', 'application/json');
      const data = await checkedJson(await fetch(`${base}/sessions`, {
        method: 'POST', headers, body: '{}', credentials: 'same-origin', signal,
      })) as Partial<KycSession>;
      if (typeof data?.id !== 'string' || !data.id || (data.token !== undefined && typeof data.token !== 'string')) {
        throw new Error('The session endpoint returned an invalid session.');
      }
      return { id: data.id, token: data.token };
    },
    async submitCapture(session, payload: CapturePayload, signal) {
      const body = new FormData();
      body.append('selfie', payload.selfie, payload.selfie.type === 'image/png' ? 'selfie.png' : 'selfie.jpg');
      if (payload.video) {
        const videoType = payload.video.type.split(';', 1)[0].trim().toLowerCase();
        body.append('faceVideo', payload.video, videoType === 'video/mp4' ? 'face-video.mp4' : 'face-video.webm');
      }
      if (payload.document) {
        body.append('documentFront', payload.document.front, payload.document.front.type === 'image/png' ? 'document-front.png' : 'document-front.jpg');
        if (payload.document.back) body.append('documentBack', payload.document.back, payload.document.back.type === 'image/png' ? 'document-back.png' : 'document-back.jpg');
      }
      body.append('metadata', JSON.stringify({ challenges: payload.challenges, capturedAt: payload.capturedAt, mode: payload.mode, ...(payload.document ? { document: { type: payload.document.type } } : {}) }));
      const headers = new Headers(extraHeaders);
      headers.delete('Content-Type'); // The browser supplies the multipart boundary.
      if (session.token) headers.set('Authorization', `Bearer ${session.token}`);
      return checkedJson(await fetch(`${base}/sessions/${encodeURIComponent(session.id)}/capture`, {
        method: 'POST', headers, body, credentials: 'same-origin', signal,
      }));
    },
  };
}
