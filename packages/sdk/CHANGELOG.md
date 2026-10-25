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
- Token-based theming with five built-in themes (Classic, Aurora, Ledger, Pebble, Halo), a theme registry for custom themes, and a playground theme studio with live preview and export.
- Icon packs: themes name an icon pack (`icons`) that replaces any of the flow's icons with validated SVG path data, a registry for custom packs (`registerIconPack`, `defineIconPack`), the built-in `halo` pack used by the Halo theme, and the built-in `viewfinder`, `tabletop`, `signal`, and `soft` packs.
- Local capture results, an optional HTTP adapter, and custom backend adapters.
- `kyc-lens-react/element`: a `<kyc-lens>` custom element for non-React hosts, configured by attributes or a `config` property, with `kyc-complete`, `kyc-cancel` and `kyc-error` DOM events and camera release on removal.
- `onEvent` analytics callback with privacy-safe step, retry, retake, error, completion and cancellation events (`KycEvent`).
- `output` options for selfie and document photos: JPEG or WebP (with JPEG fallback), encoder quality and a maximum dimension.
- HTTP adapter upload progress via `XMLHttpRequest`, opt-in exponential-backoff retries honoring `Retry-After`, and an `upload` prop that shows the upload percentage.
- Development playground with separate settings, explicit synthetic simulation, and a temporary sample upload receiver. The repository is now a monorepo: the SDK lives in `packages/sdk`, the playground and its sample receiver in `apps/playground` (no longer shipped in the npm package), the Worker in `apps/gateway`.
- TypeScript interfaces, unit and browser test suites, integration and architecture documentation, and MIT licensing for project code.
- Open-source contribution and security guidance, GitHub issue and pull request templates, and a verification workflow.
- Built-in French, Spanish, Italian, Polish, and Turkish copy alongside English and German, typed `KycStrings`/`KycStringKey` exports, `Partial<KycStrings>` overrides, and the `KYC Lens` brand string.
- `kyc-lens-copy-assets --no-matching` skips the comparison worker, ONNX Runtime WASM, and YuNet/SFace models (about 53 MB) for hosts that pass `faceMatch={false}`; `--help` lists the options.
- `kyc-lens-copy-assets` leaves out worker source maps and their `sourceMappingURL` comments by default; `--source-maps` copies them unchanged.
- Browser tests run in Chrome, Firefox, and WebKit projects; WebKit skips specs that need a fake camera.
- Bundle and tarball size budgets (`npm run check:size`), an npm name availability check (`npm run check:name`), and a release workflow that publishes with provenance (dry run by default for manual runs).
- A blocked camera preview (autoplay off, for example iOS Low Power Mode) now asks the user to tap the screen instead of reporting denied camera permission.
- Face capture asks for at most three movements besides an optional centered start (`MAX_MOVEMENTS`), and the default challenges are `center`, `turn-left`, `turn-right`, `closer`. Only the starting pose and the final selfie are held; passing through a neutral pose between movements is enough. The face screen shows numbered step progress and a live hint under the face.
- The default steps are `['intro', 'face', 'result']`; the final face review is opt-in with `'review'`.
- A verification screen lists the real comparison and upload progress. With a document, a `no_match` or `inconclusive` comparison shows a try-again screen that restarts the flow without uploading (`faceMatch.requireMatch`, default `true`), with a `rejected` phase and `rejected`/`restart` events. A clear match shows a success screen.
- The document preview freezes on the photographed frame while it is checked, and the review photo glides out of the camera frame. Handheld jitter and slower phone analysis no longer restart the automatic shutter's hold.
- A production receiver example (`examples/production-receiver.ts`) with per-customer session binding, hashed tokens, streamed size limits and idempotent retries.
- The document photo is taken on the first clear frame with the document inside the guide (`document.holdDurationMs` now defaults to 0 and accepts 0–10,000). The Take photo button is shown only when automatic capture is off or live analysis is unavailable. Guidance analyzes up to 12 frames per second and accepts corners slightly past the guide, smaller documents, darker cards, and weaker outlines.
- A document photo that passes the automatic quality check no longer needs a Looks good tap: a short confirmation appears and the back camera opens by itself (`document.confirmPhotos: true` restores the review). The back camera gives the user time to turn the document over and refuses a photo that shows the same side again. Guidance messages stay on screen long enough to read instead of changing with every frame, and a document filling about half the frame is accepted.
- On-device machine-readable zone check (`document.mrz`, on by default): a bundled 30 KB OCR-B classifier reads TD1, TD2 and TD3 zones, field rules and check digits correct and validate the read, and the zone's format tells passports from identity cards. A wrong document type asks the user to choose again; `document.mrz` in the capture result reports format, kind and validity without personal data. `scripts/train-mrz.mjs` retrains the classifier.
- `handoff` option: on desktops the intro screen shows a QR code that continues the capture on a phone, with a "use this device" fallback. The playground relays the phone's metadata-only summary back through a Cloudflare Durable Object, and its capture page has a theme switcher.

Completion means `capture_complete`. This release does not implement identity verification, document authentication, or proof of liveness.
