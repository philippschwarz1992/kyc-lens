import type { FaceObservation } from '../types.js';

export type WorkerRequest =
  | { type: 'init'; modelUrl: string; wasmBaseUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'stop' };
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'observation'; observation: FaceObservation }
  | { type: 'error'; message: string };
