import { afterEach, describe, expect, it } from 'vitest';
import { builtInThemes, defineTheme, getTheme, listThemes, registerTheme, resolveTheme, themeCss, themeVariables, unregisterTheme } from '../src/themes.js';

afterEach(() => { unregisterTheme('brand'); });

describe('themes', () => {
  it('ships six complete built-in themes with the same token shape', () => {
    expect(Object.keys(builtInThemes)).toEqual(['classic', 'aurora', 'ledger', 'pebble', 'halo', 'capital']);
    const names = Object.keys(themeVariables(builtInThemes.classic)).sort();
    for (const theme of Object.values(builtInThemes)) {
      expect(Object.keys(themeVariables(theme)).sort()).toEqual(names);
      expect(() => defineTheme({ id: `copy-${theme.id}`, name: 'Copy', extends: theme, tokens: theme.tokens })).not.toThrow();
    }
    expect(listThemes().map(theme => theme.id)).toEqual(['classic', 'aurora', 'ledger', 'pebble', 'halo', 'capital']);
  });

  it('extends a base theme with partial overrides without changing the base', () => {
    const theme = defineTheme({ id: 'brand', name: 'Brand', extends: 'ledger', tokens: { color: { primary: '#123456' }, shape: { radius: '12px' } } });
    expect(theme.tokens.color.primary).toBe('#123456');
    expect(theme.tokens.color.background).toBe(builtInThemes.ledger.tokens.color.background);
    expect(theme.tokens.font.heading).toBe(builtInThemes.ledger.tokens.font.heading);
    expect(theme.fonts).toEqual(builtInThemes.ledger.fonts);
    expect(builtInThemes.ledger.tokens.color.primary).toBe('#0f5c4a');
  });

  it('registers custom themes by id and protects built-in ids', () => {
    registerTheme({ id: 'brand', name: 'Brand', extends: 'pebble', tokens: { color: { primary: '#ff0066' } } });
    expect(getTheme('brand')?.tokens.color.primary).toBe('#ff0066');
    expect(resolveTheme('brand').tokens.shape.radius).toBe(builtInThemes.pebble.tokens.shape.radius);
    expect(() => registerTheme({ id: 'aurora', name: 'Aurora' })).toThrow(/built-in/);
    expect(unregisterTheme('aurora')).toBe(false);
    expect(unregisterTheme('brand')).toBe(true);
    expect(() => resolveTheme('brand')).toThrow(/Unknown theme/);
  });

  it('maps the quick KycTheme overrides onto the classic theme', () => {
    const theme = resolveTheme({ primaryColor: '#0f766e', borderRadius: '24px', fontFamily: 'Georgia, serif' });
    expect(theme.tokens.color.primary).toBe('#0f766e');
    expect(theme.tokens.color.illustration).toBe('#0f766e');
    expect(theme.tokens.shape.radius).toBe('24px');
    expect(theme.tokens.font.heading).toBe('Georgia, serif');
    expect(resolveTheme(undefined)).toBe(builtInThemes.classic);
  });

  it('rejects unknown tokens, invalid ids and values that could escape a declaration', () => {
    expect(() => defineTheme({ id: 'Brand', name: 'Brand' })).toThrow(/id/);
    expect(() => defineTheme({ id: 'brand', name: '' })).toThrow(/name/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', extends: 'missing' })).toThrow(/base theme/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', tokens: { color: { nope: '#fff' } as never } })).toThrow(/Unknown theme token/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', tokens: { color: { primary: 'red; } body { display: none' } } })).toThrow(/CSS value/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', tokens: { backdrop: 'url(x) /* */' } })).toThrow(/CSS value/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', tokens: { motion: { durationScale: 9 } } })).toThrow(/between/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', tokens: { motion: { entrance: 'spin' as never } } })).toThrow(/entrance/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', fonts: ['http://insecure.example/font.css'] })).toThrow(/https/);
  });

  it('writes CSS variables and a scoped stylesheet', () => {
    const variables = themeVariables(builtInThemes.aurora);
    expect(variables['--kyc-color-primary']).toBe('#f3f6fc');
    expect(variables['--kyc-motion-duration-scale']).toBe('1.2');
    expect(variables['--kyc-color-scheme']).toBe('dark');
    const css = themeCss(builtInThemes.pebble);
    expect(css.startsWith('.kyc-kit[data-kyc-theme="pebble"] {')).toBe(true);
    expect(css).toContain('--kyc-shape-radius: 32px;');
  });
});
