import { describe, expect, it } from 'vitest';
import { createDocumentHold, createSteadyFeedback, sameDocumentSide, thumbnailSimilarity } from '../src/core/document-auto.js';
import type { DocumentDetection } from '../src/core/document.js';

const clear: DocumentDetection = { reason: 'ready', corners: [
  { x: 0.1, y: 0.25 }, { x: 0.9, y: 0.25 }, { x: 0.9, y: 0.75 }, { x: 0.1, y: 0.75 },
] };
const move = (x: number): DocumentDetection => ({ ...clear, corners: clear.corners!.map(point => ({ ...point, x: point.x + x })) });

describe('Automatic document shutter', () => {
  it('captures on the first fresh clear observation by default', () => {
    const hold = createDocumentHold();
    expect(hold.observe({ reason: 'blur' }, 900, 900, 'view').capture).toBe(false);
    expect(hold.observe(clear, 1000, 1000, 'view')).toEqual({ feedback: 'ready', progress: 1, capture: true });
    expect(hold.observe(clear, 1000, 1010, 'view').capture).toBe(false);
    expect(hold.observe({ reason: 'ready' }, 1100, 1100, 'view').capture).toBe(false);
  });

  it('waits for the full hold on repeated clear observations rather than advancing on a timer', () => {
    const hold = createDocumentHold(800);
    expect(hold.observe(clear, 1000, 1000, 'landscape')).toEqual({ feedback: 'hold-still', progress: 0, capture: false });
    expect(hold.observe(clear, 1200, 1200, 'landscape').progress).toBe(0.25);
    expect(hold.observe(clear, 1400, 1400, 'landscape').capture).toBe(false);
    expect(hold.observe(clear, 1600, 1600, 'landscape').capture).toBe(false);
    expect(hold.observe(clear, 1800, 1800, 'landscape')).toEqual({ feedback: 'ready', progress: 1, capture: true });
  });

  it('requires at least three separately timed camera observations even with a short hold', () => {
    const hold = createDocumentHold(200);
    hold.observe(clear, 1000, 1000, 'view');
    expect(hold.observe(clear, 1250, 1250, 'view').capture).toBe(false);
    expect(hold.observe(clear, 1300, 1300, 'view').capture).toBe(true);
  });

  it('resets the countdown for bad quality and never resurrects an older good observation', () => {
    const hold = createDocumentHold(800);
    hold.observe(clear, 1000, 1000, 'view');
    hold.observe(clear, 1400, 1400, 'view');
    expect(hold.observe({ reason: 'glare' }, 1500, 1500, 'view')).toEqual({ feedback: 'glare', progress: 0, capture: false });
    expect(hold.observe(clear, 1400, 1550, 'view').capture).toBe(false);
    expect(hold.observe(clear, 1600, 1600, 'view').progress).toBe(0);
    expect(hold.observe(clear, 1800, 1800, 'view').capture).toBe(false);
  });

  it('duplicate and backwards callbacks cannot complete a pending hold', () => {
    const hold = createDocumentHold(800);
    hold.observe(clear, 1000, 1000, 'view');
    hold.observe(clear, 1400, 1400, 'view');
    expect(hold.observe(clear, 1400, 1450, 'view').progress).toBe(0);
    expect(hold.observe(clear, 1300, 1450, 'view').capture).toBe(false);
    expect(hold.observe(clear, 1600, 1600, 'view').progress).toBe(0);
    expect(hold.observe(clear, 1800, 1800, 'view').capture).toBe(false);
  });

  it('lost camera frames and delayed analysis cannot borrow elapsed time', () => {
    const hold = createDocumentHold(800);
    hold.observe(clear, 1000, 1000, 'view');
    hold.observe(clear, 1400, 1400, 'view');
    expect(hold.observe(clear, 2500, 2500, 'view').progress).toBe(0);
    expect(hold.observe(clear, 2700, 3800, 'view')).toEqual({ feedback: 'searching', progress: 0, capture: false });
    expect(hold.observe(clear, 3850, 3850, 'view').progress).toBe(0);
    expect(hold.observe(clear, 4050, 4050, 'view').capture).toBe(false);
  });

  it('movement, gradual drift and viewport rotation each require a fresh hold', () => {
    const hold = createDocumentHold(800);
    hold.observe(clear, 1000, 1000, 'view');
    hold.observe(move(0.03), 1200, 1200, 'view');
    expect(hold.observe(move(0.05), 1400, 1400, 'view').progress).toBe(0);
    expect(hold.observe(move(0.05), 1800, 1800, 'rotated').progress).toBe(0);
    expect(hold.observe(move(0.05), 2000, 2000, 'rotated').capture).toBe(false);
    hold.reset(2050);
    expect(hold.observe(move(0.05), 2030, 2060, 'rotated').capture).toBe(false);
    expect(hold.observe(move(0.05), 2200, 2200, 'rotated').progress).toBe(0);
  });

  it('handheld jitter does not restart the hold', () => {
    const hold = createDocumentHold(800);
    hold.observe(clear, 1000, 1000, 'view');
    hold.observe(move(0.015), 1300, 1300, 'view');
    hold.observe(move(-0.01), 1600, 1600, 'view');
    expect(hold.observe(move(0.02), 1800, 1800, 'view').capture).toBe(true);
  });

  it('a ready flag without valid complete corner geometry never enables the shutter', () => {
    const hold = createDocumentHold(200);
    for (const detection of [{ reason: 'ready' } as const,
      { ...clear, corners: clear.corners!.slice(0, 3) }, { ...clear, corners: move(NaN).corners }]) {
      expect(hold.observe(detection, 1000, 1000, 'view').capture).toBe(false);
    }
    expect(hold.observe(clear, 1200, 1200, '').capture).toBe(false);
    expect(hold.observe(clear, Infinity, Infinity, 'view').capture).toBe(false);
  });
});

describe('Steady document guidance', () => {
  const steady = () => createSteadyFeedback<string>({ settleMs: 700, dwellMs: 2000, immediate: value => value === 'ready' });

  it('keeps a hint on screen through frame-to-frame flicker', () => {
    const feedback = steady();
    expect(feedback.update('too-small', 0).value).toBe('too-small');
    expect(feedback.update('searching', 300)).toEqual({ value: 'too-small', recheckMs: 1700 });
    expect(feedback.update('too-small', 500).value).toBe('too-small');
    expect(feedback.update('searching', 900).value).toBe('too-small');
    expect(feedback.update('outside', 1200).value).toBe('too-small');
    expect(feedback.update('outside', 2000).value).toBe('outside');
  });

  it('waits for a new hint to settle even after the dwell time', () => {
    const feedback = steady();
    feedback.update('searching', 0);
    expect(feedback.update('blur', 5000)).toEqual({ value: 'searching', recheckMs: 700 });
    expect(feedback.update('blur', 5700).value).toBe('blur');
  });

  it('shows good news at once', () => {
    const feedback = steady();
    feedback.update('searching', 0);
    expect(feedback.update('ready', 100).value).toBe('ready');
  });
});

describe('Document side comparison', () => {
  const side = (seed: number) => Array.from({ length: 640 }, (_, i) => 120 + 80 * Math.sin(i * 0.37 * seed + seed));

  it('recognizes the same side, also upside down, and accepts a different side', () => {
    const front = side(1), back = side(2.3);
    expect(thumbnailSimilarity(front, front)).toBeCloseTo(1, 5);
    expect(sameDocumentSide(front, front.map(value => value * 0.9 + 10))).toBe(true);
    expect(sameDocumentSide(front, [...front].reverse())).toBe(true);
    expect(sameDocumentSide(front, back)).toBe(false);
    expect(thumbnailSimilarity(front, new Array(640).fill(100))).toBe(0);
  });
});
