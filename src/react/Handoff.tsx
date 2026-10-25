import { useEffect, useState } from 'react';
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

export function HandoffQr({ url, label }: { url: string; label: string }) {
  const [code, setCode] = useState<Modules | null>(null);
  useEffect(() => {
    let current = true;
    // The encoder loads only when a flow offers the handoff.
    void import('uqr').then(({ encode }) => { if (current) setCode(encode(url, { ecc: 'M', border: 2 })); }, () => {});
    return () => { current = false; };
  }, [url]);
  if (!code) return <div className="kyc-handoff-qr is-loading" role="img" aria-label={label} />;
  let path = '';
  code.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z`; }));
  return <svg className="kyc-handoff-qr" role="img" aria-label={label} viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges"><rect width={code.size} height={code.size} fill="#fff" /><path d={path} fill="#000" /></svg>;
}
