import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { KycFlow, MAX_MOVEMENTS } from '@sdk/index';
import type { CaptureResult, FaceChallenge, KycLocale, KycStep, KycThemeDefinition } from '@sdk/index';

const LOCALES: readonly [KycLocale, string][] = [['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['pl', 'Polski'], ['tr', 'Türkçe']];
import FaceWorkerUrl from '@sdk/camera/face.worker.ts?worker&url';
import DocumentWorkerUrl from '@sdk/camera/document.worker.ts?worker&url';
import MatchWorkerUrl from '@sdk/matching/match.worker.ts?worker&url';
import { ThemeStudio } from './ThemeStudio';
import { allThemes, findTheme, isBuiltIn, useThemeFonts } from './themeStore';

const challengeOptions: { id: FaceChallenge; label: string }[] = [
  { id: 'center', label: 'Center face' }, { id: 'turn-left', label: 'Turn left' },
  { id: 'turn-right', label: 'Turn right' }, { id: 'look-up', label: 'Look up' },
  { id: 'look-down', label: 'Look down' }, { id: 'closer', label: 'Move closer' },
  { id: 'further', label: 'Move further' },
];
const defaultChallenges: FaceChallenge[] = ['center', 'turn-left', 'turn-right', 'closer'];
const movementCount = (challenges: readonly FaceChallenge[]) => challenges.filter(challenge => challenge !== 'center').length;
const summaryKey = 'kyc-kit-demo-summary';
const summaryChannel = 'kyc-kit-demo-completion';

interface Config {
  intro: boolean; document: boolean; review: boolean; result: boolean; challenges: FaceChallenge[];
  theme: string; locale: KycLocale; simulation: boolean; upload: boolean;
  documentAutoCapture: boolean; documentHoldMs: number; faceMatch: boolean;
}

function initialConfig(): Config {
  const params = new URLSearchParams(window.location.search);
  const defaults: Config = {
    intro: true, document: params.get('document') !== '0', review: false, result: true, challenges: [...defaultChallenges],
    theme: 'classic', locale: 'en', simulation: params.get('simulate') === '1', upload: false,
    documentAutoCapture: true, documentHoldMs: 0, faceMatch: true,
  };
  try {
    const raw = params.get('config');
    if (!raw || raw.length > 4000) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    const value = parsed as Record<string, unknown>;
    const challenges = Array.isArray(value.challenges) && value.challenges.length > 0 && movementCount(value.challenges as FaceChallenge[]) <= MAX_MOVEMENTS && value.challenges.filter(item => item === 'center').length <= 1
      && value.challenges.every(item => challengeOptions.some(option => option.id === item))
      ? value.challenges as FaceChallenge[] : defaults.challenges;
    return {
      intro: typeof value.intro === 'boolean' ? value.intro : defaults.intro,
      document: typeof value.document === 'boolean' ? value.document : false,
      review: typeof value.review === 'boolean' ? value.review : defaults.review,
      result: typeof value.result === 'boolean' ? value.result : defaults.result,
      simulation: typeof value.simulation === 'boolean' ? value.simulation : defaults.simulation,
      upload: typeof value.upload === 'boolean' ? value.upload : defaults.upload,
      documentAutoCapture: typeof value.documentAutoCapture === 'boolean' ? value.documentAutoCapture : defaults.documentAutoCapture,
      // Not "documentHoldDurationMs": links from older playgrounds carried an 800 ms hold that should no longer apply.
      documentHoldMs: typeof value.documentHoldMs === 'number' && Number.isFinite(value.documentHoldMs) && value.documentHoldMs >= 0 && value.documentHoldMs <= 10_000 ? value.documentHoldMs : defaults.documentHoldMs,
      faceMatch: typeof value.faceMatch === 'boolean' ? value.faceMatch : defaults.faceMatch,
      theme: typeof value.theme === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value.theme) ? value.theme : defaults.theme,
      locale: LOCALES.find(([code]) => code === value.locale)?.[0] ?? 'en', challenges,
    };
  } catch { return defaults; }
}

function getSteps(config: Config): KycStep[] {
  return [...(config.intro ? ['intro' as const] : []), ...(config.document ? ['document' as const] : []), 'face',
    ...(config.review ? ['review' as const] : []), ...(config.result ? ['result' as const] : [])];
}

function codeFor(config: Config): string {
  return `import { KycFlow } from 'kyc-lens-react';
import 'kyc-lens-react/styles.css';

<KycFlow
  steps={${JSON.stringify(getSteps(config))}}
  face={{ challenges: ${JSON.stringify(config.challenges)} }}
  document={{ autoCapture: ${config.documentAutoCapture}, holdDurationMs: ${config.documentHoldMs} }}${config.faceMatch ? '' : '\n  faceMatch={false}'}
  locale="${config.locale}"
  theme=${isBuiltIn(config.theme) ? `"${config.theme}"` : `"${config.theme}" // registerTheme() it first, see the Theme studio export`}
  assets={{ baseUrl: '/kyc-assets' }}${config.upload ? '\n  apiBaseUrl="/api/kyc"' : ''}${config.simulation ? '\n  simulation={true} // Demo only' : ''}
  onComplete={(result) => {
    // status is "capture_complete".
    // result.faceMatch contains the local photo comparison when a document is present.
    // Capture and photo similarity do not establish identity or liveness.
  }}
/>`;
}

function summaryFor(result: CaptureResult) {
  const receipt = result.serverResult && typeof result.serverResult === 'object' && !Array.isArray(result.serverResult)
    ? result.serverResult as Record<string, unknown> : undefined;
  const files = receipt?.files !== null && typeof receipt?.files === 'object' && !Array.isArray(receipt?.files)
    ? receipt.files as Record<string, unknown> : undefined;
  const hasSavedFiles = files?.metadata === 'metadata.json' && ['selfie.jpg', 'selfie.png', 'selfie.webp'].includes(String(files.selfie));
  const savedDirectory = hasSavedFiles && result.sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(result.sessionId)
    ? `results/${result.sessionId}` : undefined;
  return {
    status: result.status, sessionId: result.sessionId ?? null,
    mode: result.payload.mode, capturedAt: result.payload.capturedAt,
    challenges: result.payload.challenges.map(({ challenge }) => challenge),
    selfie: { type: result.payload.selfie.type, sizeBytes: result.payload.selfie.size, contents: '[not displayed]' },
    ...(result.payload.video ? { video: { type: result.payload.video.type, sizeBytes: result.payload.video.size, contents: '[not displayed]' } } : {}),
    ...(result.payload.document ? { document: { type: result.payload.document.type,
      front: { type: result.payload.document.front.type, sizeBytes: result.payload.document.front.size },
      ...(result.payload.document.back ? { back: { type: result.payload.document.back.type, sizeBytes: result.payload.document.back.size } } : {}) } } : {}),
    ...(savedDirectory ? { savedDirectory } : {}),
    server: savedDirectory ? '[local API saved capture files]' : result.serverResult ? '[local API returned capture metadata]' : '[local capture only]',
  };
}
type CaptureSummary = ReturnType<typeof summaryFor>;

function loadSummary(): CaptureSummary | null {
  try { return JSON.parse(sessionStorage.getItem(summaryKey) ?? 'null') as CaptureSummary | null; }
  catch { return null; }
}
function rememberSummary(summary: CaptureSummary) {
  try { sessionStorage.setItem(summaryKey, JSON.stringify(summary)); }
  catch { /* The capture still completes when browser storage is unavailable. */ }
}
function publishSummary(capture: CaptureResult) {
  const summary = summaryFor(capture);
  rememberSummary(summary);
  try {
    const channel = new BroadcastChannel(summaryChannel);
    channel.postMessage(summary); channel.close();
  } catch { /* Cross-tab metadata is an optional playground convenience. */ }
}

function Icon({ name, size = 18 }: { name: 'face' | 'code' | 'check' | 'external'; size?: number }) {
  const paths = {
    face: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" /><path d="M8 10h.01M16 10h.01M8 15s4 4 8 0" /></>,
    code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" />,
    check: <path d="m5 12 4 4L19 6" />,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Switch({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string }) {
  return <label className="demo-switch-row">
    <span><span className="demo-option-label">{label}</span>{description && <span className="demo-option-detail">{description}</span>}</span>
    <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span className="demo-switch" aria-hidden="true" />
  </label>;
}

const HANDOFF_ID = /^[A-Za-z0-9_-]{22,64}$/;
const handoffPollMs = 2_000;
const handoffLifetimeMs = 15 * 60_000;
const handoffCheckMs = 1_500;

function newHandoffId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The Cloudflare deployment relays the phone's capture summary back to this page; the Vite dev server has no relay.
async function handoffRelayAvailable(): Promise<boolean> {
  try { const response = await fetch('/api/handoff', { cache: 'no-store' }); return response.ok && (await response.json() as { available?: unknown }).available === true; }
  catch { return false; }
}

// A floating control: it never takes layout space from the capture frame.
function ThemePicker({ themes, value, onChange }: { themes: readonly KycThemeDefinition[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = themes.find(theme => theme.id === value) ?? themes[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const swatch = (theme: KycThemeDefinition) => <span className="demo-theme-swatch" style={{ '--swatch-bg': theme.tokens.color.background, '--swatch-primary': theme.tokens.color.primary, '--swatch-accent': theme.tokens.color.accent } as CSSProperties} aria-hidden="true" />;
  return <div ref={root} className="demo-theme-picker">
    <button type="button" className="demo-theme-toggle" aria-haspopup="true" aria-expanded={open} aria-label={`Theme: ${current.name}`} onClick={() => setOpen(previous => !previous)}>{swatch(current)}</button>
    {open ? <div className="demo-theme-menu" role="radiogroup" aria-label="Theme">{themes.map(theme => <button key={theme.id} type="button" role="radio" aria-checked={value === theme.id} className={value === theme.id ? 'selected' : ''} onClick={() => { onChange(theme.id); setOpen(false); }}>{swatch(theme)}{theme.name}</button>)}</div> : null}
  </div>;
}

function PreviewPage() {
  const [config] = useState(initialConfig);
  // Custom themes live in this browser's storage, shared with the settings and studio pages.
  const [themes] = useState(() => allThemes());
  const [themeId, setThemeId] = useState(() => findTheme(config.theme)?.id ?? 'classic');
  const theme = themes.find(item => item.id === themeId) ?? findTheme('classic')!;
  const [phoneHandoff] = useState(() => { const id = new URLSearchParams(window.location.search).get('handoff'); return id && HANDOFF_ID.test(id) ? id : null; });
  const [handoff, setHandoff] = useState<{ id: string; url: string } | null>(null);
  // Only desktops offer the phone QR. They wait briefly for the relay check, so the first screen
  // shown is already the final one instead of the intro swapping to the QR code a moment later.
  const [wantsHandoff] = useState(() => !phoneHandoff && window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(any-pointer: coarse)').matches && (navigator.maxTouchPoints ?? 0) === 0);
  const [handoffChecked, setHandoffChecked] = useState(!wantsHandoff);
  const [phoneSummary, setPhoneSummary] = useState<CaptureSummary | null>(null);
  useThemeFonts([theme]);
  useEffect(() => {
    document.title = 'KYC Lens — Identity capture';
    document.documentElement.classList.add('demo-app-mode');
    return () => document.documentElement.classList.remove('demo-app-mode');
  }, []);
  // The browser chrome and safe-area edges take the theme's background, so the frame reads as one app surface.
  useEffect(() => {
    const color = theme.tokens.color.background;
    if (window.matchMedia('(max-width: 480px)').matches) document.documentElement.style.background = color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [theme]);
  // A desktop preview offers a QR code that opens the same configuration on a phone.
  useEffect(() => {
    if (!wantsHandoff) return;
    let current = true;
    const giveUp = setTimeout(() => setHandoffChecked(true), handoffCheckMs);
    void handoffRelayAvailable().then(available => {
      if (!current) return;
      if (available) {
        const id = newHandoffId();
        setHandoff({ id, url: `${window.location.origin}/?config=${encodeURIComponent(JSON.stringify({ ...config, theme: themeId }))}&handoff=${id}` });
      }
      clearTimeout(giveUp); setHandoffChecked(true);
    });
    return () => { current = false; clearTimeout(giveUp); };
  }, [wantsHandoff, themeId]);
  useEffect(() => {
    if (!handoff || phoneSummary) return;
    const started = Date.now();
    let current = true;
    const timer = setInterval(() => {
      if (Date.now() - started > handoffLifetimeMs) { clearInterval(timer); return; }
      void fetch(`/api/handoff/${handoff.id}`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then((data: { status?: string; summary?: CaptureSummary } | null) => {
        if (!current || data?.status !== 'complete' || !data.summary) return;
        clearInterval(timer); rememberSummary(data.summary); setPhoneSummary(data.summary);
        try { const channel = new BroadcastChannel(summaryChannel); channel.postMessage(data.summary); channel.close(); } catch { /* Optional cross-tab convenience. */ }
      }, () => {});
    }, handoffPollMs);
    return () => { current = false; clearInterval(timer); };
  }, [handoff, phoneSummary]);
  const complete = (capture: CaptureResult) => {
    publishSummary(capture);
    if (phoneHandoff) void fetch(`/api/handoff/${phoneHandoff}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summaryFor(capture)) }).catch(() => {});
  };
  return <main className="demo-preview-page" aria-label="Identity capture preview"><div className="demo-phone" data-testid="sdk-preview">
    <ThemePicker themes={themes} value={theme.id} onChange={setThemeId} />
    {phoneSummary ? <section className="demo-handoff-done" aria-live="polite"><h2>Completed on your phone</h2><p>The phone sent its capture summary. Photos and video stay on the phone.</p><pre>{JSON.stringify(phoneSummary, null, 2)}</pre><a className="demo-primary-button" href={window.location.pathname + window.location.search}>Start again</a></section>
      : !handoffChecked ? <div className="demo-flow-pending" aria-busy="true" />
      : <KycFlow
      steps={getSteps(config)} face={{ challenges: config.challenges, trackingFps: 15 }}
      document={{ autoCapture: config.documentAutoCapture, holdDurationMs: config.documentHoldMs }} faceMatch={config.faceMatch ? {} : false}
      theme={theme} locale={config.locale} handoff={handoff ? { url: handoff.url } : undefined}
      assets={{ baseUrl: '/kyc-assets', workerUrl: FaceWorkerUrl, documentWorkerUrl: DocumentWorkerUrl, matchWorkerUrl: MatchWorkerUrl }}
      apiBaseUrl={config.upload ? '/api/kyc' : undefined} simulation={config.simulation}
      onComplete={complete}
    />}
  </div></main>;
}

function SettingsPage() {
  const [config, setConfig] = useState(initialConfig);
  const [result, setResult] = useState(loadSummary);
  const [tab, setTab] = useState<'integration' | 'result'>('integration');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const integrationTab = useRef<HTMLButtonElement>(null);
  const resultTab = useRef<HTMLButtonElement>(null);
  const code = codeFor(config);
  const previewUrl = `/?config=${encodeURIComponent(JSON.stringify(config))}`;
  const [themes] = useState(() => allThemes());
  useThemeFonts(themes);
  const update = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(previous => ({ ...previous, [key]: value }));

  useEffect(() => {
    document.title = 'KYC Lens — Demo settings';
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel(summaryChannel);
    channel.onmessage = event => {
      if (event.data?.status !== 'capture_complete') return;
      const summary = event.data as CaptureSummary;
      rememberSummary(summary); setResult(summary); setTab('result');
    };
    return () => channel.close();
  }, []);
  function toggleChallenge(id: FaceChallenge) {
    setConfig(previous => ({ ...previous, challenges: previous.challenges.includes(id)
      ? previous.challenges.filter(challenge => challenge !== id)
      : id !== 'center' && movementCount(previous.challenges) >= MAX_MOVEMENTS ? previous.challenges : [...previous.challenges, id] }));
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopiedCode(code); setError(null); }
    catch { setError('Select and copy the code manually. Clipboard access is unavailable.'); }
  }
  function moveTab(key: string) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return false;
    const next = key === 'Home' ? 'integration' : key === 'End' ? 'result' : tab === 'integration' ? 'result' : 'integration';
    setTab(next); (next === 'integration' ? integrationTab : resultTab).current?.focus(); return true;
  }

  return <div className="demo-settings-page">
    <header className="demo-settings-header"><a className="demo-brand" href="/" aria-label="KYC Lens capture preview"><Icon name="face" size={22} /><span>KYC Lens</span></a><nav className="demo-nav" aria-label="Playground"><a href="/settings" aria-current="page">Settings</a><a href="/themes">Theme studio</a></nav></header>
    <main className="demo-settings-main">
      <div className="demo-settings-title"><h1>Demo settings</h1><p>Choose your flow, then try it on a separate page.</p></div>
      <section className="demo-config-panel" aria-label="Capture configuration">
        <fieldset><legend>Screens</legend>
          <Switch label="Introduction" checked={config.intro} onChange={value => update('intro', value)} />
          <Switch label="Document capture" checked={config.document} onChange={value => update('document', value)} />
          <Switch label="Automatic document photo" description="Capture as soon as the document is clear inside the frame" checked={config.documentAutoCapture} onChange={value => update('documentAutoCapture', value)} />
          <Switch label="Compare document and selfie" description="Compare the faces on this device" checked={config.faceMatch} onChange={value => update('faceMatch', value)} />
          <div className="demo-required-step"><span>Face capture</span><span className="demo-required-badge">Required</span></div>
          <Switch label="Face capture review" checked={config.review} onChange={value => update('review', value)} />
          <Switch label="Capture result" checked={config.result} onChange={value => update('result', value)} />
        </fieldset>
        <fieldset><legend>Face movements</legend><p className="demo-field-help">Choose up to {MAX_MOVEMENTS} movements. They run in numbered order.</p>
          <div className="demo-challenges">{challengeOptions.map(option => <label key={option.id} className={`demo-challenge-option ${config.challenges.includes(option.id) ? 'selected' : ''}`}>
            <input type="checkbox" checked={config.challenges.includes(option.id)} disabled={!config.challenges.includes(option.id) && option.id !== 'center' && movementCount(config.challenges) >= MAX_MOVEMENTS} onChange={() => toggleChallenge(option.id)} />
            <span>{option.label}</span>{config.challenges.includes(option.id) && <span className="demo-challenge-order">{config.challenges.indexOf(option.id) + 1}</span>}
          </label>)}</div>
          {config.challenges.length === 0 && <p className="demo-validation" role="alert">Select at least one movement.</p>}
        </fieldset>
        <fieldset><legend>Appearance</legend>
          <div className="demo-locale-row"><label htmlFor="demo-locale">Language</label><select id="demo-locale" value={config.locale} onChange={event => update('locale', event.target.value as KycLocale)}>{LOCALES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
          <div className="demo-theme-row"><span>Theme</span><div className="demo-theme-options" role="radiogroup" aria-label="Theme">{themes.map(theme => <button key={theme.id} type="button" role="radio" aria-checked={config.theme === theme.id} className={config.theme === theme.id ? 'selected' : ''} onClick={() => update('theme', theme.id)}>
            <span className="demo-theme-swatch" style={{ '--swatch-bg': theme.tokens.color.background, '--swatch-primary': theme.tokens.color.primary, '--swatch-accent': theme.tokens.color.accent } as CSSProperties} aria-hidden="true" />{theme.name}
          </button>)}</div></div>
          <a className="demo-studio-link" href={`/themes?theme=${encodeURIComponent(config.theme)}`}>Create and edit themes in the Theme studio<Icon name="external" size={14} /></a>
        </fieldset>
        <fieldset><legend>Testing</legend>
          <Switch label="Simulation mode" description="Try the flow without a camera" checked={config.simulation} onChange={value => update('simulation', value)} />
          <Switch label="Upload API" description="Send captures to /api/kyc: saved to results/<session ID> locally, verified server-side on the verify deployment" checked={config.upload} onChange={value => update('upload', value)} />
        </fieldset>
        <div className="demo-open-preview">{config.challenges.length > 0 ? <a className="demo-primary-button" href={previewUrl} target="_blank" rel="noopener">Open preview<Icon name="external" size={17} /></a> : <button className="demo-primary-button" disabled>Open preview</button>}<p>Opens a new tab with only the KYC flow.</p></div>
      </section>
      <section className="demo-code-panel" aria-label="Integration and capture results">
        <div className="demo-code-heading"><div className="demo-tabs" role="tablist" aria-label="Developer details">
          <button ref={integrationTab} id="integration-tab" role="tab" tabIndex={tab === 'integration' ? 0 : -1} aria-selected={tab === 'integration'} aria-controls="integration-panel" onClick={() => setTab('integration')} onKeyDown={event => { if (moveTab(event.key)) event.preventDefault(); }}>Integration code</button>
          <button ref={resultTab} id="result-tab" role="tab" tabIndex={tab === 'result' ? 0 : -1} aria-selected={tab === 'result'} aria-controls="result-panel" onClick={() => setTab('result')} onKeyDown={event => { if (moveTab(event.key)) event.preventDefault(); }}>Capture summary{result && <span className="demo-result-dot" />}</button>
        </div></div>
        {tab === 'integration' ? <div id="integration-panel" role="tabpanel" tabIndex={0} aria-labelledby="integration-tab"><div className="demo-code-caption"><span>React / TypeScript</span><button className="demo-copy" onClick={() => void copyCode()}>{copiedCode === code ? 'Copied' : 'Copy code'}</button></div><pre><code>{code}</code></pre><div className="demo-code-footer"><code>npx kyc-lens-copy-assets ./public/kyc-assets</code></div></div> : <div id="result-panel" role="tabpanel" tabIndex={0} aria-labelledby="result-tab">{result ? <><div className="demo-code-caption"><span>Latest capture · metadata only</span><button className="demo-copy" onClick={() => { setResult(null); try { sessionStorage.removeItem(summaryKey); } catch { /* Optional storage. */ } }}>Clear</button></div><pre><code>{JSON.stringify(result, null, 2)}</code></pre></> : <div className="demo-empty-result"><Icon name="code" size={24} /><p>Complete a preview to see its capture summary here.</p><span>Captured media and session tokens are never displayed.</span></div>}</div>}
        {error && <p className="demo-validation demo-clipboard-error" role="alert">{error}</p>}
      </section>
      <p className="demo-settings-note">Document detection and face comparison run in your browser. Uploads are optional. Captures and photo similarity do not establish identity or liveness.</p>
    </main>
  </div>;
}

export default function App() {
  const path = window.location.pathname.replace(/\/$/, '');
  return path === '/settings' ? <SettingsPage /> : path === '/themes' ? <ThemeStudio /> : <PreviewPage />;
}
