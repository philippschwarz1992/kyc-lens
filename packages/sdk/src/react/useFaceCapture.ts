import { useCallback, useEffect, useRef, useState } from 'react';
import { playPreview } from '../camera/playback.js';
import { ChallengeRunner } from '../core/challenges.js';
import { startVideoRecording, type VideoRecording } from '../camera/recording.js';
import { createSimulatedCamera } from '../camera/simulation.js';
import { drawScaled, encodeCanvas } from '../camera/output.js';
import type { FaceTracker } from '../camera/tracker.js';
import type { AssetOptions, CapturePayload, ChallengeFeedback, FaceChallenge, FaceObservation, FaceOptions, OutputOptions } from '../types.js';

export type CameraStatus = 'idle' | 'requesting' | 'loading' | 'tracking' | 'capturing';

async function snapshot(video: HTMLVideoElement, output?: OutputOptions): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The camera did not provide a usable image. Please try again.');
  const canvas = drawScaled(video, video.videoWidth, video.videoHeight, output);
  if (!canvas) throw new Error('Could not prepare your selfie. Please try again.');
  const blob = await encodeCanvas(canvas, output);
  if (!blob) throw new Error('Could not capture your selfie. Please try again.');
  return blob;
}

export function useFaceCapture({
  options, assets, challenges, simulation, output, onCapture, onFailure,
}: {
  options: FaceOptions;
  assets: AssetOptions;
  challenges: readonly FaceChallenge[];
  simulation: boolean;
  output?: OutputOptions;
  onCapture: (payload: CapturePayload) => void;
  onFailure: (error: Error) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<{ stop(): void } | null>(null);
  const recorderRef = useRef<VideoRecording | null>(null);
  const simulationRef = useRef<ReturnType<typeof createSimulatedCamera> | null>(null);
  const simulationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runnerRef = useRef<ChallengeRunner | null>(null);
  const feedbackRef = useRef<ChallengeFeedback | null>(null);
  const generation = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const captureStarted = useRef(false);
  const settings = useRef({ options, assets, challenges });
  settings.current = { options, assets, challenges };
  const callbacks = useRef({ onCapture, onFailure });
  callbacks.current = { onCapture, onFailure };
  const outputRef = useRef(output);
  outputRef.current = output;
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [needsTap, setNeedsTap] = useState(false);
  const [feedback, setFeedback] = useState<ChallengeFeedback | null>(null);

  const stop = useCallback(() => {
    generation.current += 1;
    controllerRef.current?.abort(); controllerRef.current = null;
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (simulationTimer.current !== null) { clearInterval(simulationTimer.current); simulationTimer.current = null; }
    trackerRef.current?.stop(); trackerRef.current = null;
    recorderRef.current?.discard(); recorderRef.current = null;
    simulationRef.current?.stop(); simulationRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  const fail = useCallback((error: unknown, attempt: number) => {
    if (!mounted.current || generation.current !== attempt) return;
    const actual = error instanceof Error ? error : new Error(String(error));
    stop(); callbacks.current.onFailure(actual);
  }, [stop]);

  const finish = useCallback(async (completed: ChallengeFeedback, attempt: number) => {
    if (captureStarted.current || !mounted.current || generation.current !== attempt) return;
    captureStarted.current = true; setStatus('capturing');
    try {
      trackerRef.current?.stop(); trackerRef.current = null;
      if (simulationTimer.current !== null) { clearInterval(simulationTimer.current); simulationTimer.current = null; }
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
      const preview = videoRef.current;
      if (!preview) throw new Error('The camera view is unavailable. Please try again.');
      // Begin the final JPEG and flush the recording before releasing camera tracks.
      const [selfie, video] = await Promise.all([
        simulation ? simulationRef.current!.snapshot() : snapshot(preview, outputRef.current),
        recorderRef.current?.finish(),
      ]);
      if (!mounted.current || generation.current !== attempt) return;
      const payload: CapturePayload = { selfie, ...(video ? { video } : {}), challenges: completed.evidence.map(item => ({ ...item })), capturedAt: new Date().toISOString(), mode: simulation ? 'simulation' : 'camera' };
      stop(); callbacks.current.onCapture(payload);
    } catch (error) { fail(error, attempt); }
  }, [fail, simulation, stop]);

  const observe = useCallback((observation: FaceObservation, attempt: number) => {
    if (!mounted.current || generation.current !== attempt || captureStarted.current) return;
    const completedSteps = feedbackRef.current?.evidence.length ?? 0;
    const next = runnerRef.current!.update(observation);
    feedbackRef.current = next; setFeedback(next);
    if (next.evidence.length > completedSteps && !simulation && settings.current.options.haptics !== false && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(30);
    if (next.completed) void finish(next, attempt);
  }, [finish, simulation]);

  const start = useCallback(async () => {
    stop();
    const { options, assets, challenges } = settings.current;
    const attempt = generation.current;
    const controller = new AbortController(); controllerRef.current = controller;
    captureStarted.current = false;
    runnerRef.current = new ChallengeRunner(challenges, options.holdDurationMs ?? 650);
    feedbackRef.current = null; setFeedback(null); setNeedsTap(false);
    const live = () => mounted.current && generation.current === attempt;
    // The movement timeout starts with tracking. Permission prompts are user-paced; startup is bounded by
    // the recorder's first-chunk timeout and the tracker's worker/model startup timeout instead.
    const beginTracking = () => {
      setStatus('tracking');
      timerRef.current = setTimeout(() => {
        const error = new Error('cameraTimeout'); error.name = 'CaptureTimeoutError'; fail(error, attempt);
      }, options.timeoutMs ?? 90_000);
    };
    setStatus('requesting');
    try {
      if (!simulation && (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
        const error = new Error('cameraUnsupported'); error.name = 'UnsupportedCameraError'; throw error;
      }
      // Load the tracking worker and model while the camera permission and recorder start. Sampling waits for both.
      let pendingTracker: Promise<FaceTracker> | null = null;
      if (!simulation) {
        pendingTracker = import('../camera/tracker.js').then(({ createFaceTracker }) => {
          if (controller.signal.aborted) throw new DOMException('Face tracking was cancelled.', 'AbortError');
          return createFaceTracker({ assets, previewFit: 'cover', signal: controller.signal, trackingFps: options.trackingFps ?? 12, onObservation: value => observe(value, attempt), onError: error => fail(error, attempt) });
        });
        pendingTracker.then(tracker => { if (!live()) tracker.stop(); }, error => fail(error, attempt));
      }
      const simulator = simulation ? createSimulatedCamera() : null;
      simulationRef.current = simulator;
      const stream = simulator?.stream ?? await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, ...options.camera } });
      if (!mounted.current || generation.current !== attempt) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('The camera view is unavailable. Please try again.');
      video.srcObject = stream;
      await playPreview(video, controller.signal, blocked => { if (mounted.current && generation.current === attempt) setNeedsTap(blocked); });
      if (!mounted.current || generation.current !== attempt) return;
      if (options.recordVideo !== false) recorderRef.current = startVideoRecording(stream, error => fail(error, attempt));
      if (simulator) {
        const neutral: Omit<FaceObservation, 'timestamp'> = { faceCount: 1, centerX: .5, centerY: .5, relativeSize: .4, yaw: 0, pitch: 0 };
        const poses: Partial<Record<FaceChallenge, Partial<FaceObservation>>> = {
          'turn-left': { yaw: 32 }, 'turn-right': { yaw: -32 }, 'look-up': { pitch: -25 }, 'look-down': { pitch: 25 }, closer: { relativeSize: .65 }, further: { relativeSize: .22 },
        };
        let canObserve = false;
        setStatus('loading');
        simulationTimer.current = setInterval(() => {
          const pose = { ...neutral, ...(poses[feedbackRef.current?.guideDirection ?? 'center'] ?? {}) };
          simulator.render(pose);
          if (canObserve) observe({ ...pose, timestamp: performance.now() }, attempt);
        }, 100);
        await recorderRef.current?.ready;
        if (!mounted.current || generation.current !== attempt) return;
        canObserve = true; beginTracking();
        return;
      }
      setStatus('loading');
      // Pose observations start only after the recording has emitted its first chunk.
      const [tracker] = await Promise.all([pendingTracker!, recorderRef.current?.ready]);
      if (!mounted.current || generation.current !== attempt) { tracker.stop(); return; }
      trackerRef.current = tracker; tracker.start(video); beginTracking();
    } catch (error) { fail(error, attempt); }
  }, [fail, observe, simulation, stop]);

  useEffect(() => {
    let cancelled = false;
    // StrictMode replays effects before this microtask. Open only the surviving
    // camera attempt, so stopping a stale stream cannot interrupt a new device open.
    if (options.autoStart !== false) queueMicrotask(() => {
      if (!cancelled && mounted.current) void start();
    });
    return () => { cancelled = true; };
    // Configuration changes remount the flow; mutable callbacks never restart a recording.
  }, [options.autoStart, start]);

  return { videoRef, status, feedback, start, stop, needsTap };
}
