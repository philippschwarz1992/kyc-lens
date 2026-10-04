import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareFaces, resolveMatchAssets } from '../src/matching/client.js';
import {
  alignedFace, cosineSimilarity, decodeYuNet, faceAcquisitionReason, faceQuality, imageTensor,
  scoreDecision, selectFace, SFACE_TARGET, similarityTransform,
} from '../src/matching/math.js';
import type { DetectedFace, FivePoints, NumericTensor, Pixels } from '../src/matching/math.js';
import { comparisonResult, validDecisionOptions } from '../src/matching/protocol.js';
import type { FaceMatchWorkerResponse } from '../src/matching/protocol.js';

function pixels(width = 112, height = 112, texture = true): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    data[index] = texture ? 45 + (x * 13 + y * 7) % 170 : 120;
    data[index + 1] = texture ? 55 + (x * 5 + y * 11) % 160 : 120;
    data[index + 2] = texture ? 65 + (x * 9 + y * 3) % 150 : 120;
    data[index + 3] = 255;
  }
  return { data, width, height };
}

function face(size = 100, x = 5, y = 5): DetectedFace {
  return { x, y, width: size, height: size, score: 0.95, landmarks: SFACE_TARGET };
}

function transformPoints(scale: number, angle: number, tx: number, ty: number): FivePoints {
  return SFACE_TARGET.map(([x, y]) => [scale * (Math.cos(angle) * x - Math.sin(angle) * y) + tx,
    scale * (Math.sin(angle) * x + Math.cos(angle) * y) + ty]) as unknown as FivePoints;
}

function emptyYuNet(): Record<string, NumericTensor> {
  const result: Record<string, NumericTensor> = {};
  for (const stride of [8, 16, 32]) for (const [name, channels] of [['cls', 1], ['obj', 1], ['bbox', 4], ['kps', 10]] as const) {
    const count = (32 / stride) ** 2;
    result[`${name}_${stride}`] = { data: new Float32Array(count * channels), dims: [1, count, channels] };
  }
  return result;
}

describe('Pinned OpenCV preprocessing conventions', () => {
  it('matches the actual OpenCV 4.12.0 aligned crop and input channels for a permitted portrait', () => {
    const reference = JSON.parse(readFileSync(new URL('./fixtures/astronaut-reference.json', import.meta.url), 'utf8')) as {
      width: number; height: number; face: number[]; embedding: number[]; identicalScore: number; rgbInputFirstPixel: number[];
    };
    const source = { width: reference.width, height: reference.height,
      data: new Uint8ClampedArray(readFileSync(new URL('./fixtures/astronaut.rgba', import.meta.url))) };
    const points = Array.from({ length: 5 }, (_, index) => [reference.face[index * 2 + 4]!, reference.face[index * 2 + 5]!]) as unknown as FivePoints;
    const crop = alignedFace(source, points)!;
    const golden = new Uint8ClampedArray(readFileSync(new URL('./fixtures/astronaut-aligned.rgba', import.meta.url)));
    let maxDifference = 0, squaredError = 0;
    for (let index = 0; index < golden.length; index++) {
      const difference = Math.abs(golden[index]! - crop.data[index]!);
      maxDifference = Math.max(maxDifference, difference); squaredError += difference * difference;
    }
    // OpenCV quantizes warp coordinates through its fixed-point affine table; isolated 1/32-pixel differences remain.
    expect(maxDifference).toBeLessThanOrEqual(6);
    expect(Math.sqrt(squaredError / golden.length)).toBeLessThanOrEqual(0.35);
    const input = imageTensor(crop, 'RGB')!;
    expect([input[0], input[112 * 112], input[112 * 112 * 2]]).toEqual(reference.rgbInputFirstPixel);
    expect(cosineSimilarity(reference.embedding, reference.embedding)).toBeCloseTo(Math.min(1, reference.identicalScore), 6);
    const selected = { x: reference.face[0]!, y: reference.face[1]!, width: reference.face[2]!, height: reference.face[3]!,
      landmarks: points, score: reference.face[14]! };
    expect(faceAcquisitionReason(selected, source, crop, 'selfie')).toBeUndefined();
  });

  it('keeps raw 0..255 values and NCHW layout with distinct detector BGR and recognizer RGB', () => {
    const source = { width: 2, height: 1, data: new Uint8ClampedArray([12, 34, 56, 255, 78, 90, 123, 255]) };
    expect(Array.from(imageTensor(source, 'BGR')!)).toEqual([56, 123, 34, 90, 12, 78]);
    expect(Array.from(imageTensor(source, 'RGB')!)).toEqual([12, 78, 34, 90, 56, 123]);
    expect(imageTensor({ ...source, data: new Uint8ClampedArray(4) }, 'RGB')).toBeNull();
  });

  it.each([[1, 0, 0, 0], [2.3, 0.2, 50, -19], [0.7, -0.4, -17, 73], [4, 1.1, 300, 100]])(
    'recovers inverse similarity at scale %s and angle %s', (scale, angle, tx, ty) => {
      const source = transformPoints(scale, angle, tx, ty), matrix = similarityTransform(source)!;
      expect(matrix[0]).toBeCloseTo(Math.cos(angle) / scale, 6);
      expect(matrix[1]).toBeCloseTo(Math.sin(angle) / scale, 6);
      expect(matrix[3]).toBeCloseTo(-Math.sin(angle) / scale, 6);
      expect(matrix[4]).toBeCloseTo(Math.cos(angle) / scale, 6);
      for (let index = 0; index < 5; index++) {
        const [x, y] = source[index]!;
        expect(matrix[0] * x + matrix[1] * y + matrix[2]).toBeCloseTo(SFACE_TARGET[index]![0], 4);
        expect(matrix[3] * x + matrix[4] * y + matrix[5]).toBeCloseTo(SFACE_TARGET[index]![1], 4);
      }
    },
  );

  it('rejects zero-spread and nonfinite landmarks without inventing an alignment', () => {
    expect(similarityTransform(Array.from({ length: 5 }, () => [5, 5]) as unknown as FivePoints)).toBeNull();
    expect(similarityTransform([[NaN, 2], ...SFACE_TARGET.slice(1)] as unknown as FivePoints)).toBeNull();
    expect(alignedFace(pixels(), Array.from({ length: 5 }, () => [5, 5]) as unknown as FivePoints)).toBeNull();
  });

  it('preserves each byte in an identity warp and uses black padding for an out-of-image translation', () => {
    const source = pixels(), identity = alignedFace(source, SFACE_TARGET)!;
    expect(identity.data).toEqual(source.data);
    const shifted = SFACE_TARGET.map(([x, y]) => [x + 5, y + 3]) as unknown as FivePoints;
    const translated = alignedFace(source, shifted)!;
    expect(Array.from(translated.data.slice(0, 4))).toEqual(Array.from(source.data.slice((3 * 112 + 5) * 4, (3 * 112 + 5) * 4 + 4)));
    expect(Array.from(translated.data.slice(-4))).toEqual([0, 0, 0, 255]);
  });

  it('interpolates a quarter-pixel translation using reference 8-bit rounding', () => {
    const source = pixels();
    const shifted = SFACE_TARGET.map(([x, y]) => [x + 0.25, y + 0.25]) as unknown as FivePoints;
    const translated = alignedFace(source, shifted)!;
    for (const [x, y] of [[10, 12], [60, 71], [89, 91]]) for (let channel = 0; channel < 3; channel++) {
      const sample = (dx: number, dy: number) => source.data[((y! + dy) * 112 + x! + dx) * 4 + channel]!;
      const expected = Math.round(sample(0, 0) * 0.5625 + sample(1, 0) * 0.1875 + sample(0, 1) * 0.1875 + sample(1, 1) * 0.0625);
      expect(translated.data[(y! * 112 + x!) * 4 + channel]).toBe(expected);
    }
  });

  it('decodes YuNet grid coordinates, exponential box sizes, landmark order and duplicate-box NMS', () => {
    const outputs = emptyYuNet();
    const idx = 5;
    (outputs.cls_8!.data as Float32Array)[idx] = 0.9;
    (outputs.obj_8!.data as Float32Array)[idx] = 0.9;
    (outputs.bbox_8!.data as Float32Array).set([1.5, 1.5, Math.log(4), Math.log(5)], idx * 4);
    (outputs.kps_8!.data as Float32Array).set([0, 0.5, 2, 0.5, 1, 1.5, 0.2, 2.5, 1.8, 2.5], idx * 10);
    const decoded = decodeYuNet(outputs, 32, 32)!;
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.x).toBeCloseTo(4, 5);
    expect(decoded[0]!.y).toBeCloseTo(0, 5);
    expect(decoded[0]!.width).toBeCloseTo(32, 5);
    expect(decoded[0]!.height).toBeCloseTo(40, 5);
    expect(decoded[0]!.landmarks[0]).toEqual([8, 12]);
    expect(decoded[0]!.landmarks[1]).toEqual([24, 12]);
    expect(decoded[0]!.landmarks[2]).toEqual([16, 20]);
    (outputs.cls_16!.data as Float32Array)[0] = 0.95;
    (outputs.obj_16!.data as Float32Array)[0] = 0.95;
    (outputs.bbox_16!.data as Float32Array).set([1.25, 1.25, Math.log(2), Math.log(2.5)]);
    (outputs.kps_16!.data as Float32Array).set([0.5, 0.75, 1.5, 0.75, 1, 1.25, 0.6, 1.75, 1.4, 1.75]);
    const suppressed = decodeYuNet(outputs, 32, 32)!;
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.score).toBeCloseTo(0.95, 6);
  });

  it('rejects incompatible output shapes and NaN model outputs', () => {
    const outputs = emptyYuNet();
    outputs.cls_8!.dims = [1, 16];
    expect(decodeYuNet(outputs, 32, 32)).toBeNull();
    const nonfinite = emptyYuNet();
    (nonfinite.obj_16!.data as Float32Array)[0] = NaN;
    expect(decodeYuNet(nonfinite, 32, 32)).toBeNull();
    expect(decodeYuNet(emptyYuNet(), 31, 32)).toBeNull();
  });
});

describe('Acquisition and decision safety', () => {
  it('requires exactly one selfie face and a dominant main document portrait', () => {
    expect(selectFace([], 'document').reason).toBe('no_document_face');
    expect(selectFace([], 'selfie').reason).toBe('no_selfie_face');
    expect(selectFace([face(100), face(40)], 'selfie').reason).toBe('multiple_selfie_faces');
    expect(selectFace([face(80), face(100)], 'document').reason).toBe('ambiguous_document_face');
    const primary = face(100);
    expect(selectFace([face(40), primary], 'document').face).toBe(primary);
  });

  it('does not borrow sharpness from crop edges when the central face is blurred', () => {
    const source = pixels(112, 112, false);
    for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) {
      if (x >= 13 && x < 99 && y >= 13 && y < 99) continue;
      const index = (y * 112 + x) * 4;
      source.data[index] = source.data[index + 1] = source.data[index + 2] = (x + y) % 2 ? 255 : 0;
    }
    // The numerical stencil reaches one neighbour past the region; make its boundary quiet too.
    for (let y = 12; y < 100; y++) for (let x = 12; x < 100; x++) {
      const index = (y * 112 + x) * 4;
      source.data[index] = source.data[index + 1] = source.data[index + 2] = 120;
    }
    expect(faceQuality(source)!.laplacianVariance).toBeCloseTo(0, 8);
    expect(faceAcquisitionReason(face(), source, source, 'document')).toBe('document_quality');
    expect(faceAcquisitionReason(face(), pixels(), pixels(), 'selfie')).toBeUndefined();
  });

  it('rejects small faces, non-neutral landmarks, clipped faces and dark images', () => {
    expect(faceAcquisitionReason(face(79), pixels(), pixels(), 'document')).toBe('document_face_too_small');
    const turned = { ...face(), landmarks: [SFACE_TARGET[0], SFACE_TARGET[1], [92, 70], SFACE_TARGET[3], SFACE_TARGET[4]] as FivePoints };
    expect(faceAcquisitionReason(turned, pixels(), pixels(), 'selfie')).toBe('selfie_pose');
    expect(faceAcquisitionReason(face(100, 30, 5), pixels(), pixels(), 'document')).toBe('document_pose');
    const dark = pixels();
    for (let index = 0; index < dark.data.length; index += 4) dark.data[index] = dark.data[index + 1] = dark.data[index + 2] = 9;
    expect(faceAcquisitionReason(face(), dark, dark, 'selfie')).toBe('selfie_quality');
  });

  it('normalizes 128-dimensional embeddings and rejects bad dimensions, zero norms and nonfinite entries', () => {
    const a = new Float64Array(128), b = new Float64Array(128);
    a[0] = 2; b[0] = 3; b[1] = Math.sqrt(27);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 12);
    expect(cosineSimilarity(a, a)).toBe(1);
    expect(cosineSimilarity(a, new Float32Array(128))).toBeNull();
    expect(cosineSimilarity(a, new Float32Array(127))).toBeNull();
    b[80] = Infinity;
    expect(cosineSimilarity(a, b)).toBeNull();
    expect(scoreDecision(null, 0.363, 0.03).status).toBe('inconclusive');
    expect(scoreDecision(NaN, 0.363, 0.03).reason).toBe('invalid_embedding');
  });

  it('freezes exact boundaries and does not lower thresholds on uncertain scores', () => {
    const threshold = 0.363, margin = 0.03;
    expect(scoreDecision(threshold - margin - 1e-8, threshold, margin).status).toBe('no_match');
    expect(scoreDecision(threshold - margin, threshold, margin).status).toBe('inconclusive');
    expect(scoreDecision(threshold, threshold, margin).status).toBe('inconclusive');
    expect(scoreDecision(threshold + margin - 1e-8, threshold, margin).status).toBe('inconclusive');
    expect(scoreDecision(threshold + margin, threshold, margin).status).toBe('match');
    expect(scoreDecision(threshold, threshold, 0).status).toBe('match');
    expect(validDecisionOptions(0.98, 0.03)).toBe(false);
    expect(validDecisionOptions(0.363, 0.26)).toBe(false);
    expect(scoreDecision(0.9, NaN, 0.03).reason).toBe('invalid_options');
  });
});

describe('Local asset resolution and worker lifecycle', () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: MessageEvent<FaceMatchWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor(readonly url: string) { FakeWorker.instances.push(this); }
  }
  const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  function browser() {
    FakeWorker.instances = [];
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
    vi.stubGlobal('document', { baseURI: 'https://example.test/app/' });
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('OffscreenCanvas', class {});
  }
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('supports nested same-origin assets and rejects external origins and non-http URL schemes', () => {
    const local = resolveMatchAssets({ baseUrl: './kyc' }, 'https://example.test/app/', 'https://example.test')!;
    expect(local.detectorUrl).toBe('https://example.test/app/kyc/matching/face_detection_yunet_2023mar.onnx');
    expect(local.wasmBaseUrl).toBe('https://example.test/app/kyc/matching/ort/');
    expect(resolveMatchAssets({ baseUrl: 'https://cdn.example.test/kyc' }, 'https://example.test/', 'https://example.test')).toBeNull();
    expect(resolveMatchAssets({ matchWorkerUrl: 'blob:https://example.test/test' }, 'https://example.test/', 'https://example.test')).toBeNull();
    expect(resolveMatchAssets({ faceRecognizerModelUrl: 'data:application/octet-stream;base64,AA' }, 'https://example.test/', 'https://example.test')).toBeNull();
  });

  it('returns bounded nondecisions for invalid images, unsupported browsers and invalid options', async () => {
    expect((await compareFaces({ document: new Blob(), selfie: image() })).reason).toBe('invalid_image');
    expect((await compareFaces({ document: image(), selfie: image() })).reason).toBe('unsupported_browser');
    expect((await compareFaces({ document: image(), selfie: image(), threshold: NaN })).reason).toBe('invalid_options');
    browser();
    expect((await compareFaces({ document: image(), selfie: image(), assets: { baseUrl: 'https://external.test' } })).reason).toBe('invalid_assets');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates on timeout and clears every event handler', async () => {
    browser(); vi.useFakeTimers();
    const pending = compareFaces({ document: image(), selfie: image(), timeoutMs: 1000 });
    const worker = FakeWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).reason).toBe('timeout');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it('throws only cancellation, terminates active work, and rejects already-aborted attempts before starting', async () => {
    browser();
    const controller = new AbortController();
    const pending = compareFaces({ document: image(), selfie: image(), signal: controller.signal });
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await check;
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    await expect(compareFaces({ document: image(), selfie: image(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('accepts one validated result, cleans up and never forwards unexpected derived data', async () => {
    browser();
    const pending = compareFaces({ document: image(), selfie: image() });
    const worker = FakeWorker.instances[0]!;
    const response = { ...scoreDecision(0.9, 0.363, 0.03), embedding: [123] };
    worker.onmessage!(new MessageEvent<FaceMatchWorkerResponse>('message', { data: { type: 'result', result: response } }));
    const result = await pending;
    expect(result.status).toBe('match');
    expect(result.score).toBe(0.9);
    expect(result).not.toHaveProperty('embedding');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it('rejects a forged successful result without score or with a contradictory score', async () => {
    browser();
    for (const response of [comparisonResult('match', 'compared'), { ...comparisonResult('match', 'compared'), score: -0.5 }]) {
      const pending = compareFaces({ document: image(), selfie: image() });
      const worker = FakeWorker.instances.at(-1)!;
      worker.onmessage!(new MessageEvent<FaceMatchWorkerResponse>('message', { data: { type: 'result', result: response } }));
      expect((await pending).reason).toBe('worker_error');
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });
});
