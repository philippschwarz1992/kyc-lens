import { KycHttpError } from '../api.js';
import type { CaptureResult, KycErrorStage, KycEvent, KycPhase } from '../types.js';
import { english } from './strings.js';

const PHASES: readonly string[] = ['intro', 'document', 'face', 'review', 'submitting', 'complete', 'error', 'cancelled'];
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** A stable, message-free error code: a known string key, HTTP status or error name. */
export function errorCode(error: Error): string {
  if (IDENTIFIER.test(error.message) && Object.hasOwn(english, error.message)) return error.message;
  if (error instanceof KycHttpError) return `http_${error.status}`;
  if (error.name && error.name !== 'Error' && IDENTIFIER.test(error.name)) return error.name;
  return 'unknown';
}

/** Builds privacy-safe analytics events. Callback exceptions are swallowed so analytics never break capture. */
export function createEventReporter(emit: () => ((event: KycEvent) => void) | undefined, now: () => number = () => performance.now()) {
  const startedAt = now();
  let lastStep: string | undefined;
  const send = (event: KycEvent) => { try { emit()?.(event); } catch { /* Analytics must not affect the flow. */ } };
  return {
    step(phase: string) {
      if (phase === lastStep || !PHASES.includes(phase)) return;
      lastStep = phase; send({ type: 'step', step: phase as KycPhase, elapsedMs: Math.round(now() - startedAt) });
    },
    retry(from: KycErrorStage) { send({ type: 'retry', from }); },
    retake() { send({ type: 'retake' }); },
    error(stage: KycErrorStage, error: Error) { send({ type: 'error', stage, code: errorCode(error) }); },
    complete(result: CaptureResult) { send({ type: 'complete', durationMs: Math.round(now() - startedAt), ...(result.faceMatch ? { faceMatchStatus: result.faceMatch.status } : {}) }); },
    cancel(step: string) { send({ type: 'cancel', step: (PHASES.includes(step) ? step : 'intro') as KycPhase }); },
  };
}
