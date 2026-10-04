'use client';

import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { initialTransition, transition } from 'xstate';
import type { EventFrom, SnapshotFrom } from 'xstate';
import { createHttpApi, KycHttpError } from '../api.js';
import { DEFAULT_CHALLENGES, validateFaceOptions } from '../core/challenges.js';
import { compareFaces } from '../matching/client.js';
import { comparisonResult, DEFAULT_INCONCLUSIVE_MARGIN, DEFAULT_MATCH_THRESHOLD, validDecisionOptions } from '../matching/protocol.js';
import type { AssetOptions, CapturePayload, CaptureResult, DocumentCapture, DocumentOptions, FaceChallenge, FaceMatchOptions, FaceMatchResult, FaceOptions, KycFlowProps, KycScreenContext, KycSession, KycStep } from '../types.js';
import { DocumentScreen } from './DocumentScreen.js';
import { FaceScreen } from './FaceScreen.js';
import { createFlowMachine, DEFAULT_STEPS, validateFlowConfiguration } from './flow.js';
import { Icon } from './Icons.js';
import { IntroScreen, ResultScreen, ReviewScreen } from './Screens.js';
import { getStrings } from './strings.js';
import { useScreenTransition } from './useScreenTransition.js';

type Configuration = { steps: readonly KycStep[]; document: DocumentOptions; face: FaceOptions; faceMatch: FaceMatchOptions | false; assets: AssetOptions; challenges: readonly FaceChallenge[]; simulation: boolean };

function readableError(error: Error, strings: Record<string, string>): string {
  if (strings[error.message]) return strings[error.message];
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError') return strings.permissionDenied;
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError' || error.name === 'OverconstrainedError') return strings.cameraMissing;
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return strings.cameraBusy;
  return error.message;
}

/** A configurable capture shell. Guided movements alone do not verify identity or liveness. */
export function KycFlow(props: KycFlowProps) {
  const s = getStrings(props.locale, props.strings);
  const steps = props.steps ?? DEFAULT_STEPS;
  const challenges = props.face?.challenges ?? DEFAULT_CHALLENGES;
  let invalid: Error | null = null;
  try {
    validateFlowConfiguration(steps, challenges); validateFaceOptions(props.face);
    if (steps.includes('document') && props.document?.types) {
      const types = props.document.types;
      if (!Array.isArray(types) || types.length < 1 || types.length > 3 || new Set(types).size !== types.length || types.some(type => !['id-card', 'drivers-license', 'passport'].includes(type))) throw new Error('Choose one to three unique supported document types.');
    }
    if (props.document?.detection !== undefined && typeof props.document.detection !== 'boolean') throw new Error('document.detection must be true or false.');
    if (props.document?.autoCapture !== undefined && typeof props.document.autoCapture !== 'boolean') throw new Error('document.autoCapture must be true or false.');
    if (props.document?.holdDurationMs !== undefined && (!Number.isFinite(props.document.holdDurationMs) || props.document.holdDurationMs < 200 || props.document.holdDurationMs > 10_000)) throw new Error('document.holdDurationMs must be between 200 and 10000.');
    if (props.faceMatch !== false && props.faceMatch !== undefined) {
      if (!props.faceMatch || typeof props.faceMatch !== 'object' || Array.isArray(props.faceMatch)) throw new Error('faceMatch must be an options object or false.');
      if (!validDecisionOptions(props.faceMatch.threshold ?? DEFAULT_MATCH_THRESHOLD, props.faceMatch.inconclusiveMargin ?? DEFAULT_INCONCLUSIVE_MARGIN)) throw new Error('Invalid face matching threshold or inconclusive margin.');
      const timeout = props.faceMatch.timeoutMs ?? 45_000;
      if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 120_000) throw new Error('faceMatch.timeoutMs must be between 1000 and 120000.');
    }
  }
  catch (error) { invalid = error instanceof Error ? error : new Error(String(error)); }
  if (invalid) return <section className={`kyc-kit ${props.className ?? ''}`} lang={props.locale ?? 'en'}><div className="kyc-screen" role="alert"><div className="kyc-screen-heading"><h2>{s.configError}</h2><p className="kyc-description">{invalid.message}</p></div><div className="kyc-media" /><div className="kyc-actions" /></div></section>;
  const configuration: Configuration = { steps: [...steps], challenges: [...challenges], document: { ...props.document }, face: { ...props.face }, faceMatch: props.faceMatch === false ? false : { ...props.faceMatch }, assets: { ...props.assets }, simulation: props.simulation === true };
  const sessionKey = JSON.stringify(configuration);
  return <FlowSession key={sessionKey} {...props} configuration={configuration} />;
}

function FlowSession(props: KycFlowProps & { configuration: Configuration }) {
  // The outer key resets changed settings; hold their references stable within this attempt.
  const [configuration] = useState(props.configuration);
  const { steps, document: documentOptions, face, faceMatch, assets, challenges, simulation } = configuration;
  const s = getStrings(props.locale, props.strings);
  const machine = useMemo(() => createFlowMachine(steps), [steps.join('|')]);
  type Machine = typeof machine;
  const [state, send] = useReducer((snapshot: SnapshotFrom<Machine>, event: EventFrom<Machine>) => transition(machine, snapshot, event)[0], undefined, () => initialTransition(machine)[0]);
  const phase = String(state.value);
  const [capture, setCapture] = useState<CapturePayload | null>(null);
  const [documentCapture, setDocumentCapture] = useState<DocumentCapture | undefined>();
  const [result, setResult] = useState<CaptureResult | undefined>();
  const [error, setError] = useState<Error | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [comparing, setComparing] = useState(false);
  const sessionRef = useRef<KycSession | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const completionDelivered = useRef(false);
  const cancellationDelivered = useRef(false);
  const latestCallbacks = useRef({ onComplete: props.onComplete, onCancel: props.onCancel, onError: props.onError });
  latestCallbacks.current = { onComplete: props.onComplete, onCancel: props.onCancel, onError: props.onError };
  const api = useMemo(() => props.api ?? (props.apiBaseUrl !== undefined ? createHttpApi(props.apiBaseUrl, props.headers) : undefined), [props.api, props.apiBaseUrl, props.headers]);
  const contentRef = useRef<HTMLDivElement>(null);
  const screenId = useId();
  useScreenTransition(contentRef, phase);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollTop = 0;
    contentRef.current.focus({ preventScroll: true });
  }, [phase]);
  useEffect(() => {
    if (!capture) { setSelfieUrl(undefined); setVideoUrl(undefined); return; }
    const url = URL.createObjectURL(capture.selfie);
    const clipUrl = capture.video ? URL.createObjectURL(capture.video) : undefined;
    setSelfieUrl(url); setVideoUrl(clipUrl);
    return () => { URL.revokeObjectURL(url); if (clipUrl) URL.revokeObjectURL(clipUrl); };
  }, [capture]);

  useEffect(() => {
    if (phase !== 'submitting' || !capture) return;
    const controller = new AbortController(); requestRef.current = controller;
    let current = true;
    void (async () => {
      try {
        let serverResult: unknown;
        let comparison: FaceMatchResult | undefined;
        if (capture.document && faceMatch !== false) {
          setComparing(true);
          comparison = simulation
            ? comparisonResult('inconclusive', 'simulation', faceMatch.threshold, faceMatch.inconclusiveMargin)
            : await compareFaces({ document: capture.document.front, selfie: capture.selfie, assets, ...faceMatch, signal: controller.signal });
          if (!current || controller.signal.aborted) return;
          setComparing(false);
          if (comparison.status === 'unavailable') {
            const failure = new Error('faceComparisonUnavailable');
            failure.name = 'FaceMatchError';
            throw failure;
          }
        }
        if (api) {
          const session = sessionRef.current ?? await api.createSession(controller.signal);
          if (!current || controller.signal.aborted) return;
          sessionRef.current = session;
          serverResult = await api.submitCapture(session, capture, controller.signal);
        }
        if (!current || controller.signal.aborted) return;
        setResult({ status: 'capture_complete', payload: capture, sessionId: sessionRef.current?.id, ...(comparison ? { faceMatch: comparison } : {}), ...(api ? { serverResult } : {}) });
        send({ type: 'SUCCESS' });
      } catch (failure) {
        if (!current || controller.signal.aborted) return;
        setComparing(false);
        const actual = failure instanceof Error ? failure : new Error(String(failure));
        if (actual instanceof KycHttpError && [401, 404, 410].includes(actual.status)) sessionRef.current = null;
        setError(actual); send({ type: 'FAILURE', stage: 'submission' }); latestCallbacks.current.onError?.(actual);
      }
    })();
    return () => { current = false; controller.abort(); if (requestRef.current === controller) requestRef.current = null; };
  }, [phase, capture, api, faceMatch, assets, simulation]);

  useEffect(() => {
    if (phase !== 'complete' || !result || completionDelivered.current) return;
    completionDelivered.current = true; latestCallbacks.current.onComplete?.(result);
  }, [phase, result]);

  const cancel = () => {
    if (phase === 'complete' || phase === 'cancelled') return;
    requestRef.current?.abort(); setCapture(null); setDocumentCapture(undefined); setResult(undefined); sessionRef.current = null; send({ type: 'CANCEL' });
    if (!cancellationDelivered.current) { cancellationDelivered.current = true; latestCallbacks.current.onCancel?.(); }
  };
  const retry = () => {
    if (phase === 'review') { setCapture(null); setResult(undefined); send({ type: 'RETAKE' }); }
    else if (phase === 'error') { setError(null); send({ type: 'RETRY' }); }
  };
  const context: KycScreenContext = { next: () => send({ type: 'NEXT' }), cancel, retry, result: result ?? (capture ? { status: 'capture_complete', payload: capture } : undefined), selfieUrl, videoUrl };
  const { Intro, Review, Result } = props.components ?? {};
  const theme: CSSProperties & Record<string, string | undefined> = {
    '--kyc-primary': props.theme?.primaryColor, '--kyc-background': props.theme?.backgroundColor,
    '--kyc-text': props.theme?.textColor, '--kyc-radius': props.theme?.borderRadius, '--kyc-font': props.theme?.fontFamily,
  };
  if (phase === 'complete' && !steps.includes('result')) return null;

  return <section className={`kyc-kit ${props.className ?? ''}`} style={theme} lang={props.locale ?? 'en'} aria-label={s.secureCapture}>
    {simulation ? <aside className="kyc-simulation-banner" aria-label={s.simulationBody}>{s.simulation}</aside> : null}
    <div ref={contentRef} id={screenId} className="kyc-content" tabIndex={-1}>
      {phase === 'intro' ? Intro ? <Intro {...context} /> : <IntroScreen {...context} strings={s} hasDocument={steps.includes('document')} /> : null}
      {phase === 'document' ? <DocumentScreen options={documentOptions} assets={assets} simulation={simulation} strings={s} onCapture={document => { setDocumentCapture(document); send({ type: 'DOCUMENT_CAPTURE' }); }} onFailure={failure => { setError(failure); send({ type: 'FAILURE', stage: 'document' }); latestCallbacks.current.onError?.(failure); }} /> : null}
      {phase === 'face' ? <FaceScreen face={face} assets={assets} challenges={challenges} simulation={simulation} strings={s} onCapture={payload => { setCapture({ ...payload, ...(documentCapture ? { document: documentCapture } : {}) }); send({ type: 'CAPTURE' }); }} onFailure={failure => { setError(failure); send({ type: 'FAILURE', stage: 'camera' }); latestCallbacks.current.onError?.(failure); }} /> : null}
      {phase === 'review' ? Review ? <Review {...context} /> : <ReviewScreen {...context} strings={s} /> : null}
      {phase === 'submitting' ? <div className="kyc-screen kyc-status-screen"><div className="kyc-screen-heading"><h2>{comparing ? s.matchingTitle : api ? s.submittingTitle : s.processingTitle}</h2><p className="kyc-description" role="status">{comparing ? s.matchingBody : s.submittingBody}</p></div><div className="kyc-media"><span className="kyc-spinner" /></div><div className="kyc-actions">{comparing ? <button type="button" className="kyc-button kyc-button-secondary" onClick={cancel}>{s.cancel}</button> : null}</div></div> : null}
      {phase === 'complete' ? Result ? <Result {...context} /> : <ResultScreen {...context} strings={s} /> : null}
      {phase === 'error' ? <div className="kyc-screen kyc-error-screen"><div className="kyc-screen-heading"><h2>{s.errorTitle}</h2><p className="kyc-description">{error?.name === 'FaceMatchError' ? s.matchingErrorBody : state.context.errorStage === 'submission' ? s.submissionErrorBody : s.cameraErrorBody}</p></div><div className="kyc-media kyc-error-media"><div className="kyc-error-icon"><Icon name="refresh" size={28} /></div><p className="kyc-error-detail" role="alert">{error ? readableError(error, s) : s.cameraErrorBody}</p></div><div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={retry}>{s.retry}<Icon name="arrow" size={18} /></button></div></div> : null}
      {phase === 'cancelled' ? <div className="kyc-screen kyc-status-screen"><div className="kyc-screen-heading"><h2>{s.cancelledTitle}</h2><p className="kyc-description">{s.cancelledBody}</p></div><div className="kyc-media" /><div className="kyc-actions" /></div> : null}
    </div>
  </section>;
}
