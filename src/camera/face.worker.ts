import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import { observationFor } from './geometry.js';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
}
const scope = globalThis as unknown as WorkerScope;
let landmarker: FaceLandmarker | undefined;
let stopped = false;
let initializing = false;

scope.onmessage = (event): void => {
  const request = event.data;
  if (request.type === 'stop') {
    stopped = true;
    landmarker?.close();
    landmarker = undefined;
    scope.close();
    return;
  }
  if (request.type === 'init') {
    if (initializing || landmarker) return;
    initializing = true;
    void (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(request.wasmBaseUrl, true);
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: request.modelUrl, delegate: 'CPU' },
          runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true, minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
        });
        if (stopped) { landmarker.close(); landmarker = undefined; return; }
        scope.postMessage({ type: 'ready' });
      } catch (error) {
        scope.postMessage({ type: 'error', message: `Unable to initialize local face tracking: ${error instanceof Error ? error.message : String(error)}` });
      } finally { initializing = false; }
    })();
    return;
  }
  try {
    if (stopped || !landmarker) return;
    const result = landmarker.detectForVideo(request.bitmap, request.timestamp);
    scope.postMessage({ type: 'observation', observation: observationFor(result, request.timestamp) });
  } catch (error) {
    scope.postMessage({ type: 'error', message: `Face tracking failed: ${error instanceof Error ? error.message : String(error)}` });
  } finally { request.bitmap.close(); }
};
