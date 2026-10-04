# Contributing to KYC Lens

Contributions to the capture flow, accessibility, browser compatibility, tests, and documentation are welcome. Please read the [code of conduct](./CODE_OF_CONDUCT.md) before participating.

## Set up the project

Use Node.js 22.12 or newer and npm. CI checks Node.js 22 and 24.

```sh
npm ci
npm run setup
npm run dev
```

Initial setup needs internet access to download the pinned MediaPipe face model. It copies the matching WASM assets from the installed dependency and verifies the model checksum. The playground is served locally at `http://localhost:5173`; its settings page is at `/settings`. Use simulation for camera-free work, and test real camera behavior separately when a change affects capture.

## Propose a change

- Use a bug report for reproducible behavior and a feature request for a proposed improvement. Discuss substantial API changes before implementing them.
- Keep a pull request focused on one problem. Explain the user-visible behavior, the reason for the change, and how you checked it.
- Update the documentation when public props, payloads, asset hosting, or backend behavior change.
- Add a regression test when fixing behavior that can be tested reliably. Existing unit tests live in `tests/`; browser tests live in `tests/e2e/`.
- Use fictional documents and synthetic camera fixtures. Do not commit real identity documents, face recordings, credentials, session tokens, or other personal data.

For vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public bug report.

## Check your work

```sh
npm run check
npm run build:demo
npm run check:package
npx playwright install chrome
npm run test:e2e
```

`check` runs the TypeScript check, unit tests, and package build. `check:package` checks the packed distribution and asset-copy command. Playwright uses the `chrome` channel and starts the local development server itself. On Linux, install browser system dependencies with `npx playwright install --with-deps chrome`.

Browser fixtures and simulation help exercise repeatable flows, but do not establish support on every device. When capture changes, report any real-device checks you performed, including browser, operating system, camera permission behavior, recording playback, and cleanup when leaving the flow.

## Project boundaries

KYC Lens collects document photos, a selfie, and an optional silent face video. Local movement and document-framing guidance are capture aids. They do not authenticate documents, prove liveness, prevent spoofing, or approve an identity. Keep this distinction in UI text, API semantics, documentation, and tests; successful capture returns `capture_complete`.

Preserve camera and worker cleanup, explicit simulation labels, and privacy boundaries. Avoid logging raw media or tokens. The Vite sample receiver is development code, so changes to it must not present it as a production verification service.

## License

By submitting a contribution, you agree that your contribution may be distributed under this project's [MIT license](./LICENSE). Include the origin and applicable license for any third-party material you introduce, and update [third-party notices](./THIRD_PARTY_NOTICES.md) where needed.

Maintainers use the [release guide](./docs/releasing.md) to prepare a release. Contributors do not need registry credentials or publishing access.
