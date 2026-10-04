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
  const showDirection = active && ['turn-left', 'turn-right', 'look-up', 'look-down'].includes(direction);
  const turning = direction === 'turn-left' || direction === 'turn-right';
  const mirrored = face.camera?.facingMode !== 'environment' && !(typeof face.camera?.facingMode === 'object' && 'exact' in face.camera.facingMode && face.camera.facingMode.exact === 'environment');

  return <div ref={screenRef} className="kyc-screen kyc-face-screen">
    <div className="kyc-screen-heading"><h2>{s.faceTitle}</h2><p className="kyc-description">{s.faceBody}</p></div>
    <div className="kyc-face-body"><div className="kyc-camera-space"><div className={`kyc-camera-stage ${active ? 'is-active' : ''} ${status === 'idle' ? 'is-idle' : ''} ${simulation ? 'is-simulation' : ''}`} data-direction={direction} data-distance={distance}>
      <div className="kyc-camera-aperture">
        <video ref={videoRef} autoPlay muted playsInline className={`kyc-video ${mirrored ? 'is-mirrored' : ''}`} aria-label={s.secureCapture} />
        {status === 'requesting' || status === 'loading' ? <div className="kyc-camera-loading"><span className="kyc-spinner" /><p role="status">{s[status]}</p></div> : null}
      </div>
      <div className={`kyc-face-guide ${feedback?.matched ? 'is-matched' : ''}`} data-direction={direction} data-distance={distance} aria-hidden="true">
        <svg className="kyc-guide-svg" viewBox="0 0 280 280" preserveAspectRatio="none">
          <circle className="kyc-guide-track" cx="140" cy="140" r="138" />
          <circle className="kyc-guide-dots" cx="140" cy="140" r="138" pathLength="64" />
          <circle className="kyc-guide-progress" cx="140" cy="140" r="138" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - progress)} transform="rotate(-90 140 140)" />
        </svg>
        {showDirection ? <span className="kyc-direction-arrow" data-direction={direction}>
          {turning ? <svg viewBox="0 0 48 44" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M40 30C32 16 18 15 7 25M7 14v11h11" /></svg> : <Icon name="arrow" size={32} />}
        </span> : null}
      </div>
      {status === 'idle' ? <div className="kyc-camera-placeholder"><Illustration kind="selfie" /></div> : null}
    </div></div>
    <p className={`kyc-current-instruction ${active ? 'is-active' : ''}`} role={active ? 'status' : undefined}>{active ? instruction : '\u00a0'}</p>
    {active ? <div className="kyc-visually-hidden" role="progressbar" aria-label={s.faceProgress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} /> : null}</div>
    <div className="kyc-actions">
      {status === 'idle' && face.autoStart === false ? <button type="button" className="kyc-button kyc-button-primary" onClick={() => void start()}>{simulation ? s.simulationStart : s.startCamera}</button> : active ? <span className="kyc-auto-capture-note">{face.recordVideo === false ? s.automaticCapture : status === 'capturing' ? s.finishingVideo : s.recordingVideo}</span> : null}
    </div>
  </div>;
}
