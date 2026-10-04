/** Normalized bounds in the visible, object-fit-cropped camera preview. */
export interface DocumentGuide { x: number; y: number; width: number; height: number }
export interface DocumentPoint { x: number; y: number }
export type DocumentDetectionReason = 'searching' | 'outside' | 'too-small' | 'dark' | 'glare' | 'blur' | 'ready';
export interface DocumentDetection {
  reason: DocumentDetectionReason;
  /** Clockwise: top left, top right, bottom right, bottom left. */
  corners?: readonly DocumentPoint[];
  /** Capture assistance only. These measurements do not establish document authenticity. */
  metrics?: { brightness: number; clippedFraction: number; sharpness: number; detailFraction: number; edgeSupport: number };
}

interface PixelPoint { x: number; y: number }
interface Candidate { corners: PixelPoint[]; area: number; support: number; clipped: boolean }
interface DocumentInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  guide: DocumentGuide;
  type: 'id-card' | 'drivers-license' | 'passport';
}

const cross = (a: PixelPoint, b: PixelPoint, c: PixelPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const distance = (a: PixelPoint, b: PixelPoint) => Math.hypot(a.x - b.x, a.y - b.y);
function polygonArea(points: readonly PixelPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - a.y * b.x;
  }
  return Math.abs(sum) / 2;
}

function convexHull(indices: number[], width: number): PixelPoint[] {
  // Numeric row order is also a valid lexicographic order for a monotone hull.
  indices.sort((a, b) => a - b);
  const points = indices.map((index) => ({ x: index % width, y: Math.floor(index / width) }));
  const lower: PixelPoint[] = [], upper: PixelPoint[] = [];
  for (const point of points) {
    while (lower.length > 1 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;
    while (upper.length > 1 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function quadrilateral(hull: PixelPoint[]): PixelPoint[] | null {
  if (hull.length < 4) return null;
  const originalArea = polygonArea(hull);
  const points = hull.slice();
  // Removing the least significant convex corner preserves the outer silhouette.
  // Rounded ID corners contribute very small triangles; an oval loses much more area.
  while (points.length > 4) {
    let smallest = Infinity, remove = -1;
    for (let i = 0; i < points.length; i++) {
      const triangle = Math.abs(cross(points[(i + points.length - 1) % points.length]!, points[i]!, points[(i + 1) % points.length]!));
      if (triangle < smallest) { smallest = triangle; remove = i; }
    }
    points.splice(remove, 1);
  }
  if (polygonArea(points) < originalArea * 0.88) return null;
  let start = 0;
  for (let i = 1; i < 4; i++) if (points[i]!.x + points[i]!.y < points[start]!.x + points[start]!.y) start = i;
  const ordered = [...points.slice(start), ...points.slice(0, start)];
  if (cross(ordered[0]!, ordered[1]!, ordered[2]!) < 0) return [ordered[0]!, ordered[3]!, ordered[2]!, ordered[1]!];
  return ordered;
}

function plausibleShape(corners: PixelPoint[], type: DocumentInput['type']): boolean {
  const lengths = corners.map((point, i) => distance(point, corners[(i + 1) % 4]!));
  const aspect = (lengths[0]! + lengths[2]!) / (lengths[1]! + lengths[3]!);
  if (aspect < (type === 'passport' ? 1.04 : 1.2) || aspect > (type === 'passport' ? 1.95 : 2.02)) return false;
  if (Math.max(lengths[0]!, lengths[2]!) / Math.min(lengths[0]!, lengths[2]!) > 1.55
    || Math.max(lengths[1]!, lengths[3]!) / Math.min(lengths[1]!, lengths[3]!) > 1.55) return false;
  for (let i = 0; i < 4; i++) {
    const a = corners[(i + 3) % 4]!, b = corners[i]!, c = corners[(i + 1) % 4]!;
    const cosine = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (distance(a, b) * distance(c, b));
    if (!Number.isFinite(cosine) || Math.abs(cosine) > 0.6) return false;
  }
  // A landscape page/card should be held approximately horizontally in this guide.
  return Math.abs(corners[1]!.y - corners[0]!.y) / lengths[0]! < 0.57;
}

function sideSupport(a: PixelPoint, b: PixelPoint, gx: Int16Array, gy: Int16Array, magnitude: Uint16Array,
  width: number, height: number, threshold: number): number {
  const length = distance(a, b);
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
  const samples = Math.max(12, Math.min(90, Math.round(length / 3)));
  let supported = 0;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
    let found = false;
    for (let dy = -3; dy <= 3 && !found; dy++) for (let dx = -3; dx <= 3; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) continue;
      const index = py * width + px;
      // Require a gradient normal to this side, not nearby unrelated text edges.
      if (magnitude[index]! >= threshold && Math.abs(gx[index]! * nx + gy[index]! * ny) >= magnitude[index]! * 0.56) { found = true; break; }
    }
    if (found) supported++;
  }
  return supported / (samples - 1);
}

function sideContrast(a: PixelPoint, b: PixelPoint, gray: Float32Array, width: number, height: number): number {
  const length = distance(a, b), nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
  let inside = 0, outside = 0, samples = 0;
  // An outer edge separates the page from its surroundings. A printed frame has
  // the same paper on both sides and must not stand in for the document boundary.
  for (let i = 2; i < 15; i++) {
    const t = i / 16, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const ix = Math.round(x + nx * 6), iy = Math.round(y + ny * 6);
    const ox = Math.round(x - nx * 6), oy = Math.round(y - ny * 6);
    if (ix < 1 || iy < 1 || ox < 1 || oy < 1 || ix >= width - 1 || iy >= height - 1 || ox >= width - 1 || oy >= height - 1) continue;
    inside += gray[iy * width + ix]!; outside += gray[oy * width + ox]!; samples++;
  }
  return samples ? Math.abs(inside - outside) / samples : 0;
}

function quality(data: Uint8ClampedArray, gray: Float32Array, magnitude: Uint16Array,
  corners: PixelPoint[], width: number, height: number, support: number): DocumentDetection['metrics'] {
  const center = corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  // Exclude the document boundary: a sharp outline must not hide blurred/blank content.
  const inner = corners.map((point) => ({ x: center.x + (point.x - center.x) * 0.84, y: center.y + (point.y - center.y) * 0.84 }));
  const minX = Math.max(1, Math.floor(Math.min(...inner.map((point) => point.x))));
  const maxX = Math.min(width - 2, Math.ceil(Math.max(...inner.map((point) => point.x))));
  const minY = Math.max(1, Math.floor(Math.min(...inner.map((point) => point.y))));
  const maxY = Math.min(height - 2, Math.ceil(Math.max(...inner.map((point) => point.y))));
  const planes = inner.map((a, i) => {
    const b = inner[(i + 1) % 4]!;
    return { a: a.y - b.y, b: b.x - a.x, c: (b.y - a.y) * a.x - (b.x - a.x) * a.y };
  });
  const regionCount = new Uint32Array(9), regionDetail = new Uint32Array(9);
  const regionLap = new Float64Array(9), regionSquared = new Float64Array(9);
  let count = 0, total = 0, clipped = 0, detail = 0, lapTotal = 0, lapSquared = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (planes.some((plane) => plane.a * x + plane.b * y + plane.c < 0)) continue;
    const index = y * width + x, rgba = index * 4, luma = gray[index]!;
    const lap = gray[index - 1]! + gray[index + 1]! + gray[index - width]! + gray[index + width]! - 4 * luma;
    const region = Math.min(2, Math.floor((y - minY) * 3 / (maxY - minY + 1))) * 3
      + Math.min(2, Math.floor((x - minX) * 3 / (maxX - minX + 1)));
    count++; total += luma; lapTotal += lap; lapSquared += lap * lap;
    regionCount[region]++; regionLap[region] += lap; regionSquared[region] += lap * lap;
    if (data[rgba]! >= 248 && data[rgba + 1]! >= 248 && data[rgba + 2]! >= 248) clipped++;
    if (magnitude[index]! >= 85) { detail++; regionDetail[region]++; }
  }
  const structuredVariance: number[] = [];
  for (let region = 0; region < 9; region++) {
    const n = regionCount[region]!;
    if (n < 20 || regionDetail[region]! / n < 0.008) continue;
    structuredVariance.push(Math.max(0, regionSquared[region]! / n - (regionLap[region]! / n) ** 2));
  }
  structuredVariance.sort((a, b) => a - b);
  // A crisp border, barcode or isolated patch must not hide blur across the rest
  // of the information. Use the median of structured regions, not its sharpest edge.
  const medianVariance = structuredVariance.length >= 3 ? structuredVariance[Math.floor(structuredVariance.length / 2)]! : 0;
  const wholeVariance = Math.max(0, lapSquared / Math.max(1, count) - (lapTotal / Math.max(1, count)) ** 2);
  return { brightness: total / Math.max(1, count), clippedFraction: clipped / Math.max(1, count),
    sharpness: Math.min(wholeVariance, medianVariance),
    detailFraction: detail / Math.max(1, count), edgeSupport: support };
}

/**
 * Dependency-free document framing/clarity aid. It detects a supported rectangular
 * outline and readable image detail, not the document's identity or authenticity.
 * Input is intentionally capped to keep repeated analysis bounded in a worker.
 */
export function analyzeDocument({ data, width, height, guide, type }: DocumentInput): DocumentDetection {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width > 480 || height > 480
    || !(data instanceof Uint8ClampedArray) || data.length !== width * height * 4 || !guide || typeof guide !== 'object'
    || ![guide.x, guide.y, guide.width, guide.height].every(Number.isFinite)
    || guide.x < 0 || guide.y < 0 || guide.width <= 0 || guide.height <= 0
    || guide.x + guide.width > 1.001 || guide.y + guide.height > 1.001
    || !['id-card', 'drivers-license', 'passport'].includes(type)) return { reason: 'searching' };
  const pixels = width * height;
  const gray = new Float32Array(pixels), smooth = new Float32Array(pixels);
  const gx = new Int16Array(pixels), gy = new Int16Array(pixels), magnitude = new Uint16Array(pixels);
  const edges = new Uint8Array(pixels), connected = new Uint8Array(pixels), queue = new Int32Array(pixels);
  for (let i = 0; i < pixels; i++) gray[i] = data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    smooth[i] = (gray[i - width - 1]! + 2 * gray[i - width]! + gray[i - width + 1]!
      + 2 * gray[i - 1]! + 4 * gray[i]! + 2 * gray[i + 1]!
      + gray[i + width - 1]! + 2 * gray[i + width]! + gray[i + width + 1]!) / 16;
  }
  const threshold = 42;
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const i = y * width + x;
    gx[i] = -smooth[i - width - 1]! + smooth[i - width + 1]! - 2 * smooth[i - 1]! + 2 * smooth[i + 1]! - smooth[i + width - 1]! + smooth[i + width + 1]!;
    gy[i] = -smooth[i - width - 1]! - 2 * smooth[i - width]! - smooth[i - width + 1]! + smooth[i + width - 1]! + 2 * smooth[i + width]! + smooth[i + width + 1]!;
    magnitude[i] = Math.abs(gx[i]!) + Math.abs(gy[i]!);
    if (magnitude[i]! >= threshold) edges[i] = 1;
  }
  // One pixel dilation joins rounded corners and small camera edge gaps.
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (!edges[i]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) connected[i + dy * width + dx] = 1;
  }
  const guideArea = guide.width * width * guide.height * height;
  const candidates: Candidate[] = [];
  for (let seed = 0; seed < pixels; seed++) {
    if (connected[seed] !== 1) continue;
    let read = 0, write = 1, clipped = false;
    queue[0] = seed; connected[seed] = 2;
    const boundary: number[] = [];
    while (read < write) {
      const i = queue[read++]!, x = i % width, y = Math.floor(i / width);
      if (x <= 3 || y <= 3 || x >= width - 4 || y >= height - 4) clipped = true;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1
        || !connected[i - 1] || !connected[i + 1] || !connected[i - width] || !connected[i + width]) boundary.push(i);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const neighbor = py * width + px;
        if (connected[neighbor] === 1) { connected[neighbor] = 2; queue[write++] = neighbor; }
      }
    }
    if (boundary.length < 40) continue;
    const corners = quadrilateral(convexHull(boundary, width));
    if (!corners || !plausibleShape(corners, type)) continue;
    const area = polygonArea(corners);
    if (area < guideArea * 0.12) continue;
    const supports = corners.map((a, i) => sideSupport(a, corners[(i + 1) % 4]!, gx, gy, magnitude, width, height, threshold));
    const support = supports.reduce((sum, value) => sum + value / 4, 0);
    if (supports.some((value) => value < 0.73) || support < 0.83) {
      // A clipped edge cannot have four visible corners; retain it only as a red candidate.
      if (!clipped || supports.filter((value) => value >= 0.73).length < 3) continue;
    }
    if (!clipped) {
      const contrasts = corners.map((a, i) => sideContrast(a, corners[(i + 1) % 4]!, gray, width, height));
      if (contrasts.filter((value) => value >= 12).length < 3 || contrasts.reduce((sum, value) => sum + value / 4, 0) < 18) continue;
    }
    candidates.push({ corners, area, support, clipped });
  }
  // Prefer the outer document over a crisp portrait/text box on an oversized document.
  const candidate = candidates.sort((a, b) => b.area - a.area)[0];
  if (!candidate) return { reason: 'searching' };
  const { corners, area, support, clipped } = candidate;
  const normalized = corners.map((point) => ({ x: point.x / width, y: point.y / height }));
  const toleranceX = 1.5 / width, toleranceY = 1.5 / height;
  if (clipped || normalized.some((point) => point.x < guide.x - toleranceX || point.x > guide.x + guide.width + toleranceX
    || point.y < guide.y - toleranceY || point.y > guide.y + guide.height + toleranceY)) return { reason: 'outside', corners: normalized };
  if (area < guideArea * 0.5) return { reason: 'too-small', corners: normalized };
  const metrics = quality(data, gray, magnitude, corners, width, height, support)!;
  const reason: DocumentDetectionReason = metrics.brightness < 68 ? 'dark' : metrics.clippedFraction > 0.16 ? 'glare'
    : metrics.sharpness < 38 || metrics.detailFraction < 0.016 ? 'blur' : 'ready';
  return { reason, corners: normalized, metrics };
}
