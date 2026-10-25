# Changelog

This file records changes prepared for release. No version has been published yet.

## 0.1.0 — Unreleased

- React capture flow with configurable intro, document, face, review, and result screens.
- ID card and driving-license front/back photographs, and passport photo-page capture.
- Local document framing and brightness, glare, sharpness, and detail guidance, with an automatic shutter.
- Document camera switching between available cameras with fallback to the previous camera, and a flashlight toggle on torch-capable cameras (`document.cameraSwitch`, `document.torch`).
- Guided face movements using MediaPipe in a Web Worker, a final selfie, and automatic silent video recording by default.
- Self-hosted model, WASM, and worker assets, a pinned model checksum, and the `kyc-lens-copy-assets` command.
- Configurable challenges, camera constraints, English/German strings, and custom screen components.
- Token-based theming with four built-in themes (Classic, Aurora, Ledger, Pebble), a theme registry for custom themes, and a playground theme studio with live preview and export.
- Local capture results, an optional HTTP adapter, and custom backend adapters.
- `kyc-lens-react/element`: a `<kyc-lens>` custom element for non-React hosts, configured by attributes or a `config` property, with `kyc-complete`, `kyc-cancel` and `kyc-error` DOM events and camera release on removal.
- `onEvent` analytics callback with privacy-safe step, retry, retake, error, completion and cancellation events (`KycEvent`).
- `output` options for selfie and document photos: JPEG or WebP (with JPEG fallback), encoder quality and a maximum dimension.
- HTTP adapter upload progress via `XMLHttpRequest`, opt-in exponential-backoff retries honoring `Retry-After`, and an `upload` prop that shows the upload percentage.
- Development playground with separate settings, explicit synthetic simulation, and a temporary sample upload receiver.
- TypeScript interfaces, unit and browser test suites, integration and architecture documentation, and MIT licensing for project code.
- Open-source contribution and security guidance, GitHub issue and pull request templates, and a verification workflow.
- Built-in French, Spanish, Italian, Polish, and Turkish copy alongside English and German, typed `KycStrings`/`KycStringKey` exports, `Partial<KycStrings>` overrides, and the `KYC Lens` brand string.
- `kyc-lens-copy-assets --no-matching` skips the comparison worker, ONNX Runtime WASM, and YuNet/SFace models (about 53 MB) for hosts that pass `faceMatch={false}`; `--help` lists the options.
- `kyc-lens-copy-assets` leaves out worker source maps and their `sourceMappingURL` comments by default; `--source-maps` copies them unchanged.
- Browser tests run in Chrome, Firefox, and WebKit projects; WebKit skips specs that need a fake camera.
- Bundle and tarball size budgets (`npm run check:size`), an npm name availability check (`npm run check:name`), and a release workflow that publishes with provenance (dry run by default for manual runs).
- A blocked camera preview (autoplay off, for example iOS Low Power Mode) now asks the user to tap the screen instead of reporting denied camera permission.
- The document photo is taken on the first clear frame with the document inside the guide (`document.holdDurationMs` now defaults to 0 and accepts 0–10,000). The Take photo button is shown only when automatic capture is off or live analysis is unavailable. Guidance analyzes up to 12 frames per second and accepts corners slightly past the guide, smaller documents, darker cards, and weaker outlines.
- `handoff` option: on desktops the intro screen shows a QR code that continues the capture on a phone, with a "use this device" fallback. The playground relays the phone's metadata-only summary back through a Cloudflare Durable Object, and its capture page has a theme switcher.

Completion means `capture_complete`. This release does not implement identity verification, document authentication, or proof of liveness.
