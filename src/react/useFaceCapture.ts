import { useCallback, useEffect, useRef, useState } from 'react';
import { ChallengeRunner } from '../core/challenges.js';
import { startVideoRecording, type VideoRecording } from '../camera/recording.js';
import { createSimulatedCamera } from '../camera/simulation.js';
import type { AssetOptions, CapturePayload, ChallengeFeedback, FaceChallenge, FaceObservation, FaceOptions } from '../types.js';

export type CameraStatus = 'idle' | 'requesting' | 'loading' | 'tracking' | 'capturing';

function snapshot(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) return Promise.reject(new Error('The camera did not provide a usable image. Please try again.'));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Could not prepare your selfie. Please try again.'));
  context.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture your selfie. Please try again.')), 'image/jpeg', 0.92));
}

export function useFaceCapture({
  options, assets, challenges, simulation, onCapture, onFailure,
}: {
  options: FaceOptions;
  assets: AssetOptions;
  challenges: readonly FaceChallenge[];
  simulation: boolean;
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
  const [status, setStatus] = useState<CameraStatus>('idle');
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
        simulation ? simulationRef.current!.snapshot() : snapshot(preview),
        recorderRef.current?.finish(),
      ]);
      if (!mounted.current || generation.current !== attempt) return;
      const payload: CapturePayload = { selfie, ...(video ? { video } : {}), challenges: completed.evidence.map(item => ({ ...item })), capturedAt: new Date().toISOString(), mode: simulation ? 'simulation' : 'camera' };
      stop(); callbacks.current.onCapture(payload);
    } catch (error) { fail(error, attempt); }
  }, [fail, simulation, stop]);

  const observe = useCallback((observation: FaceObservation, attempt: number) => {
    if (!mounted.current || generation.current !== attempt || captureStarted.current) return;
    const next = runnerRef.current!.update(observation);
    feedbackRef.current = next; setFeedback(next);
    if (next.completed) void finish(next, attempt);
  }, [finish]);

  const start = useCallback(async () => {
    stop();
    const { options, assets, challenges } = settings.current;
    const attempt = generation.current;
    const controller = new AbortController(); controllerRef.current = controller;
    captureStarted.current = false;
    runnerRef.current = new ChallengeRunner(challenges, options.holdDurationMs ?? 650);
    feedbackRef.current = null; setFeedback(null);
    timerRef.current = setTimeout(() => {
      const error = new Error('cameraTimeout'); error.name = 'CaptureTimeoutError'; fail(error, attempt);
    }, options.timeoutMs ?? 90_000);
    setStatus('requesting');
    try {
      if (!simulation && (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
        const error = new Error('cameraUnsupported'); error.name = 'UnsupportedCameraError'; throw error;
      }
      const simulator = simulation ? createSimulatedCamera() : null;
      simulationRef.current = simulator;
      const stream = simulator?.stream ?? await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, ...options.camera } });
      if (!mounted.current || generation.current !== attempt) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('The camera view is unavailable. Please try again.');
      video.srcObject = stream;
      await video.play();
      if (!mounted.current || generation.current !== attempt) return;
      if (options.recordVideo !== false) recorderRef.current = startVideoRecording(stream, error => fail(error, attempt));
      if (simulator) {
        const neutral: Omit<FaceObservation, 'timestamp'> = { faceCount: 1, centerX: .5, centerY: .5, relativeSize: .4, yaw: 0, pitch: 0 };
        const poses: Partial<Record<FaceChallenge, Partial<FaceObservation>>> = {
          'turn-left': { yaw: 32 }, 'turn-right': { yaw: -32 }, 'look-up': { pitch: -25 }, 'look-down': { pitch: 25 }, closer: { relativeSize: .65 }, further: { relativeSize: .22 },
        };
        setStatus('tracking');
        simulationTimer.current = setInterval(() => {
          const pose = { ...neutral, ...(poses[feedbackRef.current?.guideDirection ?? 'center'] ?? {}) };
          simulator.render(pose);
          observe({ ...pose, timestamp: performance.now() }, attempt);
        }, 100);
        return;
      }
      setStatus('loading');
      const { createFaceTracker } = await import('../camera/tracker.js');
      if (!mounted.current || generation.current !== attempt) return;
      const tracker = await createFaceTracker({ video, assets, previewFit: 'cover', signal: controller.signal, trackingFps: options.trackingFps ?? 12, onObservation: value => observe(value, attempt), onError: error => fail(error, attempt) });
      if (!mounted.current || generation.current !== attempt) { tracker.stop(); return; }
      trackerRef.current = tracker; setStatus('tracking');
    } catch (error) { fail(error, attempt); }
  }, [fail, observe, simulation, stop]);

  useEffect(() => {
    if (options.autoStart !== false) void start();
    // Configuration changes remount the flow; mutable callbacks never restart a recording.
  }, [options.autoStart, start]);

  return { videoRef, status, feedback, start, stop };
}
