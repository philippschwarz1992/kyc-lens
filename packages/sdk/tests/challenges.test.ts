import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChallengeRunner, validateChallenges, validateFaceOptions } from '../src/core/challenges.js';
import type { ChallengeFeedback, FaceObservation } from '../src/types.js';
import { observationFor } from '../src/camera/geometry.js';
import { createFaceTracker } from '../src/camera/tracker.js';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const neutral = (timestamp: number, changes: Partial<FaceObservation> = {}): FaceObservation => ({
  timestamp, faceCount: 1, centerX: 0.5, centerY: 0.5, relativeSize: 0.4, yaw: 0, pitch: 0, ...changes,
});

describe('Face tracker geometry', () => {
  const resultFor = (matrix: number[]): FaceLandmarkerResult => ({
    faceLandmarks: [[{ x: 0.3, y: 0.25, z: 0, visibility: 1 }, { x: 0.7, y: 0.75, z: 0, visibility: 1 }]],
    faceBlendshapes: [], facialTransformationMatrixes: [{ rows: 4, columns: 4, data: matrix }],
  });
  it('reads column-major rotations and ignores translation when estimating left/right yaw', () => {
    const a = Math.PI / 6;
    const result = resultFor([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 123, 456, -50, 1]);
    const observation = observationFor(result, 100);
    expect(observation.yaw).toBeCloseTo(30);
    expect(observation.pitch).toBeCloseTo(0);
    expect(observation.relativeSize).toBeCloseTo(0.5);
    expect(observation.centerX).toBeCloseTo(0.5);
    result.facialTransformationMatrixes[0]!.data[8] = -Math.sin(a);
    expect(observationFor(result, 200).yaw).toBeCloseTo(-30);
  });
  it('defines looking down as positive pitch and looking up as negative pitch', () => {
    const a = 25 * Math.PI / 180;
    const result = resultFor([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, -50, 1]);
    expect(observationFor(result, 100).pitch).toBeCloseTo(25);
    result.facialTransformationMatrixes[0]!.data[9] = Math.sin(a);
    expect(observationFor(result, 200).pitch).toBeCloseTo(-25);
  });
});

describe('Face tracker cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('terminates the worker and rejects initialization when aborted while loading', async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage = postMessage; });
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
    const controller = new AbortController();
    const onError = vi.fn();
    const tracker = createFaceTracker({ video: {} as HTMLVideoElement, onObservation: vi.fn(), onError, signal: controller.signal });
    controller.abort();
    await expect(tracker).rejects.toMatchObject({ name: 'AbortError' });
    expect(postMessage).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
});

function driver(runner: ChallengeRunner) {
  let timestamp = -100;
  return {
    frame(changes: Partial<FaceObservation> = {}): ChallengeFeedback {
      timestamp += 100;
      return runner.update(neutral(timestamp, changes));
    },
    hold(changes: Partial<FaceObservation> = {}): ChallengeFeedback {
      let result = this.frame(changes);
      for (let i = 0; i < 3; i++) result = this.frame(changes);
      return result;
    },
  };
}

describe('ChallengeRunner', () => {
  it('requires a steady centered frontal baseline before accepting a movement', () => {
    const d = driver(new ChallengeRunner(['turn-left'], 300));
    expect(d.hold({ yaw: 32 }).evidence).toEqual([]);
    expect(d.hold().hint).toBe('turn-left');
    const movement = d.hold({ yaw: 32 });
    expect(movement.evidence.map((item) => item.challenge)).toEqual(['turn-left']);
    expect(movement.completed).toBe(false);
    expect(d.hold().completed).toBe(true);
  });

  it('resets a dwell when a face disappears or multiple faces appear', () => {
    const d = driver(new ChallengeRunner(['center'], 300));
    d.frame(); d.frame();
    expect(d.frame({ faceCount: 0 }).hint).toBe('no-face');
    expect(d.frame().progress).toBe(0);
    d.frame();
    expect(d.frame({ faceCount: 2 }).hint).toBe('multiple-faces');
    expect(d.hold().completed).toBe(true);
  });

  it('cannot count an observation gap as time spent holding a pose', () => {
    const runner = new ChallengeRunner(['center'], 300);
    runner.update(neutral(0)); runner.update(neutral(100));
    expect(runner.update(neutral(700)).progress).toBe(0);
    expect(runner.update(neutral(800)).completed).toBe(false);
    expect(runner.update(neutral(900)).completed).toBe(false);
    expect(runner.update(neutral(1000)).completed).toBe(true);
  });

  it('does not advance with duplicate or backwards timestamps', () => {
    const runner = new ChallengeRunner(['center'], 300);
    runner.update(neutral(0)); runner.update(neutral(100));
    expect(runner.update(neutral(50)).matched).toBe(false);
    expect(runner.update(neutral(100)).matched).toBe(false);
    expect(runner.update(neutral(200)).progress).toBe(0);
    runner.update(neutral(300)); runner.update(neutral(400));
    expect(runner.update(neutral(500)).completed).toBe(true);
  });

  it('moves straight on from a neutral pose between movements and holds only the final selfie', () => {
    const d = driver(new ChallengeRunner(['center', 'turn-left', 'turn-right'], 300));
    expect(d.hold().hint).toBe('turn-left');
    expect(d.hold({ yaw: 32 }).evidence).toHaveLength(2);
    expect(d.frame()).toMatchObject({ hint: 'turn-right', matched: false });
    expect(d.hold({ yaw: -32 }).evidence).toHaveLength(3);
    expect(d.frame()).toMatchObject({ hint: 'hold-still', matched: true, completed: false });
    d.frame(); d.frame();
    expect(d.frame().completed).toBe(true);
  });

  it('counts a quick move straight past the baseline distance as returning to it', () => {
    const d = driver(new ChallengeRunner(['closer', 'further'], 300));
    d.hold();
    expect(d.hold({ relativeSize: 0.65 }).evidence).toHaveLength(1);
    expect(d.frame({ relativeSize: 0.65 }).hint).toBe('move-further');
    expect(d.frame({ relativeSize: 0.22 })).toMatchObject({ hint: 'move-further', guideDirection: 'further' });
    expect(d.hold({ relativeSize: 0.22 }).evidence).toHaveLength(2);
    // Repeating a movement still needs the opposite side of the baseline first.
    const repeat = driver(new ChallengeRunner(['closer', 'closer'], 300));
    repeat.hold(); repeat.hold({ relativeSize: 0.65 });
    expect(repeat.hold({ relativeSize: 0.7 }).evidence).toHaveLength(1);
  });

  it('requires returning to neutral between repeated movements', () => {
    const d = driver(new ChallengeRunner(['turn-left', 'turn-left'], 300));
    d.hold(); d.hold({ yaw: 32 });
    expect(d.hold({ yaw: 32 }).evidence).toHaveLength(1);
    expect(d.hold({ yaw: 32 }).evidence).toHaveLength(1);
    d.hold();
    expect(d.hold({ yaw: 32 }).evidence).toHaveLength(2);
    expect(d.hold().completed).toBe(true);
  });

  it('respects the anatomical left/right yaw signs', () => {
    const d = driver(new ChallengeRunner(['turn-left', 'turn-right'], 300));
    d.hold();
    expect(d.hold({ yaw: -32 }).evidence).toHaveLength(0);
    expect(d.hold({ yaw: 32 }).evidence[0]?.challenge).toBe('turn-left');
    d.hold();
    expect(d.hold({ yaw: 32 }).evidence).toHaveLength(1);
    expect(d.hold({ yaw: -32 }).evidence[1]?.challenge).toBe('turn-right');
    expect(d.hold().completed).toBe(true);
  });

  it('uses negative pitch for looking up and positive pitch for looking down', () => {
    const d = driver(new ChallengeRunner(['look-up', 'look-down'], 300));
    d.hold();
    expect(d.hold({ pitch: 25 }).evidence).toHaveLength(0);
    expect(d.hold({ pitch: -25 }).evidence).toHaveLength(1);
    d.hold();
    expect(d.hold({ pitch: 25 }).evidence).toHaveLength(2);
    expect(d.hold().completed).toBe(true);
  });

  it('judges closer/further against the frontal baseline, rejecting head turns', () => {
    const d = driver(new ChallengeRunner(['closer', 'further'], 300));
    d.hold();
    expect(d.hold({ relativeSize: 0.65, yaw: 32 }).evidence).toHaveLength(0);
    expect(d.hold({ relativeSize: 0.65 }).evidence[0]?.challenge).toBe('closer');
    expect(d.hold({ relativeSize: 0.65 }).hint).toBe('move-further');
    d.hold();
    expect(d.hold({ relativeSize: 0.4 }).evidence).toHaveLength(1);
    expect(d.hold({ relativeSize: 0.22 }).evidence[1]?.challenge).toBe('further');
    // The final selfie pose must face the camera but may stay at the new distance.
    expect(d.hold({ relativeSize: 0.22, yaw: 32 }).completed).toBe(false);
    expect(d.hold({ relativeSize: 0.22 }).completed).toBe(true);
  });

  it('keeps the distance guide aligned with baseline, movement holds, and recentering', () => {
    const d = driver(new ChallengeRunner(['closer', 'further'], 300));
    expect(d.frame()).toMatchObject({ hint: 'hold-still', guideDirection: 'center', matched: true });
    expect(d.hold()).toMatchObject({ hint: 'move-closer', guideDirection: 'closer' });

    expect(d.frame({ relativeSize: 0.5 })).toMatchObject({ hint: 'hold-still', guideDirection: 'closer', matched: true });
    expect(d.frame({ relativeSize: 0.5 }).progress).toBeGreaterThan(0);
    expect(d.hold({ relativeSize: 0.5 })).toMatchObject({ hint: 'move-further', guideDirection: 'further', challenge: 'further' });

    // The user must first return to the original distance, but passing through it is enough.
    expect(d.frame({ relativeSize: 0.5 })).toMatchObject({ hint: 'move-further', guideDirection: 'further', challenge: 'further', matched: false });
    expect(d.frame()).toMatchObject({ hint: 'move-further', guideDirection: 'further', matched: false });
    expect(d.frame({ relativeSize: 0.3 })).toMatchObject({ hint: 'hold-still', guideDirection: 'further', matched: true });
    expect(d.frame({ relativeSize: 0.3 }).progress).toBeGreaterThan(0);
    // The final selfie hold starts right away at the new distance.
    expect(d.hold({ relativeSize: 0.3 })).toMatchObject({ hint: 'hold-still', guideDirection: 'center', completed: false });

    const completed = d.hold();
    expect(completed).toMatchObject({ hint: 'complete', guideDirection: 'center', completed: true });
    expect(completed.evidence.map(item => item.challenge)).toEqual(['closer', 'further']);
  });

  it('resets a matched dwell when the user moves out of the center', () => {
    const d = driver(new ChallengeRunner(['center'], 300));
    d.frame(); d.frame();
    expect(d.frame({ centerX: 0.9 }).hint).toBe('center-face');
    expect(d.frame().progress).toBe(0);
    d.frame(); d.frame();
    expect(d.frame().completed).toBe(true);
  });

  it('requires approximately steady size while holding the baseline', () => {
    const d = driver(new ChallengeRunner(['center'], 300));
    d.frame(); d.frame();
    expect(d.frame({ relativeSize: 0.55 }).progress).toBe(0);
    expect(d.frame({ relativeSize: 0.55 }).completed).toBe(false);
    d.frame({ relativeSize: 0.55 });
    expect(d.frame({ relativeSize: 0.55 }).completed).toBe(true);
  });

  it('does not accept invalid geometry and supports reset without exposing mutable evidence', () => {
    const runner = new ChallengeRunner(['center'], 300);
    const d = driver(runner);
    expect(d.frame({ yaw: NaN }).matched).toBe(false);
    const result = d.hold();
    expect(result.evidence[0]?.durationMs).toBe(300);
    result.evidence[0]!.challenge = 'turn-left';
    expect(d.frame().evidence[0]?.challenge).toBe('center');
    runner.reset();
    expect(runner.update(neutral(0)).evidence).toEqual([]);
  });

  it('validates configurations before camera startup', () => {
    expect(() => validateChallenges([])).toThrow(/at least one/);
    expect(() => validateChallenges(['turn-left', 'turn-right', 'closer', 'further'])).toThrow(/at most 3/);
    expect(() => validateChallenges(['center', 'turn-left', 'center'])).toThrow(/one center/);
    expect(validateChallenges(['center', 'turn-left', 'turn-right', 'closer'])).toHaveLength(4);
    expect(() => validateChallenges(['unsupported'] as never)).toThrow(/Unsupported/);
    expect(() => validateFaceOptions({ trackingFps: 0 })).toThrow(/trackingFps/);
    expect(() => validateFaceOptions({ holdDurationMs: NaN })).toThrow(/holdDurationMs/);
    expect(() => validateFaceOptions({ timeoutMs: 999 })).toThrow(/timeoutMs/);
    expect(() => validateFaceOptions({ autoStart: 'true' } as never)).toThrow(/autoStart/);
    expect(() => validateFaceOptions({ recordVideo: 0 } as never)).toThrow(/recordVideo/);
    expect(() => validateFaceOptions({ autoStart: false, recordVideo: false })).not.toThrow();
  });

  it('chooses a baseline with room to complete configured distance challenges', () => {
    const d = driver(new ChallengeRunner(['closer', 'further'], 300));
    expect(d.hold({ relativeSize: 0.7 }).hint).toBe('move-further');
    expect(d.hold({ relativeSize: 0.2 }).hint).toBe('move-closer');
    expect(d.hold().hint).toBe('move-closer');
    expect(d.hold({ relativeSize: 0.65 }).evidence).toHaveLength(1);
  });

  it('rejects tracking rates that cannot provide samples within the 500ms dwell gap', () => {
    for (const trackingFps of [1, 2]) expect(() => validateFaceOptions({ trackingFps })).toThrow(/between 3 and 30/);
    expect(() => validateFaceOptions({ trackingFps: 3 })).not.toThrow();
    // Three frames per second can maintain a dwell even with frame scheduling jitter.
    const runner = new ChallengeRunner(['center'], 650);
    expect(runner.update(neutral(0)).completed).toBe(false);
    expect(runner.update(neutral(350)).completed).toBe(false);
    expect(runner.update(neutral(700)).completed).toBe(true);
  });
});
