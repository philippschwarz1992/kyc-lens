import type { KycScreenContext } from '../types.js';
import { Icon } from './Icons.js';
import { Illustration } from './Illustrations.js';

type ScreenProps = KycScreenContext & { strings: Record<string, string> };

export function IntroScreen({ next, strings: s, hasDocument = false }: ScreenProps & { hasDocument?: boolean }) {
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
  const comparisonLabel = comparison?.status === 'match' ? s.faceMatch : comparison?.status === 'no_match' ? s.faceNoMatch : s.faceInconclusive;
  return <div className="kyc-screen kyc-result-screen"><div className="kyc-screen-heading"><h2>{s.resultTitle}</h2><p className="kyc-description">{comparison ? comparison.reason === 'simulation' ? s.faceMatchSimulation : s.faceMatchBody : s.resultBody}</p></div><div className="kyc-media kyc-result-media"><div className="kyc-result-icon"><Icon name="check" size={42} /></div>{comparison ? <p className="kyc-comparison-result" role="status" data-match-status={comparison.status}>{comparisonLabel}</p> : null}</div><div className="kyc-actions" /></div>;
}
