# Troubleshooting KYC Lens

Start with the symptom below. Test with the files from the same package version and a physical device when the problem concerns camera or recording behavior.

## Camera does not open

- Serve the app over HTTPS, or use localhost during development. An ordinary HTTP address on your local network is not equivalent to localhost.
- Allow camera access in the browser's site settings. If access was previously denied, update that setting and retry.
- Close applications or tabs using the camera, and check that the operating system permits the browser to use it.
- For an iframe, the parent Permissions Policy and iframe camera allowance must permit camera access.
- An exact camera constraint may fail on a device that lacks the requested camera/resolution. Prefer ideal constraints unless your app requires an exact capability.

With automatic face start, the permission request happens on entering the face screen. If `face.autoStart` is `false`, use **Start camera**. Opening a modal or rendering the introduction does not itself establish camera permission.

## Face tracking stays on loading or reports an asset error

Run the copy command in your host application's directory:

```sh
npx kyc-lens-copy-assets ./public/kyc-assets
```

Confirm these public URLs are reachable beneath the configured `assets.baseUrl`:

- `face-worker.js` and any relative `chunks/` imports.
- `face_landmarker.task`.
- The `wasm/` directory and its matching JavaScript/WASM files.
- `document-worker.js` when using document guidance.

In the browser's network panel, check failed worker/model/WASM requests. A status 200 with your app's HTML page usually means a fallback route intercepted a missing asset. Worker scripts must be served as JavaScript; WASM files need an appropriate MIME type such as `application/wasm`.

Keep assets from the same package version together and recopy them after upgrading. When the app is deployed under a subpath, point `assets.baseUrl` at the actual public asset URL. Filesystem paths and `node_modules` paths are not public browser URLs.

A Content Security Policy can block worker creation, model fetching or WASM compilation. Inspect the reported blocked directive and configure the host policy for the intended asset origin and browser. Same-origin hosting simplifies this setup; the SDK cannot override host policy.

## Setup fails during the model download

Initial setup needs access to the pinned model download and MediaPipe license endpoints. Retry after restoring network access. A checksum error means the local model bytes differ from the pinned version; remove only the generated `assets/face_landmarker.task` file, then rerun `npm run setup` so it downloads a fresh copy.

Do not bypass the checksum or substitute unrelated model/WASM versions. [Third-party notices](../THIRD_PARTY_NOTICES.md) describe the bundled assets.

## A movement will not complete

Use even lighting, keep one face fully visible and hold each requested pose. Return to a neutral, centered position when prompted between movements. Left and right refer to the person's anatomical left/right; the front-camera preview can be mirrored.

The default hold is 650 ms, target tracking rate is 12 fps and full face attempt timeout is 90 seconds. `closer` and `further` compare the current face size with the initial baseline. They do not measure physical distance. Begin at a comfortable middle distance that permits both movements.

For slow devices, lower `face.trackingFps` within the supported 3–30 range or allow a longer `face.timeoutMs` within 1,000–600,000 ms. That timeout includes camera permission and tracker loading; recording has its own fixed 90-second limit, even with a longer face timeout. Background tabs and stalled frames can interrupt continuous pose holds. Use an alternative host flow if a user cannot comfortably perform the configured movements.

## Recording fails, or no face clip is returned

Recording needs `MediaRecorder` and a supported encoder in the target browser. Inspect the actual Blob MIME type: browsers can use WebM or MP4. Test playback and upload on the same devices you support, including mobile Safari, Chrome and any embedded WebView.

When recording is enabled, unsupported recording, recording errors, a clip exceeding 12 MiB or recording longer than 90 seconds produce a recoverable error; the SDK does not silently substitute a still image. Recording starts when the camera is ready, and pose checks wait for its first nonempty encoded chunk. If no chunk arrives within 10 seconds, startup fails with a recoverable recording error. Encoder and tracker startup use part of the recording time. Retake starts a fresh recording/check. If your product explicitly needs still images only, configure `face={{ recordVideo: false }}`; omitting recording support is then intentional.

Simulation produces marked synthetic media and is useful for UI tests. It cannot diagnose real camera, tracking or hardware encoder quality.

## Document outline remains red

Keep all four corners inside the guide, improve lighting, reduce reflections and let the camera focus. A plain contrasting background helps the geometry heuristics. A green outline is guidance; it does not authenticate the document or guarantee backend acceptance.

If analysis APIs or the document worker are unavailable, the guide stays red with a request to review the photo after capture. The manual shutter remains available while the camera is ready. Explicit simulation and `document={{ detection: false }}` use a neutral guide. Each required photograph still has a review screen.

The final photograph preserves the whole camera image. The visible guide is not an output crop, and detection results are not part of the submitted payload.

## Face comparison is unavailable or inconclusive

Run the asset-copy command after building/installing the package and after each upgrade. Confirm `match-worker.js`, `matching/ort/`, YuNet and SFace model files load from your own origin. A missing, changed or redirected model/runtime is rejected. The comparison screen has a Cancel action; operational failures retain the photos for retry.

For CSP, permit same-origin workers, fetches and scripts, temporary `blob:` module imports and WebAssembly compilation. Unsupported Worker/OffscreenCanvas/image APIs or WASM SIMD yield an unavailable comparison. Try a supported browser or use your application's assistance path.

Inconclusive results indicate poor pose/lighting/detail, a small portrait, multiple faces or a score inside the uncertainty band. Retake clearer photos through a fresh flow. Do not interpret this as a no-match decision. The default threshold and quality gates require validation on your target documents and devices.

## Upload fails or retries are rejected

Check the backend URL, authentication and response in the network panel. Both built-in endpoints must return JSON on success. The adapter sends multipart files and a `metadata` JSON field; let the browser set multipart `Content-Type` so it includes the boundary.

When a session returns a token, the adapter uses it as the submission bearer token, overriding an extra `Authorization` header. Same-origin cookies accompany requests. Use a custom adapter if your authentication or cross-origin upload requirements differ.

The development receiver expires sessions after 15 minutes and accepts only local same-origin requests. It limits requests to 24 MiB total, individual images to 6 MiB and video to 12 MiB. An identical retry receives the earlier receipt; changed media/metadata for an already completed session is rejected. A development server restart clears all sessions.

Saved result folders remain on disk after session expiry or a restart. Clearing the settings summary also does not remove files.

SDK submission retry preserves the captured media. Built-in HTTP errors 401, 404 and 410 clear the SDK's stored session so retry creates a new one. Your backend must still enforce its own session ownership, expiry and retry policy.

## No results folder was saved

Use the running development server and explicitly enable **Local upload API** in settings. It is disabled by default. Finish capture and confirm final review. When review is omitted, the completed capture submits automatically. Recording and retaking alone do not save files. A successful capture summary shows `savedDirectory: "results/<sessionId>"`.

Look under the checkout's `results/` directory for the session ID in that summary. Each folder contains `metadata.json`, a selfie and whichever document photos/face clip were captured. If submission failed, check the displayed error and the network response, then retry. The server must be able to create files in the checkout's results directory. It validates the upload before committing the final folder, so an invalid upload does not produce a completed result folder.

Turning off **Local upload API** gives browser-only capture and creates no folder. The installed package likewise needs a host backend that saves media; a static demo or a local `onComplete` callback does not write files to the server. Saved folders persist until manually deleted; session expiry, closing the browser, clearing the summary and server restarts do not delete them.

## Camera stays active after closing the host UI

Unmount `KycFlow` when its modal or route closes. Hiding the containing element with CSS leaves the component mounted and does not represent a closed flow. Custom API adapters should forward the provided abort signal to their network client.

The SDK releases its camera, recorder, workers and preview URLs. Your app must revoke any additional object URLs it creates and manage any received Blobs it retains.

## Layout or translations do not fit

Import `kyc-lens-react/styles.css` once. Avoid host styles that override SDK sizing or media rules. The desktop frame is centered and the mobile flow fills the viewport; an extra header or parent padding can reduce the available height.

Custom screens and longer copy must fit the bounded heading, media and action regions. Check a small viewport and increased text size, and provide appropriate host accessibility behavior. Reduced-motion preferences disable transition effects.

## The static demo has no upload API

`npm run build:demo` exports the frontend. The Vite API plugin runs only with the development server. A deployed demo needs a host-owned implementation of the [HTTP contract](./api.md), or local capture without `apiBaseUrl`.

## Reporting a bug

Use the repository's bug-report template once the project is on GitHub. Include the package version, browser/OS, whether the device is physical or simulated, configuration, reproduction steps and sanitized error text. Do not attach real selfies, face clips, documents, session tokens or authorization headers. Reproduce with marked simulation media when the problem allows it.
