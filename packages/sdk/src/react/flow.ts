import { assign, setup } from 'xstate';
import type { FaceChallenge, KycStep } from '../types.js';
import { validateChallenges } from '../core/challenges.js';

export const DEFAULT_STEPS: readonly KycStep[] = ['intro', 'face', 'review', 'result'];
const STEP_ORDER: readonly KycStep[] = ['intro', 'document', 'face', 'review', 'result'];

/** Validate configuration before asking for camera access. */
export function validateFlowConfiguration(steps: readonly KycStep[], challenges: readonly FaceChallenge[]): void {
  if (!steps.includes('face')) throw new Error('KycFlow requires the face step.');
  let previous = -1;
  for (const step of steps) {
    const index = STEP_ORDER.indexOf(step);
    if (index < 0) throw new Error(`Unknown KYC step: ${String(step)}`);
    if (index <= previous) throw new Error('KYC steps must be unique and ordered: intro, document, face, review, result.');
    previous = index;
  }
  validateChallenges(challenges);
}

type FlowEvent =
  | { type: 'NEXT' }
  | { type: 'CAPTURE' }
  | { type: 'DOCUMENT_CAPTURE' }
  | { type: 'RETAKE' }
  | { type: 'SUCCESS' }
  | { type: 'FAILURE'; stage: 'camera' | 'document' | 'submission' }
  | { type: 'RETRY' }
  | { type: 'CANCEL' };

/** The server result is deliberately independent from the capture workflow. */
export function createFlowMachine(steps: readonly KycStep[]) {
  return setup({
    types: {
      context: {} as { errorStage: 'camera' | 'document' | 'submission' },
      events: {} as FlowEvent,
    },
    guards: {
      showIntro: () => steps.includes('intro'),
      showDocument: () => steps.includes('document'),
      showReview: () => steps.includes('review'),
      retrySubmission: ({ context }) => context.errorStage === 'submission',
      retryDocument: ({ context }) => context.errorStage === 'document',
    },
    actions: {
      recordErrorStage: assign({ errorStage: ({ event }) => event.type === 'FAILURE' ? event.stage : 'camera' }),
    },
  }).createMachine({
    id: 'kyc-capture',
    context: { errorStage: 'camera' },
    initial: 'initializing',
    on: { CANCEL: '.cancelled' },
    states: {
      initializing: { always: [{ guard: 'showIntro', target: 'intro' }, { guard: 'showDocument', target: 'document' }, { target: 'face' }] },
      intro: { on: { NEXT: [{ guard: 'showDocument', target: 'document' }, { target: 'face' }] } },
      document: { on: { DOCUMENT_CAPTURE: 'face', FAILURE: { target: 'error', actions: 'recordErrorStage' } } },
      face: {
        on: {
          CAPTURE: [{ guard: 'showReview', target: 'review' }, { target: 'submitting' }],
          FAILURE: { target: 'error', actions: 'recordErrorStage' },
        },
      },
      review: { on: { NEXT: 'submitting', RETAKE: 'face' } },
      submitting: { on: { SUCCESS: 'complete', FAILURE: { target: 'error', actions: 'recordErrorStage' } } },
      error: { on: { RETRY: [{ guard: 'retrySubmission', target: 'submitting' }, { guard: 'retryDocument', target: 'document' }, { target: 'face' }] } },
      complete: { type: 'final' },
      cancelled: { type: 'final' },
    },
  });
}
