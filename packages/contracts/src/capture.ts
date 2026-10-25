/**
 * The capture upload contract (`POST /sessions/:id/capture`, multipart) and its validation.
 * Runtime-neutral (Web APIs only), shared by the playground receiver and the gateway Worker.
 */
export const MAX_BODY_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const CHALLENGES = new Set(['center', 'turn-left', 'turn-right', 'look-up', 'look-down', 'closer', 'further']);

export type DocumentType = 'id-card' | 'drivers-license' | 'passport';
export interface ChallengeEvidence { challenge: string; completedAt: number; durationMs: number }
export interface DocumentZoneSummary { format: 'TD1' | 'TD2' | 'TD3'; kind: 'passport' | 'id-card' | 'visa' | 'other'; valid: boolean }
export interface CaptureMetadata {
  challenges: ChallengeEvidence[];
  capturedAt: string;
  mode: 'camera' | 'simulation';
  /** `mrz` is the browser's own read: a capture aid, not evidence. */
  document?: { type: DocumentType; mrz?: DocumentZoneSummary };
}
export type CaptureField = 'selfie' | 'faceVideo' | 'documentFront' | 'documentBack';
export interface MediaMetadata { type: string; sizeBytes: number }
export interface CaptureFile { field: CaptureField; filename: string; type: string; bytes: Uint8Array }
export interface ParsedCapture {
  metadata: CaptureMetadata;
  files: CaptureFile[];
  image: MediaMetadata;
  video?: MediaMetadata;
  document?: { type: DocumentType; front: MediaMetadata; back?: MediaMetadata };
  /** SHA-256 over metadata and every file, for idempotent retries. */
  digest: string;
}

export class CaptureError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

export function validateMetadata(raw: string, now = Date.now()): CaptureMetadata {
  if (new TextEncoder().encode(raw).length > 16 * 1024) throw new CaptureError(400, 'Capture metadata is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new CaptureError(400, 'Capture metadata must be valid JSON.'); }
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['challenges', 'capturedAt', 'mode', ...('document' in parsed ? ['document'] : [])])) {
    throw new CaptureError(400, 'Metadata requires challenges, capturedAt, mode, and optionally document.');
  }
  let document: CaptureMetadata['document'];
  if ('document' in parsed) {
    if (!isRecord(parsed.document) || !hasOnlyKeys(parsed.document, ['type', ...('mrz' in parsed.document ? ['mrz'] : [])]) || !['id-card', 'drivers-license', 'passport'].includes(String(parsed.document.type))) throw new CaptureError(400, 'Invalid document type metadata.');
    const mrz = parsed.document.mrz;
    if (mrz !== undefined && (!isRecord(mrz) || !hasOnlyKeys(mrz, ['format', 'kind', 'valid']) || !['TD1', 'TD2', 'TD3'].includes(String(mrz.format))
      || !['passport', 'id-card', 'visa', 'other'].includes(String(mrz.kind)) || typeof mrz.valid !== 'boolean')) throw new CaptureError(400, 'Invalid machine-readable zone metadata.');
    document = { type: parsed.document.type as DocumentType, ...(mrz ? { mrz: mrz as unknown as DocumentZoneSummary } : {}) };
  }
  if (parsed.mode !== 'camera' && parsed.mode !== 'simulation') throw new CaptureError(400, 'Unsupported capture mode.');
  if (typeof parsed.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(parsed.capturedAt)) {
    throw new CaptureError(400, 'capturedAt must be an ISO UTC timestamp.');
  }
  const capturedAt = Date.parse(parsed.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt < now - 24 * 60 * 60 * 1000 || capturedAt > now + 60_000) {
    throw new CaptureError(400, 'Capture timestamp must be within the last 24 hours.');
  }
  if (!Array.isArray(parsed.challenges) || parsed.challenges.length < 1 || parsed.challenges.length > 20) {
    throw new CaptureError(400, 'Capture requires between one and twenty challenge entries.');
  }
  const challenges: ChallengeEvidence[] = parsed.challenges.map((item: unknown) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ['challenge', 'completedAt', 'durationMs'])) throw new CaptureError(400, 'Invalid challenge metadata.');
    if (typeof item.challenge !== 'string' || !CHALLENGES.has(item.challenge)) throw new CaptureError(400, 'Unknown challenge.');
    if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt < 0) throw new CaptureError(400, 'Invalid challenge completion timestamp.');
    if (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0 || item.durationMs > 120_000) throw new CaptureError(400, 'Invalid challenge duration.');
    return { challenge: item.challenge, completedAt: item.completedAt, durationMs: item.durationMs };
  });
  return { challenges, capturedAt: parsed.capturedAt, mode: parsed.mode, ...(document ? { document } : {}) };
}

const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** A MIME label alone is untrusted: require the matching image signature and end marker. */
export function validateImage(bytes: Uint8Array, claimedType: string): string {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const isPng = bytes.length >= 45 && pngSignature.every((byte, index) => bytes[index] === byte)
    && bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82
    && bytes[bytes.length - 8] === 73 && bytes[bytes.length - 7] === 69
    && bytes[bytes.length - 6] === 78 && bytes[bytes.length - 5] === 68;
  const isJpeg = bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  // WebP: RIFF container whose size field covers the whole file, a WEBP form type and a VP8, VP8L or VP8X first chunk.
  const riffSize = bytes.length >= 20 ? (bytes[4]! | bytes[5]! << 8 | bytes[6]! << 16 | bytes[7]! << 24) >>> 0 : -1;
  const isWebp = riffSize === bytes.length - 8 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(text(bytes, 12, 16));
  const type = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : null;
  if (!type || claimedType !== type) throw new CaptureError(400, 'Images must be JPEG, PNG or WebP with a matching MIME type.');
  return type;
}

/** Inspect container signatures as well as MIME labels; this is not a liveness verdict. */
export function validateVideo(bytes: Uint8Array, claimedType: string): string {
  const type = claimedType.split(';', 1)[0]!.trim().toLowerCase();
  let valid = false;
  if (type === 'video/webm' && bytes.length >= 16 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // Read the finite EBML header size and its DocType before the WebM Segment.
    const readSize = (offset: number) => {
      let length = 1;
      while (length <= 8 && (bytes[offset]! & (0x80 >> (length - 1))) === 0) length++;
      if (length > 8 || offset + length > bytes.length) return null;
      let value = bytes[offset]! & (0xff >> length);
      for (let index = 1; index < length; index++) value = value * 256 + bytes[offset + index]!;
      return Number.isSafeInteger(value) ? { length, value } : null;
    };
    const headerSize = readSize(4);
    if (headerSize && headerSize.value <= 1024) {
      const headerEnd = 4 + headerSize.length + headerSize.value;
      let offset = 4 + headerSize.length;
      let webmDocType = false;
      while (offset < headerEnd && headerEnd + 5 < bytes.length) {
        let idLength = 1;
        while (idLength <= 4 && (bytes[offset]! & (0x80 >> (idLength - 1))) === 0) idLength++;
        if (idLength > 4 || offset + idLength > headerEnd) break;
        const isDocType = idLength === 2 && bytes[offset] === 0x42 && bytes[offset + 1] === 0x82;
        offset += idLength;
        const size = readSize(offset);
        if (!size || offset + size.length + size.value > headerEnd) break;
        offset += size.length;
        if (isDocType) webmDocType = size.value === 4 && bytes[offset] === 0x77 && bytes[offset + 1] === 0x65 && bytes[offset + 2] === 0x62 && bytes[offset + 3] === 0x6d;
        offset += size.value;
      }
      valid = offset === headerEnd && webmDocType && bytes[headerEnd] === 0x18 && bytes[headerEnd + 1] === 0x53 && bytes[headerEnd + 2] === 0x80 && bytes[headerEnd + 3] === 0x67;
    }
  } else if (type === 'video/mp4' && bytes.length >= 32) {
    // MediaRecorder MP4 has ftyp, moov and mdat boxes, including fragmented MP4.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    let ftyp = false, moov = false, mdat = false;
    while (offset + 8 <= bytes.length) {
      let size = view.getUint32(offset);
      const boxType = text(bytes, offset + 4, offset + 8);
      let headerLength = 8;
      if (size === 1) {
        if (offset + 16 > bytes.length) break;
        const extendedSize = view.getBigUint64(offset + 8);
        if (extendedSize > BigInt(bytes.length)) break;
        size = Number(extendedSize);
        headerLength = 16;
      } else if (size === 0) size = bytes.length - offset;
      if (size < headerLength || offset + size > bytes.length) break;
      if (offset === 0) {
        if (boxType !== 'ftyp' || size < headerLength + 8 || (size - headerLength) % 4 !== 0) break;
        const brands = [text(bytes, offset + headerLength, offset + headerLength + 4)];
        for (let brandOffset = offset + headerLength + 8; brandOffset + 4 <= offset + size; brandOffset += 4) brands.push(text(bytes, brandOffset, brandOffset + 4));
        ftyp = brands.some(brand => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(brand));
      }
      if (boxType === 'moov' && size > headerLength) moov = true;
      if (boxType === 'mdat' && size > headerLength) mdat = true;
      offset += size;
    }
    valid = offset === bytes.length && ftyp && moov && mdat;
  }
  if (!valid) throw new CaptureError(400, 'Face video must be WebM or MP4 with a matching MIME type and container signature.');
  return type;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

const extension = (type: string) => type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'video/mp4' ? 'mp4' : type === 'video/webm' ? 'webm' : 'jpg';
const prefixes: Record<CaptureField, string> = { selfie: 'selfie', faceVideo: 'face-video', documentFront: 'document-front', documentBack: 'document-back' };

/** Validates a parsed multipart upload: exact fields for the document type, file signatures and sizes. */
export async function parseCapture(form: FormData, now = Date.now()): Promise<ParsedCapture> {
  const selfie = form.get('selfie');
  const metadataText = form.get('metadata');
  if (!(selfie instanceof Blob) || selfie.size === 0 || typeof metadataText !== 'string') throw new CaptureError(400, 'Invalid selfie or metadata field.');
  const metadata = validateMetadata(metadataText, now);
  const requiredFields = ['selfie', 'metadata', ...(form.has('faceVideo') ? ['faceVideo'] : []), ...(metadata.document ? ['documentFront', ...(metadata.document.type !== 'passport' ? ['documentBack'] : [])] : [])];
  if (Array.from(form.keys()).length !== requiredFields.length || requiredFields.some(field => form.getAll(field).length !== 1)) {
    throw new CaptureError(400, 'Upload fields must match the selected document type; cards require both sides and passports require only the photo page.');
  }
  const files: CaptureFile[] = [];
  const read = async (field: CaptureField): Promise<MediaMetadata> => {
    const file = form.get(field);
    const video = field === 'faceVideo';
    if (!(file instanceof Blob) || file.size === 0) throw new CaptureError(400, video ? 'Invalid face video file.' : `Invalid ${field} image.`);
    if (file.size > (video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) throw new CaptureError(413, video ? 'Face video must be at most 12 MB.' : 'Each image must be at most 6 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = video ? validateVideo(bytes, file.type) : validateImage(bytes, file.type);
    files.push({ field, filename: `${prefixes[field]}.${extension(type)}`, type, bytes });
    return { type, sizeBytes: file.size };
  };
  const image = await read('selfie');
  const video = form.has('faceVideo') ? await read('faceVideo') : undefined;
  let document: ParsedCapture['document'];
  if (metadata.document) {
    const front = await read('documentFront');
    const back = metadata.document.type !== 'passport' ? await read('documentBack') : undefined;
    document = { type: metadata.document.type, front, ...(back ? { back } : {}) };
  }
  // Field names and byte lengths separate the parts, so different splits cannot share a digest.
  const encoder = new TextEncoder();
  const parts = [encoder.encode(JSON.stringify(metadata)), ...files.flatMap(file => [encoder.encode(`\n${file.field}:${file.bytes.length}\n`), file.bytes])];
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  return { metadata, files, image, ...(video ? { video } : {}), ...(document ? { document } : {}), digest: await sha256Hex(joined) };
}
