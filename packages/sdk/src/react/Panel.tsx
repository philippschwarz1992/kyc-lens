import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { defineGlyph } from '../icons.js';
import type { KycIconName } from '../icons.js';
import type { KycThemeBrand } from '../themes.js';
import { Icon } from './Icons.js';

/** The `panel` layout: screens render their panel markup, and the header can show a back control. */
export interface PanelLayout { panel: boolean; setBack: (back: (() => void) | null) => void }
export const LayoutContext = createContext<PanelLayout>({ panel: false, setBack: () => {} });
export const usePanel = () => useContext(LayoutContext).panel;

/** Shows a back control in the panel header while `back` is set. The latest handler is the one called. */
export function usePanelBack(back: (() => void) | null): void {
  const { panel, setBack } = useContext(LayoutContext);
  const latest = useRef(back);
  latest.current = back;
  const shown = panel && back !== null;
  useEffect(() => {
    if (!shown) return;
    setBack(() => latest.current?.());
    return () => setBack(null);
  }, [shown, setBack]);
}

export type StatusTone = 'accent' | 'danger';

export function PanelHeader({ brand, status, tone, back, backLabel }: { brand?: KycThemeBrand; status?: string; tone: StatusTone; back: (() => void) | null; backLabel: string }) {
  return <header className="kyc-panel-header">
    <span className="kyc-panel-header-start">
      {back ? <button type="button" className="kyc-panel-back" aria-label={backLabel} onClick={back}><Icon name="back" size={20} /></button> : null}
      {brand ? <span className="kyc-panel-brand">{brand.mark ? <BrandMark mark={brand.mark} /> : null}<span>{brand.name}</span></span> : null}
    </span>
    {status ? <span className="kyc-panel-status" data-tone={tone}><span aria-hidden="true" />{status}</span> : null}
  </header>;
}

function BrandMark({ mark }: { mark: NonNullable<KycThemeBrand['mark']> }) {
  const paths = defineGlyph('Theme brand mark', mark);
  return <svg className="kyc-panel-mark" width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect width="24" height="24" rx="7.8" className="kyc-panel-mark-tile" />
    {paths.map(({ d, paint, opacity }, index) => <path key={index} d={d} opacity={opacity === 1 ? undefined : opacity} className={paint === 'stroke' ? 'kyc-panel-mark-stroke' : 'kyc-panel-mark-fill'} />)}
  </svg>;
}

/** A rounded hero panel. With a corner icon, its top-right corner is cut out around a round badge. */
export function Hero({ children, corner, tone = 'plain', label, className }: { children: ReactNode; corner?: KycIconName; tone?: 'plain' | 'accent'; label?: string; className?: string }) {
  return <section className={`kyc-hero ${className ?? ''}`} data-tone={tone} aria-label={label} aria-hidden={label ? undefined : true}>
    {corner ? <><span className="kyc-hero-notch" aria-hidden="true" /><span className="kyc-hero-corner" aria-hidden="true"><Icon name={corner} size={20} /></span></> : null}
    {children}
  </section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="kyc-eyebrow">{children}</p>;
}

export function TileList({ label, items }: { label?: string; items: { icon: KycIconName; title: string; body?: string }[] }) {
  return <ul className="kyc-tile-list" aria-label={label}>{items.map(item => <li key={item.title}>
    <span className="kyc-tile" aria-hidden="true"><Icon name={item.icon} size={20} /></span>
    <span className="kyc-tile-text"><strong>{item.title}</strong>{item.body ? <span>{item.body}</span> : null}</span>
  </li>)}</ul>;
}

export type CheckRow = { id: string; label: string; state: 'done' | 'active' | 'pending'; note?: string };

export function CheckList({ rows }: { rows: CheckRow[] }) {
  return <ul className="kyc-check-list">{rows.map(row => <li key={row.id} data-state={row.state}>
    <span className="kyc-check-mark" aria-hidden="true">{row.state === 'done' ? <Icon name="check" size={14} /> : row.state === 'active'
      ? <svg className="kyc-check-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" strokeWidth="2" /><path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" strokeWidth="2" strokeLinecap="round" /></svg> : null}</span>
    <span className="kyc-check-label">{row.label}</span>
    {row.note ? <span className="kyc-check-note">{row.note}</span> : null}
  </li>)}</ul>;
}

export type PanelArtKind = 'identity' | 'selfie' | 'document';

/** The panel illustrations, coloured from the theme: tinted fills, paper cards and accent strokes. */
export function PanelArt({ kind }: { kind: PanelArtKind }) {
  if (kind === 'selfie') return <svg className="kyc-art kyc-art-selfie" width="200" height="200" viewBox="0 0 200 200" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="100" cy="100" r="84" className="kyc-art-well" />
    <circle cx="100" cy="100" r="92" stroke="currentColor" strokeWidth="5" strokeDasharray="2 11" opacity=".3" />
    <circle cx="100" cy="100" r="92" stroke="currentColor" strokeWidth="5" strokeDasharray="180 600" transform="rotate(-90 100 100)" />
    <path d="M56 166c8-22 25-33 44-33s36 11 44 33" stroke="currentColor" strokeWidth="3" />
    <ellipse cx="100" cy="88" rx="32" ry="39" className="kyc-art-tint" stroke="currentColor" strokeWidth="3" />
    <path d="M88 82v6M112 82v6M89 103c6 6 16 6 22 0" stroke="currentColor" strokeWidth="3" />
  </svg>;
  if (kind === 'document') return <svg className="kyc-art kyc-art-document" width="240" height="140" viewBox="0 0 240 140" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 38V28a12 12 0 0 1 12-12h12M198 16h12a12 12 0 0 1 12 12v10M222 102v10a12 12 0 0 1-12 12h-12M42 124H30a12 12 0 0 1-12-12v-10" stroke="currentColor" strokeWidth="4" />
    <rect x="42" y="26" width="156" height="88" rx="12" className="kyc-art-paper" strokeWidth="1.5" />
    <rect x="56" y="40" width="40" height="48" rx="8" className="kyc-art-tint" />
    <circle cx="76" cy="57" r="8" stroke="currentColor" strokeWidth="2.4" />
    <path d="M64 83c3-8 7-11 12-11s9 3 12 11" stroke="currentColor" strokeWidth="2.4" />
    <path d="M110 48h70M110 62h48M110 76h58" className="kyc-art-text" strokeWidth="4" />
    <path d="M56 102h128" className="kyc-art-dash" strokeWidth="3" strokeDasharray="4 6" />
  </svg>;
  return <svg className="kyc-art kyc-art-identity" width="300" height="160" viewBox="0 0 300 160" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="18" y="20" width="182" height="120" rx="14" className="kyc-art-paper" strokeWidth="1.5" />
    <rect x="36" y="40" width="46" height="56" rx="9" className="kyc-art-tint" />
    <circle cx="59" cy="60" r="9" stroke="currentColor" strokeWidth="2.5" />
    <path d="M45 90c3-9 8-13 14-13s11 4 14 13" stroke="currentColor" strokeWidth="2.5" />
    <path d="M98 50h76M98 66h54M98 82h64" className="kyc-art-text" strokeWidth="4" />
    <path d="M36 116h146M36 128h112" className="kyc-art-dash" strokeWidth="3" strokeDasharray="4 6" />
    <rect x="10" y="68" width="198" height="22" fill="currentColor" opacity=".08" />
    <path d="M10 79h198" stroke="currentColor" strokeWidth="2" />
    <circle cx="232" cy="92" r="54" className="kyc-art-well" />
    <circle cx="232" cy="92" r="60" stroke="currentColor" strokeWidth="4" strokeDasharray="2 9" opacity=".3" />
    <circle cx="232" cy="92" r="60" stroke="currentColor" strokeWidth="4" strokeDasharray="120 400" transform="rotate(-90 232 92)" />
    <path d="M203 140c5-14 16-21 29-21s24 7 29 21" stroke="currentColor" strokeWidth="2.5" />
    <ellipse cx="232" cy="85" rx="21" ry="26" className="kyc-art-tint" stroke="currentColor" strokeWidth="2.5" />
    <path d="M224 81v4M240 81v4M225 95c4 4 10 4 14 0" stroke="currentColor" strokeWidth="2.5" />
  </svg>;
}

export type DocumentPhotoKind = 'id-front' | 'id-back' | 'license-front' | 'license-back' | 'passport';

/** Which stand-in photo shows a document type's side. Passports have only the photo page. */
export function documentPhotoKind(type: 'id-card' | 'drivers-license' | 'passport', side: 'front' | 'back'): DocumentPhotoKind {
  return type === 'passport' ? 'passport' : type === 'drivers-license' ? `license-${side}` : `id-${side}`;
}

const portrait = (x: number, y: number, width: number, height: number, cx: number, cy: number, r: number, body: string) => <>
  <rect x={x} y={y} width={width} height={height} rx="8" fill="#a4a89c" /><circle cx={cx} cy={cy} r={r} fill="#868a7e" /><path d={body} fill="#868a7e" />
</>;
const bar = (x: number, y: number, width: number, fill = '#a4a89c', height = 8) => <rect x={x} y={y} width={width} height={height} rx={height / 2} fill={fill} />;

/** A neutral stand-in photo of a document side, for the simulation, the screen before the camera opens and previews. */
export function DocumentPhoto({ kind, className }: { kind: DocumentPhotoKind; className?: string }) {
  const art: Record<DocumentPhotoKind, ReactNode> = {
    'id-front': <>
      <rect width="318" height="34" rx="14" fill="#babdb2" /><rect y="20" width="318" height="14" fill="#babdb2" />
      {bar(18, 10, 96, '#9a9e92', 12)}
      {portrait(18, 48, 78, 100, 57, 86, 17, 'M28 148c4-22 15-32 29-32s25 10 29 32z')}
      {bar(112, 54, 150, '#959989')}{bar(112, 74, 110)}{bar(112, 94, 130)}{bar(112, 114, 80)}
      <path d="M18 168h282M18 184h240" stroke="#868a7e" strokeWidth="5" strokeDasharray="7 5" />
    </>,
    'id-back': <>
      <rect x="22" y="22" width="46" height="36" rx="7" fill="#a9ad9f" /><path d="M22 40h46M45 22v36" stroke="#8e9286" strokeWidth="2" />
      {bar(86, 26, 140)}{bar(86, 44, 96)}
      <rect x="240" y="20" width="56" height="42" rx="6" fill="#b8bbb0" />{bar(22, 76, 274, '#b8bbb0')}
      <path d="M22 130h274M22 152h274M22 174h274" stroke="#868a7e" strokeWidth="6" strokeDasharray="8 5" />
    </>,
    // Numbered fields beside the portrait, a signature and the category boxes.
    'license-front': <>
      {bar(18, 16, 150, '#9a9e92', 12)}<circle cx="284" cy="26" r="14" fill="#b8bbb0" />
      {portrait(18, 44, 76, 98, 56, 80, 16, 'M27 142c4-21 14-31 29-31s25 10 29 31z')}
      {[[48, 130, '#959989'], [66, 104, '#a4a89c'], [84, 118, '#a4a89c'], [102, 84, '#a4a89c'], [120, 96, '#a4a89c']].map(([y, width, fill]) => <g key={y}>
        <rect x="110" y={y} width="8" height="8" rx="2" fill="#959989" />{bar(124, y as number, width as number, fill as string)}
      </g>)}
      <path d="M22 170c8-8 14 4 22-3s12-6 20 1" stroke="#868a7e" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {[206, 238, 270].map(x => <rect key={x} x={x} y="158" width="26" height="22" rx="4" fill="#b8bbb0" />)}
    </>,
    // The table of licence categories and a barcode.
    'license-back': <>
      <rect x="18" y="16" width="282" height="14" rx="4" fill="#b8bbb0" />
      {[[43, true], [65, true], [87, false], [109, false], [131, true]].map(([y, full]) => <g key={y as number}>
        <rect x="24" y={y as number} width="20" height="12" rx="2" fill="#a4a89c" />{bar(62, (y as number) + 2, 56, full ? '#a4a89c' : '#b8bbb0')}{full ? bar(142, (y as number) + 2, 56) : null}
      </g>)}
      <path d="M18 38h282M18 60h282M18 82h282M18 104h282M18 126h282M18 148h282M52 30v118M132 30v118M212 30v118" stroke="#b0b4a8" strokeWidth="1.5" />
      {bar(18, 162, 140)}{bar(18, 178, 96, '#b8bbb0')}
      <path d="M212 160v26M217 160v26M220 160v26M226 160v26M229 160v26M235 160v26M240 160v26M243 160v26M249 160v26M254 160v26M258 160v26M264 160v26M268 160v26M274 160v26M279 160v26M284 160v26M290 160v26M296 160v26" stroke="#868a7e" strokeWidth="2.5" />
    </>,
    // Labelled fields, a signature and the two machine-readable lines at the bottom.
    passport: <>
      {bar(18, 14, 124, '#9a9e92', 10)}<rect x="240" y="12" width="60" height="14" rx="7" fill="#b8bbb0" />
      {portrait(18, 38, 80, 104, 58, 78, 18, 'M28 142c4-23 15-33 30-33s26 10 30 33z')}
      {[[114, 40, 64, 132, '#959989'], [114, 66, 56, 104, '#a4a89c'], [114, 92, 48, 70, '#a4a89c'], [206, 92, 40, 54, '#a4a89c'], [114, 118, 60, 92, '#a4a89c']].map(([x, y, label, value, fill]) => <g key={`${x}-${y}`}>
        {bar(x as number, y as number, label as number, '#b0b4a8', 5)}{bar(x as number, (y as number) + 9, value as number, fill as string)}
      </g>)}
      <path d="M24 158c8-7 14 4 22-2s12-6 20 1" stroke="#868a7e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M18 186h282M18 206h282" stroke="#868a7e" strokeWidth="6" strokeDasharray="6 4" />
    </>,
  };
  const height = kind === 'passport' ? 224 : 200;
  return <svg className={`kyc-document-photo ${className ?? ''}`} data-kind={kind} viewBox={`0 0 318 ${height}`} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="318" height={height} rx={kind === 'passport' ? 12 : 14} fill="#cdd0c6" />
    {art[kind]}
  </svg>;
}

/** The verified hero: the document portrait linked to the selfie by a check. */
export function VerifiedArt() {
  return <div className="kyc-verified-art" aria-hidden="true">
    <span className="kyc-verified-document"><svg width="46" height="62" viewBox="0 0 46 62" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="23" cy="20" r="9" /><path d="M8 50c3-11 8-16 15-16s12 5 15 16" /></svg></span>
    <span className="kyc-verified-link"><Icon name="check" size={20} /></span>
    <span className="kyc-verified-face"><svg width="94" height="80" viewBox="0 0 94 80" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="47" cy="30" rx="15" ry="18" /><path d="M41 28v3M53 28v3M42 38c3 3 7 3 10 0" /><path d="M18 80c4-15 15-23 29-23s25 8 29 23" /></svg></span>
  </div>;
}

/** Two short bars that mark which document side is being photographed. */
export function SidePager({ side }: { side: 'front' | 'back' }) {
  return <span className="kyc-side-pager" aria-hidden="true"><span className="is-on" /><span className={side === 'back' ? 'is-on' : undefined} /></span>;
}
