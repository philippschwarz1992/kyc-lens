import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawScaled, encodeCanvas, scaledSize, validateOutputOptions } from '../src/camera/output.js';

afterEach(() => { vi.unstubAllGlobals(); });

function fakeCanvas(supported: string[]) {
  const calls: Array<[string, number]> = [];
  const canvas = {
    width: 0, height: 0, calls,
    getContext: () => ({ drawImage: vi.fn() }),
    // Like Safari, unsupported types silently produce PNG.
    toBlob(callback: (blob: Blob | null) => void, type: string, quality: number) { calls.push([type, quality]); callback(new Blob(['x'], { type: supported.includes(type) ? type : 'image/png' })); },
  };
  return canvas as unknown as HTMLCanvasElement & { calls: typeof calls };
}

describe('photo output options', () => {
  it('validates type, quality and maximum dimension with clear errors', () => {
    expect(() => validateOutputOptions(undefined)).not.toThrow();
    expect(() => validateOutputOptions({ imageType: 'image/webp', quality: 0.5, maxDimension: 480 })).not.toThrow();
    expect(() => validateOutputOptions({ imageType: 'image/jpeg', quality: 1, maxDimension: 4096 })).not.toThrow();
    expect(() => validateOutputOptions([])).toThrow('output must be an options object.');
    expect(() => validateOutputOptions({ imageType: 'image/png' })).toThrow('output.imageType must be image/jpeg or image/webp.');
    expect(() => validateOutputOptions({ quality: 0.49 })).toThrow('output.quality must be between 0.5 and 1.');
    expect(() => validateOutputOptions({ quality: Number.NaN })).toThrow(/quality/);
    expect(() => validateOutputOptions({ maxDimension: 479 })).toThrow('output.maxDimension must be an integer between 480 and 4096.');
    expect(() => validateOutputOptions({ maxDimension: 4097 })).toThrow(/maxDimension/);
    expect(() => validateOutputOptions({ maxDimension: 1000.5 })).toThrow(/maxDimension/);
  });

  it('limits the longest side without upscaling', () => {
    expect(scaledSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(scaledSize(1920, 1080, 960)).toEqual({ width: 960, height: 540 });
    expect(scaledSize(720, 1280, 640)).toEqual({ width: 360, height: 640 });
    expect(scaledSize(640, 480, 1024)).toEqual({ width: 640, height: 480 });
  });

  it('draws the full frame onto a scaled canvas', () => {
    const canvas = fakeCanvas([]);
    const drawImage = vi.fn();
    canvas.getContext = (() => ({ drawImage })) as never;
    vi.stubGlobal('document', { createElement: () => canvas });
    const source = {} as CanvasImageSource;
    expect(drawScaled(source, 4000, 3000, { maxDimension: 2000 })).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([2000, 1500]);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 2000, 1500);
  });

  it('encodes JPEG by default and honours the requested quality', async () => {
    const canvas = fakeCanvas(['image/jpeg']);
    expect((await encodeCanvas(canvas, undefined))!.type).toBe('image/jpeg');
    expect((await encodeCanvas(canvas, { quality: 0.7 }, 0.95))!.type).toBe('image/jpeg');
    expect((await encodeCanvas(canvas, {}, 0.95))!.type).toBe('image/jpeg');
    expect(canvas.calls).toEqual([['image/jpeg', 0.92], ['image/jpeg', 0.7], ['image/jpeg', 0.95]]);
  });

  it('uses WebP where supported and falls back to JPEG where the browser cannot encode it', async () => {
    const supported = fakeCanvas(['image/jpeg', 'image/webp']);
    expect((await encodeCanvas(supported, { imageType: 'image/webp', quality: 0.8 }))!.type).toBe('image/webp');
    expect(supported.calls).toEqual([['image/webp', 0.8]]);
    const safari = fakeCanvas(['image/jpeg']);
    expect((await encodeCanvas(safari, { imageType: 'image/webp', quality: 0.8 }))!.type).toBe('image/jpeg');
    expect(safari.calls).toEqual([['image/webp', 0.8], ['image/jpeg', 0.8]]);
  });
});
