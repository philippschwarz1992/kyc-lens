export type IllustrationKind = 'identity' | 'document-front' | 'document-back' | 'license-front' | 'license-back' | 'passport' | 'selfie';

export function Illustration({ kind, className }: { kind: IllustrationKind; className?: string }) {
  const brackets = <path d="M40 104V86a16 16 0 0 1 16-16h18M246 70h18a16 16 0 0 1 16 16v18M280 216v18a16 16 0 0 1-16 16h-18M74 250H56a16 16 0 0 1-16-16v-18" stroke="currentColor" strokeWidth="6" />;
  const card = <rect x="72" y="100" width="176" height="120" rx="14" className="kyc-illustration-paper" fill="white" stroke="currentColor" strokeWidth="5" />;
  const portrait = <><circle cx="112" cy="146" r="14" stroke="currentColor" strokeWidth="4" /><path d="M90 190c3-14 12-21 22-21s19 7 22 21" stroke="currentColor" strokeWidth="4" /></>;
  const mrz = (y: number) => <path d={`M94 ${y}h132M94 ${y + 16}h132`} stroke="currentColor" strokeWidth="4" strokeDasharray="5 7" opacity=".85" />;
  // Two-step pager under the card: the filled pill marks the side being photographed.
  const pager = (step: 1 | 2) => <><rect x="132" y="270" width="26" height="8" rx="4" fill="currentColor" opacity={step === 1 ? 1 : 0.25} /><rect x="164" y="270" width="26" height="8" rx="4" fill="currentColor" opacity={step === 2 ? 1 : 0.25} /></>;
  const idFront = <>{card}{portrait}<path d="M152 140h66M152 160h48M152 180h34" stroke="currentColor" strokeWidth="4" opacity=".55" /></>;
  const art = {
    identity: <>
      {brackets}{idFront}
      <rect x="52" y="150" width="216" height="22" fill="currentColor" opacity=".12" /><path d="M52 161h216" stroke="currentColor" strokeWidth="3" />
      <circle cx="160" cy="262" r="24" fill="currentColor" /><rect x="149" y="260" width="22" height="16" rx="4" className="kyc-illustration-on-tint" stroke="white" strokeWidth="4" /><path d="M153 260v-5a7 7 0 0 1 14 0v5" className="kyc-illustration-on-tint" stroke="white" strokeWidth="4" />
    </>,
    'document-front': <>{brackets}{idFront}{pager(1)}</>,
    'document-back': <>
      {brackets}{card}
      <path d="M94 126h74M94 144h50" stroke="currentColor" strokeWidth="4" opacity=".55" /><rect x="192" y="118" width="34" height="28" rx="6" stroke="currentColor" strokeWidth="4" />
      {mrz(172)}<path d="M94 204h132" stroke="currentColor" strokeWidth="4" strokeDasharray="5 7" opacity=".85" />
      {pager(2)}
    </>,
    'license-front': <>
      {brackets}{card}{portrait}
      <path d="M152 136h66M152 154h48" stroke="currentColor" strokeWidth="4" opacity=".55" />
      <path d="M180 202v-9l7-11h30l7 11v9z" stroke="currentColor" strokeWidth="4" /><path d="M180 193h44" stroke="currentColor" strokeWidth="3" opacity=".55" />
      {pager(1)}
    </>,
    'license-back': <>
      {brackets}{card}
      <rect x="94" y="116" width="132" height="66" rx="5" stroke="currentColor" strokeWidth="4" /><path d="M94 138h132M94 160h132M130 116v66" stroke="currentColor" strokeWidth="3" opacity=".55" />
      <path d="M94 200h88" stroke="currentColor" strokeWidth="4" opacity=".55" />
      {pager(2)}
    </>,
    passport: <>
      {brackets}
      <rect x="80" y="84" width="160" height="30" rx="10" className="kyc-illustration-paper" fill="white" stroke="currentColor" strokeWidth="4" opacity=".55" />
      {card}
      <rect x="90" y="118" width="42" height="54" rx="6" stroke="currentColor" strokeWidth="4" /><circle cx="111" cy="137" r="8" stroke="currentColor" strokeWidth="3.5" /><path d="M99 166c2-9 7-13 12-13s10 4 12 13" stroke="currentColor" strokeWidth="3.5" />
      <path d="M148 128h70M148 146h52M148 164h62" stroke="currentColor" strokeWidth="4" opacity=".55" />
      {mrz(188)}
    </>,
    selfie: <>
      <circle cx="160" cy="160" r="112" stroke="currentColor" strokeWidth="10" strokeDasharray="2 12" opacity=".3" />
      <circle cx="160" cy="160" r="112" stroke="currentColor" strokeWidth="6" strokeDasharray="250 704" transform="rotate(-90 160 160)" />
      <path d="M98 250c10-28 34-42 62-42s52 14 62 42" stroke="currentColor" strokeWidth="5" />
      <ellipse cx="160" cy="146" rx="46" ry="56" className="kyc-illustration-paper" fill="white" stroke="currentColor" strokeWidth="5" />
      <path d="M142 138v8M178 138v8M145 168c8 8 22 8 30 0" stroke="currentColor" strokeWidth="5" />
    </>,
  };
  return <svg className={`kyc-illustration ${className ?? ''}`} viewBox="0 0 320 320" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{art[kind]}</svg>;
}
