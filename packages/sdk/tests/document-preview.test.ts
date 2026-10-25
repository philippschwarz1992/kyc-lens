import { describe, expect, it } from 'vitest';
import { documentCropRect, documentPreviewCrop } from '../src/camera/document-preview.js';

describe('document preview source coordinates', () => {
  it('analyzes the visible center crop when a landscape camera fills a portrait preview', () => {
    const crop = documentPreviewCrop(1920, 1080, 360, 480)!;
    expect(crop).toEqual({ x: 555, y: 0, width: 810, height: 1080, sampleWidth: 320, sampleHeight: 427 });
    // The visible guide center and the camera center must address the same source pixel.
    expect(crop.x + crop.width / 2).toBe(960);
    expect(crop.y + crop.height / 2).toBe(540);
  });

  it('removes hidden top/bottom pixels when a portrait camera fills a wide preview', () => {
    const crop = documentPreviewCrop(1080, 1920, 400, 240)!;
    expect(crop).toEqual({ x: 0, y: 636, width: 1080, height: 648, sampleWidth: 320, sampleHeight: 192 });
  });

  it('recomputes the crop after rotation and bounds tall previews without enlarging them', () => {
    const portrait = documentPreviewCrop(1280, 720, 240, 700)!;
    const landscape = documentPreviewCrop(1280, 720, 700, 240)!;
    expect(portrait.sampleHeight).toBe(480);
    expect(portrait.sampleWidth).toBeLessThan(320);
    expect(portrait.x).toBeGreaterThan(0);
    expect(landscape.x).toBe(0);
    expect(landscape.y).toBeGreaterThan(0);
    expect(documentPreviewCrop(640, 480, 160, 120)?.sampleWidth).toBe(160);
  });

  it('ignores cameras/previews without usable dimensions', () => {
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(documentPreviewCrop(invalid, 1080, 360, 480)).toBeNull();
      expect(documentPreviewCrop(1920, 1080, 360, invalid)).toBeNull();
    }
  });
});

describe('document photo crop', () => {
  it('crops to the guide plus margin in camera pixels and keeps the guide position for the recheck', () => {
    // A 1280x720 camera in a portrait preview shows a 405x720 center slice; an ID-card guide fills 88% of its width.
    const crop = documentPreviewCrop(1280, 720, 360, 640)!;
    const guide = { x: 0.06, y: 0.36, width: 0.88, height: 0.88 * 360 / 1.58 / 640 };
    const { rect, guide: inner } = documentCropRect({ crop, guide }, 1280, 720);
    expect(rect.width / rect.height).toBeCloseTo(1.58, 1);
    expect(rect.x).toBeGreaterThan(crop.x - 1); expect(rect.x + rect.width).toBeLessThanOrEqual(crop.x + crop.width + 1);
    expect(inner.x).toBeCloseTo(0.06 / 1.12, 2); expect(inner.width).toBeCloseTo(1 / 1.12, 2);
  });
  it('clamps the margin at the camera edges', () => {
    const { rect } = documentCropRect({ crop: { x: 0, y: 0, width: 1000, height: 600 }, guide: { x: 0, y: 0, width: 1, height: 1 } }, 1000, 600);
    expect(rect).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });
});
