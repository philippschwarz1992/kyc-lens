import { useRef } from 'react';
import type { AssetOptions, CapturePayload, FaceChallenge, FaceOptions } from '../types.js';
import { Icon } from './Icons.js';
import { Illustration } from './Illustrations.js';
import { useFaceCapture } from './useFaceCapture.js';
import { useScreenTransition } from './useScreenTransition.js';

export function FaceScreen({ face, assets, challenges, simulation, strings: s, onCapture, onFailure }: {
  face: FaceOptions; assets: AssetOptions; challenges: readonly FaceChallenge[]; simulation: boolean;
  strings: Record<string, string>; onCapture: (capture: CapturePayload) => void; onFailure: (error: Error) => void;
}) {
  const { videoRef, status, feedback, start } = useFaceCapture({ options: face, assets, challenges, simulation, onCapture, onFailure });
  const screenRef = useRef<HTMLDivElement>(null);
  useScreenTransition(screenRef, status === 'idle' ? 'prepare' : 'camera');
  const current = feedback?.challenge ?? challenges[0]!;
  const progress = feedback?.progress ?? 0;
  const active = status === 'tracking' || status === 'capturing';
  const hint = feedback?.hint ?? 'center-face';
  const instruction = status === 'capturing' ? face.recordVideo === false ? s.capturing : s.finishingVideo : s[hint] ?? s[current];
  const direction = feedback?.guideDirection ?? 'center';
  const distance = direction === 'closer' || direction === 'further' ? direction : 'normal';
  const mirrored = face.camera?.facingMode !== 'environment' && !(typeof face.camera?.facingMode === 'object' && 'exact' in face.camera.facingMode && face.camera.facingMode.exact === 'environment');

  return <div ref={screenRef} className="kyc-screen kyc-face-screen">
    <div className="kyc-screen-heading"><h2>{s.faceTitle}</h2><p className="kyc-description">{s.faceBody}</p></div>
    <div className="kyc-face-body"><div className="kyc-camera-space"><div className={`kyc-camera-stage ${active ? 'is-active' : ''} ${status === 'idle' ? 'is-idle' : ''} ${simulation ? 'is-simulation' : ''}`}>
      <video ref={videoRef} autoPlay muted playsInline className={`kyc-video ${mirrored ? 'is-mirrored' : ''}`} aria-label={s.secureCapture} />
      <div className={`kyc-face-guide ${feedback?.matched ? 'is-matched' : ''}`} data-direction={direction} data-distance={distance} aria-hidden="true">
        <svg className="kyc-guide-svg" viewBox="0 0 280 280" preserveAspectRatio="none">
          <circle className="kyc-guide-dots" cx="140" cy="140" r="132" pathLength="64" />
          <circle className="kyc-guide-track" cx="140" cy="140" r="119" />
          <circle className="kyc-guide-progress" cx="140" cy="140" r="119" strokeDasharray="748" strokeDashoffset={748 * (1 - progress)} transform="rotate(-90 140 140)" />
          <path className="kyc-sector kyc-sector-left" d="M46 70a119 119 0 0 0 0 140" />
          <path className="kyc-sector kyc-sector-right" d="M234 70a119 119 0 0 1 0 140" />
          <path className="kyc-sector kyc-sector-up" d="M70 46a119 119 0 0 1 140 0" />
          <path className="kyc-sector kyc-sector-down" d="M70 234a119 119 0 0 0 140 0" />
        </svg>
        {active ? <span className="kyc-direction-label">{direction === 'closer' ? '+' : direction === 'further' ? '−' : direction === 'turn-left' ? '←' : direction === 'turn-right' ? '→' : direction === 'look-up' ? '↑' : direction === 'look-down' ? '↓' : ''}</span> : null}
      </div>
      {status === 'idle' ? <div className="kyc-camera-placeholder"><Illustration kind="selfie" /></div> : null}
      {status === 'requesting' || status === 'loading' ? <div className="kyc-camera-loading"><span className="kyc-spinner" /><p role="status">{s[status]}</p></div> : null}
    </div></div>
    <p className={`kyc-current-instruction ${active ? 'is-active' : ''}`} role={active ? 'status' : undefined}>{active ? instruction : '\u00a0'}</p>
    <div className={`kyc-challenge-progress ${active ? 'is-active' : ''}`}>
      <ol className="kyc-challenge-list" aria-label={s.challengeList}>{challenges.map((challenge, index) => <li key={`${challenge}-${index}`} className={index < (feedback?.index ?? 0) ? 'is-done' : active && index === (feedback?.index ?? 0) ? 'is-current' : ''} aria-current={active && index === (feedback?.index ?? 0) ? 'step' : undefined}><span aria-hidden="true">{index < (feedback?.index ?? 0) ? <Icon name="check" size={10} /> : null}</span><span className="kyc-visually-hidden">{s[challenge]}</span></li>)}</ol>
    </div>
    {active ? <div className="kyc-visually-hidden" role="progressbar" aria-label={s.faceProgress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} /> : null}</div>
    <div className="kyc-actions">
      {status === 'idle' && face.autoStart === false ? <button type="button" className="kyc-button kyc-button-primary" onClick={() => void start()}>{simulation ? s.simulationStart : s.startCamera}</button> : active ? <span className="kyc-auto-capture-note">{face.recordVideo === false ? s.automaticCapture : status === 'capturing' ? s.finishingVideo : s.recordingVideo}</span> : null}
    </div>
  </div>;
}
