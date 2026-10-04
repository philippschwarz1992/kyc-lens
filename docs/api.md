# KYC Lens API reference

Import the component, public types and stylesheet from the package:

```tsx
import { KycFlow } from 'kyc-lens-react';
import type { KycFlowProps, CaptureResult, KycApi, KycScreenContext } from 'kyc-lens-react';
import 'kyc-lens-react/styles.css';
```

## Configuration and defaults

All flow props are optional. The default steps are `['intro', 'face', 'review', 'result']`; document capture is enabled by including `'document'`. Steps must be unique and ordered `intro`, `document`, `face`, `review`, `result`, with `face` present.

| Setting | Default | Allowed values / behavior |
| --- | --- | --- |
| `face.challenges` | `['center', 'turn-left', 'turn-right', 'closer', 'further']` | 1–20 supported entries; repeats are allowed. |
| `face.holdDurationMs` | `650` | 100–10,000 ms for a matching pose hold. |
| `face.timeoutMs` | `90_000` | 1,000–600,000 ms for the attempt, starting before camera permission, preview playback and tracker initialization. Increasing it does not extend the recorder's separate 90-second limit. |
| `face.trackingFps` | `12` | Target inference rate, 3–30 fps. Actual performance depends on the device. |
| `face.camera` | Front camera, ideal 1280×720 | `MediaTrackConstraints` merged over the defaults. |
| `face.autoStart` | `true` | Start on face-screen entry; `false` shows a start button. |
| `face.recordVideo` | `true` | Record a silent clip; `false` explicitly selects still-only capture. |
| `document.types` | All three supported types | One to three unique choices. |
| `document.camera` | Rear camera, ideal 1920×1080 | `MediaTrackConstraints` merged over the defaults. |
| `document.detection` | `true` | Local guidance; `false` uses a neutral guide. |
| `assets.baseUrl` | `/kyc-assets` | Public URL for the self-hosted assets. |
| `locale` | `en` | Built-in `en` or `de`, with individual `strings` overrides. |

Other props configure `theme`, `components`, `apiBaseUrl`, `headers`, a custom `api`, callbacks, `simulation` and `className`. See the [README configuration table](../README.md#configure-the-flow). Configuration errors are displayed before camera access. Changing steps, document/face options, assets or simulation resets the flow; keep those settings stable during capture. Change the component's React `key` to explicitly start a fresh flow.

## Captured data

```ts
interface ChallengeEvidence {
  challenge: 'center' | 'turn-left' | 'turn-right' | 'look-up' | 'look-down' | 'closer' | 'further';
  completedAt: number;
  durationMs: number;
}

interface CapturePayload {
  selfie: Blob;
  video?: Blob; // Silent face-check clip; present when recording is enabled.
  document?: DocumentCapture;
  challenges: ChallengeEvidence[];
  capturedAt: string;
  mode: 'camera' | 'simulation';
}

type DocumentType = 'id-card' | 'drivers-license' | 'passport';

interface DocumentCapture {
  type: DocumentType;
  front: Blob;
  back?: Blob;
}

interface DocumentOptions {
  types?: readonly DocumentType[];
  camera?: MediaTrackConstraints;
  detection?: boolean; // Defaults to true: local framing/quality guidance.
}

interface FaceOptions {
  challenges?: readonly ChallengeEvidence['challenge'][];
  holdDurationMs?: number;
  timeoutMs?: number;
  trackingFps?: number;
  camera?: MediaTrackConstraints;
  autoStart?: boolean; // Defaults to true.
  recordVideo?: boolean; // Defaults to true.
}

interface CaptureResult {
  sessionId?: string;
  status: 'capture_complete';
  payload: CapturePayload;
  serverResult?: unknown;
}
```

`onComplete(result)` indicates that the configured capture flow completed, and submission succeeded when an API is configured. It is not a KYC approval. `serverResult` contains whatever your API returns. Use a separate server-side verification status for access decisions.

`mode` is diagnostic metadata supplied by the client. Checking `mode === 'camera'` on the server does not make the media trustworthy: an attacker controls their client. Production policy needs verified evidence independently of these fields.

`capturedAt` is an ISO date string from the client clock. `ChallengeEvidence.completedAt` is a monotonic browser timestamp in milliseconds, not a Unix timestamp; `durationMs` measures the completed hold. Built-in capture produces JPEG images. Without an API, `sessionId` and `serverResult` are absent.

The face step starts automatically after entry and browser camera permission. A silent recording begins once the camera is ready, including the tracker initialization period. The local challenge runner then checks centering, configured head movements and relative distance changes. The SDK stops the recording and captures the still after every challenge and a final neutral centered hold are complete. Retaking clears the previous clip and starts a new check. `face.autoStart: false` restores a start button; `face.recordVideo: false` explicitly disables recording and returns a still-only payload. Neither setting changes the movement checks.

`video` uses the format supported by the browser's `MediaRecorder`: WebM (VP8, then VP9) where available, otherwise MP4. Inspect `video.type`; do not assume every browser returns WebM. The recorder requests a 1 Mbps video bitrate; actual output depends on the browser. The clip contains no audio and is capped at 12 MiB and 90 seconds. The face check also has its own overall timeout (90 seconds by default); a longer face timeout does not extend the recording limit. A missing/unsupported recorder, recording error, size limit or tracking timeout is recoverable and produces no completed capture. There is no implicit fallback to a photograph when video recording is enabled.

Enable document photographs with `steps={['intro', 'document', 'face', 'review', 'result']}`. `document={{ types: ['passport'] }}` restricts the available choices. The document screen always reviews each photo; the optional `review` step controls the final face media review. Identity cards and driving licenses provide `front` and `back`; a passport's `front` is its photo page and has no `back`. The package's default steps remain face-only. Neither document photographs nor head movements establish identity verification.

`document.detection` defaults to `true`. Live preview analysis checks document-shaped boundaries against the visible guide and applies brightness, glare, sharpness and detail heuristics. The outline turns green only after suitable framing and quality remain stable; otherwise red feedback suggests an adjustment. `detection: false` disables the analyzer and uses a neutral guide. The camera-ready shutter stays available regardless of guidance, and each photo still requires review. This feedback does not read text, identify document types or verify authenticity. Detector feedback and metrics are transient UI state; they are not included in `DocumentCapture`, `CapturePayload` or HTTP metadata.

If Worker, `createImageBitmap` or OffscreenCanvas support is missing, or the worker fails/is blocked, feedback stays red with “Keep all four corners visible. Check the photo after capture.” Manual capture remains available. Disabled detection and explicit simulation use a neutral outline and do not report green detection.

## Custom screens

You can replace the optional built-in introduction, review and result screens. Each slot receives this context:

```ts
interface KycScreenContext {
  next: () => void;
  cancel: () => void;
  retry: () => void;
  result?: CaptureResult;
  selfieUrl?: string;
  videoUrl?: string;
}
```

```tsx
function MyIntro({ next }: KycScreenContext) {
  return (
    <section>
      <h2>Prepare your selfie</h2>
      <p>Find even lighting and make sure your face is visible.</p>
      <button type="button" onClick={next}>Start capture</button>
    </section>
  );
}

<KycFlow components={{ Intro: MyIntro }} />;
```

Use `videoUrl` for the recorded clip when present and `selfieUrl` for its still image; the SDK manages both object URLs' lifetimes. The built-in review shows the clip with playback controls when available, otherwise the still. Do not keep using these URLs after retake or after the flow is unmounted. Supply your own accessible buttons, focus behavior and copy for custom screens. Calling `cancel` triggers `onCancel`; the host should close or unmount its flow when appropriate. Unmounting alone does not invoke `onCancel`.

In `Intro`, `next` enters capture. In `Review`, `next` submits and `retry` retakes the face media. A `result` supplied to `Review` represents captured media before submission; only `onComplete` confirms successful submission. `Result` receives the completed result.

Built-in screens fit a fixed desktop frame and fullscreen mobile layout without scrolling. Custom screens must also fit the available height: use a bounded media area and a bottom action row rather than allowing content to enlarge the container. Test any longer translated or replacement copy on a small mobile viewport.

## Custom API

```ts
interface KycSession { id: string; token?: string }

interface KycApi {
  createSession: (signal: AbortSignal) => Promise<KycSession>;
  submitCapture: (
    session: KycSession,
    payload: CapturePayload,
    signal: AbortSignal,
  ) => Promise<unknown>;
}
```

Both functions receive an abort signal so requests can stop when the user cancels or the component unmounts. Pass the signal to `fetch`, reject failed HTTP responses, and leave authentication/session binding to your backend. The session is created at submission time, after capture/review. A custom `api` takes precedence over `apiBaseUrl`; prefer configuring one of them.

```tsx
const api: KycApi = {
  async createSession(signal) {
    const response = await fetch('/my-api/capture-session', {
      method: 'POST', credentials: 'same-origin', signal,
    });
    if (!response.ok) throw new Error('Could not create capture session');
    return response.json();
  },
  async submitCapture(session, payload, signal) {
    const body = new FormData();
    body.append('selfie', payload.selfie, 'selfie.jpg');
    if (payload.video) {
      const extension = payload.video.type.startsWith('video/mp4') ? 'mp4' : 'webm';
      body.append('faceVideo', payload.video, `face-video.${extension}`);
    }
    if (payload.document) {
      body.append('documentFront', payload.document.front, 'document-front.jpg');
      if (payload.document.back) body.append('documentBack', payload.document.back, 'document-back.jpg');
    }
    body.append('metadata', JSON.stringify({
      challenges: payload.challenges,
      capturedAt: payload.capturedAt,
      mode: payload.mode,
      ...(payload.document ? { document: { type: payload.document.type } } : {}),
    }));
    const response = await fetch(`/my-api/capture-session/${encodeURIComponent(session.id)}`, {
      method: 'POST', body, signal, credentials: 'same-origin',
      headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
    });
    if (!response.ok) throw new Error('Could not submit capture');
    return response.json();
  },
};

<KycFlow api={api} />;
```

Let the browser set the multipart `Content-Type` header, including its boundary. Do not set it manually. Set the file name according to the Blob's actual MIME type if your backend relies on extensions.

## Built-in HTTP adapter

The adapter is also exported for explicit composition:

```ts
import { createHttpApi } from 'kyc-lens-react';

const api = createHttpApi('/api/kyc', { 'X-App-Context': 'onboarding' });
```

`apiBaseUrl="/api/kyc"` uses these routes:

| Request | Response / body |
| --- | --- |
| `POST /api/kyc/sessions` | JSON `{ id: string, token?: string }`. |
| `POST /api/kyc/sessions/:id/capture` | FormData `selfie`, optional `faceVideo` Blob and `documentFront`/`documentBack` image Blobs, plus `metadata` JSON. Expects a successful JSON response. |

Metadata is `{ challenges: ChallengeEvidence[], capturedAt: string, mode: 'camera' | 'simulation', document?: { type: DocumentType } }`; media bytes are sent only as files. `faceVideo` is omitted for still-only capture. Without document capture, document fields are omitted. The sample receiver requires both document sides for `id-card` and `drivers-license`, only the front/photo page for `passport`, and rejects files without matching document metadata. A returned session token is sent as a bearer token on capture submission. `headers` lets you provide extra host headers. Requests include same-origin cookies. The session token takes precedence over any supplied `Authorization` header on capture submission; use your application's session cookie, a separate appropriate header or a custom adapter when additional user authentication is needed. A token and an application user session serve different purposes: production must validate both as needed.

Non-success HTTP responses throw the exported `KycHttpError` with a numeric `status`; a JSON `{ error: string }` supplies its message. Network errors and malformed successful JSON use ordinary errors. Submission retry preserves captured media and reuses its session. Built-in HTTP errors 401, 404 and 410 clear the stored session so the next retry creates a new one. Cross-origin cookie authentication needs a custom adapter and appropriate server CORS behavior.

The local sample also implements authenticated `GET /api/kyc/sessions/:id`. Before upload it returns `pending_capture`; afterwards it returns `capture_complete` with capture metadata and media type/size. A recorded clip adds `video: { type, sizeBytes }` to the receipt. Document receipts include `document: { type, front: { type, sizeBytes }, back?: { type, sizeBytes } }`. It never returns captured media or an identity approval. The sample limits the total request to 24 MiB, each image to 6 MiB and the video to 12 MiB; it accepts WebM or MP4 video with matching basic container signatures.

## Assets

```tsx
<KycFlow
  assets={{
    baseUrl: '/kyc-assets',
    workerUrl: '/kyc-assets/face-worker.js',
    documentWorkerUrl: '/kyc-assets/document-worker.js',
    // Optional individual overrides:
    // modelUrl: '/custom-model/face_landmarker.task',
    // wasmBaseUrl: '/custom-wasm',
  }}
/>
```

Copy package assets with `npx kyc-lens-copy-assets ./public/kyc-assets` and serve that directory. The workers default to `face-worker.js` and `document-worker.js` under `assets.baseUrl`, so `assets={{ baseUrl: '/kyc-assets' }}` is sufficient. Keep copied workers with their relative JavaScript chunks, and recopy the directory after upgrades. Use `workerUrl` or `documentWorkerUrl` when hosting either worker at another location. The document worker has no model/WASM or third-party service dependency. It starts only during a live document camera screen with detection enabled. The demo uses Vite-bundled source workers; packaged consumers use the workers copied from the distributable. Do not point a deployed app at a filesystem path or a worker from another version.

## Callbacks and cleanup

Keep callbacks inexpensive, and use `onError` to show a useful host error state. `onCancel` lets the host close its modal, clear pending UI, or return to onboarding. SDK cleanup stops camera tracks, recording and worker work, discards unfinished recording buffers, and releases object URLs; unmount the component when its containing route/modal closes. Abortable API requests should respect their signal. Your application owns media Blobs received through `onComplete` and any retention policy it applies to them.

Simulation is off unless explicitly enabled by `simulation={true}`. It runs the movement sequence automatically using synthetic observations and, with video enabled, a watermarked animated canvas recording. It is a testing convenience and does not check a real face. The demo URL parameter only configures the playground; the installed SDK does not read URL parameters itself.

## Copy and core exports

Built-in copy is available in English and German. Override specific keys when adapting the flow to your product:

```tsx
<KycFlow locale="en" strings={{ start: 'Begin selfie' }} />;
```

The framework-independent challenge runner is exported from `kyc-lens-react/core` along with `DEFAULT_CHALLENGES`, `MAX_OBSERVATION_GAP_MS`, `validateChallenges`, `validateFaceOptions`, `isCenteredFace`, `isNeutralFace` and observation/evidence types. These utilities describe local geometry guidance; they do not verify liveness or identity. `DEFAULT_CHALLENGES` is also exported from the main package.

```ts
import { ChallengeRunner } from 'kyc-lens-react/core';

const runner = new ChallengeRunner(['center'], 650);
const neutral = {
  faceCount: 1, centerX: 0.5, centerY: 0.5,
  relativeSize: 0.4, yaw: 0, pitch: 0,
};

runner.update({ ...neutral, timestamp: 0 });
runner.update({ ...neutral, timestamp: 350 });
const feedback = runner.update({ ...neutral, timestamp: 700 });
// feedback.completed === true
runner.reset();
```

Timestamps must increase. A gap over `MAX_OBSERVATION_GAP_MS` (500 ms) interrupts a hold. Positive yaw means anatomical left; positive pitch means looking down. The core entry processes observations without camera access or React rendering; the package still declares React peer dependencies. Copy override keys are listed in [src/react/strings.ts](../src/react/strings.ts).
