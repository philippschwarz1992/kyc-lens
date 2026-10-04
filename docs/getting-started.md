# Getting started with KYC Lens

Use Node.js 22.12 or newer for development and packaging. Your host application needs React and React DOM 18.3 or 19. Live capture needs a supported browser, a camera and a secure context: localhost during development, HTTPS when deployed.

## Run the playground

Clone the public repository and open its directory:

```sh
git clone https://github.com/philippschwarz1992/kyc-lens.git
cd kyc-lens
npm ci
npm run setup
npm run dev
```

Open [the local playground](http://localhost:5173/). On Windows, [start-demo.cmd](../start-demo.cmd) also installs dependencies on first use, prepares assets and opens the playground.

Developer `setup` downloads the pinned MediaPipe, YuNet and SFace models, checks their SHA-256 checksums and copies matching WASM files and licenses. Initial developer setup needs internet access. Consumer tarballs include these files, and runtime processing loads them from your application without an inference service.

The main page runs automatic document capture and the guided face flow, then compares the document portrait and selfie locally. [The settings page](http://localhost:5173/settings) lets you change auto-capture, face comparison, optional screens, movements, language, theme, simulation and the development upload API. **Open preview** opens those settings in a separate tab. Uploads are off by default; enabling the local API saves completed captures under their session ID.

For a camera-free preview, open [simulation mode](http://localhost:5173/?simulate=1). Add `&document=0` for a face-only preview. Simulation creates visibly marked demo media and synthetic observations; use real devices to evaluate tracking, recording and camera behavior.

## Build and install the package locally

The package has not been published to a registry. From this repository:

```sh
npm pack
```

The `prepack` script prepares assets and builds the distributable, producing `kyc-lens-react-0.1.0.tgz`. From your other React application's directory:

```sh
npm install /path/to/kyc-lens-react-0.1.0.tgz
npx kyc-lens-copy-assets ./public/kyc-assets
```

Replace the example tarball path with its location on your computer. In Windows PowerShell, quote paths that contain spaces:

```powershell
npm install 'C:\path to package\kyc-lens-react-0.1.0.tgz'
```

The copy command places the model, WASM, workers and their JavaScript chunks under your app's public directory. Serve that directory at `/kyc-assets` and run the command again after package upgrades. Keep workers and relative chunks together. Installation alone does not expose runtime assets through your application's web server.

## Add capture to React

Import the stylesheet once in your application's entry point, then render the flow:

```tsx
import { useState } from 'react';
import { KycFlow } from 'kyc-lens-react';
import type { CaptureResult } from 'kyc-lens-react';
import 'kyc-lens-react/styles.css';

export function IdentityCapture() {
  const [result, setResult] = useState<CaptureResult>();

  if (result) {
    // The host owns result.payload and can submit/store it according to its policy.
    return <p role="status">Capture complete.</p>;
  }

  return (
    <KycFlow
      steps={['intro', 'document', 'face', 'review', 'result']}
      document={{ types: ['id-card', 'drivers-license', 'passport'] }}
      assets={{ baseUrl: '/kyc-assets' }}
      locale="en"
      onComplete={setResult}
    />
  );
}
```

This example captures locally. Without `api` or `apiBaseUrl`, the SDK sends no captured media to a backend. The `onComplete` payload contains the selfie, face clip when recording is enabled, optional document photographs and challenge metadata. Keep media out of analytics and application logs.

Document photos are taken automatically after a steady, clear hold and final-photo quality check, with a manual fallback and review for each required side. The face camera starts automatically on entering its screen, records silently during tracker initialization and the selected movements, then stops and takes a final centered selfie. After optional final review, the package compares the document portrait and selfie; the result is advisory. Camera permission is still controlled by the browser. Face clips are limited to 12 MiB and 90 seconds; the browser must support recording WebM or MP4.

For a face-only flow, omit the `steps` prop; its default is `['intro', 'face', 'review', 'result']`. To delay the face camera until the user presses a button, set `face={{ autoStart: false }}`. For an explicitly still-only flow, set `face={{ recordVideo: false }}`.

## Connect your backend

Add `apiBaseUrl="/api/kyc"` when your application implements:

1. `POST /api/kyc/sessions`, returning JSON `{ id: string, token?: string }`.
2. `POST /api/kyc/sessions/:id/capture`, accepting multipart media and metadata and returning a JSON receipt.

Alternatively, supply a custom `api` adapter for an existing upload protocol. See the [API contract](./api.md) and [integration guide](./integration.md) for examples, abort signals and authentication behavior.

The playground's upload API is a development example. It validates uploads and saves media and metadata locally; it never approves an identity. `npm run build:demo` creates static frontend files without a running API. Your installed SDK needs a backend that implements storage if you want it to save results.

## Find saved playground captures

With **Local upload API** enabled, a successful submission creates `results/<sessionId>/` in the repository. When the final review is enabled, its confirmation button triggers submission; recording and retaking do not create a folder. Omitting final review submits automatically after capture completes. The settings capture summary displays the saved relative directory.

Each folder includes `metadata.json`, `selfie.jpg` or `selfie.png`, the optional `face-video.webm` or `face-video.mp4`, and optional document photos named `document-front.jpg`/`.png` and `document-back.jpg`/`.png`. `metadata.json` records the session ID, capture status, timestamps, challenge evidence, media type/size and file names. It excludes session tokens and authorization headers.

Results stay on disk after development sessions expire or the server restarts. Delete a saved session folder manually when you no longer want its files. Turning off **Local upload API** gives a browser-only capture and creates no result folder. The library's local capture example above likewise does not write files by itself.

## Before deployment

Host matching assets over HTTPS, test camera access and clip playback on physical target devices, and unmount the flow when its modal or route closes. Next.js integrations must render the SDK from a Client Component and import its stylesheet in the appropriate application entry/layout; see [integration](./integration.md).

`capture_complete` confirms capture and successful submission when configured. Your backend owns authenticated sessions, media validation, storage/retention and any identity approval. Local movements and document framing hints do not establish liveness or document authenticity.

For common integration failures, see [troubleshooting](./troubleshooting.md).
