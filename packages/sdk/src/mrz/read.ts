import { decodeMrz, MRZ_ALPHABET, MRZ_LAYOUTS, type MrzFormat, type MrzSummary } from './parse.js';

/** Classifier input: one character cell resampled to this many pixels, ink = 1, paper = 0. */
export const CELL_WIDTH = 16;
export const CELL_HEIGHT = 22;
const PAGE_WIDTH = 1100;

export interface Point { x: number; y: number }
/** A one-hidden-layer network over a character cell. Row-major weights. */
export interface MrzModel { hidden: number; w1: Float32Array; b1: Float32Array; w2: Float32Array; b2: Float32Array }
export interface MrzRead { lines: string[]; summary: MrzSummary; confidence: number }

export function grayscale(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]! * 0.299 + rgba[i * 4 + 1]! * 0.587 + rgba[i * 4 + 2]! * 0.114;
  return gray;
}

function sample(gray: Float32Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(x))), y0 = Math.max(0, Math.min(height - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const i = y0 * width + x0;
  return (gray[i]! * (1 - fx) + gray[i + 1]! * fx) * (1 - fy) + (gray[i + width]! * (1 - fx) + gray[i + width + 1]! * fx) * fy;
}

/** Rectifies the document quadrilateral (clockwise from top left) into an upright page. */
export function rectify(gray: Float32Array, width: number, height: number, corners: readonly Point[]): { page: Float32Array; width: number; height: number } {
  const [p0, p1, p2, p3] = corners as [Point, Point, Point, Point];
  const side = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const aspect = (side(p0, p1) + side(p3, p2)) / Math.max(1, side(p0, p3) + side(p1, p2));
  const outWidth = PAGE_WIDTH, outHeight = Math.max(32, Math.round(PAGE_WIDTH / Math.max(0.5, Math.min(3, aspect))));
  // Unit square to quadrilateral projective mapping (Heckbert).
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = Math.abs(denominator) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  const page = new Float32Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) / outWidth, w = g * u + h * v + 1;
      page[y * outWidth + x] = sample(gray, width, height, (a * u + b * v + p0.x) / w, (d * u + e * v + p0.y) / w);
    }
  }
  return { page, width: outWidth, height: outHeight };
}

export function rotate180(page: Float32Array): Float32Array {
  const rotated = new Float32Array(page.length);
  for (let i = 0; i < page.length; i++) rotated[i] = page[page.length - 1 - i]!;
  return rotated;
}

interface Blob { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }
interface TextLine { blobs: Blob[]; cy: number; height: number; top: number; bottom: number; x0: number; x1: number }
export interface MrzLineGeometry { top: number; bottom: number; first: number; pitch: number }

const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
};

/** Dark character-sized blobs in the lower half of the page, by local (adaptive) thresholding. */
function blobs(page: Float32Array, width: number, height: number): Blob[] {
  const startY = Math.floor(height * 0.45);
  const integral = new Float64Array((width + 1) * (height - startY + 1));
  const stride = width + 1;
  for (let y = startY; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += page[y * width + x]!;
      integral[(y - startY + 1) * stride + x + 1] = integral[(y - startY) * stride + x + 1]! + row;
    }
  }
  const radius = Math.max(6, Math.round(height * 0.035));
  const rows = height - startY, dark = new Uint8Array(width * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
    const xa = Math.max(0, x - radius), xb = Math.min(width, x + radius + 1), ya = Math.max(0, y - radius), yb = Math.min(rows, y + radius + 1);
    const mean = (integral[yb * stride + xb]! - integral[ya * stride + xb]! - integral[yb * stride + xa]! + integral[ya * stride + xa]!) / ((xb - xa) * (yb - ya));
    const value = page[(y + startY) * width + x]!;
    if (value < mean * 0.86 && mean - value > 10) dark[y * width + x] = 1;
  }
  const found: Blob[] = [], stack: number[] = [];
  const minHeight = height * 0.012, maxHeight = height * 0.09;
  for (let seed = 0; seed < dark.length; seed++) {
    if (dark[seed] !== 1) continue;
    dark[seed] = 2; stack.push(seed);
    let x0 = width, y0 = rows, x1 = -1, y1 = -1, area = 0;
    while (stack.length) {
      const i = stack.pop()!, x = i % width, y = (i - x) / width;
      area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= rows) continue;
        const n = ny * width + nx;
        if (dark[n] === 1) { dark[n] = 2; stack.push(n); }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // The filler '<' is small; touching characters can merge into a wider blob.
    if (h < minHeight * 0.45 || h > maxHeight || w > h * 2.6 || area < 6 || x0 <= 1 || x1 >= width - 2) continue;
    found.push({ x0, y0: y0 + startY, x1, y1: y1 + startY, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + startY });
  }
  return found;
}

function textLines(found: Blob[], width: number): TextLine[] {
  const lines: TextLine[] = [];
  for (const blob of [...found].sort((a, b) => a.cy - b.cy)) {
    const h = blob.y1 - blob.y0 + 1;
    const line = lines.find(candidate => Math.abs(candidate.cy - blob.cy) < 0.45 * Math.max(h, candidate.height));
    if (line) {
      line.blobs.push(blob);
      line.cy += (blob.cy - line.cy) / line.blobs.length;
      line.height = Math.max(line.height, h);
    } else lines.push({ blobs: [blob], cy: blob.cy, height: h, top: 0, bottom: 0, x0: 0, x1: 0 });
  }
  return lines.filter(line => line.blobs.length >= 10).map(line => {
    const heights = line.blobs.map(blob => blob.y1 - blob.y0 + 1);
    const tall = percentile(heights, 0.8);
    // Character height comes from full-height glyphs; fillers and punctuation are shorter.
    const capitals = line.blobs.filter(blob => blob.y1 - blob.y0 + 1 >= tall * 0.75);
    return { ...line, height: tall, top: percentile(capitals.map(blob => blob.y0), 0.2), bottom: percentile(capitals.map(blob => blob.y1), 0.8),
      x0: Math.min(...line.blobs.map(blob => blob.x0)), x1: Math.max(...line.blobs.map(blob => blob.x1)) };
  }).filter(line => line.x1 - line.x0 >= width * 0.5).sort((a, b) => a.cy - b.cy);
}

/** Fits a fixed-pitch grid of `count` characters to the blobs of one line; returns the share that fits. */
function fitGrid(line: TextLine, count: number): { first: number; pitch: number; fit: number } | null {
  const centers = line.blobs.map(blob => blob.cx).sort((a, b) => a - b);
  let best: { first: number; pitch: number; fit: number } | null = null;
  for (const start of centers.slice(0, 2)) for (const end of centers.slice(-2)) {
    const pitch = (end - start) / (count - 1);
    if (!(pitch > 0) || pitch / line.height < 0.55 || pitch / line.height > 1.7) continue;
    const occupied = new Set<number>();
    let good = 0;
    for (const center of centers) {
      const slot = (center - start) / pitch, nearest = Math.round(slot);
      if (nearest >= 0 && nearest < count && Math.abs(slot - nearest) < 0.25) { good++; occupied.add(nearest); }
    }
    const fit = Math.min(good / centers.length, occupied.size / count);
    if (!best || fit > best.fit) best = { first: start, pitch, fit };
  }
  return best;
}

/** Finds the bottom-most two or three evenly spaced full-width lines that fit an MRZ layout. */
export function locateMrz(page: Float32Array, width: number, height: number): { format: MrzFormat; lines: MrzLineGeometry[] } | null {
  const lines = textLines(blobs(page, width, height), width);
  let best: { format: MrzFormat; lines: MrzLineGeometry[]; fit: number } | null = null;
  for (const format of ['TD1', 'TD2', 'TD3'] as MrzFormat[]) {
    const { lines: count, length } = MRZ_LAYOUTS[format];
    if (lines.length < count) continue;
    const group = lines.slice(-count);
    const heights = group.map(line => line.height), meanHeight = heights.reduce((sum, value) => sum + value, 0) / count;
    if (heights.some(value => Math.abs(value - meanHeight) > meanHeight * 0.35)) continue;
    let consistent = true;
    for (let i = 1; i < count; i++) {
      const gap = group[i]!.cy - group[i - 1]!.cy;
      if (gap < meanHeight * 1.15 || gap > meanHeight * 2.8) consistent = false;
      if (Math.abs(group[i]!.x0 - group[0]!.x0) > width * 0.05 || Math.abs(group[i]!.x1 - group[0]!.x1) > width * 0.05) consistent = false;
    }
    if (!consistent) continue;
    const grids = group.map(line => fitGrid(line, length));
    if (grids.some(grid => !grid || grid.fit < 0.6)) continue;
    const fit = Math.min(...grids.map(grid => grid!.fit));
    if (!best || fit > best.fit) {
      best = { format, fit, lines: group.map((line, i) => ({ top: line.top, bottom: line.bottom, first: grids[i]!.first, pitch: grids[i]!.pitch })) };
    }
  }
  return best ? { format: best.format, lines: best.lines } : null;
}

/** Character cells of one located line, normalized to ink 1 and paper 0. */
export function cells(page: Float32Array, width: number, height: number, line: MrzLineGeometry, count: number): Float32Array[] {
  const textHeight = Math.max(4, line.bottom - line.top + 1);
  const top = line.top - textHeight * 0.14, bottom = line.bottom + textHeight * 0.14;
  // Paper and ink levels of this line, so print contrast and lighting do not matter.
  const values: number[] = [];
  const x0 = Math.max(0, Math.floor(line.first - line.pitch)), x1 = Math.min(width - 1, Math.ceil(line.first + line.pitch * count));
  for (let y = Math.max(0, Math.floor(top)); y <= Math.min(height - 1, Math.ceil(bottom)); y += 2) for (let x = x0; x <= x1; x += 2) values.push(page[y * width + x]!);
  const paper = percentile(values, 0.85), ink = percentile(values, 0.04), range = Math.max(12, paper - ink);
  const level = (x: number, y: number) => Math.max(0, Math.min(1, (paper - sample(page, width, height, x, y)) / range));
  const result: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    let center = line.first + i * line.pitch;
    // Center on the glyph's ink: the grid is approximate and narrow glyphs (I, 1) sit anywhere in their cell.
    let mass = 0, moment = 0;
    for (let s = 0; s < 12; s++) for (let t = 0; t < 8; t++) {
      const x = center + (s / 11 - 0.5) * line.pitch, value = level(x, top + (t + 0.5) / 8 * (bottom - top));
      mass += value; moment += value * x;
    }
    if (mass > 1.5) center += Math.max(-0.25, Math.min(0.25, (moment / mass - center) / line.pitch)) * line.pitch;
    const cell = new Float32Array(CELL_WIDTH * CELL_HEIGHT);
    for (let cy = 0; cy < CELL_HEIGHT; cy++) for (let cx = 0; cx < CELL_WIDTH; cx++) {
      let sum = 0;
      // 2x2 supersampling approximates the area average of a downscale.
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const x = center + ((cx + (sx + 0.5) / 2) / CELL_WIDTH - 0.5) * line.pitch;
        const y = top + (cy + (sy + 0.5) / 2) / CELL_HEIGHT * (bottom - top);
        sum += level(x, y);
      }
      cell[cy * CELL_WIDTH + cx] = sum / 4;
    }
    result.push(cell);
  }
  return result;
}

export function classify(model: MrzModel, cell: Float32Array): Float32Array {
  const inputs = CELL_WIDTH * CELL_HEIGHT, hidden = new Float32Array(model.hidden);
  for (let j = 0; j < model.hidden; j++) {
    let sum = model.b1[j]!;
    for (let i = 0, row = j * inputs; i < inputs; i++) sum += model.w1[row + i]! * cell[i]!;
    hidden[j] = sum > 0 ? sum : 0;
  }
  const scores = new Float32Array(MRZ_ALPHABET.length);
  let max = -Infinity;
  for (let k = 0; k < scores.length; k++) {
    let sum = model.b2[k]!;
    for (let j = 0, row = k * model.hidden; j < model.hidden; j++) sum += model.w2[row + j]! * hidden[j]!;
    scores[k] = sum; if (sum > max) max = sum;
  }
  let total = 0;
  for (let k = 0; k < scores.length; k++) { scores[k] = Math.exp(scores[k]! - max); total += scores[k]!; }
  for (let k = 0; k < scores.length; k++) scores[k]! /= total;
  return scores;
}

function readPage(model: MrzModel, page: Float32Array, width: number, height: number): MrzRead | null {
  const located = locateMrz(page, width, height);
  if (!located) return null;
  const { length } = MRZ_LAYOUTS[located.format];
  const probabilities = located.lines.map(line => cells(page, width, height, line, length).map(cell => classify(model, cell)));
  return decodeMrz(located.format, probabilities);
}

/**
 * Reads the machine-readable zone of a photographed document. `corners` outline the document in the
 * image (clockwise from top left, pixels). The document may be upside down. Returns null when no zone is found.
 */
export function readMrz(model: MrzModel, rgba: ArrayLike<number>, width: number, height: number, corners: readonly Point[]): MrzRead | null {
  const { page, width: pageWidth, height: pageHeight } = rectify(grayscale(rgba, width, height), width, height, corners);
  const upright = readPage(model, page, pageWidth, pageHeight);
  if (upright?.summary.valid) return upright;
  const turned = readPage(model, rotate180(page), pageWidth, pageHeight);
  if (turned?.summary.valid) return turned;
  return [upright, turned].filter((read): read is MrzRead => read !== null).sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}
