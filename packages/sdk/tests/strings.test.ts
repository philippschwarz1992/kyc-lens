import { describe, expect, it } from 'vitest';
import { english, getStrings, locales, type KycLocale } from '../src/react/strings.js';

const englishKeys = Object.keys(english).sort();

describe('strings', () => {
  it('ships every built-in locale with exactly the English keys and no empty values', () => {
    expect(Object.keys(locales).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pl', 'tr']);
    for (const [locale, table] of Object.entries(locales)) {
      expect(Object.keys(table).sort(), locale).toEqual(englishKeys);
      for (const [key, value] of Object.entries(table)) expect(value.trim(), `${locale}.${key}`).not.toBe('');
    }
  });

  it('uses the KYC Lens brand in every locale', () => {
    for (const table of Object.values(locales)) expect(table.brand).toBe('KYC Lens');
  });

  it('returns the selected locale and falls back to English', () => {
    expect(getStrings()).toEqual(english);
    expect(getStrings('fr').start).toBe(locales.fr.start);
    expect(getStrings('tr').cancel).toBe(locales.tr.cancel);
    expect(getStrings('xx' as KycLocale).start).toBe(english.start);
  });

  it('merges custom overrides without mutating the built-in tables', () => {
    const strings = getStrings('de', { start: 'Los geht’s', cancel: undefined, customKey: 'Custom' });
    expect(strings.start).toBe('Los geht’s');
    expect(strings.cancel).toBe(locales.de.cancel);
    expect(strings.customKey).toBe('Custom');
    expect(locales.de.start).not.toBe('Los geht’s');
  });
});
