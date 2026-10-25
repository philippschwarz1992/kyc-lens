import { describe, expect, it } from 'vitest';
import { coverViewport, mapFaceToViewport } from '../src/camera/viewport.js';
import { isCenteredFace } from '../src/core/challenges.js';
import type { FaceObservation } from '../src/types.js';

const observation = (changes: Partial<FaceObservation> = {}): FaceObservation => ({
  timestamp: 123, faceCount: 1, centerX: .5, centerY: .5, relativeSize: .4, yaw: 0, pitch: 0, ...changes,
});

describe('Face preview geometry', () => {
  it('uses the centered visible crop of a landscape camera in the portrait guide', () => {
    const crop = coverViewport(1920, 1080, 280, 350)!;
    expect(crop.width).toBeCloseTo(.45);
    expect(crop.x).toBeCloseTo(.275);
    expect(crop.height).toBe(1);
    expect(crop.y).toBe(0);
    const centered = mapFaceToViewport(observation(), crop);
    expect(centered.centerX).toBeCloseTo(.5);
    expect(centered.centerY).toBeCloseTo(.5);
    expect(centered.relativeSize).toBeCloseTo(.4);

    const tooFarRight = observation({ centerX: .62 });
    expect(isCenteredFace(tooFarRight)).toBe(true);
    const visible = mapFaceToViewport(tooFarRight, crop);
    expect(visible.centerX).toBeCloseTo(.7666666667);
    expect(isCenteredFace(visible)).toBe(false);
    expect(isCenteredFace(mapFaceToViewport(observation({ centerX: .55 }), crop))).toBe(true);
  });

  it('remaps vertical centering and face height when a tall source is cropped', () => {
    const crop = coverViewport(1080, 1920, 280, 350)!;
    expect(crop.width).toBe(1);
    expect(crop.height).toBeCloseTo(.703125);
    expect(crop.y).toBeCloseTo(.1484375);
    const visible = mapFaceToViewport(observation({ centerY: .62 }), crop);
    expect(visible.centerY).toBeCloseTo(.6706666667);
    expect(visible.relativeSize).toBeCloseTo(.5688888889);
    expect(isCenteredFace(visible)).toBe(false);
    expect(isCenteredFace(mapFaceToViewport(observation(), crop))).toBe(true);
  });

  it('preserves angles, timestamps and full-frame multiple-face rejection', () => {
    const source = observation({ faceCount: 2, yaw: 32, pitch: -18, timestamp: 876 });
    const visible = mapFaceToViewport(source, coverViewport(1920, 1080, 280, 350));
    expect(visible).toMatchObject({ faceCount: 2, yaw: 32, pitch: -18, timestamp: 876 });
    expect(isCenteredFace(visible)).toBe(false);
    expect(source).toEqual(observation({ faceCount: 2, yaw: 32, pitch: -18, timestamp: 876 }));
  });

  it('keeps equal-aspect coordinates unchanged at different preview sizes', () => {
    for (const [width, height] of [[280, 350], [400, 500], [160, 200]]) {
      const crop = coverViewport(720, 900, width!, height!);
      expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      const source = observation({ centerX: .61, centerY: .39, yaw: 28 });
      expect(mapFaceToViewport(source, crop)).toEqual(source);
    }
  });

  it('does not clamp a face outside the visible crop back inside the guide', () => {
    const visible = mapFaceToViewport(observation({ centerX: .9 }), coverViewport(1920, 1080, 280, 350));
    expect(visible.centerX).toBeGreaterThan(1);
    expect(isCenteredFace(visible)).toBe(false);
  });

  it('fails closed before source or layout dimensions are usable', () => {
    for (const values of [[0, 1080, 280, 350], [1920, 0, 280, 350], [1920, 1080, 0, 350], [1920, 1080, 280, 0],
      [NaN, 1080, 280, 350], [1920, Infinity, 280, 350], [1920, 1080, -280, 350]]) {
      expect(coverViewport(...values as [number, number, number, number])).toBeNull();
    }
    const mapped = mapFaceToViewport(observation(), null);
    expect(mapped.faceCount).toBe(1);
    expect(mapped.centerX).toBeNaN();
    expect(mapped.centerY).toBeNaN();
    expect(mapped.relativeSize).toBeNaN();
    expect(isCenteredFace(mapped)).toBe(false);
  });
});
