import { afterEach, describe, expect, it } from 'vitest';
import { builtInIconPacks, defineIconPack, getIconPack, iconNames, listIconPacks, registerIconPack, resolveIconPack, unregisterIconPack } from '../src/icons.js';
import { builtInThemes, defineTheme } from '../src/themes.js';

afterEach(() => { unregisterIconPack('brand'); });

describe('icon packs', () => {
  it('ships the classic drawings and complete Halo, Viewfinder, Tabletop, Signal, Soft and Capital packs', () => {
    expect(listIconPacks().map(pack => pack.id)).toEqual(['classic', 'halo', 'viewfinder', 'tabletop', 'signal', 'soft', 'capital']);
    expect(builtInIconPacks.classic.icons).toEqual({});
    for (const pack of [builtInIconPacks.halo, builtInIconPacks.viewfinder, builtInIconPacks.tabletop, builtInIconPacks.signal, builtInIconPacks.soft, builtInIconPacks.capital]) {
      expect(Object.keys(pack.icons).sort()).toEqual([...iconNames].sort());
    }
    expect(builtInThemes.halo.icons).toBe('halo');
    expect(builtInThemes.capital.icons).toBe('capital');
    expect(resolveIconPack(builtInThemes.classic.icons)).toBe(builtInIconPacks.classic);
  });

  it('normalises glyphs to path lists with defaults', () => {
    const pack = defineIconPack({ id: 'brand', name: 'Brand', icons: { check: 'M5 12l4 4 10-10', close: [{ d: 'M6 6l12 12', paint: 'tint', opacity: 0.4 }] } });
    expect(pack.grid).toBe(24);
    expect(pack.strokeWidth).toBe(1.6);
    expect(pack.icons.check).toEqual([{ d: 'M5 12l4 4 10-10', paint: 'stroke', opacity: 1 }]);
    expect(pack.icons.close).toEqual([{ d: 'M6 6l12 12', paint: 'tint', opacity: 0.4 }]);
  });

  it('rejects markup, unknown icons and bad numbers', () => {
    expect(() => defineIconPack({ id: 'brand', name: 'Brand', icons: { check: 'M0 0"/><script>' } })).toThrow(/path commands/);
    expect(() => defineIconPack({ id: 'brand', name: 'Brand', icons: { logo: 'M0 0' } as never })).toThrow(/Unknown icon/);
    expect(() => defineIconPack({ id: 'brand', name: 'Brand', grid: 4, icons: {} })).toThrow(/grid/);
    expect(() => defineIconPack({ id: 'brand', name: 'Brand', icons: { check: [{ d: 'M0 0', opacity: 2 }] } })).toThrow(/opacity/);
    expect(() => defineIconPack({ id: 'brand', name: 'Brand', icons: { check: [{ d: 'M0 0', paint: 'url' as never }] } })).toThrow(/paint/);
  });

  it('registers packs by id and protects built-in ids', () => {
    registerIconPack({ id: 'brand', name: 'Brand', icons: { arrow: 'M4 12h16' } });
    expect(getIconPack('brand')?.icons.arrow?.[0]?.d).toBe('M4 12h16');
    expect(resolveIconPack('brand')).toBe(getIconPack('brand'));
    expect(() => registerIconPack({ id: 'halo', name: 'Halo', icons: {} })).toThrow(/built-in/);
    expect(unregisterIconPack('halo')).toBe(false);
    expect(unregisterIconPack('brand')).toBe(true);
    expect(() => resolveIconPack('brand')).toThrow(/Unknown icon pack/);
  });

  it('lets themes name, inherit and inline icon packs', () => {
    expect(defineTheme({ id: 'brand', name: 'Brand', extends: 'halo' }).icons).toBe('halo');
    expect(defineTheme({ id: 'brand', name: 'Brand', extends: 'halo', icons: 'classic' }).icons).toBe('classic');
    const inline = defineTheme({ id: 'brand', name: 'Brand', icons: { id: 'inline', name: 'Inline', icons: { check: 'M5 12l4 4 10-10' } } });
    expect(resolveIconPack(inline.icons).icons.check?.[0]?.paint).toBe('stroke');
    expect(() => defineTheme({ id: 'brand', name: 'Brand', icons: 'Not An Id' })).toThrow(/icon pack id/);
    expect(() => defineTheme({ id: 'brand', name: 'Brand', icons: { id: 'inline', name: 'Inline', icons: { check: '<svg>' } } })).toThrow(/path commands/);
  });
});
