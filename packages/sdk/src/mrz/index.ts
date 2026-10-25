import { mrzModel } from './model.js';
import { readMrz, type MrzModel, type MrzRead, type Point } from './read.js';

export type { MrzFormat, MrzKind, MrzSummary } from './parse.js';
export { checkDigit, summarizeMrz } from './parse.js';

let model: MrzModel | undefined;

/**
 * Reads the machine-readable zone inside a document outline. Runs locally with the bundled OCR-B
 * classifier; the decoded text stays in memory and only the summary is meant to leave the device.
 */
export function readDocumentZone(rgba: ArrayLike<number>, width: number, height: number, corners: readonly Point[]): MrzRead | null {
  model ??= mrzModel();
  return readMrz(model, rgba, width, height, corners);
}
