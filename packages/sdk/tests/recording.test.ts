import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_MS, startVideoRecording } from '../src/camera/recording';

interface FakeTrack {
  kind: 'audio' | 'video';
  readyState: 'live' | 'ended';
  stop: ReturnType<typeof vi.fn>;
}

class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}

/** Native stop is asynchronous: the test dispatches the final data then stop. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported = new Set(['video/webm;codecs=vp8']);
  static isTypeSupported = vi.fn((type: string) => FakeMediaRecorder.supported.has(type));
  static constructionError = false;
  static startError = false;
  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  stopError = false;
  start = vi.fn((timeslice?: number) => {
    if (FakeMediaRecorder.startError) throw new Error('Cannot start encoder.');
    this.state = 'recording';
    return timeslice;
  });
  stop = vi.fn(() => {
    if (this.stopError) throw new Error('Cannot stop encoder.');
    this.state = 'inactive';
  });

  constructor(readonly stream: FakeMediaStream, readonly options: MediaRecorderOptions) {
    if (FakeMediaRecorder.constructionError) throw new Error('Cannot create encoder.');
    this.mimeType = options.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  chunk(value: string | Uint8Array<ArrayBuffer>) { this.ondataavailable?.({ data: new Blob([value]) }); }
  stopped() { this.state = 'inactive'; this.onstop?.(); }
  failed() { this.onerror?.(); }
}

function track(kind: FakeTrack['kind'] = 'video', readyState: FakeTrack['readyState'] = 'live'): FakeTrack {
  return { kind, readyState, stop: vi.fn() };
}

function record(tracks = [track()]) {
  const onError = vi.fn();
  const recording = startVideoRecording(new FakeMediaStream(tracks) as unknown as MediaStream, onError);
  return { recording, recorder: FakeMediaRecorder.instances.at(-1)!, onError, tracks };
}

function expectReleased(recorder: FakeMediaRecorder) {
  expect(recorder.ondataavailable).toBeNull();
  expect(recorder.onstop).toBeNull();
  expect(recorder.onerror).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(['video/webm;codecs=vp8']);
  FakeMediaRecorder.isTypeSupported.mockClear();
  FakeMediaRecorder.constructionError = false;
  FakeMediaRecorder.startError = false;
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('silent face video recording', () => {
  it('waits for the first nonempty encoded chunk before declaring the recorder ready', async () => {
    const { recording, recorder, onError } = record();
    let ready = false;
    void recording.ready.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    recorder.chunk('');
    vi.advanceTimersByTime(9_999);
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    recorder.chunk('initial encoded bytes');
    await expect(recording.ready).resolves.toBeUndefined();
    expect(ready).toBe(true);
    // The startup deadline is gone after usable data; the capture deadline remains.
    vi.advanceTimersByTime(1);
    expect(onError).not.toHaveBeenCalled();
    const finished = recording.finish();
    recorder.chunk('final bytes');
    recorder.stopped();
    expect(await (await finished).text()).toBe('initial encoded bytesfinal bytes');
    expectReleased(recorder);
  });

  it.each(['native error', 'unexpected stop', 'discard', 'oversized first chunk'] as const)('rejects startup readiness on %s', async reason => {
    const { recording, recorder, onError } = record();
    const rejection = reason === 'discard'
      ? expect(recording.ready).rejects.toMatchObject({ name: 'AbortError' })
      : expect(recording.ready).rejects.toThrow(reason === 'oversized first chunk' ? 'videoTooLarge' : 'videoRecordingFailed');
    if (reason === 'native error') recorder.failed();
    else if (reason === 'unexpected stop') recorder.stopped();
    else if (reason === 'discard') recording.discard();
    else recorder.chunk(new Uint8Array(MAX_VIDEO_BYTES + 1));
    await rejection;
    expect(onError).toHaveBeenCalledTimes(reason === 'discard' ? 0 : 1);
    expectReleased(recorder);
  });

  it('rejects startup readiness at the bounded first-chunk deadline', async () => {
    const { recording, recorder, onError } = record();
    const rejected = expect(recording.ready).rejects.toThrow(/videoRecording/);
    recorder.chunk('');
    vi.advanceTimersByTime(9_999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await rejected;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    await expect(recording.finish()).rejects.toThrow(/videoRecording/);
    expectReleased(recorder);
  });

  it('records only live video tracks and leaves stream ownership with the caller', () => {
    const liveVideo = track();
    const endedVideo = track('video', 'ended');
    const audio = track('audio');
    const { recording, recorder } = record([liveVideo, endedVideo, audio]);
    expect(recorder.stream.getVideoTracks()).toEqual([liveVideo]);
    expect(recorder.stream.getAudioTracks()).toEqual([]);
    expect(recorder.options.videoBitsPerSecond).toBe(1_000_000);
    expect(recorder.start).toHaveBeenCalledWith(500);
    recording.discard();
    for (const input of [liveVideo, endedVideo, audio]) expect(input.stop).not.toHaveBeenCalled();
    expectReleased(recorder);
  });

  it.each([
    ['video/webm;codecs=vp8', 'video/webm'],
    ['video/webm;codecs=vp9', 'video/webm'],
    ['video/webm', 'video/webm'],
    ['video/mp4;codecs=avc1.42E01E', 'video/mp4'],
    ['video/mp4', 'video/mp4'],
  ])('negotiates %s and produces a normalized %s Blob', async (supported, type) => {
    FakeMediaRecorder.supported = new Set([supported]);
    const { recording, recorder, onError } = record();
    expect(recorder.options.mimeType).toBe(supported);
    const finished = recording.finish();
    recorder.chunk('encoded video');
    recorder.stopped();
    expect((await finished).type).toBe(type);
    expect(onError).not.toHaveBeenCalled();
    expectReleased(recorder);
  });

  it('includes the last native data event and shares an idempotent finish promise', async () => {
    const { recording, recorder, onError } = record();
    recorder.chunk('first');
    recorder.chunk('');
    const finished = recording.finish();
    expect(recording.finish()).toBe(finished);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    let resolved = false;
    void finished.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    recorder.chunk('final');
    recorder.stopped();
    const video = await finished;
    expect(await video.text()).toBe('firstfinal');
    expect(video.size).toBe(10);
    expect(recording.finish()).toBe(finished);
    recording.discard();
    expect(await recording.finish()).toBe(video);
    expect(onError).not.toHaveBeenCalled();
    expectReleased(recorder);
  });

  it('rejects unsupported or unavailable recording before starting an encoder', () => {
    FakeMediaRecorder.supported.clear();
    expect(() => record()).toThrow('videoUnsupported');
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    vi.stubGlobal('MediaRecorder', undefined);
    expect(() => record()).toThrow('videoUnsupported');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('requires a live video track and reports native construction or start failures', () => {
    expect(() => record([track('audio'), track('video', 'ended')])).toThrow('videoRecordingFailed');
    FakeMediaRecorder.constructionError = true;
    expect(() => record()).toThrow('videoUnsupported');
    FakeMediaRecorder.constructionError = false;
    FakeMediaRecorder.startError = true;
    expect(() => record()).toThrow('videoRecordingFailed');
    expectReleased(FakeMediaRecorder.instances.at(-1)!);
  });

  it.each(['native error', 'unexpected stop'] as const)('releases data and reports %s exactly once', async reason => {
    const { recording, recorder, onError, tracks } = record();
    recorder.chunk('partial');
    const queuedData = recorder.ondataavailable!;
    const queuedStop = recorder.onstop!;
    const queuedError = recorder.onerror!;
    if (reason === 'native error') recorder.failed();
    else recorder.stopped();
    queuedData({ data: new Blob(['late']) });
    queuedStop();
    queuedError();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].message).toBe('videoRecordingFailed');
    await expect(recording.finish()).rejects.toThrow('videoRecordingFailed');
    expect(tracks[0].stop).not.toHaveBeenCalled();
    expectReleased(recorder);
  });

  it('rejects a pending finish on a recorder error or native stop failure', async () => {
    for (const stopError of [false, true]) {
      const { recording, recorder, onError } = record();
      recorder.stopError = stopError;
      const finished = recording.finish();
      const rejected = expect(finished).rejects.toThrow('videoRecordingFailed');
      if (!stopError) recorder.failed();
      await rejected;
      expect(recording.finish()).toBe(finished);
      expect(onError).toHaveBeenCalledTimes(1);
      expectReleased(recorder);
    }
  });

  it.each([false, true])('discard safely rejects further finish calls (finish pending: %s)', async finishing => {
    const { recording, recorder, onError } = record();
    recorder.chunk('discarded bytes');
    const queuedData = recorder.ondataavailable!;
    const queuedStop = recorder.onstop!;
    const pending = finishing ? recording.finish() : undefined;
    const rejected = pending ? expect(pending).rejects.toMatchObject({ name: 'AbortError' }) : undefined;
    recording.discard();
    recording.discard();
    queuedData({ data: new Blob(['late']) });
    queuedStop();
    if (rejected) await rejected;
    await expect(recording.finish()).rejects.toMatchObject({ name: 'AbortError' });
    expect(onError).not.toHaveBeenCalled();
    expectReleased(recorder);
  });

  it('accepts the exact byte limit and rejects one additional byte from the final chunk', async () => {
    const accepted = record();
    accepted.recorder.chunk(new Uint8Array(MAX_VIDEO_BYTES));
    const finished = accepted.recording.finish();
    accepted.recorder.stopped();
    expect((await finished).size).toBe(MAX_VIDEO_BYTES);
    expect(accepted.onError).not.toHaveBeenCalled();
    expectReleased(accepted.recorder);

    const rejected = record();
    rejected.recorder.chunk(new Uint8Array(MAX_VIDEO_BYTES));
    const pending = rejected.recording.finish();
    const assertion = expect(pending).rejects.toThrow('videoTooLarge');
    rejected.recorder.chunk(new Uint8Array([1]));
    await assertion;
    expect(rejected.onError).toHaveBeenCalledTimes(1);
    expect(rejected.onError.mock.calls[0]![0].message).toBe('videoTooLarge');
    expectReleased(rejected.recorder);
  });

  it('stops a capture at its duration limit and releases queued recording data', async () => {
    const { recording, recorder, onError } = record();
    recorder.chunk('partial');
    vi.advanceTimersByTime(MAX_VIDEO_DURATION_MS - 1);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].message).toBe('videoRecordingTimeout');
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    await expect(recording.finish()).rejects.toThrow('videoRecordingTimeout');
    expectReleased(recorder);
  });

  it('replaces the capture deadline with a bounded finalization wait', async () => {
    const { recording, recorder, onError } = record();
    recorder.chunk('initial encoded bytes');
    await recording.ready;
    vi.advanceTimersByTime(MAX_VIDEO_DURATION_MS - 1);
    const finished = recording.finish();
    const rejected = expect(finished).rejects.toThrow('videoRecordingFailed');
    vi.advanceTimersByTime(4_999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await rejected;
    expect(recording.finish()).toBe(finished);
    expect(onError).toHaveBeenCalledTimes(1);
    expectReleased(recorder);
  });

  it.each(['empty recording', 'unexpected container'] as const)('rejects %s at finalization', async reason => {
    const { recording, recorder, onError } = record();
    if (reason === 'unexpected container') {
      recorder.mimeType = 'audio/webm';
      recorder.chunk('encoded');
    }
    const finished = recording.finish();
    const rejected = expect(finished).rejects.toThrow('videoRecordingFailed');
    recorder.stopped();
    await rejected;
    expect(onError).toHaveBeenCalledTimes(1);
    expectReleased(recorder);
  });
});
