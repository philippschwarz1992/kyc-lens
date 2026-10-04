export const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
export const MAX_VIDEO_DURATION_MS = 90_000;

export interface VideoRecording {
  /** Resolves after the encoder has delivered its first nonempty chunk. */
  ready: Promise<void>;
  finish(): Promise<Blob>;
  discard(): void;
}

const FORMATS = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];

/** Bounded, silent recording. The caller owns the stream and its tracks. */
export function startVideoRecording(stream: MediaStream, onError: (error: Error) => void): VideoRecording {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') throw new Error('videoUnsupported');
  const mimeType = FORMATS.find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('videoUnsupported');
  const tracks = stream.getVideoTracks().filter(track => track.readyState === 'live');
  if (!tracks.length) throw new Error('videoRecordingFailed');
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 1_000_000 }); }
  catch { throw new Error('videoUnsupported'); }

  let state: 'recording' | 'finishing' | 'done' | 'failed' | 'discarded' = 'recording';
  let chunks: Blob[] = [];
  let size = 0;
  let error: Error | undefined;
  let finishPromise: Promise<Blob> | undefined;
  let resolveFinish: ((blob: Blob) => void) | undefined;
  let rejectFinish: ((error: Error) => void) | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Cleanup can happen before a caller awaits readiness; keep that rejection observed.
  void ready.catch(() => {});

  const release = () => {
    clearTimeout(durationTimer); clearTimeout(readyTimer); clearTimeout(finishTimer);
    recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
    chunks = [];
  };
  const stopRecorder = () => {
    if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Cleanup can race a browser stream ending. */ } }
  };
  const fail = (failure: Error) => {
    if (state === 'done' || state === 'failed' || state === 'discarded') return;
    state = 'failed'; error = failure;
    release(); stopRecorder(); rejectReady(failure); rejectFinish?.(failure); onError(failure);
  };

  recorder.ondataavailable = event => {
    if ((state !== 'recording' && state !== 'finishing') || !event.data.size) return;
    if (size + event.data.size > MAX_VIDEO_BYTES) { fail(new Error('videoTooLarge')); return; }
    chunks.push(event.data); size += event.data.size;
    clearTimeout(readyTimer); resolveReady();
  };
  recorder.onerror = () => fail(new Error('videoRecordingFailed'));
  recorder.onstop = () => {
    if (state !== 'finishing') { fail(new Error('videoRecordingFailed')); return; }
    const type = (recorder.mimeType || mimeType).split(';')[0]!.trim().toLowerCase();
    if (!size || !['video/webm', 'video/mp4'].includes(type)) { fail(new Error('videoRecordingFailed')); return; }
    // The final dataavailable event precedes stop, so all encoded bytes are present.
    const blob = new Blob(chunks, { type });
    state = 'done'; release(); resolveFinish?.(blob);
  };
  try { recorder.start(500); }
  catch { release(); stopRecorder(); rejectReady(new Error('videoRecordingFailed')); throw new Error('videoRecordingFailed'); }
  durationTimer = setTimeout(() => fail(new Error('videoRecordingTimeout')), MAX_VIDEO_DURATION_MS);
  readyTimer = setTimeout(() => fail(new Error('videoRecordingFailed')), 10_000);

  return {
    ready,
    finish() {
      if (finishPromise) return finishPromise;
      if (state === 'failed') return Promise.reject(error!);
      if (state === 'discarded') return Promise.reject(new DOMException('Video recording was discarded.', 'AbortError'));
      finishPromise = new Promise<Blob>((resolve, reject) => { resolveFinish = resolve; rejectFinish = reject; });
      state = 'finishing'; clearTimeout(durationTimer);
      finishTimer = setTimeout(() => fail(new Error('videoRecordingFailed')), 5_000);
      try { recorder.stop(); } catch { fail(new Error('videoRecordingFailed')); }
      return finishPromise;
    },
    discard() {
      if (state === 'done' || state === 'failed' || state === 'discarded') return;
      state = 'discarded'; release(); stopRecorder();
      const failure = new DOMException('Video recording was discarded.', 'AbortError');
      rejectReady(failure); rejectFinish?.(failure);
    },
  };
}
