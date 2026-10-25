# Changelog

This file records changes prepared for release. No version has been published yet.

## 0.1.0 — Unreleased

- React capture flow with configurable intro, document, face, review, and result screens.
- ID card and driving-license front/back photographs, and passport photo-page capture.
- Local document framing and brightness, glare, sharpness, and detail guidance, with a manual shutter.
- Guided face movements using MediaPipe in a Web Worker, a final selfie, and automatic silent video recording by default.
- Self-hosted model, WASM, and worker assets, a pinned model checksum, and the `kyc-lens-copy-assets` command.
- Configurable challenges, camera constraints, English/German strings, and custom screen components.
- Token-based theming with four built-in themes (Classic, Aurora, Ledger, Pebble), a theme registry for custom themes, and a playground theme studio with live preview and export.
- Local capture results, an optional HTTP adapter, and custom backend adapters.
- `kyc-lens-react/element`: a `<kyc-lens>` custom element for non-React hosts, configured by attributes or a `config` property, with `kyc-complete`, `kyc-cancel` and `kyc-error` DOM events and camera release on removal.
- Development playground with separate settings, explicit synthetic simulation, and a temporary sample upload receiver.
- TypeScript interfaces, unit and browser test suites, integration and architecture documentation, and MIT licensing for project code.
- Open-source contribution and security guidance, GitHub issue and pull request templates, and a verification workflow.

Completion means `capture_complete`. This release does not implement identity verification, document authentication, or proof of liveness.
