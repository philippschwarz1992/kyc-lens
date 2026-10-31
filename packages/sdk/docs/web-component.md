# Web component

`kyc-lens-react/element` wraps `KycFlow` in a custom element for hosts that do not render React themselves: server-rendered pages, Vue, Angular, Svelte or plain HTML. The element still runs React internally.

## Install

React and React DOM remain **peer dependencies**. The element imports `react` and `react-dom/client` and does not bundle them, so install them next to the package even if your application has no React code:

```sh
npm install kyc-lens-react react react-dom
npx kyc-lens-copy-assets ./public/kyc-assets
```

Supported versions match the React entry: `react` and `react-dom` 18.3 or 19.

## Register and use the element

```ts
import { defineKycLensElement } from 'kyc-lens-react/element';
import 'kyc-lens-react/styles.css';

defineKycLensElement('kyc-lens');
```

```html
<kyc-lens steps="intro,document,face,review,result" locale="en" theme="aurora"
  assets-base-url="/kyc-assets" api-base-url="/api/kyc"></kyc-lens>
```

`defineKycLensElement(tagName = 'kyc-lens')` registers the element and returns its constructor. Calling it again with a registered name returns the existing constructor instead of throwing, so several bundles or hot reloads can call it safely. Each name gets its own class, so you can register the element under more than one name.

The module is safe to import during server rendering. It does not touch `HTMLElement` at import time; the class is created inside `defineKycLensElement`, which returns `undefined` where `customElements` is unavailable. Call it from client code, for example in a `useEffect`, an `onMounted` hook or a browser-only module.

## Configure

| Attribute | `KycFlow` prop | Value |
| --- | --- | --- |
| `steps` | `steps` | Comma-separated list, for example `intro,face,review,result`. |
| `locale` | `locale` | `en` or `de`. |
| `theme` | `theme` | A registered theme id, such as `classic`, `aurora`, `ledger`, `pebble`, `halo`, `capital` or one you registered with `registerTheme()`. |
| `assets-base-url` | `assets.baseUrl` | Where you host the copied assets. Defaults to `/kyc-assets`. |
| `api-base-url` | `apiBaseUrl` | Base URL for the built-in HTTP adapter. |
| `simulation` | `simulation` | HTML boolean attribute: present means on, whatever its value. Remove it to turn simulation off. Demo use only. |

For everything else, assign the `config` property. It accepts every `KycFlow` prop except the callbacks (`onComplete`, `onCancel`, `onError`) and custom screen `components`:

```ts
const element = document.querySelector('kyc-lens')!;
element.config = {
  document: { types: ['passport'] },
  face: { challenges: ['center', 'turn-left', 'turn-right'] },
  faceMatch: { threshold: 0.4 },
  headers: { 'X-CSRF-Token': csrfToken },
};
```

Fields in `config` take precedence over the matching attributes. Asset options are merged field by field, so `assets-base-url` still applies when `config.assets` sets only `workerUrl`. A `config` value assigned before `defineKycLensElement` runs is picked up when the element upgrades.

The element re-renders when an observed attribute or `config` changes. Changes made in the same task are combined into one render. As with the React component, a theme change restyles the running flow, while a change to steps, options, assets or simulation starts a new attempt.

## Events

The element reports results as DOM events. All of them bubble and are `composed`, so they also cross shadow roots of host components.

| Event | `detail` | When |
| --- | --- | --- |
| `kyc-complete` | `CaptureResult` | The capture finished, including after your API accepted the upload. |
| `kyc-cancel` | `undefined` | The user cancelled. |
| `kyc-error` | `Error` | Camera, document capture or submission failed. The flow shows its retry screen. |

```ts
element.addEventListener('kyc-complete', event => {
  console.log(event.detail.status, event.detail.payload.selfie);
});
element.addEventListener('kyc-error', event => reportError(event.detail));
```

`kyc-complete` means `capture_complete`. Your backend still decides identity verification.

## Lifecycle and camera release

The element creates its React root in `connectedCallback` and unmounts it in `disconnectedCallback`. Unmounting runs the flow's cleanup, which stops camera tracks, terminates workers and aborts requests. Removing the element from the page, or hiding it with a framework conditional that removes the node, therefore releases the camera immediately. Moving the element to another place in the document restarts the flow.

Hiding the element with CSS keeps it mounted and keeps the camera running. Remove the element when the user closes your dialog.

## Why light DOM, not shadow DOM

The element renders into its own light DOM, not a shadow root, and you load `kyc-lens-react/styles.css` in the host page:

- The stylesheet, themes and CSS custom properties (`--kyc-*`) work exactly as for the React component. You can override them from your page CSS without `::part` selectors.
- Theme fonts and your own `@font-face` rules apply. Fonts declared inside a shadow root are ignored by browsers.
- One copy of the stylesheet serves any number of elements; the element never injects a `<style>` tag of its own.
- Labels, buttons and live regions stay in the document tree that screen readers, browser translation and end-to-end tests already understand.

All KYC Lens class names use the `kyc-` prefix to avoid collisions with host styles. Do not put your own children inside the element: React owns its contents and replaces them.

## TypeScript

The package exports `KycLensElement`, `KycLensElementConfig` and `KycLensElementEventMap`. To type `document.querySelector('kyc-lens')`, `document.createElement('kyc-lens')` and the event listeners, add an optional global augmentation for the tag name you register:

```ts
import type { KycLensElement } from 'kyc-lens-react/element';

declare global {
  interface HTMLElementTagNameMap {
    'kyc-lens': KycLensElement;
  }
}
```

The package does not add this augmentation itself because you choose the tag name.

## Helpers

`parseKycLensAttributes()` and `mergeKycLensConfig()` are the pure functions the element uses to read attributes and combine them with `config`. `KYC_LENS_ATTRIBUTES` lists the observed attribute names.
