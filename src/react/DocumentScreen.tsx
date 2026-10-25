import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createSteadyFeedback } from '../core/document-auto.js';
import type { AssetOptions, DocumentCapture, DocumentOptions, DocumentType, OutputOptions } from '../types.js';
import type { MrzSummary } from '../mrz/parse.js';
import { Icon } from './Icons.js';
import { Illustration, type IllustrationKind } from './Illustrations.js';
import { useDocumentCapture, type DocumentGuideFeedback } from './useDocumentCapture.js';
import { useScreenTransition } from './useScreenTransition.js';

type DocumentStage = 'select' | 'prepare-front' | 'camera-front' | 'review-front' | 'done-front'
  | 'prepare-back' | 'camera-back' | 'review-back' | 'done-back';
const DEFAULT_DOCUMENT_TYPES: readonly DocumentType[] = ['id-card', 'drivers-license', 'passport'];
const typeIcons = { 'id-card': 'idCard', 'drivers-license': 'license', passport: 'passport' } as const;

function sideIllustration(type: DocumentType, back: boolean): IllustrationKind {
  if (type === 'passport') return 'passport';
  if (type === 'drivers-license') return back ? 'license-back' : 'license-front';
  return back ? 'document-back' : 'document-front';
}

// Long enough to read the confirmation, also for someone who reads slowly.
const DONE_MS = 2200;
const ADJUSTMENTS: ReadonlySet<DocumentGuideFeedback> = new Set(['searching', 'outside', 'too-small', 'dark', 'glare', 'blur']);

/** Detector reasons change several times a second; show each hint long enough to be read. */
function useSteadyFeedback(feedback: DocumentGuideFeedback, scope: string): DocumentGuideFeedback {
  const steady = useMemo(() => createSteadyFeedback<DocumentGuideFeedback>({ immediate: value => !ADJUSTMENTS.has(value) }), [scope]);
  const [shown, setShown] = useState(feedback);
  const latest = useRef(feedback);
  latest.current = feedback;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const next = steady.update(latest.current, performance.now());
      setShown(next.value);
      if (next.recheckMs !== undefined) timer = setTimeout(update, next.recheckMs);
    };
    update();
    return () => clearTimeout(timer);
  }, [feedback, steady]);
  return shown;
}

export function DocumentScreen({ options, assets, simulation, output, strings: s, onCapture, onFailure }: {
  options: DocumentOptions;
  assets: AssetOptions;
  simulation: boolean;
  output?: OutputOptions;
  strings: Record<string, string>;
  onCapture: (capture: DocumentCapture) => void;
  onFailure: (error: Error) => void;
}) {
  const types = options.types ?? DEFAULT_DOCUMENT_TYPES;
  const [selected, setSelected] = useState<DocumentType>(types[0] ?? 'id-card');
  const [stage, setStage] = useState<DocumentStage>('select');
  const [front, setFront] = useState<Blob | null>(null);
  const [back, setBack] = useState<Blob | null>(null);
  const [frontZone, setFrontZone] = useState<MrzSummary | null>(null);
  const [backZone, setBackZone] = useState<MrzSummary | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const completed = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  useScreenTransition(screenRef, stage);
  const radioName = useId();
  const titleId = useId();
  const isCamera = stage === 'camera-front' || stage === 'camera-back';
  const isReview = stage === 'review-front' || stage === 'review-back';
  const isDone = stage === 'done-front' || stage === 'done-back';
  const isBack = stage.endsWith('back');
  const side = isBack ? 'back' : 'front';
  const preview = isReview ? isBack ? back : front : null;
  const sideArt = sideIllustration(selected, isBack);
  const { videoRef, guideRef, feedback: liveFeedback, progress, status, start, capture, stop, cameras, torch, notice, switchCamera, toggleTorch } = useDocumentCapture({
    options, assets, type: selected, side, otherSide: stage === 'camera-back' ? front : null,
    otherSideZone: stage === 'camera-back' ? frontZone : null, simulation, output, onFailure,
    onCapture: (photo, automatic, zone) => {
      // A photo that passed the automatic quality check needs no extra confirmation step.
      const confirmed = automatic && options.confirmPhotos !== true;
      if (stage === 'camera-back') { setBack(photo); setBackZone(zone); setStage(confirmed ? 'done-back' : 'review-back'); }
      else if (stage === 'camera-front') { setFront(photo); setFrontZone(zone); setBack(null); setBackZone(null); setStage(confirmed ? 'done-front' : 'review-front'); }
    },
  });
  const feedback = useSteadyFeedback(liveFeedback, stage);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [stage]);

  useEffect(() => {
    // Entering this stage follows the user's Open camera or Retake photo action.
    if (!isCamera) return;
    void start();
    return stop;
  }, [isCamera, stage, start, stop]);

  useEffect(() => {
    // After the confirmation, continue straight to the back camera or to the next step.
    if (!isDone) return;
    const timer = setTimeout(() => {
      if (stage === 'done-front' && selected !== 'passport') setStage('camera-back');
      else if (front) finish(front, stage === 'done-back' ? back : null);
    }, DONE_MS);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    if (!preview) { setPreviewUrl(undefined); return; }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const names: Record<DocumentType, string> = {
    'id-card': s.documentTypeIdCard ?? 'Identity card',
    'drivers-license': s.documentTypeDriversLicense ?? 'Driver’s license',
    passport: s.documentTypePassport ?? 'Passport',
  };
  const title = stage === 'select' ? s.documentSelectTitle ?? 'Choose your document'
    : stage === 'done-front' ? selected === 'passport' ? s.documentPageCaptured ?? 'Photo page captured' : s.documentFrontCaptured ?? 'Front captured'
    : stage === 'done-back' ? s.documentBackCaptured ?? 'Back captured'
    : isReview ? s.documentReviewTitle ?? 'Check your photo'
      : isBack ? s.documentBackTitle ?? 'Photograph the back'
        : selected === 'passport' ? s.documentPassportTitle ?? 'Photograph the photo page'
          : s.documentFrontTitle ?? 'Photograph the front';
  const body = stage === 'select' ? s.documentSelectBody ?? 'Use a valid, original document.'
    : stage === 'done-front' && selected !== 'passport' ? s.documentTurnOver ?? 'Now turn your document over.'
    : isDone ? s.documentAllCaptured ?? 'Your document photos are done.'
    : isReview ? s.documentReviewBody ?? 'Make sure the entire document is clear and easy to read.'
      : isCamera ? s.documentCameraBody ?? 'Fit all four corners inside the frame. Avoid glare.'
        : isBack ? s.documentBackBody ?? 'Turn your document over. Make sure all four corners are visible.'
          : s.documentFrontBody ?? 'Place your document on a flat surface. Make sure all four corners are visible.';
  // A found, clear document is green while a configured hold completes, not red.
  const guideState = feedback === 'off' ? 'off' : feedback === 'ready' || feedback === 'hold-still' ? 'ready' : 'adjust';
  const automatic = !simulation && options.detection !== false && options.autoCapture !== false;
  // The shutter is automatic; a manual one appears only when live analysis cannot run.
  const manualShutter = !automatic || feedback === 'unavailable';
  const liveGuidance = isCamera && status === 'ready';
  const showSwitch = isCamera && !simulation && options.cameraSwitch !== false && cameras.length > 1;
  const showTorch = isCamera && !simulation && options.torch !== false && torch.available;
  const controlsBusy = status !== 'ready';
  const guideHints = {
    searching: s.documentSearching ?? 'Keep all four corners inside the frame.',
    outside: s.documentOutside ?? 'Move the whole document inside the frame.',
    'too-small': s.documentTooSmall ?? 'Move a little closer.',
    dark: s.documentDark ?? 'Use brighter, even lighting.',
    glare: s.documentGlare ?? 'Tilt slightly to avoid reflections.',
    blur: s.documentBlur ?? 'Hold steady and let the camera focus.',
    'hold-still': automatic ? s.documentAutoHoldStill ?? 'Hold steady… taking your photo automatically.' : s.documentHoldStill ?? 'Hold steady…',
    ready: automatic ? s.documentAutoReady ?? 'Taking your photo automatically…' : s.documentReady ?? 'Looks clear. Take your photo.',
    unavailable: s.documentGuidanceUnavailable ?? 'Keep all four corners visible. Check the photo after capture.',
    'turn-over': s.documentTurnOver ?? 'Now turn your document over.',
    'same-side': s.documentSameSide ?? 'This is the same side. Turn your document over.',
    'zone-unreadable': s.documentZoneUnreadable ?? 'Keep the lines of code at the bottom fully visible and sharp.',
    'looks-like-passport': s.documentLooksLikePassport ?? 'This looks like a passport. Go back and choose Passport.',
    'looks-like-id-card': s.documentLooksLikeIdCard ?? 'This looks like an identity card. Go back and choose Identity card.',
    off: body,
  };

  const goBack = () => {
    stop();
    if (stage === 'camera-front' || stage === 'done-front') setStage('prepare-front');
    else if (stage === 'camera-back' || stage === 'done-back') setStage('prepare-back');
    else if (stage === 'prepare-back') setStage('review-front');
    else if (stage === 'review-front') setStage('prepare-front');
    else if (stage === 'review-back') setStage('prepare-back');
    else setStage('select');
  };

  const finish = (frontPhoto: Blob, backPhoto: Blob | null) => {
    if (completed.current || (selected !== 'passport' && !backPhoto)) return;
    completed.current = true;
    stop();
    const zone = frontZone ?? (selected === 'passport' ? null : backZone);
    onCapture({ type: selected, front: frontPhoto, ...(selected === 'passport' ? {} : { back: backPhoto! }), ...(zone ? { mrz: zone } : {}) });
  };

  const confirm = () => {
    if (completed.current || !front) return;
    if (stage === 'review-front' && selected !== 'passport') { setStage('prepare-back'); return; }
    finish(front, back);
  };

  const retake = () => {
    stop();
    if (isBack) { setBack(null); setStage('camera-back'); }
    else { setFront(null); setBack(null); setStage('camera-front'); }
  };

  return <div ref={screenRef} className={`kyc-screen kyc-document-screen ${isReview ? 'kyc-document-review-screen' : ''}`}>
    {stage !== 'select' ? <button type="button" className="kyc-back" aria-label={s.back ?? 'Back'} onClick={goBack}><Icon name="back" size={22} /></button> : null}
    <div className="kyc-screen-heading">
      <h2 ref={headingRef} id={titleId} tabIndex={-1}>{title}</h2>
      <p className="kyc-description" role={liveGuidance || isDone ? 'status' : undefined} aria-live={liveGuidance || isDone ? 'polite' : undefined} aria-atomic={liveGuidance || isDone ? true : undefined}>{liveGuidance ? notice === 'cameraSwitchFailed' ? s.documentCameraSwitchFailed ?? 'That camera could not be opened. Your previous camera is back on.' : guideHints[feedback] : body}</p>
    </div>
    {stage === 'select' ? <div className="kyc-document-body">
      <Illustration kind="identity" />
      <div className="kyc-document-type-list" role="radiogroup" aria-labelledby={titleId}>
        {types.map(type => <label key={type} className={`kyc-document-type-button ${selected === type ? 'is-selected' : ''}`}>
          <input className="kyc-visually-hidden" type="radio" name={radioName} value={type} checked={selected === type} onChange={() => setSelected(type)} />
          <span className="kyc-document-type-icon" aria-hidden="true"><Icon name={typeIcons[type]} size={22} /></span>
          <span className="kyc-document-type-text"><strong className="kyc-document-type-name">{names[type]}</strong><span className="kyc-document-type-detail">{type === 'passport' ? s.documentPhotoPage ?? 'Photo page' : s.documentFrontAndBack ?? 'Front and back'}</span></span>
          <span className="kyc-document-type-radio" aria-hidden="true">{selected === type ? <Icon name="check" size={14} /> : null}</span>
        </label>)}
      </div>
    </div> : isDone ? <div className="kyc-media kyc-document-done" aria-hidden="true">
      <span className="kyc-document-done-mark"><Icon name="check" size={46} /></span>
    </div> : isReview ? <div className="kyc-media kyc-document-preview">
      {previewUrl ? <img src={previewUrl} alt={isBack ? s.documentBackAlt ?? 'Photograph of the back of your document' : s.documentFrontAlt ?? 'Photograph of the front of your document'} /> : null}
    </div> : isCamera ? <div className={`kyc-media kyc-document-camera ${simulation ? 'is-simulation' : ''}`}>
      <video ref={videoRef} className="kyc-document-video" autoPlay muted playsInline aria-label={title} />
      {simulation ? <div className="kyc-document-demo" aria-hidden="true"><Illustration kind={sideArt} /><span>DEMO</span></div> : null}
      <div ref={guideRef} className="kyc-document-guide" data-state={guideState} data-reason={liveFeedback} data-document-type={selected} aria-hidden="true" />
      {automatic && feedback === 'hold-still' && progress > 0 ? <div className="kyc-document-auto-progress" role="progressbar" aria-label={s.documentAutoProgress ?? 'Automatic photo capture'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div> : null}
      {showSwitch || showTorch ? <div className="kyc-document-camera-controls">
        {/* aria-disabled keeps focus on the control while the next camera opens. */}
        {showTorch ? <button type="button" className={`kyc-document-camera-control ${torch.on ? 'is-active' : ''}`} aria-disabled={controlsBusy} aria-label={torch.on ? s.documentTorchOff ?? 'Turn off flashlight' : s.documentTorchOn ?? 'Turn on flashlight'} onClick={() => { if (!controlsBusy) void toggleTorch(); }}><Icon name="flash" size={19} /></button> : null}
        {showSwitch ? <button type="button" className="kyc-document-camera-control" aria-disabled={controlsBusy} aria-label={s.documentSwitchCamera ?? 'Switch camera'} onClick={() => { if (!controlsBusy) switchCamera(); }}><Icon name="switchCamera" size={20} /></button> : null}
      </div> : null}
      {status === 'requesting' || status === 'capturing' ? <div className="kyc-document-status" role="status"><span className="kyc-spinner" /><span>{status === 'requesting' ? notice === 'tapToStart' ? s.tapToStartCamera : s.requesting ?? 'Opening your camera…' : s.capturing ?? 'Taking your photo…'}</span></div> : null}
    </div> : <div className="kyc-media kyc-document-preparation"><Illustration kind={sideArt} /></div>}
    <div className="kyc-actions">
      {stage === 'select' ?
        <button type="button" className="kyc-button kyc-button-primary" disabled={!types.includes(selected)} onClick={() => { setFront(null); setBack(null); setStage('prepare-front'); }}>{s.documentContinue ?? 'Continue'}<Icon name="arrow" size={18} /></button>
       : isReview ? <div className="kyc-actions-row">
        <button type="button" className="kyc-button kyc-button-secondary" onClick={retake}><Icon name="refresh" size={17} />{s.documentRetake ?? 'Retake photo'}</button>
        <button type="button" className="kyc-button kyc-button-primary" onClick={confirm}>{s.documentConfirm ?? 'Looks good'}<Icon name="arrow" size={18} /></button>
      </div> : isDone ? null : isCamera ? manualShutter ? <button type="button" className="kyc-button kyc-button-primary" disabled={status !== 'ready'} onClick={() => void capture(selected, side)}><Icon name="camera" size={18} />{s.documentTakePhoto ?? 'Take photo'}</button> : null
        : <button type="button" className="kyc-button kyc-button-primary" onClick={() => setStage(isBack ? 'camera-back' : 'camera-front')}>{simulation ? s.documentStartDemo ?? 'Continue' : s.documentStartCamera ?? 'Open camera'}<Icon name="arrow" size={18} /></button>}
    </div>
  </div>;
}
