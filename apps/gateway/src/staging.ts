import type { Applicant, CaptureField, CaptureMetadata } from '@kyc-lens/contracts';

/** What the gateway keeps between upload and delivery, under `sessions/<id>/` in the staging bucket. */
export interface StagedCapture {
  sessionId: string;
  reference?: string;
  applicant?: Applicant;
  receivedAt: string;
  metadata: CaptureMetadata;
  files: Array<{ field: CaptureField; filename: string; type: string; sizeBytes: number; key: string }>;
}

/** The subset of an R2 bucket the gateway uses; an in-memory map in tests. */
export interface Staging {
  put(key: string, value: Uint8Array | string, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  deletePrefix(prefix: string): Promise<void>;
}

export const stagingPrefix = (sessionId: string) => `sessions/${sessionId}/`;
export const captureKey = (sessionId: string) => `${stagingPrefix(sessionId)}capture.json`;
export const analysisKey = (sessionId: string) => `${stagingPrefix(sessionId)}analysis.json`;

export function r2Staging(bucket: R2Bucket): Staging {
  return {
    async put(key, value, contentType) { await bucket.put(key, value, { httpMetadata: { contentType } }); },
    async get(key) {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async deletePrefix(prefix) {
      let cursor: string | undefined;
      do {
        const listing = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
        if (listing.objects.length) await bucket.delete(listing.objects.map(object => object.key));
        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
    },
  };
}
