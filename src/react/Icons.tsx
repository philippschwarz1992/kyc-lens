import type { CSSProperties } from 'react';

export function Icon({ name, size = 20, className, style }: { name: 'arrow' | 'check' | 'camera' | 'sun' | 'face' | 'shield' | 'refresh' | 'close' | 'upload'; size?: number; className?: string; style?: CSSProperties }) {
  const paths = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    camera: <><path d="M4 6h4l2-2h4l2 2h4v14H4z" /><circle cx="12" cy="13" r="4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    face: <><path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4" /><path d="M8 9h.01M16 9h.01M8 14c1 3 7 3 8 0" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
