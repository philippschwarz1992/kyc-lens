import { describe, expect, it } from 'vitest';
import { analyzeDocument, type DocumentGuide } from '../src/core/document.js';

const width = 320, height = 360;
const guide: DocumentGuide = { x: 0.06, y: 0.25, width: 0.88, height: 0.5 };
type Point = readonly [number, number];
const card: readonly Point[] = [[32, 100], [288, 100], [288, 260], [32, 260]];

function rotatedCard(degrees: number): readonly Point[] {
  const angle = degrees * Math.PI / 180;
  return [[-112, -70], [112, -70], [112, 70], [-112, 70]].map(([x, y]) => [
    160 + x! * Math.cos(angle) - y! * Math.sin(angle),
    180 + x! * Math.sin(angle) + y! * Math.cos(angle),
  ] as const);
}

function photo(options: { corners?: readonly Point[]; blank?: boolean; dark?: boolean; glare?: boolean; background?: 'noise' | 'stripes' } = {}): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const points = options.corners ?? card;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = options.background === 'noise' ? 45 + ((x * 563 + y * 173 + x * y * 3) % 145)
      : options.background === 'stripes' ? (x % 17 < 7 ? 65 : 150) : 65;
    // Invert bilinear quad coordinates to keep the document contents within its silhouette.
    let u = 0.5, v = 0.5;
    for (let n = 0; n < 5; n++) {
      const px = points[0]![0] * (1 - u) * (1 - v) + points[1]![0] * u * (1 - v) + points[2]![0] * u * v + points[3]![0] * (1 - u) * v;
      const py = points[0]![1] * (1 - u) * (1 - v) + points[1]![1] * u * (1 - v) + points[2]![1] * u * v + points[3]![1] * (1 - u) * v;
      const dxdu = (points[1]![0] - points[0]![0]) * (1 - v) + (points[2]![0] - points[3]![0]) * v;
      const dydu = (points[1]![1] - points[0]![1]) * (1 - v) + (points[2]![1] - points[3]![1]) * v;
      const dxdv = (points[3]![0] - points[0]![0]) * (1 - u) + (points[2]![0] - points[1]![0]) * u;
      const dydv = (points[3]![1] - points[0]![1]) * (1 - u) + (points[2]![1] - points[1]![1]) * u;
      const determinant = dxdu * dydv - dxdv * dydu;
      const ex = x + 0.5 - px, ey = y + 0.5 - py;
      u += (ex * dydv - ey * dxdv) / determinant;
      v += (ey * dxdu - ex * dydu) / determinant;
    }
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      value = 229;
      if (!options.blank) {
        // Fictional portrait and small interrupted type lines, not a real identity document.
        if (u > 0.07 && u < 0.32 && v > 0.19 && v < 0.8) {
          value = 130 + Math.round((u + v) * 12);
          if (((u - 0.195) / 0.07) ** 2 + ((v - 0.39) / 0.13) ** 2 < 1) value = 183;
          if (v > 0.64 && Math.abs(u - 0.195) < (v - 0.57) * 0.5) value = 78;
        }
        if (u > 0.4 && u < 0.89 && v > 0.18 && v < 0.75 && Math.floor(v * 78) % 9 < 2 && Math.floor(u * 100) % 9 < 6) value = 74;
        if (v > 0.84 && v < 0.94 && u > 0.08 && u < 0.92 && Math.floor(u * 190) % 4 < 2) value = 80;
      }
      if (options.dark) value *= 0.2;
      if (options.glare && u > 0.33 && u < 0.86 && v > 0.22 && v < 0.85) value = 255;
    }
    const index = (y * width + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = value;
    data[index + 3] = 255;
  }
  return data;
}

function blur(data: Uint8ClampedArray, radius: number): Uint8ClampedArray {
  const horizontal = new Float32Array(width * height), output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dx = -radius; dx <= radius; dx++) sum += data[(y * width + Math.max(0, Math.min(width - 1, x + dx))) * 4]!;
    horizontal[y * width + x] = sum / (radius * 2 + 1);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy++) sum += horizontal[Math.max(0, Math.min(height - 1, y + dy)) * width + x]!;
    const index = (y * width + x) * 4;
    output[index] = output[index + 1] = output[index + 2] = sum / (radius * 2 + 1);
    output[index + 3] = 255;
  }
  return output;
}

function detect(data = photo(), changes: { guide?: DocumentGuide; type?: 'id-card' | 'drivers-license' | 'passport' } = {}) {
  return analyzeDocument({ data, width, height, guide, type: 'id-card', ...changes });
}

describe('Document framing and image clarity', () => {
  it('accepts a complete sharp ID and returns its outer four normalized corners', () => {
    const result = detect();
    expect(result.reason).toBe('ready');
    expect(result.corners).toHaveLength(4);
    expect(result.corners![0]!.x).toBeCloseTo(card[0]![0] / width, 1);
    expect(result.corners![0]!.y).toBeCloseTo(card[0]![1] / height, 1);
    expect(result.corners![2]!.x).toBeCloseTo(card[2]![0] / width, 1);
    expect(result.corners![2]!.y).toBeCloseTo(card[2]![1] / height, 1);
    expect(result.metrics!.detailFraction).toBeGreaterThan(0.016);
  });

  it('accepts a passport photo page with a different aspect ratio', () => {
    const page: readonly Point[] = [[33, 91], [287, 91], [287, 269], [33, 269]];
    expect(detect(photo({ corners: page }), { type: 'passport', guide: { x: 0.06, y: 0.22, width: 0.88, height: 0.56 } }).reason).toBe('ready');
  });

  it('supports modest rotation and perspective without replacing corners with an axis-aligned box', () => {
    const rotation = detect(photo({ corners: rotatedCard(8) }));
    expect(rotation.reason).toBe('ready');
    expect(rotation.corners![1]!.y).toBeGreaterThan(rotation.corners![0]!.y + 0.05);
    const perspective: readonly Point[] = [[43, 105], [285, 112], [269, 257], [34, 249]];
    expect(detect(photo({ corners: perspective })).reason).toBe('ready');
  });

  it('marks an oversized or shifted document outside even when its sharp inner content fits', () => {
    const oversized: readonly Point[] = [[7, 84], [311, 84], [311, 277], [7, 277]];
    expect(detect(photo({ corners: oversized })).reason).toBe('outside');
    const shifted = card.map(([x, y]) => [x + 20, y] as const);
    expect(detect(photo({ corners: shifted })).reason).toBe('outside');
  });

  it('never makes a partially clipped card green', () => {
    const clipped: readonly Point[] = [[-42, 96], [272, 96], [272, 293], [-42, 293]];
    expect(detect(photo({ corners: clipped })).reason).not.toBe('ready');
  });

  it('does not use an inner printed frame when the whole page extends beyond the camera', () => {
    const data = photo();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index] === 65) data[index] = data[index + 1] = data[index + 2] = 229;
      if (x >= 32 && x <= 288 && y >= 100 && y <= 260
        && (x <= 34 || x >= 286 || y <= 102 || y >= 258)) data[index] = data[index + 1] = data[index + 2] = 75;
    }
    expect(detect(data).reason).not.toBe('ready');
  });

  it('asks a small document to fill more of the guide', () => {
    const small: readonly Point[] = [[103, 144], [217, 144], [217, 216], [103, 216]];
    expect(detect(photo({ corners: small })).reason).toBe('too-small');
  });

  it('rejects blank scenes and empty paper despite a strong rectangular outline', () => {
    const blank = new Uint8ClampedArray(width * height * 4).fill(120);
    expect(detect(blank).reason).toBe('searching');
    expect(detect(photo({ blank: true })).reason).toBe('blur');
  });

  it('rejects interior blur without borrowing sharpness from the card outline', () => {
    const blurred = blur(photo(), 5);
    expect(detect(blurred).reason).not.toBe('ready');
    const crispOutline = photo();
    for (let y = 113; y < 247; y++) for (let x = 45; x < 275; x++) {
      const index = (y * width + x) * 4;
      crispOutline.set(blurred.subarray(index, index + 4), index);
    }
    expect(detect(crispOutline).reason).toBe('blur');
  });

  it('rejects dark documents and saturated glare covering the information', () => {
    expect(detect(photo({ dark: true })).reason).toBe('dark');
    expect(detect(photo({ glare: true })).reason).toBe('glare');
  });

  it('does not turn textured or striped backgrounds into a green document', () => {
    const absent: readonly Point[] = [[-400, -400], [-200, -400], [-200, -275], [-400, -275]];
    expect(detect(photo({ corners: absent, background: 'noise' })).reason).not.toBe('ready');
    expect(detect(photo({ corners: absent, background: 'stripes' })).reason).not.toBe('ready');
  });

  it('rejects an oval-shaped distractor even with crisp detail inside it', () => {
    const data = photo();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (((x - 160) / 128) ** 2 + ((y - 180) / 80) ** 2 <= 1) continue;
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 65;
    }
    expect(detect(data).reason).not.toBe('ready');
  });

  it('bounds work and rejects invalid or oversized frames safely', () => {
    expect(analyzeDocument({ data: new Uint8ClampedArray(4), width, height, guide, type: 'id-card' }).reason).toBe('searching');
    expect(analyzeDocument({ data: new Uint8ClampedArray(481 * 32 * 4), width: 481, height: 32, guide, type: 'passport' }).reason).toBe('searching');
    expect(detect(photo(), { guide: { x: NaN, y: 0, width: 1, height: 1 } }).reason).toBe('searching');
    expect(detect(photo(), { guide: { x: 0, y: 0, width: -1, height: 1 } }).reason).toBe('searching');
  });
});
