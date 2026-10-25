import { describe, expect, it } from 'vitest';
import { createActor, initialTransition, transition } from 'xstate';
import type { EventFrom } from 'xstate';
import { KycHttpError } from '../src/api.js';
import { createEventReporter, errorCode } from '../src/react/events.js';
import { createFlowMachine, DEFAULT_STEPS, validateFlowConfiguration } from '../src/react/flow.js';
import type { FaceChallenge, KycEvent, KycStep } from '../src/types.js';

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

  it('submits the capture automatically by default, without a review screen', () => {
    expect(DEFAULT_STEPS).toEqual(['intro', 'face', 'result']);
    const actor = createActor(createFlowMachine(DEFAULT_STEPS)).start();
    actor.send({ type: 'NEXT' }); actor.send({ type: 'CAPTURE' });
    expect(actor.getSnapshot().value).toBe('submitting');
    actor.send({ type: 'SUCCESS' });
    expect(actor.getSnapshot().value).toBe('complete');
    actor.stop();
  });

  it('restarts from the first screen after the faces do not match', () => {
    for (const [steps, first] of [[['intro', 'document', 'face', 'result'], 'intro'], [['document', 'face'], 'document']] as const) {
      const actor = createActor(createFlowMachine(steps)).start();
      if (first === 'intro') actor.send({ type: 'NEXT' });
      actor.send({ type: 'DOCUMENT_CAPTURE' }); actor.send({ type: 'CAPTURE' }); actor.send({ type: 'REJECT' });
      expect(actor.getSnapshot().value).toBe('rejected');
      for (const type of ['SUCCESS', 'RETRY', 'CAPTURE'] as const) actor.send({ type });
      expect(actor.getSnapshot().value).toBe('rejected');
      actor.send({ type: 'RESTART' });
      expect(actor.getSnapshot().value).toBe(first);
      actor.stop();
    }
  });

  it('cannot complete or submit before a capture and explicit review confirmation', () => {
    const actor = createActor(createFlowMachine(['intro', 'face', 'review', 'result'])).start();
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

describe('analytics events', () => {
  it('reports a privacy-safe sequence of steps, retakes, errors, retries and completion', () => {
    const events: KycEvent[] = [];
    let clock = 1000;
    const reporter = createEventReporter(() => event => events.push(event), () => clock);
    const machine = createFlowMachine(['intro', 'face', 'review', 'result']);
    let snapshot = initialTransition(machine)[0];
    const go = (event: EventFrom<typeof machine>) => { clock += 100; snapshot = transition(machine, snapshot, event)[0]; reporter.step(String(snapshot.value)); };
    reporter.step(String(snapshot.value)); reporter.step(String(snapshot.value));
    go({ type: 'NEXT' }); go({ type: 'CAPTURE' });
    reporter.retake(); go({ type: 'RETAKE' });
    go({ type: 'CAPTURE' }); go({ type: 'NEXT' });
    reporter.error('submission', new KycHttpError('Token abc expired for https://example.test/secret', 503)); go({ type: 'FAILURE', stage: 'submission' });
    reporter.retry(snapshot.context.errorStage); go({ type: 'RETRY' });
    reporter.rejected('no_match'); go({ type: 'REJECT' }); reporter.restart(); go({ type: 'RESTART' });
    go({ type: 'NEXT' }); go({ type: 'CAPTURE' }); go({ type: 'NEXT' }); go({ type: 'SUCCESS' });
    reporter.complete({ status: 'capture_complete', payload: { selfie: new Blob(['x']), challenges: [], capturedAt: '', mode: 'camera' }, faceMatch: { status: 'match', reason: 'above-threshold', score: 0.9, threshold: 0.4 } as never });
    expect(events).toEqual([
      { type: 'step', step: 'intro', elapsedMs: 0 },
      { type: 'step', step: 'face', elapsedMs: 100 },
      { type: 'step', step: 'review', elapsedMs: 200 },
      { type: 'retake' },
      { type: 'step', step: 'face', elapsedMs: 300 },
      { type: 'step', step: 'review', elapsedMs: 400 },
      { type: 'step', step: 'submitting', elapsedMs: 500 },
      { type: 'error', stage: 'submission', code: 'http_503' },
      { type: 'step', step: 'error', elapsedMs: 600 },
      { type: 'retry', from: 'submission' },
      { type: 'step', step: 'submitting', elapsedMs: 700 },
      { type: 'rejected', faceMatchStatus: 'no_match' },
      { type: 'step', step: 'rejected', elapsedMs: 800 },
      { type: 'restart' },
      { type: 'step', step: 'intro', elapsedMs: 900 },
      { type: 'step', step: 'face', elapsedMs: 1000 },
      { type: 'step', step: 'review', elapsedMs: 1100 },
      { type: 'step', step: 'submitting', elapsedMs: 1200 },
      { type: 'step', step: 'complete', elapsedMs: 1300 },
      { type: 'complete', durationMs: 1300, faceMatchStatus: 'match' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/abc|https|secret|blob|score|threshold/i);
  });

  it('reports cancellation and never lets analytics exceptions escape', () => {
    const events: KycEvent[] = [];
    const reporter = createEventReporter(() => event => { events.push(event); throw new Error('analytics down'); }, () => 0);
    expect(() => { reporter.step('document'); reporter.cancel('document'); reporter.step('cancelled'); reporter.step('initializing'); }).not.toThrow();
    expect(events).toEqual([{ type: 'step', step: 'document', elapsedMs: 0 }, { type: 'cancel', step: 'document' }, { type: 'step', step: 'cancelled', elapsedMs: 0 }]);
    expect(() => createEventReporter(() => undefined).step('intro')).not.toThrow();
  });

  it('maps errors to stable codes instead of raw messages', () => {
    const named = (message: string, name: string) => Object.assign(new Error(message), { name });
    expect(errorCode(new Error('documentCaptureFailed'))).toBe('documentCaptureFailed');
    expect(errorCode(named('faceComparisonUnavailable', 'FaceMatchError'))).toBe('faceComparisonUnavailable');
    expect(errorCode(named('Permission denied by user at /home/me', 'NotAllowedError'))).toBe('NotAllowedError');
    expect(errorCode(new KycHttpError('Session expired.', 401))).toBe('http_401');
    expect(errorCode(new Error('Something with personal data'))).toBe('unknown');
    expect(errorCode(named('x', 'bad name with spaces'))).toBe('unknown');
  });
});
