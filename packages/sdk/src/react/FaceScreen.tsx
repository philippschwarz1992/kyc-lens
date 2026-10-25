import { useEffect, useRef, useState } from 'react';
import type { AssetOptions, CapturePayload, FaceChallenge, FaceOptions, OutputOptions } from '../types.js';
import { Icon } from './Icons.js';
import { Illustration } from './Illustrations.js';
import { useFaceCapture } from './useFaceCapture.js';
import { useScreenTransition } from './useScreenTransition.js';

const TICK_COUNT = 72;
// Radial ticks just outside the aperture edge (rx 138, ry 172.5 in the 280 x 350 guide box), clockwise from the top.
const TICKS = Array.from({ length: TICK_COUNT }, (_, index) => {
  const angle = -Math.PI / 2 + index / TICK_COUNT * Math.PI * 2;
  const x = 140 + 138 * Math.cos(angle), y = 175 + 172.5 * Math.sin(angle);
  const normalX = Math.cos(angle) / 138, normalY = Math.sin(angle) / 172.5, length = Math.hypot(normalX, normalY);
  const point = (offset: number) => `${(x + normalX / length * offset).toFixed(2)} ${(y + normalY / length * offset).toFixed(2)}`;
  return `M${point(8)}L${point(17)}`;
});

export function FaceScreen({ face, assets, challenges, simulation, output, strings: s, onCapture, onFailure }: {
  face: FaceOptions; assets: AssetOptions; challenges: readonly FaceChallenge[]; simulation: boolean; output?: OutputOptions;
  strings: Record<string, string>; onCapture: (capture: CapturePayload) => void; onFailure: (error: Error) => void;
}) {
  const { videoRef, status, feedback, start, needsTap } = useFaceCapture({ options: face, assets, challenges, simulation, output, onCapture, onFailure });
  const screenRef = useRef<HTMLDivElement>(null);
  useScreenTransition(screenRef, status === 'idle' ? 'prepare' : 'camera');
  const current = feedback?.challenge ?? challenges[0]!;
  const progress = feedback?.progress ?? 0;
  const active = status === 'tracking' || status === 'capturing';
  const hint = feedback?.hint ?? 'center-face';
  const instruction = status === 'capturing' ? face.recordVideo === false ? s.capturing : s.finishingVideo : s[hint] ?? s[current];
  // Hints can change several times per second; announce only a hint that stayed stable.
  const spoken = active ? instruction ?? '' : '';
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!spoken) { setAnnouncement(''); return; }
    const timer = setTimeout(() => setAnnouncement(spoken), 700);
    return () => clearTimeout(timer);
  }, [spoken]);
  const direction = feedback?.guideDirection ?? 'center';
  const distance = direction === 'closer' || direction === 'further' ? direction : 'normal';
  const showDirection = active && ['turn-left', 'turn-right', 'look-up', 'look-down'].includes(direction);
  const turning = direction === 'turn-left' || direction === 'turn-right';
  const mirrored = face.camera?.facingMode !== 'environment' && !(typeof face.camera?.facingMode === 'object' && 'exact' in face.camera.facingMode && face.camera.facingMode.exact === 'environment');
  const complete = status === 'capturing';
  const litTicks = complete ? TICK_COUNT : Math.round(progress * TICK_COUNT);
  // The blurred backdrop repeats the preview stream. Only the aperture video is measured by the tracker.
  const backdropRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current, backdrop = backdropRef.current;
    if (!video || !backdrop) return;
    const sync = () => {
      if (backdrop.srcObject !== video.srcObject) backdrop.srcObject = video.srcObject;
      if (backdrop.srcObject && backdrop.paused) void backdrop.play().catch(() => undefined);
    };
    sync();
    video.addEventListener('playing', sync);
    video.addEventListener('emptied', sync);
    return () => { video.removeEventListener('playing', sync); video.removeEventListener('emptied', sync); };
  }, [status, videoRef]);

  return <div ref={screenRef} className="kyc-screen kyc-face-screen">
    <div className="kyc-screen-heading"><h2>{s.faceTitle}</h2><p className="kyc-description">{s.faceBody}</p></div>
    <div className={`kyc-face-body ${status === 'idle' ? '' : 'is-live'}`}><div className="kyc-camera-space"><div className={`kyc-camera-stage ${active ? 'is-active' : ''} ${status === 'idle' ? 'is-idle' : ''} ${simulation ? 'is-simulation' : ''}`} data-direction={direction} data-distance={distance}>
      <div className="kyc-camera-aperture">
        <video ref={videoRef} autoPlay muted playsInline className={`kyc-video ${mirrored ? 'is-mirrored' : ''}`} aria-label={s.secureCapture} />
        {status === 'requesting' || status === 'loading' ? <div className="kyc-camera-loading"><span className="kyc-spinner" /><p role="status">{needsTap ? s.tapToStartCamera : s[status]}</p></div> : null}
      </div>
      <div className={`kyc-face-guide ${feedback?.matched ? 'is-matched' : ''} ${complete ? 'is-complete' : ''}`} data-direction={direction} data-distance={distance} aria-hidden="true">
        <svg className="kyc-guide-svg" viewBox="0 0 280 350">
          <ellipse className="kyc-guide-track" cx="140" cy="175" rx="138" ry="172.5" />
          <g className="kyc-guide-ticks">{TICKS.map((path, index) => <path key={index} d={path} className={index < litTicks ? 'is-lit' : undefined} />)}</g>
        </svg>
        {showDirection ? <span className="kyc-direction-arrow" data-direction={direction}>
          {turning ? <svg viewBox="0 0 48 44" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M40 30C32 16 18 15 7 25M7 14v11h11" /></svg> : <Icon name="arrow" size={32} />}
        </span> : null}
      </div>
      {status === 'idle' ? <div className="kyc-camera-placeholder"><Illustration kind="selfie" /></div> : null}
    </div></div>
    <p className={`kyc-current-instruction ${active ? 'is-active' : ''}`} aria-hidden={active ? undefined : true}>{active ? <span>{instruction}</span> : '\u00a0'}</p>
    <video ref={backdropRef} autoPlay muted playsInline tabIndex={-1} className={`kyc-face-backdrop ${mirrored ? 'is-mirrored' : ''}`} aria-hidden="true" />
    <p className="kyc-visually-hidden kyc-instruction-announcement" role="status">{announcement}</p>
    {active ? <div className="kyc-visually-hidden" role="progressbar" aria-label={s.faceProgress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} /> : null}</div>
    <div className="kyc-actions">
      {status === 'idle' && face.autoStart === false ? <button type="button" className="kyc-button kyc-button-primary" onClick={() => void start()}>{simulation ? s.simulationStart : s.startCamera}</button> : active && (face.recordVideo === false || status === 'capturing') ? <span className="kyc-auto-capture-note">{face.recordVideo === false ? s.automaticCapture : s.finishingVideo}</span> : null}
    </div>
  </div>;
}
