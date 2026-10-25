import { useEffect } from 'react';
import { builtInThemes, defineTheme } from '@sdk/index';
import type { KycThemeDefinition, KycThemeTokens } from '@sdk/index';

/** A playground theme saved in this browser, with the built-in theme it started from. */
export interface StoredTheme { base: string; theme: KycThemeDefinition }

const storageKey = 'kyc-lens-demo-themes';
const builtIns = Object.values(builtInThemes) as KycThemeDefinition[];

export function isBuiltIn(id: string): boolean { return id in builtInThemes; }

export function loadThemes(): StoredTheme[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const result: StoredTheme[] = [];
    for (const item of parsed.slice(0, 50)) {
      try {
        const base = typeof item?.base === 'string' && isBuiltIn(item.base) ? item.base : 'classic';
        // Stored values pass the same validation as code-defined themes.
        const theme = defineTheme({ ...item.theme, extends: base });
        if (!isBuiltIn(theme.id) && !result.some(saved => saved.theme.id === theme.id)) result.push({ base, theme });
      } catch { /* Skip themes that no longer validate. */ }
    }
    return result;
  } catch { return []; }
}

export function saveThemes(themes: StoredTheme[]): boolean {
  try { localStorage.setItem(storageKey, JSON.stringify(themes)); return true; }
  catch { return false; }
}

export function allThemes(saved = loadThemes()): KycThemeDefinition[] {
  return [...builtIns, ...saved.map(item => item.theme)];
}

export function findTheme(id: string, saved = loadThemes()): KycThemeDefinition | undefined {
  return allThemes(saved).find(theme => theme.id === id);
}

export function uniqueId(name: string, taken: readonly string[]): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40) || 'theme';
  let id = stem; let index = 2;
  while (taken.includes(id)) id = `${stem}-${index++}`;
  return id;
}

/** Only the tokens that differ from the base theme, for compact generated code. */
export function tokenChanges(theme: KycThemeTokens, base: KycThemeTokens): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [group, value] of Object.entries(theme)) {
    const original = (base as unknown as Record<string, unknown>)[group];
    if (value && typeof value === 'object') {
      const changed = Object.fromEntries(Object.entries(value).filter(([name, token]) => (original as Record<string, unknown>)[name] !== token));
      if (Object.keys(changed).length) changes[group] = changed;
    } else if (value !== original) changes[group] = value;
  }
  return changes;
}

/** The playground loads theme fonts itself; the library never fetches fonts. */
export function useThemeFonts(themes: readonly (KycThemeDefinition | undefined)[]) {
  const urls = [...new Set(themes.flatMap(theme => theme?.fonts ?? []))].filter(url => url.startsWith('https://fonts.googleapis.com/'));
  const key = urls.join('|');
  useEffect(() => {
    for (const url of urls) {
      if ([...document.querySelectorAll<HTMLLinkElement>('link[data-theme-font]')].some(link => link.href === url)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = url; link.dataset.themeFont = '';
      document.head.append(link);
    }
  }, [key]);
}
