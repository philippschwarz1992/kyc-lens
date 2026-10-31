import type { KycIconGlyph } from '../icons.js';
import type { KycScreenContext } from '../types.js';
import { HandoffQr } from './Handoff.js';
import { Icon } from './Icons.js';
import { Illustration } from './Illustrations.js';
import { CheckList, Eyebrow, Hero, PanelArt, TileList, usePanel, VerifiedArt } from './Panel.js';
import type { CheckRow } from './Panel.js';

type ScreenProps = KycScreenContext & { strings: Record<string, string> };

export function IntroScreen({ next, strings: s, hasDocument = false, handoffUrl, brandMark }: ScreenProps & { hasDocument?: boolean; brandMark?: KycIconGlyph }) {
  const panel = usePanel();
  if (handoffUrl && panel) return <div className="kyc-screen kyc-intro-screen kyc-handoff-screen">
    <Hero corner="phone" label={s.handoffQrLabel} className="kyc-hero-handoff"><HandoffQr url={handoffUrl} label={s.handoffQrLabel} panel mark={brandMark} /></Hero>
    <div className="kyc-screen-heading"><Eyebrow>{s.introEyebrow}</Eyebrow><h2>{s.handoffTitle}</h2><p className="kyc-description">{s.handoffBody}</p></div>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-secondary" onClick={next}>{s.handoffThisDevice}</button></div>
  </div>;
  if (handoffUrl) return <div className="kyc-screen kyc-intro-screen kyc-handoff-screen">
    <div className="kyc-screen-heading"><h2>{s.handoffTitle}</h2><p className="kyc-description">{s.handoffBody}</p></div>
    <div className="kyc-media kyc-handoff-media"><HandoffQr url={handoffUrl} label={s.handoffQrLabel} /></div>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-secondary" onClick={next}>{s.handoffThisDevice}</button></div>
  </div>;
  if (panel) return <div className="kyc-screen kyc-intro-screen">
    <Hero corner="lock" className={hasDocument ? 'kyc-hero-identity' : 'kyc-hero-selfie'}>
      <PanelArt kind={hasDocument ? 'identity' : 'selfie'} />
      {hasDocument ? <div className="kyc-step-chips"><span className="is-current"><b>1</b>{s.stepDocument}</span><span><b>2</b>{s.stepFace}</span></div> : null}
    </Hero>
    <div className="kyc-screen-heading"><Eyebrow>{s.introEyebrow}</Eyebrow><h2>{hasDocument ? s.identityTitle : s.introTitle}</h2><p className="kyc-description">{hasDocument ? s.identityBody : s.introBody}</p></div>
    <TileList label={s.introChecklist} items={[
      { icon: 'sun', title: s.goodLight, body: s.goodLightBody },
      { icon: 'camera', title: s.cameraReady, body: s.cameraReadyBody },
      { icon: 'face', title: s.natural, body: s.naturalBody },
    ]} />
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={next}>{hasDocument ? s.documentBegin : s.start}<Icon name="arrow" size={20} /></button></div>
  </div>;
  return <div className="kyc-screen kyc-intro-screen">
    <div className="kyc-screen-heading"><h2>{hasDocument ? s.identityTitle : s.introTitle}</h2><p className="kyc-description">{hasDocument ? s.identityBody : s.introBody}</p></div>
    <div className="kyc-media"><Illustration kind={hasDocument ? 'identity' : 'selfie'} /></div>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={next}>{hasDocument ? s.documentBegin : s.start}</button></div>
  </div>;
}

export function ReviewScreen({ next, retry, result, selfieUrl, videoUrl, strings: s }: ScreenProps) {
  const panel = usePanel();
  const hasVideo = Boolean(result?.payload.video || videoUrl);
  const media = hasVideo ? <video src={videoUrl} poster={selfieUrl} controls muted playsInline preload="metadata" aria-label={s.videoAlt} /> : selfieUrl ? <img src={selfieUrl} alt={s.selfieAlt} /> : null;
  if (panel) return <div className="kyc-screen kyc-review-screen">
    <div className="kyc-screen-heading"><Eyebrow>{s.reviewEyebrow}</Eyebrow><h2>{hasVideo ? s.videoReviewTitle : s.reviewTitle}</h2><p className="kyc-description">{hasVideo ? s.videoReviewBody : s.reviewBody}</p></div>
    <div className="kyc-media kyc-selfie-frame">{media}{hasVideo ? null : <span className="kyc-captured-pill"><Icon name="check" size={14} />{s.resultStatus}</span>}</div>
    <div className="kyc-actions kyc-actions-row"><button type="button" className="kyc-button kyc-button-secondary" onClick={retry}>{hasVideo ? s.videoRetake : s.retake}</button><button type="button" className="kyc-button kyc-button-primary kyc-button-wide" onClick={next}>{s.confirm}</button></div>
  </div>;
  return <div className="kyc-screen kyc-review-screen">
    <div className="kyc-screen-heading"><h2>{hasVideo ? s.videoReviewTitle : s.reviewTitle}</h2><p className="kyc-description">{hasVideo ? s.videoReviewBody : s.reviewBody}</p></div>
    <div className="kyc-media kyc-selfie-frame">{media}</div>
    <div className="kyc-actions kyc-actions-row"><button type="button" className="kyc-button kyc-button-secondary" onClick={retry}>{hasVideo ? s.videoRetake : s.retake}</button><button type="button" className="kyc-button kyc-button-primary" onClick={next}>{s.confirm}</button></div>
  </div>;
}

export function ResultScreen({ result, strings: s }: ScreenProps) {
  const panel = usePanel();
  const comparison = result?.faceMatch;
  const verified = comparison?.status === 'match';
  const comparisonLabel = verified ? s.faceMatch : comparison?.status === 'no_match' ? s.faceNoMatch : s.faceInconclusive;
  const body = verified ? s.successBody : comparison ? comparison.reason === 'simulation' ? s.faceMatchSimulation : s.faceMatchBody : s.resultBody;
  if (panel) {
    const rows: CheckRow[] = [
      ...(result?.payload.document ? [{ id: 'document', label: s.analysisDocument, state: 'done' as const, note: s.resultPassed }] : []),
      { id: 'face', label: s.analysisFace, state: 'done', note: s.resultPassed },
      ...(verified ? [{ id: 'compare', label: s.resultCompared, state: 'done' as const, note: s.resultPassed }] : []),
    ];
    return <div className={`kyc-screen kyc-result-screen ${verified ? 'is-verified' : ''}`}>
      {verified ? <Hero corner="shield" tone="accent" label={`${s.resultIdentity}, ${s.resultFaceMatched}`} className="kyc-hero-verified">
        <VerifiedArt />
        <div className="kyc-hero-caption"><p className="kyc-eyebrow">{s.resultIdentity}</p><p className="kyc-hero-title">{s.resultFaceMatched}</p></div>
      </Hero> : <Hero className="kyc-hero-symbol"><span className="kyc-symbol"><Icon name="check" size={40} /></span></Hero>}
      <div className="kyc-screen-heading"><h2>{verified ? s.successTitle : s.resultTitle}</h2><p className="kyc-description">{body}</p></div>
      {comparison && !verified && comparison.reason !== 'simulation' ? <p className="kyc-comparison-result" role="status" data-match-status={comparison.status}>{comparisonLabel}</p> : null}
      <CheckList rows={rows} />
      <div className="kyc-actions" />
    </div>;
  }
  return <div className={`kyc-screen kyc-result-screen ${verified ? 'is-verified' : ''}`}><div className="kyc-screen-heading"><h2>{verified ? s.successTitle : s.resultTitle}</h2><p className="kyc-description">{body}</p></div><div className="kyc-media kyc-result-media"><div className="kyc-result-icon"><Icon name="check" size={42} /></div>{comparison && !verified && comparison.reason !== 'simulation' ? <p className="kyc-comparison-result" role="status" data-match-status={comparison.status}>{comparisonLabel}</p> : null}</div><div className="kyc-actions" /></div>;
}

export type AnalysisStage = 'compare' | 'upload';

/** Shown while the capture is compared and sent. Every row reflects real progress, never a timer. */
export function AnalysisScreen({ strings: s, hasDocument, compare, upload, stage, uploadPercent, onCancel }: {
  strings: Record<string, string>; hasDocument: boolean; compare: boolean; upload: boolean; stage: AnalysisStage | null; uploadPercent: number | null; onCancel: () => void;
}) {
  const panel = usePanel();
  const rows: CheckRow[] = [
    ...(hasDocument ? [{ id: 'document', label: s.analysisDocument, state: 'done' as const }] : []),
    { id: 'face', label: s.analysisFace, state: 'done' },
    ...(compare ? [{ id: 'compare', label: s.analysisCompare, state: stage === 'compare' ? 'active' as const : 'done' as const }] : []),
    ...(upload ? [{ id: 'upload', label: s.analysisUpload, state: stage === 'upload' ? 'active' as const : stage === 'compare' ? 'pending' as const : 'done' as const }] : []),
  ];
  const title = compare ? s.analysisTitle : upload ? s.submittingTitle : s.processingTitle;
  // The body follows the running stage; the upload percentage appears only here.
  const body = stage === 'compare' ? s.analysisBody
    : uploadPercent !== null ? (s.uploadProgress ?? '{percent}%').replace('{percent}', String(uploadPercent)) : s.submittingBody;
  const cancel = <div className="kyc-actions">{stage === 'compare' ? <button type="button" className="kyc-button kyc-button-secondary" onClick={onCancel}>{s.cancel}</button> : null}</div>;
  if (panel) return <div className="kyc-screen kyc-status-screen kyc-analysis-screen" aria-busy="true">
    <div className="kyc-scan-rings" aria-hidden="true">
      <span /><span />
      <svg viewBox="0 0 216 216" fill="none"><circle cx="108" cy="108" r="84" strokeWidth="3" strokeLinecap="round" strokeDasharray="96 600" /></svg>
      <span className="kyc-scan-core"><Icon name={stage === 'compare' ? 'face' : 'upload'} size={44} /></span>
    </div>
    <div className="kyc-screen-heading"><h2>{title}</h2><p className="kyc-description" role="status">{body}</p></div>
    <CheckList rows={rows.map(row => row.state === 'done' ? { ...row, note: s.analysisDone } : row)} />
    {cancel}
  </div>;
  return <div className="kyc-screen kyc-status-screen kyc-analysis-screen" aria-busy="true">
    <div className="kyc-screen-heading"><h2>{title}</h2><p className="kyc-description" role="status">{body}</p></div>
    <div className="kyc-media kyc-analysis-media">
      <div className="kyc-analysis-visual" aria-hidden="true">
        <span className="kyc-analysis-pulse" /><span className="kyc-analysis-pulse" />
        <span className="kyc-analysis-orbit" />
        <span className="kyc-analysis-core"><Icon name={stage === 'compare' ? 'face' : 'upload'} size={40} /><span className="kyc-analysis-scan" /></span>
      </div>
      <ul className="kyc-analysis-steps">{rows.map(row => <li key={row.id} data-state={row.state}>
        <span className="kyc-analysis-step-mark">{row.state === 'done' ? <Icon name="check" size={14} /> : row.state === 'active' ? <span className="kyc-spinner" /> : null}</span>
        <span>{row.label}</span>
      </li>)}</ul>
    </div>
    {cancel}
  </div>;
}

/** The faces did not match: explain, give quick tips and restart the whole capture. */
export function RejectedScreen({ strings: s, status, onRestart }: { strings: Record<string, string>; status: 'no_match' | 'inconclusive'; onRestart: () => void }) {
  const panel = usePanel();
  if (panel) return <div className="kyc-screen kyc-rejected-screen">
    <Hero className="kyc-hero-symbol"><span className="kyc-symbol is-danger"><Icon name="close" size={40} /></span></Hero>
    <div className="kyc-screen-heading"><h2>{s.rejectedTitle}</h2><p className="kyc-description" role="alert">{status === 'no_match' ? s.rejectedNoMatch : s.rejectedInconclusive}</p></div>
    <section className="kyc-tips"><h3>{s.rejectedTips}</h3><TileList items={[
      { icon: 'sun', title: s.tipLight }, { icon: 'face', title: s.tipAccessories }, { icon: 'idCard', title: s.tipDocument },
    ]} /></section>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={onRestart}>{s.retry}<Icon name="arrow" size={20} /></button></div>
  </div>;
  return <div className="kyc-screen kyc-rejected-screen">
    <div className="kyc-screen-heading"><h2>{s.rejectedTitle}</h2><p className="kyc-description" role="alert">{status === 'no_match' ? s.rejectedNoMatch : s.rejectedInconclusive}</p></div>
    <div className="kyc-media kyc-rejected-media">
      <div className="kyc-rejected-icon"><Icon name="close" size={36} /></div>
      <div className="kyc-rejected-tips"><p>{s.rejectedTips}</p><ul>
        <li><Icon name="sun" size={18} />{s.tipLight}</li>
        <li><Icon name="face" size={18} />{s.tipAccessories}</li>
        <li><Icon name="idCard" size={18} />{s.tipDocument}</li>
      </ul></div>
    </div>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={onRestart}><Icon name="refresh" size={18} />{s.retry}</button></div>
  </div>;
}

/** A capture step failed: the readable reason and a retry. */
export function ErrorScreen({ strings: s, body, detail, onRetry }: { strings: Record<string, string>; body: string; detail: string; onRetry: () => void }) {
  const panel = usePanel();
  if (panel) return <div className="kyc-screen kyc-error-screen">
    <Hero className="kyc-hero-symbol"><span className="kyc-symbol"><Icon name="refresh" size={38} /></span></Hero>
    <div className="kyc-screen-heading"><h2>{s.errorTitle}</h2><p className="kyc-description">{body}</p></div>
    <p className="kyc-error-detail" role="alert"><Icon name="alert" size={20} /><span>{detail}</span></p>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={onRetry}>{s.retry}<Icon name="arrow" size={20} /></button></div>
  </div>;
  return <div className="kyc-screen kyc-error-screen"><div className="kyc-screen-heading"><h2>{s.errorTitle}</h2><p className="kyc-description">{body}</p></div><div className="kyc-media kyc-error-media"><div className="kyc-error-icon"><Icon name="refresh" size={28} /></div><p className="kyc-error-detail" role="alert">{detail}</p></div><div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={onRetry}>{s.retry}<Icon name="arrow" size={18} /></button></div></div>;
}
