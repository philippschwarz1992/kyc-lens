import { describe, expect, it } from 'vitest';
import { createDocumentHold } from '../src/core/document-auto.js';
import type { DocumentDetection } from '../src/core/document.js';

const clear: DocumentDetection = { reason: 'ready', corners: [
  { x: 0.1, y: 0.25 }, { x: 0.9, y: 0.25 }, { x: 0.9, y: 0.75 }, { x: 0.1, y: 0.75 },
] };
const move = (x: number): DocumentDetection => ({ ...clear, corners: clear.corners!.map(point => ({ ...point, x: point.x + x })) });

describe('Automatic document shutter', () => {
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
    expect(hold.observe(clear, 2000, 2000, 'view').progress).toBe(0);
    expect(hold.observe(clear, 2200, 2800, 'view')).toEqual({ feedback: 'searching', progress: 0, capture: false });
    expect(hold.observe(clear, 2850, 2850, 'view').progress).toBe(0);
    expect(hold.observe(clear, 3050, 3050, 'view').capture).toBe(false);
  });

  it('movement, gradual drift and viewport rotation each require a fresh hold', () => {
    const hold = createDocumentHold(800);
    hold.observe(clear, 1000, 1000, 'view');
    hold.observe(move(0.01), 1200, 1200, 'view');
    expect(hold.observe(move(0.02), 1400, 1400, 'view').progress).toBe(0);
    expect(hold.observe(move(0.02), 1800, 1800, 'rotated').progress).toBe(0);
    expect(hold.observe(move(0.02), 2000, 2000, 'rotated').capture).toBe(false);
    hold.reset(2050);
    expect(hold.observe(move(0.02), 2030, 2060, 'rotated').capture).toBe(false);
    expect(hold.observe(move(0.02), 2200, 2200, 'rotated').progress).toBe(0);
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
