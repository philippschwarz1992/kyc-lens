import { useId } from 'react';

export function Illustration({ kind, className }: { kind: 'identity' | 'document-front' | 'document-back' | 'selfie'; className?: string }) {
  const id = useId().replace(/:/g, '');
  const fill = `url(#${id}-fill)`;
  const glow = `url(#${id}-glow)`;
  const shadow = `url(#${id}-shadow)`;
  const portrait = <><circle cx="99" cy="145" r="17" fill={fill} /><path d="M70 193c0-22 13-33 29-33s29 11 29 33" fill={fill} opacity=".55" /></>;
  const card = <g filter={shadow}><rect x="48" y="108" width="224" height="140" rx="18" fill="white" stroke="currentColor" strokeOpacity=".12" strokeWidth="2" />{portrait}<path d="M155 147h73m-73 20h59m-59 20h38" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".65" /><path d="M71 226h178" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".12" /></g>;
  return <svg className={`kyc-illustration ${className ?? ''}`} viewBox="0 0 320 320" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".32" /></linearGradient>
      <radialGradient id={`${id}-glow`}><stop stopColor="currentColor" stopOpacity=".14" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient>
      <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="currentColor" floodOpacity=".16" /></filter>
    </defs>
    <circle cx="160" cy="165" r="148" fill={glow} />
    {kind === 'identity' ? <>
      <g transform="rotate(-10 127 149)" filter={shadow}><rect x="67" y="53" width="134" height="208" rx="16" fill="white" stroke="currentColor" strokeOpacity=".15" strokeWidth="2" /><rect x="75" y="61" width="118" height="192" rx="10" fill={fill} /><circle cx="134" cy="139" r="34" stroke="white" strokeWidth="2.5" /><ellipse cx="134" cy="139" rx="15" ry="34" stroke="white" strokeWidth="2.5" /><path d="M103 126h62m-62 26h62m-31-47v68" stroke="white" strokeWidth="2.5" /><path d="M106 206h56" stroke="white" strokeWidth="3" strokeLinecap="round" opacity=".8" /></g>
      <g transform="translate(63 3) rotate(9 160 185) scale(.75)">{card}</g>
      <circle cx="223" cy="78" r="25" fill="currentColor" /><path d="m212 78 7 7 15-16" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </> : kind === 'selfie' ? <g transform="rotate(-5 160 160)" filter={shadow}>
      <rect x="91" y="34" width="138" height="252" rx="25" fill="white" stroke="currentColor" strokeWidth="7" />
      <path d="M139 49h42" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".3" />
      <circle cx="160" cy="132" r="36" fill={fill} /><path d="M110 234c0-40 23-63 50-63s50 23 50 63v22H110z" fill={fill} opacity=".4" />
      <path d="M150 122v4m20-4v4m-29 11c4 20 34 20 38 0" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M124 266h72" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".15" />
    </g> : <>
      <g transform={kind === 'document-back' ? 'rotate(7 160 180)' : 'rotate(-5 160 180)'}>{kind === 'document-back' ? <g filter={shadow}><rect x="48" y="108" width="224" height="140" rx="18" fill="white" stroke="currentColor" strokeOpacity=".12" strokeWidth="2" /><path d="M71 139h95m-95 17h161m-161 17h142" stroke="currentColor" strokeOpacity=".35" strokeWidth="4" strokeLinecap="round" /><path d="M73 204v22m7-22v22m5-22v22m8-22v22m5-22v22m7-22v22m9-22v22m4-22v22m8-22v22m8-22v22m5-22v22m8-22v22m8-22v22m4-22v22m8-22v22m9-22v22m4-22v22m8-22v22m8-22v22m4-22v22m9-22v22m7-22v22m5-22v22" stroke="currentColor" strokeWidth="2" strokeOpacity=".55" /></g> : card}</g>
      {kind === 'document-back' ? <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><path d="M57 187c-25 10-30 25-10 39 31 21 191 26 230 2 20-12 15-27-14-38" /><path d="m276 173-20 17 20 13" /></g> : <g stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".8"><path d="M39 101V85h20m202 0h20v16m0 142v18h-20M59 261H39v-18" /></g>}
    </>}
  </svg>;
}
