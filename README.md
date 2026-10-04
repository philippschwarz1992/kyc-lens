# KYC Lens

**Automatic document photos, guided face capture, and local face comparison for React.**

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/philippschwarz1992/kyc-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/philippschwarz1992/kyc-lens/actions/workflows/ci.yml)
[![React](https://img.shields.io/badge/React-18.3%20%7C%2019-149eca.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-types%20included-3178c6.svg)](./docs/api.md)

KYC Lens gives your application a configurable camera flow for collecting identity document photographs, a selfie, and a silent face video. Guide a person through centering, head turns, and closer/further movements using local MediaPipe tracking. Choose the screens, customize the copy and theme, and connect your own upload API.

Document detection, face tracking and document-to-selfie comparison run inside the browser package, with bundled model and runtime files served by your application. No inference service is required. **Capture completion is not identity approval.** Photo comparison does not authenticate documents or prove liveness. `onComplete` returns `status: 'capture_complete'` and an optional `faceMatch` result; your application owns approval decisions. See [architecture and limitations](./docs/architecture.md).

**Release status:** version 0.1.0 is prepared for its first npm release. The proposed npm name is `kyc-lens-react`; its availability must be checked before publishing. Registry installation becomes available after that release.

## What you get

| Capability | Included |
| --- | --- |
| Document capture | ID cards, driving licenses, and passport photo pages, with per-photo review |
| Automatic document photo | Stable framing, brightness, glare, sharpness and detail checks; captured-photo recheck and manual fallback |
| Guided face capture | Centering, left/right turns, looking up/down, and relative closer/further movements |
| Face media | Automatic silent video plus a final selfie; configurable still-only mode |
| Local face comparison | YuNet portrait detection and SFace embeddings in a separate browser worker; explicit match, no match, inconclusive or unavailable result |
| Configurable flow | Optional intro, document, review, and result screens; required face screen |
| Customization | Theme, English/German strings, custom copy, and intro/review/result components |
| Backend integration | Local Blob payloads, a multipart HTTP adapter, or your own API functions |
| Bundled assets | Face/document/comparison workers, WASM, pinned models, checksums and license notices |
| Developer playground | Settings, camera-free simulation, generated integration code, and metadata summaries |

Face tracking and document guidance run in Web Workers. With the default self-hosted assets, capture does not send frames to a third-party provider. Uploads happen only when you configure an API or submit the returned payload yourself. Initial developer setup downloads the model; packaged applications serve it locally.

## Try the playground

Use Node.js **22.12 or newer**, npm, and a current browser with a camera.

```sh
git clone https://github.com/philippschwarz1992/kyc-lens.git
cd kyc-lens
npm ci
npm run setup
npm run dev
```

Open [localhost:5173](http://localhost:5173/) for the capture flow or [localhost:5173/settings](http://localhost:5173/settings) to change its configuration. On Windows, [start-demo.cmd](./start-demo.cmd) also prepares and opens the playground.

Live camera is the default. Enable simulation in settings, or open [the simulated preview](http://localhost:5173/?simulate=1), to try the flow without a camera. Simulation uses synthetic observations and watermarked media; it is a demonstration mode. Add `&document=0` for a face-only simulated flow.

The playground runs entirely in the browser by default. **Local upload API** is an optional setting: enabling it saves completed captures and `metadata.json` in **`results/<sessionId>/`** beneath this checkout after final review. It does not write a result folder during recording or before review. The receiver runs only in the development server; building the static playground does not deploy it.

Saved folders contain `selfie.jpg` (or `.png`), optional `face-video.webm` (or `.mp4`), optional `document-front.jpg`/`document-back.jpg` (or `.png`), and `metadata.json`. The JSON includes capture metadata and file names, with no session token or authorization headers. Folders remain after session expiry and server restarts until you delete them yourself. The capture summary shows the saved relative directory without exposing media contents or tokens.

## Install in your application

Until the first npm release, build the tarball from this checkout:

```sh
npm pack
```

The packaging step prepares the assets and builds the library. Then, from your React application's directory:

```sh
npm install /path/to/kyc-lens-react-0.1.0.tgz
npx kyc-lens-copy-assets ./public/kyc-assets
```

After the package is published, the registry install will be:

```sh
npm install kyc-lens-react
npx kyc-lens-copy-assets ./public/kyc-assets
```

Repeat the asset-copy command after every upgrade. It copies all three workers, models, WASM and license files. Serve that directory from your application; `assets={{ baseUrl: '/kyc-assets' }}` resolves them automatically. Consumer installation and runtime do not download models from a third party. The package currently packs to about 51 MiB with these assets.

```tsx
import { useState } from 'react';
import { KycFlow } from 'kyc-lens-react';
import 'kyc-lens-react/styles.css';

export function IdentityCapture() {
  const [captureComplete, setCaptureComplete] = useState(false);

  if (captureComplete) return <p>Capture complete. Verification is a separate step.</p>;

  return (
    <KycFlow
      steps={['intro', 'document', 'face', 'review', 'result']}
      document={{ types: ['id-card', 'drivers-license', 'passport'], autoCapture: true }}
      face={{ challenges: ['center', 'turn-left', 'turn-right', 'closer', 'further'] }}
      assets={{ baseUrl: '/kyc-assets' }}
      locale="en"
      theme={{ primaryColor: '#2563eb' }}
      onComplete={() => setCaptureComplete(true)}
    />
  );
}
```

This example captures and compares locally. The completion callback receives `result.payload`: a selfie `Blob`, an optional face video `Blob`, optional document `Blob`s, challenge evidence, a capture timestamp and capture mode. `result.faceMatch` contains the comparison status, reason and optional cosine score. It is not a probability or approval. Connect your own submission flow or supply `apiBaseUrl` as described below. Keep media, scores and session tokens out of logs and analytics.

The default SDK flow is `['intro', 'face', 'review', 'result']`. Include `'document'` explicitly to collect document photos. ID cards and driving licenses require front and back; passports use the photo page only.

For Next.js, render `KycFlow` in a Client Component and import the stylesheet in your root layout. See the [integration guide](./docs/integration.md).

## Configure the flow

```tsx
<KycFlow
  steps={['face', 'review']}
  face={{
    challenges: ['center', 'turn-left', 'turn-right'],
    holdDurationMs: 650,
    timeoutMs: 90_000,
    trackingFps: 12,
  }}
  assets={{ baseUrl: '/kyc-assets' }}
  locale="de"
  theme={{ primaryColor: '#0f766e', borderRadius: '24px' }}
/>
```

| Option | Behavior |
| --- | --- |
| `steps` | Choose unique screens in the order `intro`, `document`, `face`, `review`, `result`; always include `face` |
| `face.challenges` | 1–20 ordered movements; repeated movements are allowed |
| `face.autoStart` | Defaults to `true`; use `false` to show a camera-start button |
| `face.recordVideo` | Defaults to `true`; use `false` for still-only capture |
| `face.holdDurationMs` | Pose hold duration, 100–10,000 ms; default 650 ms |
| `face.timeoutMs` | Overall face timeout, 1,000–600,000 ms; default 90,000 ms |
| `face.trackingFps` | Target tracking frequency, 3–30 fps; default 12 |
| `document.detection` | Defaults to `true`; use `false` for a neutral manual-capture guide |
| `document.autoCapture` | Defaults to `true`; use `false` to keep the shutter manual |
| `document.holdDurationMs` | Stable document hold, 200–10,000 ms; default 800 ms |
| `faceMatch` | Enabled when a document is present; `false` disables comparison; options set threshold, inconclusive margin and timeout |
| `face.camera`, `document.camera` | Override browser camera constraints |
| `strings`, `theme`, `components` | Customize text, appearance, and selected screen components |
| `apiBaseUrl`, `headers`, `api` | Connect a backend or provide a custom adapter |
| `onComplete`, `onCancel`, `onError` | Receive completion, cancellation, and errors |
| `simulation` | Explicit opt-in to the camera-free demo driver |

Document feedback assists framing; a green guide does not establish document authenticity or acceptance. Auto-capture rechecks the encoded full-resolution photo against quality heuristics before review. The manual shutter remains available when the camera is ready, including when the heuristic is uncertain. Disabled or unavailable analysis never triggers auto-capture. Simulation skips face comparison and returns an inconclusive result with reason `simulation`.

The default face threshold (0.363) is an upstream example, with a ±0.03 inconclusive band. Calibrate it on consented passport/ID-to-selfie data before making production decisions. Published model licenses and the unresolved SFace training-data provenance issue are described in [third-party notices](./THIRD_PARTY_NOTICES.md).

See the [API reference](./docs/api.md) for all props, types, custom screen context, exported utilities, and payloads.

## Connect your backend

Set `apiBaseUrl="/api/kyc"` to use the built-in HTTP adapter and implement these routes:

| Route | Contract |
| --- | --- |
| `POST /api/kyc/sessions` | Return `{ "id": "session-id", "token": "optional-session-token" }` |
| `POST /api/kyc/sessions/:id/capture` | Accept multipart fields `selfie`, optional `faceVideo`, optional `documentFront`/`documentBack`, and JSON `metadata`; return a capture receipt |

Metadata contains `challenges`, `capturedAt`, `mode`, and optional `document: { type }`. A returned session token becomes the upload's bearer token. Your API must bind sessions to your users, validate submissions, and own storage, retention, and verification policy.

For a different protocol, provide `api={{ createSession, submitCapture }}`. Both functions receive an `AbortSignal`. See [backend examples](./docs/integration.md) and the development-only [sample receiver](./demo/server.ts). The installed React package does not create filesystem folders itself; saving media requires your backend to implement that behavior.

## Browser and hosting requirements

- React **18.3 or 19**. The library is ESM and ships TypeScript declarations and its own stylesheet.
- Camera access requires **HTTPS** in deployment, browser permission, and available camera APIs. `localhost` works for development.
- Serve matching assets, preferably under the same origin. Configure worker/model/WASM requests and execution for your Content Security Policy.
- Video capture requires a supported `MediaRecorder` encoder. The clip has no audio, negotiates WebM or MP4, and is bounded to 12 MiB and 90 seconds, even with a longer face timeout. Use `recordVideo: false` if your product requires only a still.
- Embedded flows require camera permission through both the host's Permissions Policy and the iframe's `allow` setting.
- Test your target phones, desktop browsers, and WebViews. Head angles and distance guidance are approximate; document detection depends on lighting, edges, and device performance.
- Unmount the flow when its route or modal closes so camera, recording, and worker resources are released.

See [troubleshooting](./docs/troubleshooting.md) for denied cameras, missing assets, unsupported recording, and upload errors.

## Documentation

- [Getting started](./docs/getting-started.md) — local demo, installation, and first capture
- [Integration guide](./docs/integration.md) — React, Next.js, backend adapters, and deployment
- [API reference](./docs/api.md) — props, types, payloads, and core utilities
- [Architecture](./docs/architecture.md) — workers, capture lifecycle, privacy boundaries, and limitations
- [Troubleshooting](./docs/troubleshooting.md) — common setup and runtime problems
- [Releasing](./docs/releasing.md) — GitHub setup, package checks, and first npm publication

## Contribute

Contributions to browser reliability, accessibility, capture guidance, documentation, and integrations are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Follow [SECURITY.md](./SECURITY.md) for security reports; use synthetic media in public bug reports.

```sh
npm run setup
npm run check
npm run build:demo
npm run check:package
npm run check:matching-reference
npm run check:consumer
npx playwright install chrome
npm run test:e2e
```

GitHub Actions checks the library, packaged assets, local WASM reference parity and fresh tarball installation on Node 22 and 24, and runs the Chrome browser suite. Physical-device and held-out biometric evaluation remain release gates in the [QA plan](./docs/qa-plan.md). It does not publish packages automatically.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

The project is released under the [MIT License](./LICENSE). MediaPipe, its model/runtime assets, and other dependencies retain their own terms; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Preserve the included notices when redistributing the assets.
