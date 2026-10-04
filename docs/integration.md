# Integrating KYC Lens

## Next.js App Router

First build the local package as described in [getting started](./getting-started.md), install its tarball, then copy its self-hosted assets. The package has not been published to a registry:

```sh
npm install /path/to/kyc-lens-react-0.1.0.tgz
npx kyc-lens-copy-assets ./public/kyc-assets
```

This copies both `face-worker.js` and `document-worker.js`, their relative JavaScript chunks, and the face model/WASM files. Keep the copied directory together, serve it from your app and repeat the command after upgrading the package. `assets={{ baseUrl: '/kyc-assets' }}` resolves both workers automatically.

Import the stylesheet once in your app's root layout:

```tsx
// app/layout.tsx
import 'kyc-lens-react/styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```

Use a Client Component. If you want to load the camera SDK only when this page is opened, use a client-side dynamic import:

```tsx
// app/verify/CaptureClient.tsx
'use client';

import dynamic from 'next/dynamic';

const KycFlow = dynamic(
  () => import('kyc-lens-react').then(module => module.KycFlow),
  { ssr: false, loading: () => <p>Loading camera capture…</p> },
);

export default function CaptureClient() {
  return (
    <KycFlow
      assets={{ baseUrl: '/kyc-assets', workerUrl: '/kyc-assets/face-worker.js' }}
      apiBaseUrl="/api/kyc"
      steps={['intro', 'document', 'face', 'review', 'result']}
      document={{ types: ['id-card', 'drivers-license', 'passport'] }}
      face={{ challenges: ['center', 'turn-left', 'turn-right', 'closer', 'further'] }}
      onComplete={({ sessionId }) => {
        // Update capture UI or fetch your backend's verification status.
        // Do not unlock a verified-user feature from this callback.
        console.log('Capture received for session', sessionId);
      }}
    />
  );
}
```

This code belongs in a Client Component. The face screen automatically requests camera permission when entered, records a silent video during local movement checks, and finishes after the configured sequence and final centered hold. Review shows the clip; retake starts a fresh check. Keep callbacks and captured media in client code; do not try to serialize a Blob through Server Component props.

Automatic start and video recording are enabled by default. If your host needs a separate camera-start action, use `face={{ autoStart: false }}`. To explicitly retain a still-only flow, use `face={{ recordVideo: false }}`. Movement checks still run in both cases. Recording requires browser `MediaRecorder` support; an unsupported encoder or recording failure shows a recoverable error, without silently dropping the clip. The recorded Blob's MIME type can be WebM or MP4, so accept the actual negotiated format in your backend and media preview.

Omit `'document'` from `steps` for a face-only capture. When enabled, document selection and individual photo reviews happen before the face screen. Pass `document.types` to restrict available choices and `document.camera` to override rear-camera constraints. Your upload service receives document photos along with the selfie and optional `faceVideo`; validate required sides and required media using your server's policy.

Document framing guidance is on by default. A red outline and hint ask the user to improve framing or image quality; a green outline means a complete document-shaped rectangle has been stable inside the guide and passed local quality heuristics. Capture remains manual and does not require green. To disable analysis, pass `document={{ types: ['id-card', 'passport'], detection: false }}`; the guide then stays neutral. No detector score is included in the upload or completion payload. Check the captured images on your backend according to your own policy; the outline does not authenticate an ID or recognize its type.

Missing or blocked worker/image APIs leave the guide red with a request to check the photo after capture; they do not block the shutter. Simulation uses a neutral outline because it does not analyze a live document.

## Your route handlers

The SDK requires a session-create route and a multipart-capture route. The following illustrates the boundaries with a **host-owned service**, not a supplied backend implementation. `kycService` must implement persistent sessions, user authorization, bounded media parsing/validation, retention and any actual verification processing.

```ts
// app/api/kyc/sessions/route.ts
import { auth } from '@/lib/auth';
import { kycService } from '@/lib/kyc-service';

export async function POST(request: Request) {
  const user = await auth(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const session = await kycService.createCaptureSession({ userId: user.id });
  return Response.json({ id: session.id, token: session.captureToken });
}
```

```ts
// app/api/kyc/sessions/[id]/capture/route.ts
import { auth } from '@/lib/auth';
import { kycService } from '@/lib/kyc-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await auth(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  // Your service must verify user ownership, bearer token, expiry,
  // body size before parsing, allowed MIME/signatures and valid media decode,
  // required server policy, and metadata. Do not trust client gesture claims.
  const receipt = await kycService.acceptCapture({
    request, sessionId: id, userId: user.id,
  });
  return Response.json({ sessionId: receipt.sessionId, status: 'capture_complete' });
}
```

Apply your platform's upload limits before `request.formData()` allocates a large body. Authenticate your application user and bind the bearer token to that user/session. Reject expired, reused, oversized, malformed or unauthorized submissions. Store or stream media only according to your application's data policy. An authoritative verification workflow can later move a separate verification record to `approved`, `declined`, or `needs_review`.

For a working development-only example of this contract, see [demo/server.ts](../demo/server.ts). It checks local requests and session tokens, caps multipart requests at 24 MiB, and validates allowed metadata and basic media signatures before saving the complete result under `results/<sessionId>/` in the checkout. Individual images are limited to 6 MiB and an optional WebM/MP4 clip to 12 MiB. Files have fixed MIME-appropriate names: `selfie.jpg`/`.png`, optional `face-video.webm`/`.mp4`, optional `document-front.jpg`/`.png` and `document-back.jpg`/`.png`, plus `metadata.json`. Receipts expose type/size, capture metadata and a `files` filename map rather than media bytes; the JSON omits session tokens and authorization headers.

The playground's local upload API is enabled by default. Saving starts only when capture is submitted, after final review confirmation when that screen is enabled; recording and retakes do not create saved folders. The receiver commits each validated result as a complete folder and returns the same receipt for an identical retry; a changed capture is rejected. Sessions remain in memory and expire, but saved folders survive session expiry and server restarts until manually deleted. Turning off **Local upload API** keeps capture in the browser and creates no result folder.

The installed SDK does not write to a server's filesystem itself. Copy or adapt the receiver's storage behavior into your own backend if you want results saved by session ID. The development sample does not authenticate application users, implement independent PAD or approve anyone.

## React, Vite and other hosts

Ordinary React applications can import `KycFlow` and its stylesheet directly. Host the copied `/kyc-assets` directory as public files. The package does not depend on Next.js, a particular authentication provider, or a CSS framework.

For a non-Node backend, implement the same HTTP contract in your language/framework. If your routes use different names, your upload protocol is different, or you already have storage sessions, provide the [custom `api` interface](./api.md) instead of `apiBaseUrl`.

The built-in screens have no cancel or close button. For a modal integration, mount the SDK when the modal opens and unmount it when the user closes it through your host controls, including your own backdrop/escape handlers. Hiding the modal with CSS leaves the SDK mounted. Custom screens can call `context.cancel`, which delivers `onCancel`; unmounting alone does not deliver that callback. Cleanup on unmount releases the camera, recorder, unfinished recording buffers, workers and preview URLs.

The built-in frame has a fixed height across steps, centered on desktop and fullscreen on mobile. Its contents do not scroll, and action buttons stay at the bottom. Screen changes use a short fade and upward slide for copy and media; bottom controls fade in place. The animation keeps existing camera elements mounted and respects `prefers-reduced-motion`. For a dedicated route, give its parent viewport height and center the frame; avoid adding page headers or padding above the fullscreen mobile flow. Custom screen slots need to keep media and copy within the available height as well.

For distance movements, the entire masked face preview grows for “move closer” and shrinks for “move further away,” with its green boundary scaling together. It returns to normal for calibration and recentering, and keeps the same target during a movement hold. The page frame, instructions and bottom actions stay in place. Guidance uses the current instruction and clearer side arrows for head turns, without a row of movement icons below the camera. Reduced-motion preferences make size changes immediate.

## Deployment checklist

- Use HTTPS and host matching model/WASM files and both worker assets under your application's public URL. Do not use the development server as a production API.
- Preserve your application's authentication, CSRF controls and server-side step policy. Treat SDK gesture observations and `mode` as untrusted client data.
- Configure camera permission for embedded iframes. Test restrictive CSP with worker creation, model fetching and WASM compilation in your supported browsers.
- Set upload size/time limits and an explicit media storage/retention/deletion policy. Keep face videos, selfies and document bytes out of logs, analytics and error tracking.
- Provide camera-denied, recording failure, timeout, unsupported-device and accessibility fallback behavior appropriate to your application.
- Test actual mobile devices and low-performance machines, including video recording/playback, document framing feedback under different lighting/backgrounds, cancellation, retakes, route changes and expired sessions.

`npm run build:demo` exports the playground's static frontend; its Vite API plugin only runs in development. To deploy the demo with uploads, implement the same routes in your deployment backend.
