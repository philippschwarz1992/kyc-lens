import type { ComponentType } from 'react';
import type { FaceMatchResult } from './matching/protocol.js';
import type { MrzSummary } from './mrz/parse.js';
import type { KycThemeDefinition } from './themes.js';
export type { FaceMatchResult } from './matching/protocol.js';

export type KycStep = 'intro' | 'document' | 'face' | 'review' | 'result';
export type DocumentType = 'id-card' | 'drivers-license' | 'passport';
export interface DocumentOptions {
  /** Available document types. Defaults to ID card, driving licence, and passport. */
  types?: readonly DocumentType[];
  camera?: MediaTrackConstraints;
  /** Local framing/clarity guidance. Defaults to true. */
  detection?: boolean;
  /** Automatically capture a clear document. Default: true. A manual shutter appears only when live analysis is unavailable. */
  autoCapture?: boolean;
  /**
   * Read the machine-readable zone (the lines of code on passports and identity cards) on the device and
   * check its check digits. A passport photo page, or an identity card side, must then carry a valid zone of
   * the chosen document type; after three unreadable photos the photo is accepted without one. Default: true.
   */
  mrz?: boolean;
  /** Show each automatically captured photo for confirmation before continuing. Default: false: a photo that passed the quality check moves straight on. */
  confirmPhotos?: boolean;
  /** Required stable document hold in milliseconds. Default: 0 (capture on the first clear frame); range: 0–10000. */
  holdDurationMs?: number;
  /** Show a Switch camera control when more than one camera is available. Default: true. */
  cameraSwitch?: boolean;
  /** Show a flashlight toggle when the active camera supports torch. Default: true. */
  torch?: boolean;
  /** `document` (default) crops the photo to the on-screen guide plus a small margin; `full` keeps the whole camera frame. */
  crop?: 'document' | 'full';
}
export interface DocumentCapture {
  type: DocumentType;
  front: Blob;
  /** ID cards and driving licences include both sides. Passports use the photo page. */
  back?: Blob;
  /**
   * The valid machine-readable zone read on the device, when one matched the document type: its format,
   * the document kind it declares and that its check digits passed. It contains no personal data. A client-side
   * read is a capture aid; verify the document on your server.
   */
  mrz?: MrzSummary;
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
  /** Short vibration after each completed movement where supported; never in simulation. Default: true. */ haptics?: boolean;
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
  /** All matching URLs must use the application's own origin. */
  matchWorkerUrl?: string;
  matchWasmBaseUrl?: string;
  faceDetectorModelUrl?: string;
  faceRecognizerModelUrl?: string;
}
export interface FaceMatchOptions {
  /** Cosine similarity boundary; default 0.363 is an example, not a calibrated KYC threshold. */
  threshold?: number;
  /** Scores within this distance of the threshold are inconclusive. Default: 0.03. */
  inconclusiveMargin?: number;
  /** Whole local comparison timeout, including model loading. Default: 45000 milliseconds. */
  timeoutMs?: number;
  /**
   * When true (default), a `no_match` or `inconclusive` comparison shows a "try again" screen that restarts
   * the flow; the capture is neither uploaded nor completed. False completes with the comparison result instead.
   */
  requireMatch?: boolean;
}
/** Quick overrides on top of the classic theme. For full control pass a theme id or a `defineTheme()` result. */
export interface KycTheme {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: string;
  fontFamily?: string;
}
export interface KycSession { id: string; token?: string; }
/** Encoding for the selfie and document photos. Browsers without WebP encoding fall back to JPEG. */
export interface OutputOptions {
  /** Default: image/jpeg. */
  imageType?: 'image/jpeg' | 'image/webp';
  /** Encoder quality, 0.5–1. Default: 0.92 for selfies and 0.95 for document photos. */
  quality?: number;
  /** Longest side in pixels, 480–4096. Default: the camera's native resolution. */
  maxDimension?: number;
}
export interface RetryOptions {
  /** Additional attempts after network errors and 408, 429 or 5xx responses, 0–5. Default: 2. */
  attempts?: number;
  /** First backoff delay in milliseconds, 0–30000; doubles per attempt with jitter. Default: 500. */
  baseDelayMs?: number;
}
export interface HttpApiOptions {
  retry?: RetryOptions;
  /** Capture upload progress in bytes. Uses XMLHttpRequest when set. */
  onProgress?: (loaded: number, total: number) => void;
}
export type UploadOptions = HttpApiOptions;
export type KycPhase = 'intro' | 'document' | 'face' | 'review' | 'submitting' | 'rejected' | 'complete' | 'error' | 'cancelled';
export type KycErrorStage = 'camera' | 'document' | 'submission';
/** Privacy-safe analytics events. They never include media, URLs, tokens, scores or embeddings. */
export type KycEvent =
  | { type: 'step'; step: KycPhase; elapsedMs: number }
  | { type: 'retry'; from: KycErrorStage }
  | { type: 'retake' }
  | { type: 'error'; stage: KycErrorStage; code: string }
  | { type: 'rejected'; faceMatchStatus: 'no_match' | 'inconclusive' }
  | { type: 'restart' }
  | { type: 'complete'; durationMs: number; faceMatchStatus?: FaceMatchResult['status'] }
  | { type: 'cancel'; step: KycPhase };
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
  /** Local face comparison only; does not establish authenticity, liveness or identity approval. */
  faceMatch?: FaceMatchResult;
}
export interface KycApi {
  createSession: (signal: AbortSignal) => Promise<KycSession>;
  submitCapture: (session: KycSession, payload: CapturePayload, signal: AbortSignal) => Promise<unknown>;
}
/** Offer a QR code on the intro screen so the capture can continue on a phone. */
export interface HandoffOptions {
  /** Absolute http(s) URL the phone opens; the host binds it to its own session. */
  url: string;
  /** `desktop` (default) shows the code only on devices without a touch screen. */
  show?: 'desktop' | 'always';
}
export interface KycScreenContext {
  next: () => void;
  cancel: () => void;
  retry: () => void;
  result?: CaptureResult;
  selfieUrl?: string;
  /** Local object URL for reviewing the recorded video. Revoked on retake/unmount. */
  videoUrl?: string;
  /** Set when the intro screen should offer the phone handoff QR code. */
  handoffUrl?: string;
}
export interface KycFlowProps {
  steps?: readonly KycStep[];
  document?: DocumentOptions;
  face?: FaceOptions;
  /** Local document/selfie comparison. Enabled when document capture is present; false disables it. */
  faceMatch?: FaceMatchOptions | false;
  assets?: AssetOptions;
  /** A registered theme id (`classic`, `aurora`, `ledger`, `pebble`, `halo` or your own), a `defineTheme()` result, or quick overrides. */
  theme?: string | KycTheme | KycThemeDefinition;
  /** Built-in English, German, French, Spanish, Italian, Polish, and Turkish; also sets the `lang` attribute. */
  locale?: 'en' | 'de' | 'fr' | 'es' | 'it' | 'pl' | 'tr';
  /** Overrides individual built-in strings; keys are typed. */
  strings?: Partial<import('./react/strings.js').KycStrings>;
  components?: Partial<Record<'Intro' | 'Review' | 'Result', ComponentType<KycScreenContext>>>;
  apiBaseUrl?: string;
  api?: KycApi;
  /** Headers for the built-in HTTP adapter (e.g. your host app's session auth). */
  headers?: HeadersInit;
  /** Retry and progress options for the built-in HTTP adapter. */
  upload?: UploadOptions;
  /** Image encoding for selfie and document photos. */
  output?: OutputOptions;
  onComplete?: (result: CaptureResult) => void;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  /** Privacy-safe analytics events. Exceptions thrown by this callback are ignored. */
  onEvent?: (event: KycEvent) => void;
  /** QR code on the intro screen to continue on a phone. Requires the intro step. */
  handoff?: HandoffOptions;
  /** Explicit camera-free demo driver; never use this to evaluate identity. */
  simulation?: boolean;
  className?: string;
}
