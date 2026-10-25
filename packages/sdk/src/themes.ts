import { defineIconPack } from './icons.js';
import type { KycIconPack } from './icons.js';
import type { KycTheme } from './types.js';

/** Every visual decision of the capture flow. Values are CSS values unless noted. */
export interface KycThemeTokens {
  /** Selects light or dark browser controls and scrollbars. */
  colorScheme: 'light' | 'dark';
  color: {
    /** Primary buttons, selection and focus. */
    primary: string;
    /** Text and icons placed on `primary`. */
    onPrimary: string;
    /** Card background. */
    background: string;
    /** Soft fills: hover states, loading panels, simulated camera backgrounds. */
    surface: string;
    /** Background of a selected document type. */
    selected: string;
    text: string;
    muted: string;
    /** Hairlines, card border and unselected controls. */
    line: string;
    /** Secondary button border and radio outlines. */
    lineStrong: string;
    /** Face guide ring and matched states. */
    accent: string;
    /** Direction arrows and accent-coloured text. */
    accentText: string;
    /** Document guide when the photo is ready, auto-capture progress. */
    success: string;
    /** Document guide when the framing needs adjusting. */
    danger: string;
    /** Error detail text and its background. */
    noticeText: string;
    noticeSurface: string;
    /** Camera viewport background and the dimmed area around the document frame. */
    camera: string;
    cameraOverlay: string;
    /** Illustration tint and the white "paper" of illustrated cards. */
    illustration: string;
    paper: string;
    /** Keyboard focus outline. */
    focus: string;
  };
  font: {
    body: string;
    heading: string;
    /** Small technical labels such as the simulation banner. */
    mono: string;
  };
  type: {
    headingSize: string;
    headingWeight: string;
    headingTracking: string;
    /** Body text size inside the flow. */
    bodySize: string;
    buttonWeight: string;
  };
  shape: {
    /** Outer card radius. */
    radius: string;
    /** Buttons and document type cards. */
    control: string;
    /** Camera viewport and captured photo previews. */
    media: string;
  };
  elevation: {
    card: string;
    button: string;
  };
  /** CSS background layered behind the card content, e.g. gradients. Use `none` for a flat card. */
  backdrop: string;
  motion: {
    /** Easing for screen transitions and state changes. */
    easing: string;
    /** Easing for button presses and selections; overshoot curves feel springy. */
    press: string;
    /** Multiplies every duration. 1 is the default speed; larger is slower. */
    durationScale: number;
    /** How a new screen enters. */
    entrance: 'rise' | 'fade' | 'scale';
    /** Slowly drift the backdrop. Disabled automatically with reduced motion. */
    ambient: boolean;
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type KycThemeTokenOverrides = DeepPartial<KycThemeTokens>;

export interface KycThemeDefinition {
  /** Lowercase identifier, used as `data-kyc-theme` on the flow root. */
  id: string;
  name: string;
  description?: string;
  /**
   * Font stylesheets this theme expects, for example Google Fonts URLs.
   * KYC Lens never loads them itself: include them in your page, or self-host the fonts.
   */
  fonts?: readonly string[];
  /** Icon pack: a registered id such as `halo`, or an inline pack. Default: the built-in drawings. */
  icons?: string | KycIconPack;
  tokens: KycThemeTokens;
}

export interface KycThemeInput {
  id: string;
  name: string;
  description?: string;
  fonts?: readonly string[];
  /** Icon pack id or inline pack. Default: the base theme's pack. */
  icons?: string | KycIconPack;
  /** Base theme id or definition. Default: `classic`. */
  extends?: string | KycThemeDefinition;
  tokens?: KycThemeTokenOverrides;
}

const systemSans = '"Inter", "Segoe UI", system-ui, sans-serif';
const systemMono = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

const classic: KycThemeDefinition = {
  id: 'classic', name: 'Classic', description: 'The original KYC Lens look: clean white with a blue accent.',
  tokens: {
    colorScheme: 'light',
    color: {
      primary: '#2563eb', onPrimary: '#ffffff', background: '#ffffff', surface: '#f4f7fb', selected: '#f6f9ff',
      text: '#172b46', muted: '#677589', line: '#e5eaf2', lineStrong: '#d9e1eb',
      accent: '#2cc69b', accentText: '#149c76', success: '#34d399', danger: '#f87171',
      noticeText: '#855d3e', noticeSurface: '#fff7ef', camera: '#182230', cameraOverlay: 'rgb(7 15 26 / 35%)',
      illustration: '#2563eb', paper: '#ffffff', focus: '#2563eb',
    },
    font: { body: systemSans, heading: systemSans, mono: systemMono },
    type: { headingSize: '25px', headingWeight: '650', headingTracking: '-0.7px', bodySize: '14px', buttonWeight: '600' },
    shape: { radius: '28px', control: '13px', media: '18px' },
    elevation: { card: '0 18px 70px rgb(25 43 68 / 8%)', button: '0 5px 15px rgb(37 99 235 / 16%)' },
    backdrop: 'none',
    motion: { easing: 'cubic-bezier(0.22, 1, 0.36, 1)', press: 'cubic-bezier(0.22, 1, 0.36, 1)', durationScale: 1, entrance: 'rise', ambient: false },
  },
};

const aurora: KycThemeDefinition = {
  id: 'aurora', name: 'Aurora', description: 'Dark premium neobank: midnight glass with a drifting teal-to-violet glow.',
  fonts: ['https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap'],
  tokens: {
    colorScheme: 'dark',
    color: {
      primary: '#f3f6fc', onPrimary: '#070b14', background: '#0a0f1c', surface: 'rgb(255 255 255 / 6%)', selected: 'rgb(62 230 196 / 10%)',
      text: '#f3f6fc', muted: '#a3aec4', line: 'rgb(255 255 255 / 10%)', lineStrong: 'rgb(255 255 255 / 20%)',
      accent: '#3ee6c4', accentText: '#3ee6c4', success: '#3ee6c4', danger: '#ff8a7a',
      noticeText: '#ffc9bf', noticeSurface: 'rgb(255 138 122 / 10%)', camera: '#05080f', cameraOverlay: 'rgb(3 6 14 / 55%)',
      illustration: '#3ee6c4', paper: '#e8eefb', focus: '#3ee6c4',
    },
    font: { body: '"Manrope", "Inter", system-ui, sans-serif', heading: '"Manrope", "Inter", system-ui, sans-serif', mono: '"JetBrains Mono", ui-monospace, monospace' },
    type: { headingSize: '26px', headingWeight: '700', headingTracking: '-0.6px', bodySize: '14px', buttonWeight: '700' },
    shape: { radius: '30px', control: '16px', media: '24px' },
    elevation: {
      card: '0 30px 80px -20px rgb(0 0 0 / 70%), inset 0 1px 0 rgb(255 255 255 / 8%)',
      button: '0 0 0 1px rgb(255 255 255 / 35%), 0 12px 32px -10px rgb(79 124 255 / 60%)',
    },
    backdrop: 'radial-gradient(60% 45% at 15% 0%, rgb(62 230 196 / 22%), transparent 70%), radial-gradient(55% 50% at 100% 25%, rgb(154 107 255 / 24%), transparent 70%), radial-gradient(70% 50% at 50% 110%, rgb(79 124 255 / 24%), transparent 70%)',
    motion: { easing: 'cubic-bezier(0.22, 1, 0.36, 1)', press: 'cubic-bezier(0.22, 1, 0.36, 1)', durationScale: 1.2, entrance: 'scale', ambient: true },
  },
};

const ledger: KycThemeDefinition = {
  id: 'ledger', name: 'Ledger', description: 'Swiss editorial, private-bank grade: warm paper, ink type and a deep emerald accent.',
  fonts: ['https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap'],
  tokens: {
    colorScheme: 'light',
    color: {
      primary: '#0f5c4a', onPrimary: '#f9f8f4', background: '#f9f8f4', surface: '#f1efe8', selected: '#e3ece6',
      text: '#0e1116', muted: '#5d636c', line: '#dcd9cf', lineStrong: '#bab5a7',
      accent: '#0f5c4a', accentText: '#0f5c4a', success: '#2f8f6b', danger: '#b23c17',
      noticeText: '#8a2f12', noticeSurface: '#f6e9e2', camera: '#12161b', cameraOverlay: 'rgb(14 17 22 / 42%)',
      illustration: '#0f5c4a', paper: '#fffdf8', focus: '#0f5c4a',
    },
    font: { body: '"Inter", "Helvetica Neue", Arial, sans-serif', heading: '"Instrument Serif", "Iowan Old Style", Georgia, serif', mono: '"IBM Plex Mono", ui-monospace, monospace' },
    type: { headingSize: '32px', headingWeight: '400', headingTracking: '-0.3px', bodySize: '14px', buttonWeight: '500' },
    shape: { radius: '6px', control: '4px', media: '4px' },
    elevation: { card: '0 1px 0 #dcd9cf, 0 24px 60px -30px rgb(14 17 22 / 28%)', button: 'none' },
    backdrop: 'linear-gradient(#dcd9cf, #dcd9cf) top 44px left 28px / calc(100% - 56px) 1px no-repeat',
    motion: { easing: 'cubic-bezier(0.22, 1, 0.36, 1)', press: 'cubic-bezier(0.22, 1, 0.36, 1)', durationScale: 1.15, entrance: 'fade', ambient: false },
  },
};

const pebble: KycThemeDefinition = {
  id: 'pebble', name: 'Pebble', description: 'Soft, friendly fintech: lavender, chunky rounded shapes and springy motion.',
  fonts: ['https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap'],
  tokens: {
    colorScheme: 'light',
    color: {
      primary: '#5b4cf0', onPrimary: '#ffffff', background: '#ffffff', surface: '#f3f0ff', selected: '#f1eeff',
      text: '#1e1840', muted: '#625c80', line: '#ebe6fb', lineStrong: '#d9d2f5',
      accent: '#2fcf9c', accentText: '#17a87a', success: '#2fcf9c', danger: '#ff7a6b',
      noticeText: '#9a3a2f', noticeSurface: '#fff1ee', camera: '#2a2160', cameraOverlay: 'rgb(30 24 64 / 40%)',
      illustration: '#5b4cf0', paper: '#ffffff', focus: '#5b4cf0',
    },
    font: { body: '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif', heading: '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif', mono: '"Plus Jakarta Sans", system-ui, sans-serif' },
    type: { headingSize: '26px', headingWeight: '800', headingTracking: '-0.6px', bodySize: '14px', buttonWeight: '700' },
    shape: { radius: '32px', control: '20px', media: '24px' },
    elevation: { card: '0 2px 0 #ebe6fb, 0 30px 60px -24px rgb(91 76 240 / 28%)', button: '0 4px 0 #3a2bc0' },
    backdrop: 'radial-gradient(90% 40% at 50% 0%, rgb(91 76 240 / 9%), transparent 70%)',
    motion: { easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', press: 'cubic-bezier(0.34, 1.56, 0.64, 1)', durationScale: 1, entrance: 'scale', ambient: false },
  },
};

const halo: KycThemeDefinition = {
  id: 'halo', name: 'Halo', description: 'Airy verification app: white cards on a misty lavender glow, navy type and soft brackets.',
  fonts: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@600;700&display=swap'],
  icons: 'halo',
  tokens: {
    colorScheme: 'light',
    color: {
      primary: '#141b41', onPrimary: '#ffffff', background: '#ffffff', surface: '#f3f4fb', selected: '#f3f1ff',
      text: '#141b41', muted: '#646a82', line: '#eceef5', lineStrong: '#d9dcea',
      accent: '#8b7cf6', accentText: '#6a5ae0', success: '#3fbf87', danger: '#ef6f6a',
      noticeText: '#8f3d34', noticeSurface: '#fff2f0', camera: '#1c1e2c', cameraOverlay: 'rgb(18 20 38 / 40%)',
      illustration: '#8b7cf6', paper: '#ffffff', focus: '#6a5ae0',
    },
    font: { body: '"Inter", "Segoe UI", system-ui, sans-serif', heading: '"Inter Tight", "Inter", system-ui, sans-serif', mono: systemMono },
    type: { headingSize: '28px', headingWeight: '700', headingTracking: '-0.9px', bodySize: '14px', buttonWeight: '600' },
    shape: { radius: '34px', control: '14px', media: '28px' },
    elevation: {
      card: '0 0 0 12px rgb(255 255 255 / 55%), 0 30px 80px -30px rgb(84 92 160 / 28%)',
      button: '0 10px 24px -10px rgb(20 27 65 / 45%)',
    },
    backdrop: 'radial-gradient(50% 26% at 45% 40%, rgb(167 139 250 / 20%), transparent 70%), radial-gradient(34% 22% at 68% 48%, rgb(244 114 182 / 14%), transparent 70%)',
    motion: { easing: 'cubic-bezier(0.22, 1, 0.36, 1)', press: 'cubic-bezier(0.22, 1, 0.36, 1)', durationScale: 1, entrance: 'rise', ambient: false },
  },
};

/** Themes that ship with KYC Lens. `classic` is the default. */
export const builtInThemes = { classic, aurora, ledger, pebble, halo } as const;
export type KycBuiltInThemeId = keyof typeof builtInThemes;

const registry = new Map<string, KycThemeDefinition>(Object.values(builtInThemes).map(theme => [theme.id, theme]));

// Rejects anything that could close a declaration or block when variables are written as CSS text.
const unsafeValue = /[;{}<>\\]|\/\*|@import|expression\(|javascript:/i;

function checkValue(path: string, value: unknown): void {
  if (path === 'motion.durationScale') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 4) throw new Error(`Theme token ${path} must be a number between 0.25 and 4.`);
    return;
  }
  if (path === 'motion.ambient') { if (typeof value !== 'boolean') throw new Error(`Theme token ${path} must be true or false.`); return; }
  if (path === 'motion.entrance') { if (value !== 'rise' && value !== 'fade' && value !== 'scale') throw new Error(`Theme token ${path} must be rise, fade or scale.`); return; }
  if (path === 'colorScheme') { if (value !== 'light' && value !== 'dark') throw new Error('Theme token colorScheme must be light or dark.'); return; }
  if (typeof value !== 'string' || value.trim() === '' || value.length > 600 || unsafeValue.test(value)) throw new Error(`Theme token ${path} must be a non-empty CSS value without ; { } < > or comments.`);
}

function merge(base: KycThemeTokens, overrides: KycThemeTokenOverrides | undefined): KycThemeTokens {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) continue;
    const current = result[key];
    if (!(key in result)) throw new Error(`Unknown theme token group "${key}".`);
    if (current && typeof current === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Theme token group "${key}" must be an object.`);
      for (const [name, token] of Object.entries(value)) {
        if (token === undefined) continue;
        if (!(name in current)) throw new Error(`Unknown theme token "${key}.${name}".`);
        checkValue(`${key}.${name}`, token);
        (current as Record<string, unknown>)[name] = token;
      }
    } else { checkValue(key, value); result[key] = value; }
  }
  return result as unknown as KycThemeTokens;
}

/** Create a complete theme from a base theme and partial token overrides. */
export function defineTheme(input: KycThemeInput): KycThemeDefinition {
  if (!input || typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(input.id)) throw new Error('Theme id must start with a letter and use 1-48 lowercase letters, digits or hyphens.');
  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 80) throw new Error('Theme name must be 1-80 characters.');
  const base = typeof input.extends === 'object' ? input.extends : getTheme(input.extends ?? 'classic');
  if (!base) throw new Error(`Unknown base theme "${String(input.extends)}".`);
  if (input.fonts !== undefined && (!Array.isArray(input.fonts) || input.fonts.some(url => typeof url !== 'string' || !/^https:\/\//.test(url)))) throw new Error('Theme fonts must be https stylesheet URLs.');
  const icons = input.icons ?? base.icons;
  // Pack ids are looked up when the flow renders, so a pack can be registered after the theme.
  if (typeof icons === 'string' && !/^[a-z][a-z0-9-]{0,47}$/.test(icons)) throw new Error('Theme icons must be an icon pack id or an icon pack.');
  return {
    id: input.id, name: input.name.trim(),
    ...(input.description ? { description: String(input.description).slice(0, 240) } : {}),
    ...(input.fonts ?? base.fonts ? { fonts: [...(input.fonts ?? base.fonts ?? [])] } : {}),
    ...(icons === undefined ? {} : { icons: typeof icons === 'string' ? icons : defineIconPack(icons) }),
    tokens: merge(base.tokens, input.tokens),
  };
}

/** Make a theme available by id, for example `<KycFlow theme="brand" />`. Built-in themes cannot be replaced. */
export function registerTheme(theme: KycThemeDefinition | KycThemeInput): KycThemeDefinition {
  // Full definitions pass through defineTheme too, so stored or user-built themes are validated.
  const definition = defineTheme(theme);
  if (definition.id in builtInThemes) throw new Error(`"${definition.id}" is a built-in theme id.`);
  registry.set(definition.id, definition);
  return definition;
}
export function unregisterTheme(id: string): boolean {
  return id in builtInThemes ? false : registry.delete(id);
}
export function getTheme(id: string): KycThemeDefinition | undefined { return registry.get(id); }
export function listThemes(): KycThemeDefinition[] { return [...registry.values()]; }

function isDefinition(theme: unknown): theme is KycThemeDefinition {
  return Boolean(theme) && typeof theme === 'object' && 'tokens' in (theme as object) && 'id' in (theme as object);
}

/** Resolve the `theme` prop: a registered id, a theme definition, or the legacy flat `KycTheme` object. */
export function resolveTheme(theme: string | KycTheme | KycThemeDefinition | undefined): KycThemeDefinition {
  if (theme === undefined) return classic;
  if (typeof theme === 'string') {
    const found = getTheme(theme);
    if (!found) throw new Error(`Unknown theme "${theme}". Register it with registerTheme() first.`);
    return found;
  }
  if (isDefinition(theme)) return defineTheme(theme);
  const legacy = theme as KycTheme;
  return defineTheme({
    id: 'custom', name: 'Custom', extends: classic,
    tokens: {
      color: {
        ...(legacy.primaryColor ? { primary: legacy.primaryColor, illustration: legacy.primaryColor, focus: legacy.primaryColor } : {}),
        ...(legacy.backgroundColor ? { background: legacy.backgroundColor, paper: legacy.backgroundColor } : {}),
        ...(legacy.textColor ? { text: legacy.textColor } : {}),
      },
      ...(legacy.borderRadius ? { shape: { radius: legacy.borderRadius } } : {}),
      ...(legacy.fontFamily ? { font: { body: legacy.fontFamily, heading: legacy.fontFamily } } : {}),
    },
  });
}

const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

/** CSS custom properties for a theme, e.g. `--kyc-color-primary`. */
export function themeVariables(theme: KycThemeDefinition): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [group, value] of Object.entries(theme.tokens)) {
    if (value && typeof value === 'object') for (const [name, token] of Object.entries(value)) variables[`--kyc-${group}-${kebab(name)}`] = String(token);
    else variables[`--kyc-${kebab(group)}`] = String(value);
  }
  return variables;
}

/** A static stylesheet for a theme, for server rendering or non-React pages. */
export function themeCss(theme: KycThemeDefinition, selector = `.kyc-kit[data-kyc-theme="${theme.id}"]`): string {
  const body = Object.entries(themeVariables(theme)).map(([name, value]) => `  ${name}: ${value};`).join('\n');
  return `${selector} {\n${body}\n}\n`;
}
