import { useEffect, useId, useRef, useState } from 'react';
import type { AssetOptions, DocumentCapture, DocumentOptions, DocumentType } from '../types.js';
import { Icon } from './Icons.js';
import { Illustration } from './Illustrations.js';
import { useDocumentCapture } from './useDocumentCapture.js';
import { useScreenTransition } from './useScreenTransition.js';

type DocumentStage = 'select' | 'prepare-front' | 'camera-front' | 'review-front' | 'prepare-back' | 'camera-back' | 'review-back';
const DEFAULT_DOCUMENT_TYPES: readonly DocumentType[] = ['id-card', 'drivers-license', 'passport'];

export function DocumentScreen({ options, assets, simulation, strings: s, onCapture, onFailure }: {
  options: DocumentOptions;
  assets: AssetOptions;
  simulation: boolean;
  strings: Record<string, string>;
  onCapture: (capture: DocumentCapture) => void;
  onFailure: (error: Error) => void;
}) {
  const types = options.types ?? DEFAULT_DOCUMENT_TYPES;
  const [selected, setSelected] = useState<DocumentType>(types[0] ?? 'id-card');
  const [stage, setStage] = useState<DocumentStage>('select');
  const [front, setFront] = useState<Blob | null>(null);
  const [back, setBack] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const completed = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  useScreenTransition(screenRef, stage);
  const radioName = useId();
  const titleId = useId();
  const isCamera = stage === 'camera-front' || stage === 'camera-back';
  const isReview = stage === 'review-front' || stage === 'review-back';
  const isBack = stage.endsWith('back');
  const side = isBack ? 'back' : 'front';
  const preview = isReview ? isBack ? back : front : null;
  const { videoRef, guideRef, feedback, status, start, capture, stop } = useDocumentCapture({
    options, assets, type: selected, simulation, onFailure,
    onCapture: photo => {
      if (stage === 'camera-back') { setBack(photo); setStage('review-back'); }
      else if (stage === 'camera-front') { setFront(photo); setBack(null); setStage('review-front'); }
    },
  });

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
    : isReview ? s.documentReviewTitle ?? 'Check your photo'
      : isBack ? s.documentBackTitle ?? 'Photograph the back'
        : selected === 'passport' ? s.documentPassportTitle ?? 'Photograph the photo page'
          : s.documentFrontTitle ?? 'Photograph the front';
  const body = stage === 'select' ? s.documentSelectBody ?? 'Use a valid, original document.'
    : isReview ? s.documentReviewBody ?? 'Make sure the entire document is clear and easy to read.'
      : isCamera ? s.documentCameraBody ?? 'Fit all four corners inside the frame. Avoid glare.'
        : isBack ? s.documentBackBody ?? 'Turn your document over. Make sure all four corners are visible.'
          : s.documentFrontBody ?? 'Place your document on a flat surface. Make sure all four corners are visible.';
  const guideState = feedback === 'off' ? 'off' : feedback === 'ready' ? 'ready' : 'adjust';
  const liveGuidance = isCamera && status === 'ready';
  const guideHints = {
    searching: s.documentSearching ?? 'Keep all four corners inside the frame.',
    outside: s.documentOutside ?? 'Move the whole document inside the frame.',
    'too-small': s.documentTooSmall ?? 'Move a little closer.',
    dark: s.documentDark ?? 'Use brighter, even lighting.',
    glare: s.documentGlare ?? 'Tilt slightly to avoid reflections.',
    blur: s.documentBlur ?? 'Hold steady and let the camera focus.',
    'hold-still': s.documentHoldStill ?? 'Hold steady…',
    ready: s.documentReady ?? 'Looks clear. Take your photo.',
    unavailable: s.documentGuidanceUnavailable ?? 'Keep all four corners visible. Check the photo after capture.',
    off: body,
  };

  const goBack = () => {
    stop();
    if (stage === 'camera-front') setStage('prepare-front');
    else if (stage === 'camera-back') setStage('prepare-back');
    else if (stage === 'prepare-back') setStage('review-front');
    else if (stage === 'review-front') setStage('prepare-front');
    else if (stage === 'review-back') setStage('prepare-back');
    else setStage('select');
  };

  const confirm = () => {
    if (completed.current || !front) return;
    if (stage === 'review-front' && selected !== 'passport') { setStage('prepare-back'); return; }
    if (stage === 'review-back' && !back) return;
    completed.current = true;
    stop();
    onCapture({ type: selected, front, ...(selected === 'passport' ? {} : { back: back! }) });
  };

  const retake = () => {
    stop();
    if (isBack) { setBack(null); setStage('camera-back'); }
    else { setFront(null); setBack(null); setStage('camera-front'); }
  };

  return <div ref={screenRef} className={`kyc-screen kyc-document-screen ${isReview ? 'kyc-document-review-screen' : ''}`}>
    {stage !== 'select' ? <button type="button" className="kyc-back" aria-label={s.back ?? 'Back'} onClick={goBack}>←</button> : null}
    <div className="kyc-screen-heading">
      <h2 ref={headingRef} id={titleId} tabIndex={-1}>{title}</h2>
      <p className="kyc-description" role={liveGuidance ? 'status' : undefined} aria-live={liveGuidance ? 'polite' : undefined} aria-atomic={liveGuidance ? true : undefined}>{liveGuidance ? guideHints[feedback] : body}</p>
    </div>
    {stage === 'select' ? <div className="kyc-document-body">
      <Illustration kind="identity" />
      <div className="kyc-document-type-list" role="radiogroup" aria-labelledby={titleId}>
        {types.map(type => <label key={type} className={`kyc-document-type-button ${selected === type ? 'is-selected' : ''}`}>
          <input className="kyc-visually-hidden" type="radio" name={radioName} value={type} checked={selected === type} onChange={() => setSelected(type)} />
          <span className="kyc-document-type-text"><strong className="kyc-document-type-name">{names[type]}</strong><span className="kyc-document-type-detail">{type === 'passport' ? s.documentPhotoPage ?? 'Photo page' : s.documentFrontAndBack ?? 'Front and back'}</span></span>
          <span className="kyc-document-type-radio" aria-hidden="true">{selected === type ? <Icon name="check" size={14} /> : null}</span>
        </label>)}
      </div>
    </div> : isReview ? <div className="kyc-media kyc-document-preview">
      {previewUrl ? <img src={previewUrl} alt={isBack ? s.documentBackAlt ?? 'Photograph of the back of your document' : s.documentFrontAlt ?? 'Photograph of the front of your document'} /> : null}
    </div> : isCamera ? <div className={`kyc-media kyc-document-camera ${simulation ? 'is-simulation' : ''}`}>
      <video ref={videoRef} className="kyc-document-video" autoPlay muted playsInline aria-label={title} />
      {simulation ? <div className="kyc-document-demo" aria-hidden="true"><Illustration kind={isBack ? 'document-back' : 'document-front'} /><span>DEMO</span></div> : null}
      <div ref={guideRef} className="kyc-document-guide" data-state={guideState} data-reason={feedback} data-document-type={selected} aria-hidden="true" />
      {status === 'requesting' || status === 'capturing' ? <div className="kyc-document-status" role="status"><span className="kyc-spinner" /><span>{status === 'requesting' ? s.requesting ?? 'Opening your camera…' : s.capturing ?? 'Taking your photo…'}</span></div> : null}
    </div> : <div className="kyc-media kyc-document-preparation"><Illustration kind={isBack ? 'document-back' : 'document-front'} /></div>}
    <div className="kyc-actions">
      {stage === 'select' ?
        <button type="button" className="kyc-button kyc-button-primary" disabled={!types.includes(selected)} onClick={() => { setFront(null); setBack(null); setStage('prepare-front'); }}>{s.documentContinue ?? 'Continue'}<Icon name="arrow" size={18} /></button>
       : isReview ? <div className="kyc-actions-row">
        <button type="button" className="kyc-button kyc-button-secondary" onClick={retake}><Icon name="refresh" size={17} />{s.documentRetake ?? 'Retake photo'}</button>
        <button type="button" className="kyc-button kyc-button-primary" onClick={confirm}>{s.documentConfirm ?? 'Looks good'}<Icon name="arrow" size={18} /></button>
      </div> : isCamera ? <button type="button" className="kyc-button kyc-button-primary" disabled={status !== 'ready'} onClick={() => void capture(selected, side)}><Icon name="camera" size={18} />{s.documentTakePhoto ?? 'Take photo'}</button>
        : <button type="button" className="kyc-button kyc-button-primary" onClick={() => setStage(isBack ? 'camera-back' : 'camera-front')}>{simulation ? s.documentStartDemo ?? 'Continue' : s.documentStartCamera ?? 'Open camera'}<Icon name="arrow" size={18} /></button>}
    </div>
  </div>;
}
