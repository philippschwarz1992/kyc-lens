import { useCallback, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CSSProperties, ReactNode } from 'react';
import { resolveIconPack, themeVariables } from '@sdk/index';
import { getStrings } from '@sdk/react/strings';
import type { DocumentType, KycLocale, KycThemeDefinition } from '@sdk/index';
import { DEFAULT_CHALLENGES } from '@sdk/core/challenges';
import { DocumentScreen } from '@sdk/react/DocumentScreen';
import type { DocumentStage } from '@sdk/react/DocumentScreen';
import { FaceScreen } from '@sdk/react/FaceScreen';
import { Icon, IconPackContext } from '@sdk/react/Icons';
import { DocumentPhoto, LayoutContext, PanelHeader } from '@sdk/react/Panel';
import type { DocumentPhotoKind, StatusTone } from '@sdk/react/Panel';
import { AnalysisScreen, ErrorScreen, IntroScreen, RejectedScreen, ResultScreen, ReviewScreen } from '@sdk/react/Screens';
import { allThemes, useThemeFonts } from './themeStore';

const LOCALES: readonly [KycLocale, string][] = [['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['pl', 'Polski'], ['tr', 'Türkçe']];

// Stand-in photos, so the review and result screens have something to show.
const photo = (kind: DocumentPhotoKind) => new Blob([renderToStaticMarkup(<DocumentPhoto kind={kind} />)], { type: 'image/svg+xml' });
const photos = { idFront: photo('id-front'), licenseFront: photo('license-front'), licenseBack: photo('license-back'), passport: photo('passport') };
const selfieSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 420"><rect width="350" height="420" fill="#262823"/><path d="M20 420c14-84 76-128 155-128s141 44 155 128z" fill="#33362f"/><path d="M150 262h50v32c0 13-11 21-25 21s-25-8-25-21z" fill="#41453b"/><ellipse cx="108" cy="190" rx="9" ry="16" fill="#41453b"/><ellipse cx="242" cy="190" rx="9" ry="16" fill="#41453b"/><ellipse cx="175" cy="182" rx="66" ry="84" fill="#4a4e43"/><path d="M110 172c0-56 30-88 66-88s64 32 64 88c-14-28-38-44-66-44s-52 16-64 44z" fill="#2e302a"/></svg>';
const selfiePhoto = new Blob([selfieSvg], { type: 'image/svg+xml' });
const selfieUrl = URL.createObjectURL(selfiePhoto);
const noop = () => {};

/** One screen in a flow-shaped frame: the same root, header and note KycFlow renders around it. */
function Frame({ title, theme, locale, status, children }: { title: string; theme: KycThemeDefinition; locale: KycLocale; status: [string, StatusTone]; children: ReactNode }) {
  const s = getStrings(locale);
  const panel = theme.layout === 'panel';
  const [back, setBackState] = useState<(() => void) | null>(null);
  const setBack = useCallback((handler: (() => void) | null) => setBackState(() => handler), []);
  const layout = useMemo(() => ({ panel, setBack }), [panel, setBack]);
  return <figure className="gallery-item">
    <figcaption>{title}</figcaption>
    <section className="kyc-kit gallery-kit" style={themeVariables(theme) as CSSProperties} data-kyc-theme={theme.id} data-kyc-scheme={theme.tokens.colorScheme} data-kyc-icons={resolveIconPack(theme.icons).id} data-kyc-layout={theme.layout ?? 'card'} lang={locale}>
      <IconPackContext.Provider value={resolveIconPack(theme.icons)}><LayoutContext.Provider value={layout}>
        {panel ? <PanelHeader brand={theme.brand} status={status[0]} tone={status[1]} back={back} backLabel={s.back} /> : null}
        <div className="kyc-content">{children}</div>
        {panel ? <p className="kyc-panel-note"><Icon name="lock" size={14} />{s.captureOnly}</p> : null}
      </LayoutContext.Provider></IconPackContext.Provider>
    </section>
  </figure>;
}

export function ScreenGallery() {
  const [themes] = useState(() => allThemes());
  const params = new URLSearchParams(window.location.search);
  const [themeId, setThemeId] = useState(() => themes.some(theme => theme.id === params.get('theme')) ? params.get('theme')! : 'capital');
  const [locale, setLocale] = useState<KycLocale>(() => LOCALES.some(([code]) => code === params.get('locale')) ? params.get('locale') as KycLocale : 'en');
  const theme = themes.find(item => item.id === themeId) ?? themes[0]!;
  useThemeFonts([theme]);
  const s = getStrings(locale);
  const document = (stage: DocumentStage, type: DocumentType = 'id-card', photo?: Blob) => <DocumentScreen key={`${theme.id}-${locale}-${type}-${stage}`} options={{}} assets={{ baseUrl: '/kyc-assets' }} simulation strings={s} onCapture={noop} onFailure={noop} preview={{ stage, type, photo }} />;
  const match = { status: 'capture_complete' as const, payload: { selfie: selfiePhoto, document: { type: 'id-card' as const, front: photos.idFront } } as never, faceMatch: { status: 'match' } as never };
  const screens: [string, [string, StatusTone], ReactNode][] = [
    ['01 · Continue on phone', [s.statusGuided, 'accent'], <IntroScreen next={noop} cancel={noop} retry={noop} strings={s} hasDocument handoffUrl="https://example.com/continue" brandMark={theme.brand?.mark} />],
    ['02 · Intro', [s.statusGuided, 'accent'], <IntroScreen next={noop} cancel={noop} retry={noop} strings={s} hasDocument />],
    ['02b · Selfie-only intro', [s.statusGuided, 'accent'], <IntroScreen next={noop} cancel={noop} retry={noop} strings={s} />],
    ['03 · Choose document', [s.statusDocument, 'accent'], document('select')],
    ['04 · Document front', [s.statusDocument, 'accent'], document('camera-front')],
    ['05 · Check photo', [s.statusDocument, 'accent'], document('review-front', 'id-card', photos.idFront)],
    ['06 · Document back', [s.statusDocument, 'accent'], document('camera-back', 'id-card', photos.idFront)],
    ['04L · License front', [s.statusDocument, 'accent'], document('camera-front', 'drivers-license')],
    ['05L · Check license photo', [s.statusDocument, 'accent'], document('review-front', 'drivers-license', photos.licenseFront)],
    ['06L · License back', [s.statusDocument, 'accent'], document('camera-back', 'drivers-license', photos.licenseFront)],
    ['04P · Passport photo page', [s.statusDocument, 'accent'], document('camera-front', 'passport')],
    ['05P · Check passport photo', [s.statusDocument, 'accent'], document('review-front', 'passport', photos.passport)],
    ['07 · Face guide', [s.statusFace, 'accent'], <FaceScreen key={`${theme.id}-${locale}-face`} face={{}} assets={{ baseUrl: '/kyc-assets' }} challenges={DEFAULT_CHALLENGES} simulation strings={s} onCapture={noop} onFailure={noop} />],
    ['08 · Check selfie', [s.statusFace, 'accent'], <ReviewScreen next={noop} cancel={noop} retry={noop} strings={s} selfieUrl={selfieUrl} />],
    ['09 · Verifying', [s.statusVerifying, 'accent'], <AnalysisScreen strings={s} hasDocument compare upload stage="compare" uploadPercent={null} onCancel={noop} />],
    ['10 · Verified', [s.statusVerified, 'accent'], <ResultScreen next={noop} cancel={noop} retry={noop} strings={s} result={match} />],
    ['11 · Not verified', [s.statusRejected, 'danger'], <RejectedScreen strings={s} status="no_match" onRestart={noop} />],
    ['12 · Camera error', [s.statusCamera, 'danger'], <ErrorScreen strings={s} body={s.cameraErrorBody} detail={s.permissionDenied} onRetry={noop} />],
  ];
  return <div className="gallery-page" data-scheme={theme.tokens.colorScheme}>
    <header className="gallery-header">
      <a className="demo-brand" href="/settings">KYC Lens</a>
      <nav className="demo-nav" aria-label="Playground"><a href="/settings">Settings</a><a href="/themes">Theme studio</a><a href="/screens" aria-current="page">Screens</a></nav>
    </header>
    <div className="gallery-toolbar">
      <h1>Every screen</h1>
      <label>Theme<select value={theme.id} onChange={event => setThemeId(event.target.value)}>{themes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Language<select value={locale} onChange={event => setLocale(event.target.value as KycLocale)}>{LOCALES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <p>Each screen is shown on its own with sample photos. Cameras run in simulation.</p>
    </div>
    <main className="gallery-grid">{screens.map(([title, status, screen]) => <Frame key={`${theme.id}-${locale}-${title}`} title={title} theme={theme} locale={locale} status={status}>{screen}</Frame>)}</main>
  </div>;
}
