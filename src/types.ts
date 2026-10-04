import type { ComponentType } from 'react';

export type KycStep = 'intro' | 'document' | 'face' | 'review' | 'result';
export type DocumentType = 'id-card' | 'drivers-license' | 'passport';
export interface DocumentOptions {
  /** Available document types. Defaults to ID card, driving licence, and passport. */
  types?: readonly DocumentType[];
  camera?: MediaTrackConstraints;
  /** Local framing/clarity guidance. Defaults to true; photographs remain manual. */
  detection?: boolean;
}
export interface DocumentCapture {
  type: DocumentType;
  front: Blob;
  /** ID cards and driving licences include both sides. Passports use the photo page. */
  back?: Blob;
}
export type FaceChallenge = 'center' | 'turn-left' | 'turn-right' | 'look-up' | 'look-down' | 'closer' | 'further';
export interface FaceObservation {
  timestamp: number;
  faceCount: number;
  centerX: number;
  centerY: number;
  relativeSize: number;
  /** Approximate head angle in degrees; positive means anatomical left. */
  yaw: number;
  /** Approximate head angle in degrees; positive means looking down. */
  pitch: number;
}
export interface ChallengeEvidence {
  challenge: FaceChallenge;
  completedAt: number;
  durationMs: number;
}
export interface ChallengeFeedback {
  challenge: FaceChallenge | null;
  /** Visual movement target; neutral holds use center, including between challenges. */
  guideDirection?: FaceChallenge;
  index: number;
  progress: number;
  hint: string;
  matched: boolean;
  completed: boolean;
  evidence: ChallengeEvidence[];
}
export interface FaceOptions {
  challenges?: readonly FaceChallenge[];
  /** Starts the camera when the face screen opens. Default: true. */
  autoStart?: boolean;
  /** Records a silent video alongside the final selfie. Default: true. */
  recordVideo?: boolean;
  holdDurationMs?: number;
  /** Time allowed to complete all challenges. Default: 90000 ms. */
  timeoutMs?: number;
  /** Target inference rate, 3–30 fps; defaults to 12. */
  trackingFps?: number;
  camera?: MediaTrackConstraints;
}
export interface AssetOptions {
  /** Default: /kyc-assets; host these files on your own application. */
  baseUrl?: string;
  modelUrl?: string;
  wasmBaseUrl?: string;
  workerUrl?: string;
  /** Document guidance worker. Defaults to baseUrl/document-worker.js. */
  documentWorkerUrl?: string;
}
export interface KycTheme {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: string;
  fontFamily?: string;
}
export interface KycSession { id: string; token?: string; }
export interface CapturePayload {
  selfie: Blob;
  /** Silent WebM or MP4 recording of the guided movements, when enabled. */
  video?: Blob;
  document?: DocumentCapture;
  challenges: ChallengeEvidence[];
  capturedAt: string;
  mode: 'camera' | 'simulation';
}
export interface CaptureResult {
  sessionId?: string;
  status: 'capture_complete';
  payload: CapturePayload;
  serverResult?: unknown;
}
export interface KycApi {
  createSession: (signal: AbortSignal) => Promise<KycSession>;
  submitCapture: (session: KycSession, payload: CapturePayload, signal: AbortSignal) => Promise<unknown>;
}
export interface KycScreenContext {
  next: () => void;
  cancel: () => void;
  retry: () => void;
  result?: CaptureResult;
  selfieUrl?: string;
  /** Local object URL for reviewing the recorded video. Revoked on retake/unmount. */
  videoUrl?: string;
}
export interface KycFlowProps {
  steps?: readonly KycStep[];
  document?: DocumentOptions;
  face?: FaceOptions;
  assets?: AssetOptions;
  theme?: KycTheme;
  /** Built-in English and German; other locales use custom strings. */
  locale?: 'en' | 'de';
  strings?: Partial<Record<string, string>>;
  components?: Partial<Record<'Intro' | 'Review' | 'Result', ComponentType<KycScreenContext>>>;
  apiBaseUrl?: string;
  api?: KycApi;
  /** Headers for the built-in HTTP adapter (e.g. your host app's session auth). */
  headers?: HeadersInit;
  onComplete?: (result: CaptureResult) => void;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  /** Explicit camera-free demo driver; never use this to evaluate identity. */
  simulation?: boolean;
  className?: string;
}
