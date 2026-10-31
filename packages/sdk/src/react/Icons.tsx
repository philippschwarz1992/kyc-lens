import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { KycIconName, KycResolvedIconPack } from '../icons.js';

/** The theme's icon pack. KycFlow provides it; without a provider every icon uses the built-in drawing. */
export const IconPackContext = createContext<KycResolvedIconPack | undefined>(undefined);

export function Icon({ name, size = 20, className, style }: { name: KycIconName; size?: number; className?: string; style?: CSSProperties }) {
  const pack = useContext(IconPackContext);
  const glyph = pack?.icons[name];
  if (glyph) return <svg width={size} height={size} viewBox={`0 0 ${pack.grid} ${pack.grid}`} fill="none" stroke="currentColor" strokeWidth={pack.strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
    {glyph.map(({ d, paint, opacity }, index) => <path key={index} d={d} opacity={opacity === 1 ? undefined : opacity} {...paint === 'stroke' ? {} : { stroke: 'none', fill: 'currentColor', style: paint === 'tint' ? { fill: 'var(--kyc-color-illustration)' } : undefined }} />)}
  </svg>;
  // Partial, so names added to iconNames before a built-in drawing exists still type-check.
  const paths: Partial<Record<KycIconName, ReactNode>> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    back: <path d="m15 5-7 7 7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    camera: <><path d="M4 6h4l2-2h4l2 2h4v14H4z" /><circle cx="12" cy="13" r="4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    face: <><path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4" /><path d="M8 9h.01M16 9h.01M8 14c1 3 7 3 8 0" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" /></>,
    switchCamera: <><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><path d="M8.5 12a3.5 3.5 0 0 1 6-2.4M15.5 12a3.5 3.5 0 0 1-6 2.4" /><path d="M14.8 7.6v2h-2M9.2 16.4v-2h2" /></>,
    flash: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
    idCard: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><circle cx="8.5" cy="10.5" r="2" /><path d="M5.8 15.5c.5-1.6 1.5-2.3 2.7-2.3s2.2.7 2.7 2.3M14 10h4M14 13.5h3" /></>,
    license: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><circle cx="8.5" cy="10.5" r="2" /><path d="M5.8 15.5c.5-1.6 1.5-2.3 2.7-2.3s2.2.7 2.7 2.3M14 9.5h4" /><path d="M13.5 15.5v-1.8l1-1.7h3l1 1.7v1.8z" /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>,
    passport: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10.5" r="3.2" /><path d="M8.8 10.5h6.4M12 7.3c-1 .9-1.5 2-1.5 3.2s.5 2.3 1.5 3.2c1-.9 1.5-2 1.5-3.2s-.5-2.3-1.5-3.2M9 17h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
