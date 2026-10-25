import type { OutputOptions } from '../types.js';

export const DEFAULT_OUTPUT_QUALITY = 0.92;
const IMAGE_TYPES = ['image/jpeg', 'image/webp'];

/** Validate photo encoding options before the camera opens. */
export function validateOutputOptions(output: unknown): void {
  if (output === undefined) return;
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('output must be an options object.');
  const { imageType, quality, maxDimension } = output as OutputOptions;
  if (imageType !== undefined && !IMAGE_TYPES.includes(imageType)) throw new Error('output.imageType must be image/jpeg or image/webp.');
  if (quality !== undefined && (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0.5 || quality > 1)) throw new Error('output.quality must be between 0.5 and 1.');
  if (maxDimension !== undefined && (typeof maxDimension !== 'number' || !Number.isInteger(maxDimension) || maxDimension < 480 || maxDimension > 4096)) throw new Error('output.maxDimension must be an integer between 480 and 4096.');
}

/** Scale a source size so its longest side fits maxDimension; never upscales. */
export function scaledSize(width: number, height: number, maxDimension?: number): { width: number; height: number } {
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Draw a camera frame onto a canvas sized by maxDimension. */
export function drawScaled(source: CanvasImageSource, width: number, height: number, output: OutputOptions | undefined): HTMLCanvasElement | null {
  const size = scaledSize(width, height, output?.maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(resolve, type, quality); } catch (error) { reject(error); }
  });
}

/** Encode with the requested type; browsers that silently ignore WebP (Safari returns PNG) are re-encoded as JPEG. */
export async function encodeCanvas(canvas: HTMLCanvasElement, output: OutputOptions | undefined, defaultQuality = DEFAULT_OUTPUT_QUALITY): Promise<Blob | null> {
  const type = output?.imageType ?? 'image/jpeg';
  const quality = output?.quality ?? defaultQuality;
  const blob = await toBlob(canvas, type, quality);
  if (!blob || blob.type === type || type === 'image/jpeg') return blob;
  return toBlob(canvas, 'image/jpeg', quality);
}
