import { useEffect, useState } from 'react';
import { defineGlyph } from '../icons.js';
import type { KycIconGlyph } from '../icons.js';
import type { HandoffOptions } from '../types.js';

/** Throws for a handoff option the QR code cannot carry. */
export function validateHandoffOptions(handoff: HandoffOptions | undefined): void {
  if (handoff === undefined) return;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) throw new Error('handoff must be an options object.');
  let url: URL;
  try { url = new URL(handoff.url); } catch { throw new Error('handoff.url must be an absolute http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || handoff.url.length > 2048) throw new Error('handoff.url must be an absolute http(s) URL of at most 2048 characters.');
  if (handoff.show !== undefined && !['desktop', 'always'].includes(handoff.show)) throw new Error('handoff.show must be "desktop" or "always".');
}

/** Touch screens already hold the camera the flow needs; desktops get the phone option. */
export function prefersHandoff(show: HandoffOptions['show'] = 'desktop'): boolean {
  if (show === 'always') return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(any-pointer: coarse)').matches && (navigator.maxTouchPoints ?? 0) === 0;
}

type Modules = { size: number; data: boolean[][] };

/**
 * The panel variant draws theme-coloured modules on a primary tile and can clear the centre for the brand mark;
 * it then encodes with high error correction, so the covered modules are recovered.
 */
export function HandoffQr({ url, label, panel = false, mark }: { url: string; label: string; panel?: boolean; mark?: KycIconGlyph }) {
  const [code, setCode] = useState<Modules | null>(null);
  const withMark = panel && mark !== undefined;
  useEffect(() => {
    let current = true;
    // The encoder loads only when a flow offers the handoff.
    void import('uqr').then(({ encode }) => { if (current) setCode(encode(url, { ecc: withMark ? 'H' : 'M', border: panel ? 1 : 2 })); }, () => {});
    return () => { current = false; };
  }, [url, panel, withMark]);
  if (!code) return <div className={`kyc-handoff-qr is-loading ${panel ? 'is-panel' : ''}`} role="img" aria-label={label} />;
  // About a fifth of the width, well inside what high error correction restores.
  const hole = withMark ? Math.round(code.size * 0.22) | 1 : 0, start = (code.size - hole) / 2;
  let path = '';
  code.data.forEach((row, y) => row.forEach((dark, x) => {
    if (dark && !(hole && x >= start && x < start + hole && y >= start && y < start + hole)) path += `M${x} ${y}h1v1h-1z`;
  }));
  if (panel) return <div className="kyc-handoff-qr is-panel"><svg role="img" aria-label={label} viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges">
    <path d={path} className="kyc-handoff-modules" />
    {hole ? <g transform={`translate(${start} ${start}) scale(${hole / 24})`} shapeRendering="geometricPrecision">
      <rect width="24" height="24" rx="6.5" className="kyc-handoff-modules" />
      {defineGlyph('Theme brand mark', mark!).map(({ d, paint, opacity }, index) => <path key={index} d={d} opacity={opacity === 1 ? undefined : opacity} className={paint === 'stroke' ? 'kyc-handoff-mark' : 'kyc-handoff-mark-fill'} />)}
    </g> : null}
  </svg></div>;
  return <svg className="kyc-handoff-qr" role="img" aria-label={label} viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges"><rect width={code.size} height={code.size} fill="#fff" /><path d={path} fill="#000" /></svg>;
}
