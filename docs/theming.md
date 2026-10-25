# Theming

KYC Lens styles every screen from one set of design tokens. A theme is a complete set of token values. Five themes ship with the package, and you can define as many of your own as you need.

| Theme | Look |
| --- | --- |
| `classic` (default) | Clean white card with a blue accent. |
| `aurora` | Dark premium neobank: midnight glass with a slowly drifting teal-to-violet glow. |
| `ledger` | Swiss editorial: warm paper, serif headings, square corners and a deep emerald accent. |
| `pebble` | Soft fintech: lavender, chunky rounded shapes and springy motion. |
| `halo` | Airy verification app: white cards on a misty lavender glow, navy type and soft brackets. |

## Use a theme

```tsx
import { KycFlow } from 'kyc-lens-react';
import 'kyc-lens-react/styles.css';

<KycFlow theme="aurora" assets={{ baseUrl: '/kyc-assets' }} />
```

The `theme` prop accepts a registered theme id, a theme definition from `defineTheme()`, or the quick overrides object (`primaryColor`, `backgroundColor`, `textColor`, `borderRadius`, `fontFamily`), which applies on top of `classic`. Changing the theme restyles a running flow without restarting it. An unknown theme id shows a configuration error before camera access.

### Fonts

Themes name their font stacks, and `theme.fonts` lists the stylesheets they were designed with. **KYC Lens never loads fonts itself**, so no request leaves your page unless you add one. Include the stylesheets in your page, or self-host the fonts. Without them, each stack falls back to system fonts.

```tsx
import { builtInThemes } from 'kyc-lens-react';
// builtInThemes.ledger.fonts → ['https://fonts.googleapis.com/css2?family=Instrument+Serif…']
```

## Create a theme

Start from a built-in theme and override only the tokens that differ:

```tsx
import { KycFlow, registerTheme } from 'kyc-lens-react';

registerTheme({
  id: 'acme',
  name: 'Acme Bank',
  extends: 'ledger',
  fonts: ['https://fonts.googleapis.com/css2?family=Fraunces&display=swap'],
  tokens: {
    color: { primary: '#7a1f3d', accent: '#7a1f3d', illustration: '#7a1f3d' },
    font: { heading: '"Fraunces", Georgia, serif' },
    shape: { radius: '14px' },
  },
});

<KycFlow theme="acme" />;
```

`registerTheme()` makes the id available everywhere in your application. Use `defineTheme()` with the same input to build a theme object without registering it, and pass that object directly to `theme`. `getTheme(id)`, `listThemes()` and `unregisterTheme(id)` manage the registry. Built-in ids cannot be replaced.

Themes are validated when they are defined. Ids use lowercase letters, digits and hyphens. Unknown token names are rejected. Token values are CSS values and may not contain `;`, `{`, `}`, `<`, `>`, backslashes or comments, so a stored or user-supplied theme cannot inject other CSS rules.

## Icon packs

A theme can swap the flow's icons by naming an icon pack. Six packs ship with the package: `classic` (the built-in thin-line drawings, used when a theme names no pack), `halo` (rounded outlines with a soft tint, used by the `halo` theme), `viewfinder` (thin monoline icons that match the Viewfinder illustrations), `tabletop` (flat tonal shapes with solid details), `signal` (bold solid pictograms with cut-out details) and `soft` (an ink outline over a pastel fill in the illustration color). A theme inherits its base theme's pack, and `icons: 'classic'` switches back to the built-in drawings.

```tsx
import { KycFlow, registerIconPack, registerTheme } from 'kyc-lens-react';

registerIconPack({
  id: 'acme',
  name: 'Acme icons',
  strokeWidth: 2,
  icons: {
    arrow: 'M4 12h16M14 6l6 6-6 6',
    check: 'm5 12 5 5 9-10',
    camera: [{ d: 'M3 7h18v13H3z', paint: 'tint', opacity: 0.3 }, 'M3 7h18v13H3z', 'M9 13a3 3 0 1 0 6 0 3 3 0 1 0-6 0'],
  },
});

registerTheme({ id: 'acme', name: 'Acme Bank', extends: 'ledger', icons: 'acme' });

<KycFlow theme="acme" />;
```

A pack replaces any of these icons: `arrow`, `back`, `check`, `camera`, `sun`, `face`, `shield`, `refresh`, `close`, `upload`, `switchCamera`, `flash`, `idCard`, `license`, `passport` (also exported as `iconNames`). Icons a pack leaves out use the built-in drawing.

- Each icon is one SVG path data string, or a list of paths drawn in order. A path is a string, or `{ d, paint, opacity }`.
- `paint` is `stroke` (default, outlined in the text color), `fill` (filled with the text color) or `tint` (filled with `color.illustration`). `opacity` is 0–1.
- `grid` sets the square drawing grid (default 24, so paths use a `0 0 24 24` view box). `strokeWidth` is in grid units (default 1.6).

Path data may only contain SVG path commands and numbers, so a stored or user-supplied pack cannot inject markup. Use `defineIconPack()` to validate a pack without registering it. A theme can also carry the pack inline: `defineTheme({ ..., icons: { id: 'inline', name: 'Inline', icons: { … } } })`. `getIconPack(id)`, `listIconPacks()` and `unregisterIconPack(id)` manage the registry, and built-in pack ids cannot be replaced. Packs are looked up when the flow renders, so you can register a pack after the theme that names it. An unknown pack id shows a configuration error before camera access. The flow root carries `data-kyc-icons` with the active pack id.

## Theme studio

The playground includes a visual editor at [localhost:5173/themes](http://localhost:5173/themes). It shows the flow in simulation mode next to every token:

- Pick any built-in or saved theme to preview it on a light or dark page.
- Edit colors, fonts, sizes, radii, shadows, the backdrop, motion and the icon pack; the preview updates live. Editing a built-in theme creates a copy.
- Create, duplicate, rename, delete and import themes. They are saved in this browser's local storage.
- Export a theme as TypeScript (`registerTheme` with only the changed tokens), as CSS, or as JSON.

The settings page lists the same themes, so you can open a configured preview with any of them. The studio loads Google Fonts for the built-in themes; the published package does not.

## Tokens

Every token becomes a CSS custom property on the `.kyc-kit` root: `color.primary` is `--kyc-color-primary`, `motion.durationScale` is `--kyc-motion-duration-scale`, and so on. The root also carries `data-kyc-theme`, `data-kyc-scheme` (`light` or `dark`) and, when enabled, `data-kyc-ambient`.

| Group | Tokens |
| --- | --- |
| `colorScheme` | `light` or `dark`, for browser controls such as the video player. |
| `color` | `primary`, `onPrimary`, `background`, `surface`, `selected`, `text`, `muted`, `line`, `lineStrong`, `accent` (face guide), `accentText` (guide arrows), `success`, `danger`, `noticeText`, `noticeSurface`, `camera`, `cameraOverlay`, `illustration`, `paper`, `focus`. |
| `font` | `body`, `heading`, `mono` (small labels). |
| `type` | `headingSize`, `headingWeight`, `headingTracking`, `bodySize`, `buttonWeight`. |
| `shape` | `radius` (card), `control` (buttons and choices), `media` (camera and previews). |
| `elevation` | `card`, `button` (box-shadow values). |
| `backdrop` | A CSS background layered behind the content, or `none`. |
| `motion` | `easing` (screens), `press` (buttons and selections), `durationScale` (0.25–4), `entrance` (`rise`, `fade` or `scale`), `ambient` (drift the backdrop). |

Reduced-motion preferences turn off the drifting backdrop and press effects, and shorten screen transitions to the existing reduced-motion behavior.

### Static CSS

For server rendering or a page that themes the flow from a stylesheet, `themeCss(theme)` returns a rule scoped to `.kyc-kit[data-kyc-theme="<id>"]`, and `themeVariables(theme)` returns the custom properties as an object.
