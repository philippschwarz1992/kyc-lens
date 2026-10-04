import type { ChallengeEvidence, ChallengeFeedback, FaceChallenge, FaceObservation, FaceOptions } from '../types.js';

export const DEFAULT_CHALLENGES: readonly FaceChallenge[] = Object.freeze(['center', 'turn-left', 'turn-right', 'closer', 'further']);
export const MAX_OBSERVATION_GAP_MS = 500;
const SUPPORTED = new Set<FaceChallenge>(['center', 'turn-left', 'turn-right', 'look-up', 'look-down', 'closer', 'further']);
const HINTS: Record<FaceChallenge, string> = {
  center: 'center-face', 'turn-left': 'turn-left', 'turn-right': 'turn-right',
  'look-up': 'look-up', 'look-down': 'look-down', closer: 'move-closer', further: 'move-further',
};

export function validateChallenges(challenges: readonly FaceChallenge[]): FaceChallenge[] {
  if (!Array.isArray(challenges) || challenges.length === 0 || challenges.length > 20) {
    throw new Error('Configure between 1 and 20 face challenges.');
  }
  for (const challenge of challenges) {
    if (!SUPPORTED.has(challenge)) throw new Error(`Unsupported face challenge: ${String(challenge)}`);
  }
  return [...challenges];
}

export function validateFaceOptions(options: FaceOptions = {}): void {
  if (options.challenges !== undefined) validateChallenges(options.challenges);
  for (const key of ['autoStart', 'recordVideo'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new Error(`face.${key} must be true or false.`);
  }
  if (options.holdDurationMs !== undefined && (!Number.isFinite(options.holdDurationMs) || options.holdDurationMs < 100 || options.holdDurationMs > 10_000)) {
    throw new Error('holdDurationMs must be between 100 and 10000 milliseconds.');
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 600_000)) {
    throw new Error('timeoutMs must be between 1000 and 600000 milliseconds.');
  }
  if (options.trackingFps !== undefined && (!Number.isFinite(options.trackingFps) || options.trackingFps < 3 || options.trackingFps > 30)) {
    throw new Error('trackingFps must be between 3 and 30.');
  }
}

function hasFiniteGeometry(observation: FaceObservation): boolean {
  return [observation.timestamp, observation.centerX, observation.centerY, observation.relativeSize, observation.yaw, observation.pitch].every(Number.isFinite);
}

export function isCenteredFace(observation: FaceObservation): boolean {
  return observation.faceCount === 1 && hasFiniteGeometry(observation)
    && Math.abs(observation.centerX - 0.5) <= 0.12
    && Math.abs(observation.centerY - 0.5) <= 0.16
    && observation.relativeSize >= 0.18 && observation.relativeSize <= 0.78;
}

export function isNeutralFace(observation: FaceObservation): boolean {
  return isCenteredFace(observation) && Math.abs(observation.yaw) <= 12 && Math.abs(observation.pitch) <= 15;
}

/** Guides capture geometry only. Completing challenges is not a liveness or identity decision. */
export class ChallengeRunner {
  private readonly challenges: FaceChallenge[];
  private readonly holdDurationMs: number;
  private index = 0;
  private phase: 'baseline' | 'challenge' | 'recenter' | 'done' = 'baseline';
  private baselineSize: number | null = null;
  private dwellStart: number | null = null;
  private dwellSize: number | null = null;
  private lastTimestamp: number | null = null;
  private evidence: ChallengeEvidence[] = [];

  constructor(challenges: readonly FaceChallenge[], holdDurationMs: number) {
    this.challenges = validateChallenges(challenges);
    validateFaceOptions({ holdDurationMs });
    this.holdDurationMs = holdDurationMs;
  }

  reset(): void {
    this.index = 0;
    this.phase = 'baseline';
    this.baselineSize = null;
    this.lastTimestamp = null;
    this.evidence = [];
    this.clearDwell();
  }

  update(observation: FaceObservation): ChallengeFeedback {
    if (this.phase === 'done') return this.feedback('complete', true, 1);
    if (!Number.isFinite(observation.timestamp) || (this.lastTimestamp !== null && observation.timestamp <= this.lastTimestamp)) {
      this.clearDwell();
      return this.feedback('hold-still', false, 0);
    }
    if (this.lastTimestamp !== null && observation.timestamp - this.lastTimestamp > MAX_OBSERVATION_GAP_MS) this.clearDwell();
    this.lastTimestamp = observation.timestamp;
    if (observation.faceCount !== 1) {
      this.clearDwell();
      return this.feedback(observation.faceCount > 1 ? 'multiple-faces' : 'no-face', false, 0);
    }
    if (!isCenteredFace(observation)) {
      this.clearDwell();
      return this.feedback('center-face', false, 0);
    }

    // Leave enough visible space to complete either configured distance change.
    // A baseline already near the limits would make a later challenge impossible.
    if (this.phase === 'baseline' && this.challenges.includes('closer') && observation.relativeSize > 0.6) {
      this.clearDwell();
      return this.feedback('move-further', false, 0);
    }
    if (this.phase === 'baseline' && this.challenges.includes('further') && observation.relativeSize < 0.28) {
      this.clearDwell();
      return this.feedback('move-closer', false, 0);
    }

    if (this.phase === 'baseline' || this.phase === 'recenter') {
      const atBaselineDistance = this.baselineSize === null || Math.abs(observation.relativeSize / this.baselineSize - 1) <= 0.12;
      if (!isNeutralFace(observation) || !atBaselineDistance) {
        this.clearDwell();
        return this.feedback('neutral-pose', false, 0);
      }
      const progress = this.advanceDwell(observation);
      if (progress < 1) return this.feedback('hold-still', true, progress);
      if (this.phase === 'baseline') {
        this.baselineSize = observation.relativeSize;
        this.phase = 'challenge';
        if (this.challenges[0] === 'center') {
          this.completeChallenge(observation.timestamp);
          // The initial centered hold already establishes neutral, so the first
          // movement can start immediately without a second identical hold.
          if (this.index < this.challenges.length) this.phase = 'challenge';
        }
      } else {
        this.phase = this.index === this.challenges.length ? 'done' : 'challenge';
      }
      this.clearDwell();
      return this.phase === 'done' ? this.feedback('complete', true, 1) : this.feedback(HINTS[this.challenges[this.index]!], false, 0);
    }

    const challenge = this.challenges[this.index]!;
    if (!this.matches(challenge, observation)) {
      this.clearDwell();
      return this.feedback(HINTS[challenge], false, 0);
    }
    const progress = this.advanceDwell(observation);
    if (progress < 1) return this.feedback('hold-still', true, progress);
    this.completeChallenge(observation.timestamp);
    this.clearDwell();
    return this.feedback('neutral-pose', false, 0);
  }

  private matches(challenge: FaceChallenge, observation: FaceObservation): boolean {
    switch (challenge) {
      case 'center': return isNeutralFace(observation) && Math.abs(observation.relativeSize / this.baselineSize! - 1) <= 0.12;
      case 'turn-left': return observation.yaw >= 22 && observation.yaw <= 60 && Math.abs(observation.pitch) <= 20;
      case 'turn-right': return observation.yaw <= -22 && observation.yaw >= -60 && Math.abs(observation.pitch) <= 20;
      case 'look-up': return observation.pitch <= -18 && observation.pitch >= -45 && Math.abs(observation.yaw) <= 15;
      case 'look-down': return observation.pitch >= 18 && observation.pitch <= 45 && Math.abs(observation.yaw) <= 15;
      case 'closer': return isNeutralFace(observation) && observation.relativeSize / this.baselineSize! >= 1.25;
      case 'further': return isNeutralFace(observation) && observation.relativeSize / this.baselineSize! <= 0.78;
    }
  }

  private advanceDwell(observation: FaceObservation): number {
    // A visible, stable pose must persist across consecutive recent observations.
    if (this.dwellSize !== null && Math.abs(observation.relativeSize / this.dwellSize - 1) > 0.1) this.clearDwell();
    if (this.dwellStart === null) {
      this.dwellStart = observation.timestamp;
      this.dwellSize = observation.relativeSize;
    }
    return Math.min(1, (observation.timestamp - this.dwellStart) / this.holdDurationMs);
  }

  private completeChallenge(timestamp: number): void {
    this.evidence.push({ challenge: this.challenges[this.index]!, completedAt: timestamp, durationMs: timestamp - this.dwellStart! });
    this.index += 1;
    // A center-only flow already has a suitable final frontal capture pose.
    this.phase = this.index === this.challenges.length && this.challenges[this.index - 1] === 'center' ? 'done' : 'recenter';
  }

  private clearDwell(): void {
    this.dwellStart = null;
    this.dwellSize = null;
  }

  private feedback(hint: string, matched: boolean, progress: number): ChallengeFeedback {
    // A hold can be a movement or a neutral calibration/recenter. Keep its visual target
    // aligned with the runner phase rather than the next entry in the challenge list.
    const guideDirection: FaceChallenge = hint === 'move-closer' ? 'closer'
      : hint === 'move-further' ? 'further'
        : SUPPORTED.has(hint as FaceChallenge) ? hint as FaceChallenge
          : hint === 'hold-still' && this.phase === 'challenge' ? this.challenges[this.index] ?? 'center'
            : 'center';
    return {
      challenge: this.challenges[this.index] ?? null, guideDirection, index: this.index, progress, hint,
      matched, completed: this.phase === 'done', evidence: this.evidence.map((item) => ({ ...item })),
    };
  }
}
