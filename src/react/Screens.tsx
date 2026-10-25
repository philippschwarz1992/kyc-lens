import type { KycScreenContext } from '../types.js';
import { HandoffQr } from './Handoff.js';
import { Icon } from './Icons.js';
import { Illustration } from './Illustrations.js';

type ScreenProps = KycScreenContext & { strings: Record<string, string> };

export function IntroScreen({ next, strings: s, hasDocument = false, handoffUrl }: ScreenProps & { hasDocument?: boolean }) {
  if (handoffUrl) return <div className="kyc-screen kyc-intro-screen kyc-handoff-screen">
    <div className="kyc-screen-heading"><h2>{s.handoffTitle}</h2><p className="kyc-description">{s.handoffBody}</p></div>
    <div className="kyc-media kyc-handoff-media"><HandoffQr url={handoffUrl} label={s.handoffQrLabel} /></div>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-secondary" onClick={next}>{s.handoffThisDevice}</button></div>
  </div>;
  return <div className="kyc-screen kyc-intro-screen">
    <div className="kyc-screen-heading"><h2>{hasDocument ? s.identityTitle : s.introTitle}</h2><p className="kyc-description">{hasDocument ? s.identityBody : s.introBody}</p></div>
    <div className="kyc-media"><Illustration kind={hasDocument ? 'identity' : 'selfie'} /></div>
    <div className="kyc-actions"><button type="button" className="kyc-button kyc-button-primary" onClick={next}>{hasDocument ? s.documentBegin : s.start}</button></div>
  </div>;
}

export function ReviewScreen({ next, retry, result, selfieUrl, videoUrl, strings: s }: ScreenProps) {
  const hasVideo = Boolean(result?.payload.video || videoUrl);
  return <div className="kyc-screen kyc-review-screen">
    <div className="kyc-screen-heading"><h2>{hasVideo ? s.videoReviewTitle : s.reviewTitle}</h2><p className="kyc-description">{hasVideo ? s.videoReviewBody : s.reviewBody}</p></div>
    <div className="kyc-media kyc-selfie-frame">{hasVideo ? <video src={videoUrl} poster={selfieUrl} controls muted playsInline preload="metadata" aria-label={s.videoAlt} /> : selfieUrl ? <img src={selfieUrl} alt={s.selfieAlt} /> : null}</div>
    <div className="kyc-actions kyc-actions-row"><button type="button" className="kyc-button kyc-button-secondary" onClick={retry}>{hasVideo ? s.videoRetake : s.retake}</button><button type="button" className="kyc-button kyc-button-primary" onClick={next}>{s.confirm}</button></div>
  </div>;
}

export function ResultScreen({ result, strings: s }: ScreenProps) {
  const comparison = result?.faceMatch;
  const verified = comparison?.status === 'match';
  const comparisonLabel = verified ? s.faceMatch : comparison?.status === 'no_match' ? s.faceNoMatch : s.faceInconclusive;
  return <div className={`kyc-screen kyc-result-screen ${verified ? 'is-verified' : ''}`}><div className="kyc-screen-heading"><h2>{verified ? s.successTitle : s.resultTitle}</h2><p className="kyc-description">{verified ? s.successBody : comparison ? comparison.reason === 'simulation' ? s.faceMatchSimulation : s.faceMatchBody : s.resultBody}</p></div><div className="kyc-media kyc-result-media"><div className="kyc-result-icon"><Icon name="check" size={42} /></div>{comparison && !verified && comparison.reason !== 'simulation' ? <p className="kyc-comparison-result" role="status" data-match-status={comparison.status}>{comparisonLabel}</p> : null}</div><div className="kyc-actions" /></div>;
}

export type AnalysisStage = 'compare' | 'upload';

/** Shown while the capture is compared and sent. Every row reflects real progress, never a timer. */
export function AnalysisScreen({ strings: s, hasDocument, compare, upload, stage, uploadPercent, onCancel }: {
  strings: Record<string, string>; hasDocument: boolean; compare: boolean; upload: boolean; stage: AnalysisStage | null; uploadPercent: number | null; onCancel: () => void;
}) {
  type Row = { id: string; label: string; state: 'done' | 'active' | 'pending' };
  const rows: Row[] = [
    ...(hasDocument ? [{ id: 'document', label: s.analysisDocument, state: 'done' as const }] : []),
    { id: 'face', label: s.analysisFace, state: 'done' },
    ...(compare ? [{ id: 'compare', label: s.analysisCompare, state: stage === 'compare' ? 'active' as const : 'done' as const }] : []),
    ...(upload ? [{ id: 'upload', label: s.analysisUpload, state: stage === 'upload' ? 'active' as const : stage === 'compare' ? 'pending' as const : 'done' as const }] : []),
  ];
  const title = compare ? s.analysisTitle : upload ? s.submittingTitle : s.processingTitle;
  // The body follows the running stage; the upload percentage appears only here.
  const body = stage === 'compare' ? s.analysisBody
    : uploadPercent !== null ? (s.uploadProgress ?? '{percent}%').replace('{percent}', String(uploadPercent)) : s.submittingBody;
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
    <div className="kyc-actions">{stage === 'compare' ? <button type="button" className="kyc-button kyc-button-secondary" onClick={onCancel}>{s.cancel}</button> : null}</div>
  </div>;
}

/** The faces did not match: explain, give quick tips and restart the whole capture. */
export function RejectedScreen({ strings: s, status, onRestart }: { strings: Record<string, string>; status: 'no_match' | 'inconclusive'; onRestart: () => void }) {
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
