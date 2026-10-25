import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FaceObservation } from '../types.js';

/** Converts MediaPipe geometry to uncalibrated guidance values, never biometric decisions. */
export function observationFor(result: FaceLandmarkerResult, timestamp: number): FaceObservation {
  const face = result.faceLandmarks[0];
  if (!face || result.faceLandmarks.length !== 1) {
    return { timestamp, faceCount: result.faceLandmarks.length, centerX: 0.5, centerY: 0.5, relativeSize: 0, yaw: 0, pitch: 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const landmark of face) {
    minX = Math.min(minX, landmark.x); maxX = Math.max(maxX, landmark.x);
    minY = Math.min(minY, landmark.y); maxY = Math.max(maxY, landmark.y);
  }
  const matrix = result.facialTransformationMatrixes[0]?.data;
  // addFacialTransformationMatrixes forwards packed_data unchanged; MatrixData
  // stores COLUMN_MAJOR by default. The third column is the face-forward axis
  // in metric coordinates (+Y up). A leftward anatomical turn points image-right;
  // downward pitch points metric-Y down. Preview mirroring never changes this data.
  const yaw = matrix && matrix.length >= 16 ? Math.atan2(matrix[8]!, matrix[10]!) * 180 / Math.PI : NaN;
  const pitch = matrix && matrix.length >= 16 ? Math.atan2(-matrix[9]!, Math.hypot(matrix[8]!, matrix[10]!)) * 180 / Math.PI : NaN;
  return { timestamp, faceCount: 1, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, relativeSize: maxY - minY, yaw, pitch };
}
