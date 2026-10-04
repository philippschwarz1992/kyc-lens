import { describe, expect, it } from 'vitest';
import { documentPreviewCrop } from '../src/camera/document-preview.js';

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
