import { comparisonResult, validDecisionOptions } from './protocol.js';
import type { FaceMatchResult } from './protocol.js';

export type Point = readonly [number, number];
export type FivePoints = readonly [Point, Point, Point, Point, Point];
export interface DetectedFace { x: number; y: number; width: number; height: number; landmarks: FivePoints; score: number; }
export interface Pixels { data: Uint8ClampedArray; width: number; height: number; }
export interface NumericTensor { data: ArrayLike<number>; dims: readonly number[]; }
export type SimilarityTransform = readonly [number, number, number, number, number, number];

// Pinned reference: OpenCV 4.12.0 modules/objdetect/src/face_recognize.cpp.
// https://github.com/opencv/opencv/blob/4.12.0/modules/objdetect/src/face_recognize.cpp
export const SFACE_TARGET: FivePoints = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041],
];

/** Closed-form orientation-preserving 2D Procrustes, equivalent to the reference's SVD solution. */
export function similarityTransform(source: FivePoints): SimilarityTransform | null {
  if (source.length !== 5 || source.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) return null;
  const meanX = source.reduce((sum, point) => sum + point[0], 0) / 5;
  const meanY = source.reduce((sum, point) => sum + point[1], 0) / 5;
  // Keep the reference's rounded target mean (rather than recalculating it).
  const targetX = 56.0262, targetY = 71.9008;
  let norm = 0, dot = 0, cross = 0;
  for (let index = 0; index < 5; index++) {
    const x = source[index]![0] - meanX, y = source[index]![1] - meanY;
    const u = SFACE_TARGET[index]![0] - targetX, v = SFACE_TARGET[index]![1] - targetY;
    norm += x * x + y * y; dot += x * u + y * v; cross += x * v - y * u;
  }
  if (norm < 1e-8) return null;
  const a = dot / norm, b = cross / norm;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a * a + b * b < 1e-12) return null;
  return [a, -b, targetX - a * meanX + b * meanY, b, a, targetY - b * meanX - a * meanY];
}

export function validPixels(pixels: Pixels): boolean {
  return Number.isInteger(pixels.width) && Number.isInteger(pixels.height) && pixels.width > 0 && pixels.height > 0
    && pixels.data.length === pixels.width * pixels.height * 4;
}

/** Uint8 input to NCHW float32. YuNet expects BGR; SFace expects RGB, both raw 0..255. */
export function imageTensor(pixels: Pixels, channelOrder: 'RGB' | 'BGR'): Float32Array | null {
  if (!validPixels(pixels)) return null;
  const plane = pixels.width * pixels.height;
  const output = new Float32Array(plane * 3);
  const first = channelOrder === 'RGB' ? 0 : 2, third = channelOrder === 'RGB' ? 2 : 0;
  for (let index = 0; index < plane; index++) {
    output[index] = pixels.data[index * 4 + first]!;
    output[plane + index] = pixels.data[index * 4 + 1]!;
    output[plane * 2 + index] = pixels.data[index * 4 + third]!;
  }
  return output;
}

/** Reference uses 8-bit warpAffine INTER_LINEAR with a black border and 1/32 interpolation table. */
export function alignedFace(pixels: Pixels, points: FivePoints): Pixels | null {
  if (!validPixels(pixels)) return null;
  const matrix = similarityTransform(points);
  if (!matrix) return null;
  const [a, b, tx, c, d, ty] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const output = new Uint8ClampedArray(112 * 112 * 4);
  const pixel = (x: number, y: number, channel: number) => x >= 0 && y >= 0 && x < pixels.width && y < pixels.height
    ? pixels.data[(y * pixels.width + x) * 4 + channel]! : 0;
  for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) {
    const sx = Math.round(((d * (x - tx) - b * (y - ty)) / determinant) * 32) / 32;
    const sy = Math.round(((-c * (x - tx) + a * (y - ty)) / determinant) * 32) / 32;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const index = (y * 112 + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const value = pixel(ix, iy, channel) * (1 - fx) * (1 - fy) + pixel(ix + 1, iy, channel) * fx * (1 - fy)
        + pixel(ix, iy + 1, channel) * (1 - fx) * fy + pixel(ix + 1, iy + 1, channel) * fx * fy;
      output[index + channel] = Math.round(value);
    }
    output[index + 3] = 255;
  }
  return { data: output, width: 112, height: 112 };
}

function intersectionOverUnion(a: DetectedFace, b: DetectedFace): number {
  // OpenCV converts the candidate rectangles to Rect2i before NMS.
  const ax = Math.trunc(a.x), ay = Math.trunc(a.y), aw = Math.trunc(a.width), ah = Math.trunc(a.height);
  const bx = Math.trunc(b.x), by = Math.trunc(b.y), bw = Math.trunc(b.width), bh = Math.trunc(b.height);
  const width = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const height = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const intersection = width * height;
  return intersection / Math.max(1e-12, aw * ah + bw * bh - intersection);
}

/** Decode the March-2023 YuNet output, following pinned OpenCV 4.12.0 face_detect.cpp. */
export function decodeYuNet(outputs: Record<string, NumericTensor>, width = 640, height = 640,
  scoreThreshold = 0.8, nmsThreshold = 0.3): DetectedFace[] | null {
  if (width % 32 || height % 32 || width <= 0 || height <= 0) return null;
  const faces: DetectedFace[] = [];
  for (const stride of [8, 16, 32]) {
    const cols = width / stride, rows = height / stride, count = cols * rows;
    const cls = outputs[`cls_${stride}`], obj = outputs[`obj_${stride}`], bbox = outputs[`bbox_${stride}`], kps = outputs[`kps_${stride}`];
    const valid = (tensor: NumericTensor | undefined, channels: number) => tensor && tensor.data.length === count * channels
      && tensor.dims.length === 3 && tensor.dims[0] === 1 && tensor.dims[1] === count && tensor.dims[2] === channels;
    if (!valid(cls, 1) || !valid(obj, 1) || !valid(bbox, 4) || !valid(kps, 10)) return null;
    for (let index = 0; index < count; index++) {
      const confidence = cls!.data[index]!, objectness = obj!.data[index]!;
      if (!Number.isFinite(confidence) || !Number.isFinite(objectness)) return null;
      const score = Math.sqrt(Math.min(1, Math.max(0, confidence)) * Math.min(1, Math.max(0, objectness)));
      if (score < scoreThreshold) continue;
      const row = Math.floor(index / cols), col = index % cols;
      const cx = (col + bbox!.data[index * 4]!) * stride, cy = (row + bbox!.data[index * 4 + 1]!) * stride;
      const w = Math.exp(bbox!.data[index * 4 + 2]!) * stride, h = Math.exp(bbox!.data[index * 4 + 3]!) * stride;
      const points = Array.from({ length: 5 }, (_, point) => [
        (col + kps!.data[index * 10 + point * 2]!) * stride,
        (row + kps!.data[index * 10 + point * 2 + 1]!) * stride,
      ] as Point) as unknown as FivePoints;
      if (![cx, cy, w, h, ...points.flat()].every(Number.isFinite) || w <= 0 || h <= 0 || w > width * 4 || h > height * 4) return null;
      faces.push({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, landmarks: points, score });
    }
  }
  const sorted = faces.sort((a, b) => b.score - a.score).slice(0, 5000), kept: DetectedFace[] = [];
  for (const face of sorted) {
    if (kept.every(other => intersectionOverUnion(face, other) <= nmsThreshold)) kept.push(face);
  }
  return kept;
}

export function selectFace(faces: readonly DetectedFace[], kind: 'document' | 'selfie'): { face?: DetectedFace; reason?: FaceMatchResult['reason'] } {
  if (!faces.length) return { reason: kind === 'document' ? 'no_document_face' : 'no_selfie_face' };
  if (kind === 'selfie' && faces.length !== 1) return { reason: 'multiple_selfie_faces' };
  const sorted = [...faces].sort((a, b) => b.width * b.height - a.width * a.height);
  if (kind === 'document' && sorted.length > 1 && sorted[0]!.width * sorted[0]!.height < sorted[1]!.width * sorted[1]!.height * 2.5) {
    return { reason: 'ambiguous_document_face' };
  }
  return { face: sorted[0] };
}

/** Engineering acquisition gates. They require calibration on actual documents and devices. */
export function faceAcquisitionReason(face: DetectedFace, pixels: Pixels, crop: Pixels, kind: 'document' | 'selfie'): FaceMatchResult['reason'] | undefined {
  const [eyeA, eyeB, nose, mouthA, mouthB] = face.landmarks;
  const eyeX = eyeB[0] - eyeA[0], eyeY = eyeB[1] - eyeA[1], eyes = Math.hypot(eyeX, eyeY);
  if (Math.min(face.width, face.height) < 80 || eyes < 28) return kind === 'document' ? 'document_face_too_small' : 'selfie_face_too_small';
  const ex = eyeX / eyes, ey = eyeY / eyes;
  const nosePosition = ((nose[0] - eyeA[0]) * ex + (nose[1] - eyeA[1]) * ey) / eyes;
  const noseDepth = (-(nose[0] - eyeA[0]) * ey + (nose[1] - eyeA[1]) * ex) / eyes;
  const mouthDepth = (-((mouthA[0] + mouthB[0]) / 2 - eyeA[0]) * ey + ((mouthA[1] + mouthB[1]) / 2 - eyeA[1]) * ex) / eyes;
  if (eyeX <= 0 || Math.abs(Math.atan2(eyeY, eyeX)) > Math.PI / 7 || nosePosition < 0.2 || nosePosition > 0.8
    || noseDepth < 0.18 || noseDepth > 1.15 || mouthDepth < 0.65 || mouthDepth > 1.8
    || face.x < 0 || face.y < 0 || face.x + face.width > pixels.width || face.y + face.height > pixels.height
    || face.landmarks.some(([x, y]) => x < 0 || y < 0 || x >= pixels.width || y >= pixels.height)) {
    return kind === 'document' ? 'document_pose' : 'selfie_pose';
  }
  const metrics = faceQuality(crop);
  if (!metrics || metrics.mean < 35 || metrics.mean > 225 || metrics.laplacianVariance < 18 || metrics.clippedFraction > 0.35) {
    return kind === 'document' ? 'document_quality' : 'selfie_quality';
  }
  return undefined;
}

export function faceQuality(pixels: Pixels): { mean: number; laplacianVariance: number; clippedFraction: number } | null {
  if (!validPixels(pixels) || pixels.width < 4 || pixels.height < 4) return null;
  const grey = new Float64Array(pixels.width * pixels.height);
  for (let index = 0; index < grey.length; index++) grey[index] = 0.299 * pixels.data[index * 4]! + 0.587 * pixels.data[index * 4 + 1]! + 0.114 * pixels.data[index * 4 + 2]!;
  let mean = 0, clipped = 0, lapSum = 0, lapSquares = 0, count = 0;
  // Central region avoids counting interpolated crop borders as facial detail.
  const marginX = Math.max(1, Math.floor(pixels.width * 0.12)), marginY = Math.max(1, Math.floor(pixels.height * 0.12));
  for (let y = marginY; y < pixels.height - marginY; y++) for (let x = marginX; x < pixels.width - marginX; x++) {
    const index = y * pixels.width + x, value = grey[index]!;
    const lap = grey[index - 1]! + grey[index + 1]! + grey[index - pixels.width]! + grey[index + pixels.width]! - 4 * value;
    mean += value; clipped += value < 10 || value > 245 ? 1 : 0; lapSum += lap; lapSquares += lap * lap; count++;
  }
  return { mean: mean / count, laplacianVariance: Math.max(0, lapSquares / count - (lapSum / count) ** 2), clippedFraction: clipped / count };
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  if (a.length !== 128 || b.length !== 128) return null;
  let product = 0, normA = 0, normB = 0;
  for (let index = 0; index < a.length; index++) {
    const x = a[index]!, y = b[index]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    product += x * y; normA += x * x; normB += y * y;
  }
  if (normA < 1e-12 || normB < 1e-12) return null;
  const score = product / Math.sqrt(normA * normB);
  return Number.isFinite(score) ? Math.max(-1, Math.min(1, score)) : null;
}

export function scoreDecision(score: number | null, threshold: number, margin: number): FaceMatchResult {
  if (!validDecisionOptions(threshold, margin)) return comparisonResult('inconclusive', 'invalid_options');
  if (score === null || !Number.isFinite(score) || score < -1 || score > 1) return comparisonResult('inconclusive', 'invalid_embedding', threshold, margin);
  const status = score >= threshold + margin ? 'match' : score < threshold - margin ? 'no_match' : 'inconclusive';
  return { ...comparisonResult(status, status === 'inconclusive' ? 'uncertain_score' : 'compared', threshold, margin), score };
}
