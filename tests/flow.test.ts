import { describe, expect, it } from 'vitest';
import { createActor, transition } from 'xstate';
import { createFlowMachine, DEFAULT_STEPS, validateFlowConfiguration } from '../src/react/flow.js';
import type { FaceChallenge, KycStep } from '../src/types.js';

describe('capture workflow', () => {
  it('requires ordered, unique, supported screens and at least one supported gesture before camera access', () => {
    expect(() => validateFlowConfiguration(['intro', 'review'], ['center'])).toThrow(/face step/);
    expect(() => validateFlowConfiguration(['face', 'intro'], ['center'])).toThrow(/ordered/);
    expect(() => validateFlowConfiguration(['face', 'face'], ['center'])).toThrow(/unique/);
    expect(() => validateFlowConfiguration(['face', 'unknown' as KycStep], ['center'])).toThrow(/Unknown/);
    expect(() => validateFlowConfiguration(['face', 'document'], ['center'])).toThrow(/ordered/);
    expect(() => validateFlowConfiguration(['intro', 'document', 'face', 'review', 'result'], ['center'])).not.toThrow();
    expect(() => validateFlowConfiguration(['face'], [])).toThrow();
    expect(() => validateFlowConfiguration(['face'], ['smile' as FaceChallenge])).toThrow();
    expect(() => validateFlowConfiguration(['face'], Array(21).fill('center'))).toThrow();
    expect(() => validateFlowConfiguration(['face'], ['closer', 'further'])).not.toThrow();
  });

  it('cannot complete or submit before a capture and explicit review confirmation', () => {
    const actor = createActor(createFlowMachine(DEFAULT_STEPS)).start();
    expect(actor.getSnapshot().value).toBe('intro');
    actor.send({ type: 'SUCCESS' }); actor.send({ type: 'CAPTURE' });
    expect(actor.getSnapshot().value).toBe('intro');
    actor.send({ type: 'NEXT' }); actor.send({ type: 'NEXT' }); actor.send({ type: 'SUCCESS' });
    expect(actor.getSnapshot().value).toBe('face');
    actor.send({ type: 'CAPTURE' });
    expect(actor.getSnapshot().value).toBe('review');
    actor.send({ type: 'SUCCESS' });
    expect(actor.getSnapshot().value).toBe('review');
    actor.send({ type: 'NEXT' }); actor.send({ type: 'SUCCESS' });
    expect(actor.getSnapshot().value).toBe('complete');
    actor.stop();
  });

  it('skips disabled screens while retaining the mandatory face stage', () => {
    const actor = createActor(createFlowMachine(['face'])).start();
    expect(actor.getSnapshot().value).toBe('face');
    actor.send({ type: 'CAPTURE' });
    expect(actor.getSnapshot().value).toBe('submitting');
    actor.send({ type: 'SUCCESS' });
    expect(actor.getSnapshot().value).toBe('complete');
    actor.stop();
  });

  it('keeps document capture optional and requires its completion before the face stage', () => {
    expect(DEFAULT_STEPS).toEqual(['intro', 'face', 'review', 'result']);
    const actor = createActor(createFlowMachine(['intro', 'document', 'face', 'review'])).start();
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('document');
    for (const type of ['NEXT', 'CAPTURE', 'SUCCESS'] as const) actor.send({ type });
    expect(actor.getSnapshot().value).toBe('document');
    actor.send({ type: 'DOCUMENT_CAPTURE' });
    expect(actor.getSnapshot().value).toBe('face');
    actor.send({ type: 'CAPTURE' });
    expect(actor.getSnapshot().value).toBe('review');
    actor.stop();
  });

  it('starts with documents when intro is disabled and retries document failures in that stage', () => {
    const actor = createActor(createFlowMachine(['document', 'face'])).start();
    expect(actor.getSnapshot().value).toBe('document');
    actor.send({ type: 'FAILURE', stage: 'document' });
    expect(actor.getSnapshot().value).toBe('error');
    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('document');
    actor.send({ type: 'DOCUMENT_CAPTURE' });
    expect(actor.getSnapshot().value).toBe('face');
    actor.stop();
  });

  it('retakes return to camera; submission retries return directly to submitting', () => {
    const actor = createActor(createFlowMachine(['face', 'review'])).start();
    actor.send({ type: 'CAPTURE' }); actor.send({ type: 'RETAKE' });
    expect(actor.getSnapshot().value).toBe('face');
    actor.send({ type: 'FAILURE', stage: 'camera' }); actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('face');
    actor.send({ type: 'CAPTURE' }); actor.send({ type: 'NEXT' }); actor.send({ type: 'FAILURE', stage: 'submission' }); actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('submitting');
    actor.stop();
  });

  it('cancellation is terminal and ignores late capture or upload responses', () => {
    for (const before of ['document', 'face', 'submitting'] as const) {
      const machine = createFlowMachine(before === 'document' ? ['document', 'face'] : ['face']);
      const actor = createActor(machine).start();
      if (before === 'submitting') actor.send({ type: 'CAPTURE' });
      actor.send({ type: 'CANCEL' });
      for (const type of ['DOCUMENT_CAPTURE', 'CAPTURE', 'SUCCESS', 'RETRY'] as const) expect(transition(machine, actor.getSnapshot(), { type })[0].value).toBe('cancelled');
      expect(actor.getSnapshot().value).toBe('cancelled');
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
    }
  });
});
