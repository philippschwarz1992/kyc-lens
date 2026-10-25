/** Every icon the capture flow draws. */
export const iconNames = ['arrow', 'back', 'check', 'camera', 'sun', 'face', 'shield', 'refresh', 'close', 'upload', 'switchCamera', 'flash', 'idCard', 'license', 'passport'] as const;
export type KycIconName = typeof iconNames[number];

/** One SVG path of an icon. */
export interface KycIconPath {
  /** SVG path data, for example `M5 12h14`. Only path commands and numbers are allowed. */
  d: string;
  /** `stroke` (default) outlines with the text color, `fill` fills with the text color, `tint` fills with `color.illustration`. */
  paint?: 'stroke' | 'fill' | 'tint';
  /** 0–1. Default 1. */
  opacity?: number;
}
/** A path data string, or several paths drawn in order (later paths on top). */
export type KycIconGlyph = string | readonly (string | KycIconPath)[];

export interface KycIconPack {
  /** Lowercase identifier, used as `data-kyc-icons` on the flow root. */
  id: string;
  name: string;
  description?: string;
  /** Size of the square drawing grid. Default 24. */
  grid?: number;
  /** Stroke width in grid units. Default 1.6. */
  strokeWidth?: number;
  /** Icons this pack replaces. Missing icons use the built-in drawing. */
  icons: Partial<Record<KycIconName, KycIconGlyph>>;
}

/** An icon pack with every glyph normalised to a list of paths. */
export interface KycResolvedIconPack {
  id: string; name: string; description?: string; grid: number; strokeWidth: number;
  icons: Partial<Record<KycIconName, readonly Required<KycIconPath>[]>>;
}

const pathData = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]+$/;

/** Validate an icon pack. Path data may only contain SVG path commands and numbers, so a stored pack cannot inject markup. */
export function defineIconPack(input: KycIconPack): KycResolvedIconPack {
  if (!input || typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(input.id)) throw new Error('Icon pack id must start with a letter and use 1-48 lowercase letters, digits or hyphens.');
  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 80) throw new Error('Icon pack name must be 1-80 characters.');
  const grid = input.grid ?? 24;
  if (typeof grid !== 'number' || !Number.isFinite(grid) || grid < 8 || grid > 96) throw new Error('Icon pack grid must be a number between 8 and 96.');
  const strokeWidth = input.strokeWidth ?? 1.6;
  if (typeof strokeWidth !== 'number' || !Number.isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > grid / 4) throw new Error('Icon pack strokeWidth must be between 0 and a quarter of the grid.');
  if (!input.icons || typeof input.icons !== 'object' || Array.isArray(input.icons)) throw new Error('Icon pack icons must be an object.');
  const icons: KycResolvedIconPack['icons'] = {};
  for (const [name, glyph] of Object.entries(input.icons)) {
    if (glyph === undefined) continue;
    if (!(iconNames as readonly string[]).includes(name)) throw new Error(`Unknown icon "${name}".`);
    const parts = typeof glyph === 'string' ? [glyph] : glyph;
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 16) throw new Error(`Icon ${name} must be path data or a list of 1-16 paths.`);
    icons[name as KycIconName] = parts.map(part => {
      const path = typeof part === 'string' ? { d: part } : part;
      if (!path || typeof path.d !== 'string' || path.d.length > 2000 || !pathData.test(path.d)) throw new Error(`Icon ${name} path data may only contain SVG path commands and numbers.`);
      const paint = path.paint ?? 'stroke';
      if (paint !== 'stroke' && paint !== 'fill' && paint !== 'tint') throw new Error(`Icon ${name} paint must be stroke, fill or tint.`);
      const opacity = path.opacity ?? 1;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`Icon ${name} opacity must be between 0 and 1.`);
      return { d: path.d.trim(), paint, opacity };
    });
  }
  return { id: input.id, name: input.name.trim(), ...(input.description ? { description: String(input.description).slice(0, 240) } : {}), grid, strokeWidth, icons };
}

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const rect = (x: number, y: number, width: number, height: number, r: number) =>
  `M${x + r} ${y}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(width - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(height - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const tint = (d: string, opacity = 0.35): KycIconPath => ({ d, paint: 'tint', opacity });
const cameraBody = 'M8.6 6.5l1.1-1.8c.3-.4.7-.7 1.2-.7h2.2c.5 0 .9.3 1.2.7l1.1 1.8H18a3 3 0 0 1 3 3V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9.5a3 3 0 0 1 3-3z';

/** The drawings the flow ships with. An empty pack: every icon uses the built-in drawing. */
const classic = defineIconPack({ id: 'classic', name: 'Classic', description: 'The built-in thin-line icons.', icons: {} });

const halo = defineIconPack({
  id: 'halo', name: 'Halo', description: 'Rounded outline icons with a soft lavender fill, drawn for the Halo theme.',
  strokeWidth: 1.5,
  icons: {
    arrow: ['M5 12h14', 'M13.5 6.5 19 12l-5.5 5.5'],
    back: 'M14.5 5.5 8 12l6.5 6.5',
    check: 'm5.5 12.5 4 4 9-9.5',
    close: 'M7 7l10 10M17 7 7 17',
    camera: [tint(cameraBody, 0.18), cameraBody, tint(circle(12, 13.2, 3.4), 0.45), circle(12, 13.2, 3.4)],
    sun: [tint(circle(12, 12, 4)), circle(12, 12, 4), 'M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1'],
    face: ['M4 8.5V7a3 3 0 0 1 3-3h1.5M15.5 4H17a3 3 0 0 1 3 3v1.5M20 15.5V17a3 3 0 0 1-3 3h-1.5M8.5 20H7a3 3 0 0 1-3-3v-1.5', tint(circle(12, 12, 5.2), 0.3), 'M9.8 10.2v.8M14.2 10.2v.8', 'M9.6 13.8c1.3 1.3 3.5 1.3 4.8 0'],
    shield: [tint('M12 3.5 19 6v5.5c0 4.4-3.1 7.6-7 9-3.9-1.4-7-4.6-7-9V6z', 0.3), 'M12 3.5 19 6v5.5c0 4.4-3.1 7.6-7 9-3.9-1.4-7-4.6-7-9V6z', 'm9 12 2 2 4-4.5'],
    refresh: ['M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9', 'M19.5 4.5V9H15', 'M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15', 'M4.5 19.5V15H9'],
    upload: ['M12 15V4.5', 'M7.5 9 12 4.5 16.5 9', 'M4.5 14.5V17a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-2.5'],
    switchCamera: [tint(cameraBody, 0.18), cameraBody, 'M9 13a3 3 0 0 1 5.3-1.9', 'M15 13.4a3 3 0 0 1-5.3 1.9', 'M14.6 9v2.2h-2.2', 'M9.4 17.6v-2.2h2.2'],
    flash: [tint('M13.2 3.5 6 13.2h5.3l-.8 7.3 7.5-9.8h-5.3z', 0.3), 'M13.2 3.5 6 13.2h5.3l-.8 7.3 7.5-9.8h-5.3z'],
    idCard: [rect(5, 3, 14, 18, 3), 'M10.2 6.2h3.6', tint(circle(12, 11, 2.6), 0.5), circle(12, 11, 2.6), 'M8.4 17.4c.6-1.9 2-2.9 3.6-2.9s3 1 3.6 2.9'],
    license: [rect(3, 5.5, 18, 13, 3), tint(circle(8.5, 10.6, 2.1), 0.5), circle(8.5, 10.6, 2.1), 'M5.8 15.6c.5-1.5 1.5-2.2 2.7-2.2s2.2.7 2.7 2.2', 'M14 10h4M14 13.5h2.5'],
    passport: [rect(5, 3, 14, 18, 2.5), tint(circle(12, 10.2, 3.3), 0.4), circle(12, 10.2, 3.3), 'M8.7 10.2h6.6M12 6.9c-.9.9-1.4 2-1.4 3.3s.5 2.4 1.4 3.3c.9-.9 1.4-2 1.4-3.3s-.5-2.4-1.4-3.3', 'M9.5 17h5'],
  },
});

// Solid shapes knock out holes with the nonzero rule: circle() winds counter-clockwise and rect() clockwise,
// so a hole is a subpath in the same `d` that winds the other way (disc() clockwise, hole() counter-clockwise).
const disc = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0z`;
const hole = (x: number, y: number, width: number, height: number, r: number) =>
  `M${x + r} ${y}a${r} ${r} 0 0 0 ${-r} ${r}v${height - 2 * r}a${r} ${r} 0 0 0 ${r} ${r}h${width - 2 * r}a${r} ${r} 0 0 0 ${r} ${-r}v${-(height - 2 * r)}a${r} ${r} 0 0 0 ${-r} ${-r}z`;
const fill = (d: string, opacity = 1): KycIconPath => ({ d, paint: 'fill', opacity });
const shieldShape = 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z';
const refreshArrows = ['M20 7v5h-5M4 17v-5h5', 'M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1'];
const switchArrows = ['M8.5 13a3.5 3.5 0 0 1 6-2.4M15.5 13a3.5 3.5 0 0 1-6 2.4', 'M14.8 8.6v2h-2M9.2 17.4v-2h2'];
const globe = 'M8.6 10h6.8M12 6.6c-1 .9-1.5 2.1-1.5 3.4s.5 2.5 1.5 3.4c1-.9 1.5-2.1 1.5-3.4s-.5-2.5-1.5-3.4';

const viewfinder = defineIconPack({
  id: 'viewfinder', name: 'Viewfinder', description: 'Thin monoline icons that match the Viewfinder illustrations.',
  icons: {
    arrow: 'M5 12h14M13 6l6 6-6 6',
    back: 'm15 5-7 7 7 7',
    check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6',
    camera: ['M4 6h4l2-2h4l2 2h4v14H4z', circle(12, 13, 4)],
    sun: [circle(12, 12, 4), 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
    face: ['M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4', 'M8 9h.01M16 9h.01M8 14c1 3 7 3 8 0'],
    shield: [shieldShape, 'm8 12 3 3 5-6'],
    refresh: refreshArrows,
    upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
    switchCamera: ['M4 7h3l2-2h6l2 2h3v12H4z', 'M8.5 12a3.5 3.5 0 0 1 6-2.4M15.5 12a3.5 3.5 0 0 1-6 2.4', 'M14.8 7.6v2h-2M9.2 16.4v-2h2'],
    flash: 'M13 3 5 14h6l-1 7 8-11h-6z',
    idCard: [rect(3, 5.5, 18, 13, 2.5), circle(8.5, 10.5, 2), 'M5.8 15.5c.5-1.6 1.5-2.3 2.7-2.3s2.2.7 2.7 2.3M14 10h4M14 13.5h3'],
    license: [rect(3, 5.5, 18, 13, 2.5), circle(8.5, 10.5, 2), 'M5.8 15.5c.5-1.6 1.5-2.3 2.7-2.3s2.2.7 2.7 2.3M14 9.5h4', 'M13.5 15.5v-1.8l1-1.7h3l1 1.7v1.8z'],
    passport: [rect(5, 3, 14, 18, 2), circle(12, 10.5, 3.2), 'M8.8 10.5h6.4M12 7.3c-1 .9-1.5 2-1.5 3.2s.5 2.3 1.5 3.2c1-.9 1.5-2 1.5-3.2s-.5-2.3-1.5-3.2M9 17h6'],
  },
});

const tabletop = defineIconPack({
  id: 'tabletop', name: 'Tabletop', description: 'Flat tonal shapes with solid details in the text color, no outlines.',
  strokeWidth: 2,
  icons: {
    arrow: [fill(circle(12, 12, 10), 0.18), 'M6.5 12h11M13 7.5l4.5 4.5-4.5 4.5'],
    back: [fill(circle(12, 12, 10), 0.18), 'm13.5 7.5-4.5 4.5 4.5 4.5'],
    check: [fill(circle(12, 12, 10), 0.3), 'm7.5 12.2 3 3 6-6.4'],
    close: [fill(circle(12, 12, 10), 0.18), 'm8.5 8.5 7 7M8.5 15.5l7-7'],
    camera: [fill('M3 7h4.5l2-2.5h5L16.5 7H21v13H3z', 0.3), fill(circle(12, 13.5, 4))],
    sun: [fill(circle(12, 12, 9), 0.22), fill(circle(12, 12, 4.5))],
    face: [fill(circle(12, 12, 10), 0.3), fill(circle(9, 10.5, 1.4)), fill(circle(15, 10.5, 1.4)), 'M8.5 14.5c1.5 2 5.5 2 7 0'],
    shield: [fill('m12 2.5 8.5 3.2v6.3c0 5.3-8.5 9.5-8.5 9.5s-8.5-4.2-8.5-9.5V5.7z', 0.3), 'm8.5 12 2.5 2.5 4.5-5'],
    refresh: [fill(circle(12, 12, 6.5), 0.22), ...refreshArrows],
    upload: [fill(rect(3, 14, 18, 7, 2), 0.3), 'M12 15V3.5m-5 5 5-5 5 5'],
    switchCamera: [fill('M3 7h4l2-2.5h6L17 7h4v12H3z', 0.3), ...switchArrows],
    flash: [fill('M13 3 5 14h6l-1 7 8-11h-6z', 0.3), fill('M11 14l-1 7 8-11h-6z')],
    idCard: [fill(rect(3, 5, 18, 14, 2.5), 0.3), fill(rect(5.5, 8, 5, 6.5, 1)), 'M13 9.5h5M13 12.5h3.5'],
    license: [fill(rect(3, 5, 18, 14, 2.5), 0.3), fill(rect(5.5, 8, 5, 6.5, 1)), 'M13 9.5h5', fill('M13 16.5v-1.8l1-1.7h3l1 1.7v1.8z')],
    passport: [fill(rect(5, 2.5, 14, 19, 2.5), 0.3), fill(circle(12, 10.5, 3.6)), 'M9 17.5h6'],
  },
});

const portraitHole = circle(8, 10, 2.2) + 'M11.2 16.5c0-2.2-1.4-3.6-3.2-3.6s-3.2 1.4-3.2 3.6z';
const signal = defineIconPack({
  id: 'signal', name: 'Signal', description: 'Bold solid pictograms with cut-out details, like wayfinding signs.',
  strokeWidth: 2.4,
  icons: {
    arrow: 'M4 12h15M13 5.5l6.5 6.5-6.5 6.5',
    back: 'm15 4.5-7.5 7.5 7.5 7.5',
    check: [fill(disc(12, 12, 10) + 'M6.9 12.6 10.6 16.3 17.4 9 15.6 7.3 10.6 12.7 8.7 10.8z')],
    close: 'm6 6 12 12M6 18 18 6',
    camera: [fill(cameraBody + circle(12, 13.2, 3.4))],
    sun: [fill(circle(12, 12, 5)), 'M12 1.5v2.5m0 16v2.5M1.5 12H4m16 0h2.5M4.6 4.6l1.8 1.8m11.2 11.2 1.8 1.8M4.6 19.4l1.8-1.8m11.2-11.2 1.8-1.8'],
    face: ['M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5', fill(circle(12, 12, 5.5) + disc(10, 11, 1.1) + disc(14, 11, 1.1))],
    shield: [fill('M12 2.5 20.5 5.7V12c0 5.3-8.5 9.5-8.5 9.5S3.5 17.3 3.5 12V5.7z' + 'M8.3 12.7 11 15.4 15.8 10.2 14.3 8.8 11 12.5 9.7 11.3z')],
    refresh: refreshArrows,
    upload: ['M12 14V3.5M6.5 9 12 3.5 17.5 9', fill(rect(3, 16, 18, 5, 1.5))],
    switchCamera: [cameraBody, 'M9 13a3 3 0 0 1 5.3-1.9', 'M15 13.4a3 3 0 0 1-5.3 1.9', 'M14.6 9v2.2h-2.2', 'M9.4 17.6v-2.2h2.2'],
    flash: [fill('M13.5 2 4.5 14h6.5l-1 8 9-12.5h-6.5z')],
    idCard: [fill(rect(2, 4.5, 20, 15, 3) + portraitHole + hole(13, 8.6, 6, 2, 1) + hole(13, 12.4, 4, 2, 1))],
    license: [fill(rect(2, 4.5, 20, 15, 3) + portraitHole + hole(13, 8.6, 6, 2, 1) + 'M13 16.5H19V14.7L17.9 12.9H14.1L13 14.7z')],
    passport: [fill(rect(4.5, 2, 15, 20, 2.8) + circle(12, 10.5, 3.8) + hole(9, 17, 6, 2, 1)), fill(rect(8.2, 9.9, 7.6, 1.2, 0.6))],
  },
});

const softCamera = 'M3.5 7.5h4l1.8-2.5h5.4l1.8 2.5h4V19h-17z';
const softFlash = 'M13 3 5 14h6l-1 7 8-11h-6z';
const soft = defineIconPack({
  id: 'soft', name: 'Soft', description: 'Duotone icons: an ink outline over a pastel fill in the illustration color.',
  strokeWidth: 1.5,
  icons: {
    arrow: 'M5 12h14M13 6l6 6-6 6',
    back: 'm15 5-7 7 7 7',
    check: [tint(circle(12, 12, 9), 0.3), circle(12, 12, 9), 'm8 12.2 2.8 2.8 5.2-5.8'],
    close: 'm6 6 12 12M6 18 18 6',
    camera: [tint(softCamera, 0.3), softCamera, circle(12, 13, 3.5)],
    sun: [tint(circle(12, 12, 4), 0.4), circle(12, 12, 4), 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
    face: ['M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4', tint(circle(12, 12, 5), 0.3), circle(12, 12, 5), 'M10.2 11h.01M13.8 11h.01', 'M10 13.5c1 1.2 3 1.2 4 0'],
    shield: [tint(shieldShape, 0.3), shieldShape, 'm8.5 12 2.5 2.5 4.5-5'],
    refresh: refreshArrows,
    upload: [tint(rect(4, 15, 16, 5, 1.5), 0.3), rect(4, 15, 16, 5, 1.5), 'M12 15V4m-4.5 4.5L12 4l4.5 4.5'],
    switchCamera: [tint('M3.5 7.5h3.5l2-2.5h6l2 2.5h3.5V19h-17z', 0.3), 'M3.5 7.5h3.5l2-2.5h6l2 2.5h3.5V19h-17z', ...switchArrows],
    flash: [tint(softFlash, 0.4), softFlash],
    idCard: [rect(5, 3, 14, 18, 3), tint(circle(12, 9.5, 2.4), 0.5), circle(12, 9.5, 2.4), 'M8.3 15.5c.6-1.9 2-2.9 3.7-2.9s3.1 1 3.7 2.9M9.5 18.2h5'],
    license: [rect(3, 5.5, 18, 13, 3), tint(circle(8.5, 12, 3), 0.4), circle(8.5, 12, 3), 'M14 9.5h4.5M14 12.2h3M14 14.8h4'],
    passport: [tint(rect(5, 3, 14, 18, 2.5), 0.25), rect(5, 3, 14, 18, 2.5), circle(12, 10, 3.4), globe, 'M9.5 17h5'],
  },
});

/** Icon packs that ship with KYC Lens. `classic` is the built-in drawing set. */
export const builtInIconPacks = { classic, halo, viewfinder, tabletop, signal, soft } as const;
export type KycBuiltInIconPackId = keyof typeof builtInIconPacks;

const registry = new Map<string, KycResolvedIconPack>(Object.values(builtInIconPacks).map(pack => [pack.id, pack]));

/** Make an icon pack available by id, for example `registerTheme({ ..., icons: 'brand' })`. Built-in packs cannot be replaced. */
export function registerIconPack(pack: KycIconPack): KycResolvedIconPack {
  const definition = defineIconPack(pack);
  if (definition.id in builtInIconPacks) throw new Error(`"${definition.id}" is a built-in icon pack id.`);
  registry.set(definition.id, definition);
  return definition;
}
export function unregisterIconPack(id: string): boolean {
  return id in builtInIconPacks ? false : registry.delete(id);
}
export function getIconPack(id: string): KycResolvedIconPack | undefined { return registry.get(id); }
export function listIconPacks(): KycResolvedIconPack[] { return [...registry.values()]; }

/** Resolve a theme's `icons` value: a registered id or an inline pack. Undefined means the built-in drawings. */
export function resolveIconPack(icons: string | KycIconPack | undefined): KycResolvedIconPack {
  if (icons === undefined) return classic;
  if (typeof icons === 'string') {
    const found = getIconPack(icons);
    if (!found) throw new Error(`Unknown icon pack "${icons}". Register it with registerIconPack() first.`);
    return found;
  }
  // Inline packs, for example from stored themes, are validated like registered ones.
  return registry.get(icons.id) === icons ? icons as KycResolvedIconPack : defineIconPack(icons);
}
