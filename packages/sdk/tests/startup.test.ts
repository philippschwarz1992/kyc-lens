import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFaceTracker } from '../src/camera/tracker.js';
import { prefetchMatchingAssets } from '../src/matching/client.js';
import { validateFaceOptions } from '../src/core/challenges.js';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror = null; onmessageerror = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.last = this; }
}

describe('Face tracker startup', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
    return frames;
  };

  it('initializes without a video and samples only after start', async () => {
    const frames = stub();
    const pending = createFaceTracker({ onObservation: vi.fn(), onError: vi.fn() });
    expect(FakeWorker.last.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init' }));
    FakeWorker.last.onmessage!({ data: { type: 'ready' } });
    const tracker = await pending;
    expect(frames).toHaveLength(0);
    tracker.start({ readyState: 0 } as HTMLVideoElement);
    expect(frames).toHaveLength(1);
    tracker.stop();
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
    tracker.start({ readyState: 0 } as HTMLVideoElement);
    expect(frames).toHaveLength(1);
  });

  it('keeps starting immediately when a video is supplied at creation', async () => {
    const frames = stub();
    const pending = createFaceTracker({ video: { readyState: 0 } as HTMLVideoElement, onObservation: vi.fn(), onError: vi.fn() });
    FakeWorker.last.onmessage!({ data: { type: 'ready' } });
    (await pending).stop();
    expect(frames).toHaveLength(1);
  });
});

describe('Matching asset prefetch', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const body = (chunks: number) => {
    let index = 0;
    const cancel = vi.fn(async () => {});
    return { cancel, getReader: () => ({ read: async () => index++ < chunks ? { done: false, value: new Uint8Array(4) } : { done: true }, cancel }) };
  };
  const stub = (fetch: ReturnType<typeof vi.fn>, idle = true) => {
    const idleCallbacks: (() => void)[] = [];
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://app.example' }, ...(idle ? { requestIdleCallback: vi.fn((callback: () => void) => idleCallbacks.push(callback)), cancelIdleCallback } : {}) });
    vi.stubGlobal('document', { baseURI: 'https://app.example/kyc/' });
    vi.stubGlobal('fetch', fetch);
    return { idleCallbacks, cancelIdleCallback };
  };

  it('fetches runtime and models sequentially at low priority after an idle callback', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, body: body(2) }));
    const { idleCallbacks } = stub(fetch);
    prefetchMatchingAssets({ baseUrl: '/static/kyc' });
    expect(fetch).not.toHaveBeenCalled();
    idleCallbacks[0]!();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://app.example/static/kyc/matching/ort/ort-wasm-simd-threaded.mjs',
      'https://app.example/static/kyc/matching/ort/ort-wasm-simd-threaded.wasm',
      'https://app.example/static/kyc/matching/face_detection_yunet_2023mar.onnx',
      'https://app.example/static/kyc/matching/face_recognition_sface_2021dec.onnx',
    ]);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'force-cache', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', priority: 'low' });
  });

  it('stays silent on failures and continues with the remaining files', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ ok: false, body: body(0) }).mockResolvedValue({ ok: true, body: body(1) });
    const { idleCallbacks } = stub(fetch);
    prefetchMatchingAssets();
    idleCallbacks[0]!();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  it('cancels a scheduled or running prefetch and rejects external asset hosts', async () => {
    const fetch = vi.fn(async () => ({ ok: true, body: body(1) }));
    const { idleCallbacks, cancelIdleCallback } = stub(fetch);
    const cancel = prefetchMatchingAssets();
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledOnce();
    idleCallbacks[0]!();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    prefetchMatchingAssets({ faceRecognizerModelUrl: 'https://models.example/sface.onnx' })();
    expect(idleCallbacks).toHaveLength(1);
  });

  it('aborts the in-flight request and falls back to a timer without idle callbacks', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise(() => {}); });
    stub(fetch, false);
    const cancel = prefetchMatchingAssets();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledOnce();
    cancel();
    expect(signal?.aborted).toBe(true);
  });
});

describe('Face haptics option', () => {
  it('accepts booleans only', () => {
    expect(() => validateFaceOptions({ haptics: false })).not.toThrow();
    expect(() => validateFaceOptions({ haptics: 'yes' as unknown as boolean })).toThrow('face.haptics must be true or false.');
  });
});
