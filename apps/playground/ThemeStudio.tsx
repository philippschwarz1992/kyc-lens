import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { builtInThemes, defineTheme, KycFlow, themeCss } from '@sdk/index';
import type { KycThemeDefinition, KycThemeTokens } from '@sdk/index';
import FaceWorkerUrl from '@sdk/camera/face.worker.ts?worker&url';
import DocumentWorkerUrl from '@sdk/camera/document.worker.ts?worker&url';
import MatchWorkerUrl from '@sdk/matching/match.worker.ts?worker&url';
import { allThemes, isBuiltIn, loadThemes, saveThemes, tokenChanges, uniqueId, useThemeFonts } from './themeStore';
import type { StoredTheme } from './themeStore';

type Field =
  | { path: string; label: string; kind: 'color' | 'text' | 'textarea' | 'boolean' }
  | { path: string; label: string; kind: 'px'; min: number; max: number; step?: number }
  | { path: string; label: string; kind: 'number'; min: number; max: number; step: number }
  | { path: string; label: string; kind: 'select'; options: readonly (readonly [string, string])[]; custom?: boolean };

const fontStacks = [
  ['"Inter", "Segoe UI", system-ui, sans-serif', 'Inter'],
  ['"Manrope", "Inter", system-ui, sans-serif', 'Manrope'],
  ['"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif', 'Plus Jakarta Sans'],
  ['"Instrument Serif", "Iowan Old Style", Georgia, serif', 'Instrument Serif'],
  ['"Inter", "Helvetica Neue", Arial, sans-serif', 'Inter / Helvetica'],
  ['"JetBrains Mono", ui-monospace, monospace', 'JetBrains Mono'],
  ['"IBM Plex Mono", ui-monospace, monospace', 'IBM Plex Mono'],
  ['ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', 'System mono'],
  ['system-ui, sans-serif', 'System sans'],
  ['Georgia, serif', 'Georgia'],
] as const;
const easings = [
  ['cubic-bezier(0.22, 1, 0.36, 1)', 'Smooth'],
  ['cubic-bezier(0.34, 1.56, 0.64, 1)', 'Spring'],
  ['cubic-bezier(0.4, 0, 0.2, 1)', 'Standard'],
  ['ease-in-out', 'Ease in-out'],
  ['linear', 'Linear'],
] as const;
const weights = ['300', '400', '500', '600', '650', '700', '800'].map(weight => [weight, weight] as const);

const sections: { title: string; fields: Field[] }[] = [
  { title: 'Brand colors', fields: [
    { path: 'color.primary', label: 'Primary', kind: 'color' }, { path: 'color.onPrimary', label: 'On primary', kind: 'color' },
    { path: 'color.accent', label: 'Face guide', kind: 'color' }, { path: 'color.accentText', label: 'Guide arrows', kind: 'color' },
    { path: 'color.illustration', label: 'Illustrations', kind: 'color' }, { path: 'color.focus', label: 'Focus ring', kind: 'color' },
  ] },
  { title: 'Surfaces & text', fields: [
    { path: 'colorScheme', label: 'Color scheme', kind: 'select', options: [['light', 'Light'], ['dark', 'Dark']] },
    { path: 'color.background', label: 'Card', kind: 'color' }, { path: 'color.surface', label: 'Soft fill', kind: 'color' },
    { path: 'color.selected', label: 'Selected', kind: 'color' }, { path: 'color.paper', label: 'Illustration paper', kind: 'color' },
    { path: 'color.text', label: 'Text', kind: 'color' }, { path: 'color.muted', label: 'Muted text', kind: 'color' },
    { path: 'color.line', label: 'Hairline', kind: 'color' }, { path: 'color.lineStrong', label: 'Strong line', kind: 'color' },
  ] },
  { title: 'Status & camera', fields: [
    { path: 'color.success', label: 'Ready', kind: 'color' }, { path: 'color.danger', label: 'Adjust', kind: 'color' },
    { path: 'color.noticeText', label: 'Notice text', kind: 'color' }, { path: 'color.noticeSurface', label: 'Notice fill', kind: 'color' },
    { path: 'color.camera', label: 'Camera', kind: 'color' }, { path: 'color.cameraOverlay', label: 'Camera dim', kind: 'color' },
  ] },
  { title: 'Typography', fields: [
    { path: 'font.heading', label: 'Heading font', kind: 'select', options: fontStacks, custom: true },
    { path: 'font.body', label: 'Body font', kind: 'select', options: fontStacks, custom: true },
    { path: 'font.mono', label: 'Label font', kind: 'select', options: fontStacks, custom: true },
    { path: 'type.headingSize', label: 'Heading size', kind: 'px', min: 18, max: 40 },
    { path: 'type.headingWeight', label: 'Heading weight', kind: 'select', options: weights },
    { path: 'type.headingTracking', label: 'Heading tracking', kind: 'px', min: -1.5, max: 0.5, step: 0.1 },
    { path: 'type.bodySize', label: 'Body size', kind: 'px', min: 12, max: 17 },
    { path: 'type.buttonWeight', label: 'Button weight', kind: 'select', options: weights },
  ] },
  { title: 'Shape', fields: [
    { path: 'shape.radius', label: 'Card radius', kind: 'px', min: 0, max: 40 },
    { path: 'shape.control', label: 'Control radius', kind: 'px', min: 0, max: 28 },
    { path: 'shape.media', label: 'Camera radius', kind: 'px', min: 0, max: 32 },
  ] },
  { title: 'Depth & backdrop', fields: [
    { path: 'elevation.card', label: 'Card shadow', kind: 'textarea' },
    { path: 'elevation.button', label: 'Button shadow', kind: 'textarea' },
    { path: 'backdrop', label: 'Backdrop (CSS background)', kind: 'textarea' },
  ] },
  { title: 'Motion', fields: [
    { path: 'motion.easing', label: 'Screen easing', kind: 'select', options: easings, custom: true },
    { path: 'motion.press', label: 'Press easing', kind: 'select', options: easings, custom: true },
    { path: 'motion.entrance', label: 'Screen entrance', kind: 'select', options: [['rise', 'Rise'], ['fade', 'Fade'], ['scale', 'Scale']] },
    { path: 'motion.durationScale', label: 'Speed (duration ×)', kind: 'number', min: 0.5, max: 2.5, step: 0.05 },
    { path: 'motion.ambient', label: 'Drifting backdrop', kind: 'boolean' },
  ] },
];

function read(tokens: KycThemeTokens, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], tokens);
}
function withToken(tokens: KycThemeTokens, path: string, value: unknown): KycThemeTokens {
  const next = structuredClone(tokens) as unknown as Record<string, Record<string, unknown>>;
  const [group, name] = path.split('.') as [string, string | undefined];
  if (name) next[group]![name] = value; else (next as Record<string, unknown>)[group] = value;
  return next as unknown as KycThemeTokens;
}
const hex = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map(c => c + c).join('')}` : null;

/** Text-like inputs keep the user's partial value while it is not yet a valid token. */
function TextToken({ value, multiline, label, onCommit }: { value: string; multiline?: boolean; label: string; onCommit: (value: string) => string | null }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(value); setError(null); }, [value]);
  const change = (next: string) => { setText(next); setError(onCommit(next)); };
  return <>
    {multiline ? <textarea aria-label={label} value={text} rows={3} spellCheck={false} onChange={event => change(event.target.value)} />
      : <input aria-label={label} value={text} spellCheck={false} onChange={event => change(event.target.value)} />}
    {error ? <span className="studio-field-error" role="alert">{error}</span> : null}
  </>;
}

function TokenField({ field, tokens, onChange }: { field: Field; tokens: KycThemeTokens; onChange: (path: string, value: unknown) => string | null }) {
  const value = read(tokens, field.path);
  const id = `token-${field.path.replace('.', '-')}`;
  let control: ReactNode;
  if (field.kind === 'color') {
    const current = String(value);
    control = <div className="studio-color">
      <label className="studio-swatch" style={{ '--swatch': current } as CSSProperties} title="Pick a color">
        <input type="color" aria-label={`${field.label} picker`} value={hex(current) ?? '#000000'} onChange={event => onChange(field.path, event.target.value)} />
      </label>
      <TextToken label={field.label} value={current} onCommit={next => onChange(field.path, next)} />
    </div>;
  } else if (field.kind === 'px') {
    const number = Number.parseFloat(String(value));
    control = <div className="studio-range"><input id={id} type="range" min={field.min} max={field.max} step={field.step ?? 1} value={Number.isFinite(number) ? number : field.min} onChange={event => onChange(field.path, `${event.target.value}px`)} /><output htmlFor={id}>{String(value)}</output></div>;
  } else if (field.kind === 'number') {
    control = <div className="studio-range"><input id={id} type="range" min={field.min} max={field.max} step={field.step} value={Number(value)} onChange={event => onChange(field.path, Number(event.target.value))} /><output htmlFor={id}>{Number(value).toFixed(2)}×</output></div>;
  } else if (field.kind === 'boolean') {
    control = <label className="demo-switch-row studio-switch"><span className="demo-option-label">{value ? 'On' : 'Off'}</span><input id={id} type="checkbox" role="switch" checked={Boolean(value)} onChange={event => onChange(field.path, event.target.checked)} /><span className="demo-switch" aria-hidden="true" /></label>;
  } else if (field.kind === 'select') {
    const known = field.options.some(([option]) => option === value);
    control = <div className="studio-select-stack">
      <select id={id} value={known ? String(value) : '__custom'} onChange={event => { if (event.target.value !== '__custom') onChange(field.path, event.target.value); }}>
        {field.options.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
        {field.custom ? <option value="__custom">Custom…</option> : null}
      </select>
      {field.custom && !known ? <TextToken label={`${field.label} value`} value={String(value)} onCommit={next => onChange(field.path, next)} /> : null}
    </div>;
  } else {
    control = <TextToken label={field.label} value={String(value)} multiline={field.kind === 'textarea'} onCommit={next => onChange(field.path, next)} />;
  }
  return <div className={`studio-field studio-field-${field.kind}`}><label htmlFor={field.kind === 'color' || field.kind === 'text' || field.kind === 'textarea' ? undefined : id}>{field.label}</label>{control}</div>;
}

function Swatches({ theme }: { theme: KycThemeDefinition }) {
  const { color } = theme.tokens;
  return <span className="studio-swatches" aria-hidden="true" style={{ background: color.background, borderRadius: Math.min(12, Number.parseFloat(theme.tokens.shape.radius) / 2) }}>
    <span style={{ background: color.primary }} /><span style={{ background: color.accent }} /><span style={{ background: color.text }} /><span style={{ background: color.surface }} />
  </span>;
}

function exportCode(theme: KycThemeDefinition, base: string): string {
  if (isBuiltIn(theme.id)) return `import { KycFlow } from 'kyc-lens-react';\nimport 'kyc-lens-react/styles.css';\n\n// Built-in theme: load its fonts in your page, see theme.fonts.\n<KycFlow theme="${theme.id}" />`;
  const baseTokens = (builtInThemes as Record<string, KycThemeDefinition>)[base]!.tokens;
  const tokens = JSON.stringify(tokenChanges(theme.tokens, baseTokens), null, 2).replace(/\n/g, '\n  ');
  const fonts = theme.fonts?.length ? `\n  fonts: ${JSON.stringify(theme.fonts)},` : '';
  return `import { KycFlow, registerTheme } from 'kyc-lens-react';\nimport 'kyc-lens-react/styles.css';\n\nregisterTheme({\n  id: '${theme.id}',\n  name: ${JSON.stringify(theme.name)},\n  extends: '${base}',${fonts}\n  tokens: ${tokens},\n});\n\n<KycFlow theme="${theme.id}" />`;
}

export function ThemeStudio() {
  const [saved, setSaved] = useState<StoredTheme[]>(loadThemes);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('theme') ?? 'aurora');
  const [restart, setRestart] = useState(0);
  const [stage, setStage] = useState<'light' | 'dark'>('light');
  const [exportTab, setExportTab] = useState<'ts' | 'css' | 'json'>('ts');
  const [newBase, setNewBase] = useState('classic');
  const [importText, setImportText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const themes = allThemes(saved);
  const theme = themes.find(item => item.id === selectedId) ?? builtInThemes.classic;
  const stored = saved.find(item => item.theme.id === theme.id);
  const base = stored?.base ?? theme.id;
  useThemeFonts(themes);
  useEffect(() => { document.title = 'KYC Lens — Theme studio'; }, []);
  useEffect(() => { if (!saveThemes(saved)) setNotice('Browser storage is unavailable, so themes last only until you reload.'); }, [saved]);

  const code = useMemo(() => exportTab === 'ts' ? exportCode(theme, base)
    : exportTab === 'css' ? themeCss(theme)
    : JSON.stringify({ base, theme }, null, 2), [theme, base, exportTab]);

  function addTheme(item: StoredTheme) { setSaved(previous => [...previous, item]); setSelectedId(item.theme.id); }
  function create(fromId: string, name: string) {
    const source = themes.find(item => item.id === fromId)!;
    const sourceBase = saved.find(item => item.theme.id === fromId)?.base ?? fromId;
    const id = uniqueId(name, themes.map(item => item.id));
    const created = defineTheme({ ...source, id, name, extends: sourceBase });
    addTheme({ base: sourceBase, theme: created });
    return created;
  }
  /** Returns an error message, or null when the edit was applied. */
  function edit(path: string, value: unknown): string | null {
    try {
      const target = isBuiltIn(theme.id) ? null : theme;
      const tokens = withToken((target ?? theme).tokens, path, value);
      if (!target) {
        const copy = defineTheme({ ...theme, id: uniqueId(`${theme.name} copy`, themes.map(item => item.id)), name: `${theme.name} copy`, extends: theme.id, tokens });
        addTheme({ base: theme.id, theme: copy });
        setNotice(`Built-in themes are read-only, so your change created "${copy.name}".`);
        return null;
      }
      const next = defineTheme({ ...target, extends: base, tokens });
      setSaved(previous => previous.map(item => item.theme.id === target.id ? { ...item, theme: next } : item));
      return null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  function rename(name: string) {
    if (!stored || !name.trim()) return;
    setSaved(previous => previous.map(item => item.theme.id === theme.id ? { ...item, theme: { ...item.theme, name: name.slice(0, 80) } } : item));
  }
  function remove() {
    if (!stored) return;
    setSaved(previous => previous.filter(item => item.theme.id !== theme.id));
    setSelectedId(base);
  }
  function importTheme() {
    try {
      const parsed = JSON.parse(importText ?? '') as Partial<StoredTheme> & Record<string, unknown>;
      const input = (parsed.theme ?? parsed) as KycThemeDefinition;
      const importBase = typeof parsed.base === 'string' && isBuiltIn(parsed.base) ? parsed.base : 'classic';
      const name = typeof input.name === 'string' ? input.name : 'Imported theme';
      const created = defineTheme({ ...input, id: uniqueId(input.id ?? name, themes.map(item => item.id)), name, extends: importBase });
      addTheme({ base: importBase, theme: created }); setImportText(null); setNotice(`Imported "${created.name}".`);
    } catch (error) { setNotice(`Import failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(code); setNotice('Copied to the clipboard.'); }
    catch { setNotice('Select and copy the code manually. Clipboard access is unavailable.'); }
  }

  return <div className="studio-page">
    <header className="studio-header">
      <a className="demo-brand" href="/settings"><span className="studio-logo" aria-hidden="true" />KYC Lens</a>
      <nav aria-label="Playground"><a href="/settings">Settings</a><a href="/themes" aria-current="page">Theme studio</a></nav>
    </header>
    <div className="studio-layout">
      <aside className="studio-library" aria-label="Themes">
        <h1>Theme studio</h1>
        <p>Pick a theme to preview it, or start a new one. Your themes are saved in this browser.</p>
        <ul className="studio-theme-list">
          {themes.map(item => <li key={item.id}>
            <button type="button" className={item.id === theme.id ? 'is-active' : ''} aria-pressed={item.id === theme.id} onClick={() => setSelectedId(item.id)}>
              <Swatches theme={item} />
              <span><strong>{item.name}</strong><small>{isBuiltIn(item.id) ? 'Built-in' : `Custom · from ${saved.find(entry => entry.theme.id === item.id)?.base}`}</small></span>
            </button>
          </li>)}
        </ul>
        <div className="studio-create">
          <label htmlFor="studio-base">Start a new theme from</label>
          <div><select id="studio-base" value={newBase} onChange={event => setNewBase(event.target.value)}>{themes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <button type="button" className="demo-primary-button" onClick={() => create(newBase, 'My theme')}>New theme</button></div>
          <button type="button" className="studio-link-button" onClick={() => setImportText(importText === null ? '' : null)}>{importText === null ? 'Import JSON…' : 'Cancel import'}</button>
          {importText !== null ? <div className="studio-import"><textarea aria-label="Theme JSON" rows={6} value={importText} spellCheck={false} onChange={event => setImportText(event.target.value)} placeholder='Paste a JSON export from this studio' /><button type="button" className="demo-primary-button" onClick={importTheme}>Import theme</button></div> : null}
        </div>
      </aside>

      <section className={`studio-stage is-${stage}`} aria-label={`${theme.name} preview`}>
        <div className="studio-stage-bar">
          <div><strong>{theme.name}</strong><span>{theme.description ?? 'Live preview in simulation mode'}</span></div>
          <div className="studio-stage-actions">
            <div className="studio-segmented" role="group" aria-label="Page background">
              <button type="button" aria-pressed={stage === 'light'} onClick={() => setStage('light')}>Light page</button>
              <button type="button" aria-pressed={stage === 'dark'} onClick={() => setStage('dark')}>Dark page</button>
            </div>
            <button type="button" className="studio-ghost-button" onClick={() => setRestart(value => value + 1)}>Restart flow</button>
          </div>
        </div>
        <div className="studio-device" data-testid="studio-preview">
          <KycFlow key={restart} theme={theme} simulation
            steps={['intro', 'document', 'face', 'review', 'result']}
            face={{ challenges: ['center', 'turn-left', 'turn-right', 'closer'], trackingFps: 15 }}
            assets={{ baseUrl: '/kyc-assets', workerUrl: FaceWorkerUrl, documentWorkerUrl: DocumentWorkerUrl, matchWorkerUrl: MatchWorkerUrl }}
            onComplete={() => undefined} />
        </div>
      </section>

      <aside className="studio-editor" aria-label="Theme tokens">
        <div className="studio-editor-head">
          {stored ? <label className="studio-name"><span>Name</span><input value={theme.name} onChange={event => rename(event.target.value)} /></label>
            : <p className="studio-readonly">Built-in theme. Change any value to create your own copy.</p>}
          <div className="studio-editor-actions">
            <button type="button" className="studio-ghost-button" onClick={() => create(theme.id, `${theme.name} copy`)}>Duplicate</button>
            {stored ? <button type="button" className="studio-ghost-button is-danger" onClick={remove}>Delete</button> : null}
          </div>
        </div>
        {notice ? <p className="studio-notice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></p> : null}
        {sections.map((section, index) => <details key={section.title} open={index < 2}>
          <summary>{section.title}</summary>
          <div className="studio-fields">{section.fields.map(field => <TokenField key={`${theme.id}-${field.path}`} field={field} tokens={theme.tokens} onChange={edit} />)}</div>
        </details>)}
        <details>
          <summary>Font stylesheets</summary>
          <div className="studio-fields"><div className="studio-field studio-field-textarea"><label htmlFor="studio-fonts">One https URL per line. Your app loads these; KYC Lens never fetches fonts.</label>
            <textarea id="studio-fonts" rows={3} spellCheck={false} readOnly={!stored} value={(theme.fonts ?? []).join('\n')} onChange={event => {
              if (!stored) return;
              const fonts = event.target.value.split('\n').map(line => line.trim()).filter(Boolean);
              try { const next = defineTheme({ ...theme, fonts, extends: base }); setSaved(previous => previous.map(item => item.theme.id === theme.id ? { ...item, theme: next } : item)); }
              catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
            }} /></div></div>
        </details>
        <div className="studio-export">
          <div className="studio-export-head">
            <div className="studio-segmented" role="group" aria-label="Export format">
              <button type="button" aria-pressed={exportTab === 'ts'} onClick={() => setExportTab('ts')}>TypeScript</button>
              <button type="button" aria-pressed={exportTab === 'css'} onClick={() => setExportTab('css')}>CSS</button>
              <button type="button" aria-pressed={exportTab === 'json'} onClick={() => setExportTab('json')}>JSON</button>
            </div>
            <button type="button" className="demo-copy" onClick={() => void copy()}>Copy</button>
          </div>
          <pre><code>{code}</code></pre>
        </div>
      </aside>
    </div>
  </div>;
}
