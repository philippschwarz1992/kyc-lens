import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { KycFlow } from '../src/index';
import type { CaptureResult, FaceChallenge, KycStep } from '../src/index';
import FaceWorkerUrl from '../src/camera/face.worker.ts?worker&url';
import DocumentWorkerUrl from '../src/camera/document.worker.ts?worker&url';

const challengeOptions: { id: FaceChallenge; label: string }[] = [
  { id: 'center', label: 'Center face' }, { id: 'turn-left', label: 'Turn left' },
  { id: 'turn-right', label: 'Turn right' }, { id: 'look-up', label: 'Look up' },
  { id: 'look-down', label: 'Look down' }, { id: 'closer', label: 'Move closer' },
  { id: 'further', label: 'Move further' },
];
const defaultChallenges: FaceChallenge[] = ['center', 'turn-left', 'turn-right', 'closer', 'further'];
const colors = [
  { value: '#2563eb', label: 'Blue' }, { value: '#0f766e', label: 'Teal' },
  { value: '#7c3aed', label: 'Violet' }, { value: '#c2410c', label: 'Orange' },
];
const summaryKey = 'kyc-kit-demo-summary';
const summaryChannel = 'kyc-kit-demo-completion';

interface Config {
  intro: boolean; document: boolean; review: boolean; result: boolean; challenges: FaceChallenge[];
  color: string; locale: 'en' | 'de'; simulation: boolean; upload: boolean;
}

function initialConfig(): Config {
  const params = new URLSearchParams(window.location.search);
  const defaults: Config = {
    intro: true, document: params.get('document') !== '0', review: true, result: true, challenges: [...defaultChallenges],
    color: '#2563eb', locale: 'en', simulation: params.get('simulate') === '1', upload: true,
  };
  try {
    const raw = params.get('config');
    if (!raw || raw.length > 4000) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    const value = parsed as Record<string, unknown>;
    const challenges = Array.isArray(value.challenges) && value.challenges.length > 0 && value.challenges.length <= 20
      && value.challenges.every(item => challengeOptions.some(option => option.id === item))
      ? value.challenges as FaceChallenge[] : defaults.challenges;
    return {
      intro: typeof value.intro === 'boolean' ? value.intro : defaults.intro,
      document: typeof value.document === 'boolean' ? value.document : false,
      review: typeof value.review === 'boolean' ? value.review : defaults.review,
      result: typeof value.result === 'boolean' ? value.result : defaults.result,
      simulation: typeof value.simulation === 'boolean' ? value.simulation : defaults.simulation,
      upload: typeof value.upload === 'boolean' ? value.upload : defaults.upload,
      color: colors.some(color => color.value === value.color) ? value.color as string : defaults.color,
      locale: value.locale === 'de' ? 'de' : 'en', challenges,
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
  locale="${config.locale}"
  theme={{ primaryColor: '${config.color}' }}
  assets={{ baseUrl: '/kyc-assets' }}${config.upload ? '\n  apiBaseUrl="/api/kyc"' : ''}${config.simulation ? '\n  simulation={true} // Demo only' : ''}
  onComplete={(result) => {
    // status is "capture_complete".
    // Your backend decides verification separately.
  }}
/>`;
}

function summaryFor(result: CaptureResult) {
  const receipt = result.serverResult && typeof result.serverResult === 'object' && !Array.isArray(result.serverResult)
    ? result.serverResult as Record<string, unknown> : undefined;
  const hasSavedFiles = receipt?.files !== null && typeof receipt?.files === 'object' && !Array.isArray(receipt?.files);
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

function PreviewPage() {
  const [config] = useState(initialConfig);
  useEffect(() => { document.title = 'KYC Lens — Identity capture'; }, []);
  return <main className="demo-preview-page" aria-label="Identity capture preview"><div className="demo-phone" data-testid="sdk-preview">
    <KycFlow
      steps={getSteps(config)} face={{ challenges: config.challenges, trackingFps: 15 }}
      theme={{ primaryColor: config.color }} locale={config.locale}
      assets={{ baseUrl: '/kyc-assets', workerUrl: FaceWorkerUrl, documentWorkerUrl: DocumentWorkerUrl }}
      apiBaseUrl={config.upload ? '/api/kyc' : undefined} simulation={config.simulation}
      onComplete={publishSummary}
    />
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
      ? previous.challenges.filter(challenge => challenge !== id) : [...previous.challenges, id] }));
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
    <header className="demo-settings-header"><a className="demo-brand" href="/" aria-label="KYC Lens capture preview"><Icon name="face" size={22} /><span>KYC Lens</span></a><span>Playground</span></header>
    <main className="demo-settings-main">
      <div className="demo-settings-title"><h1>Demo settings</h1><p>Choose your flow, then try it on a separate page.</p></div>
      <section className="demo-config-panel" aria-label="Capture configuration">
        <fieldset><legend>Screens</legend>
          <Switch label="Introduction" checked={config.intro} onChange={value => update('intro', value)} />
          <Switch label="Document capture" checked={config.document} onChange={value => update('document', value)} />
          <div className="demo-required-step"><span>Face capture</span><span className="demo-required-badge">Required</span></div>
          <Switch label="Face capture review" checked={config.review} onChange={value => update('review', value)} />
          <Switch label="Capture result" checked={config.result} onChange={value => update('result', value)} />
        </fieldset>
        <fieldset><legend>Face movements</legend><p className="demo-field-help">Selected movements run in numbered order.</p>
          <div className="demo-challenges">{challengeOptions.map(option => <label key={option.id} className={`demo-challenge-option ${config.challenges.includes(option.id) ? 'selected' : ''}`}>
            <input type="checkbox" checked={config.challenges.includes(option.id)} onChange={() => toggleChallenge(option.id)} />
            <span>{option.label}</span>{config.challenges.includes(option.id) && <span className="demo-challenge-order">{config.challenges.indexOf(option.id) + 1}</span>}
          </label>)}</div>
          {config.challenges.length === 0 && <p className="demo-validation" role="alert">Select at least one movement.</p>}
        </fieldset>
        <fieldset><legend>Appearance</legend>
          <div className="demo-locale-row"><label htmlFor="demo-locale">Language</label><select id="demo-locale" value={config.locale} onChange={event => update('locale', event.target.value as 'en' | 'de')}><option value="en">English</option><option value="de">Deutsch</option></select></div>
          <div className="demo-accent-row"><span>Accent color</span><div className="demo-color-options">{colors.map(color => <button key={color.value} className={config.color === color.value ? 'selected' : ''} type="button" title={color.label} aria-label={`${color.label} accent`} aria-pressed={config.color === color.value} style={{ '--swatch': color.value } as CSSProperties} onClick={() => update('color', color.value)}><span>{config.color === color.value && <Icon name="check" size={16} />}</span></button>)}</div></div>
        </fieldset>
        <fieldset><legend>Testing</legend>
          <Switch label="Simulation mode" description="Try the flow without a camera" checked={config.simulation} onChange={value => update('simulation', value)} />
          <Switch label="Local upload API" description="Save captures in results under their session ID" checked={config.upload} onChange={value => update('upload', value)} />
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
      <p className="demo-settings-note">This demo captures documents, a silent face video, a selfie and movement evidence. Your backend owns identity verification.</p>
    </main>
  </div>;
}

export default function App() {
  return window.location.pathname.replace(/\/$/, '') === '/settings' ? <SettingsPage /> : <PreviewPage />;
}
