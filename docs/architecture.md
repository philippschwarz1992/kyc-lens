# KYC Lens architecture and trust boundaries

```text
Host React application
  └─ KycFlow: screens, state, translations, theme, capture
       ├─ optional document camera → document worker → framing/quality hints
       │                       └─ automatic/manual full-image photo → per-side review
       ├─ Browser camera → tracking worker → MediaPipe landmarks
       │       │                      └─ local pose/size guidance
       │       └─ silent MediaRecorder clip → automatic stop + JPEG → review
       ├─ document portrait + selfie → YuNet/SFace WASM worker → comparison result
       └─ optional API adapter → host backend
                                  ├─ capture session and media handling
                                  └─ independent verification/review policy
```

The package owns the capture experience and exports a typed result. The host owns user authentication, storage, real identity verification and approval. Built-in screen selection and custom screen components change the UI. They cannot establish a security policy: an attacker can alter or replace browser code.

## Local tracking

MediaPipe Face Landmarker runs in a worker with locally served model/WASM assets. The guide uses face presence/position, approximate head angles, and relative face size to decide when a configured movement has been held long enough. The worker prevents inference from blocking the UI thread. Reducing `trackingFps` reduces inference work on slower hardware; the user-visible guide can still animate separately.

Face position and relative height are mapped to the visible centered camera crop, so centering follows the portrait preview even when the source camera image is wide. Inference still uses the full source frame to detect additional faces outside the preview crop. The recorded video and final still retain the full camera image.

Entering the face screen starts the camera automatically after permission. Once the camera is ready, a `MediaRecorder` records the video-only stream. Its readiness promise waits for a first nonempty encoded chunk before tracker initialization and before any pose observation is accepted. This keeps the movement sequence, including its first accepted centered hold, inside an already started recording. The challenge runner processes actual landmark observations. Centering and a neutral starting baseline precede movement checks; completion requires the configured movements and a final centered neutral hold. Completion automatically stops recording, takes a final JPEG and releases the camera/tracker before review. `face.autoStart: false` allows a host to retain a manual start button; `face.recordVideo: false` explicitly selects still-only capture without removing geometry checks.

The recorder negotiates a supported WebM or MP4 encoder, requests a 1 Mbps video bitrate, collects bounded chunks and limits the clip to 12 MiB and 90 seconds. Failure to emit a first nonempty chunk within 10 seconds produces a recoverable recording error. The separate configurable face timeout can expire sooner; setting it above 90 seconds does not extend recording. It never requests microphone access. Recording failure or missing recorder support produces a recoverable error when video is enabled; it does not silently submit a still in place of the requested clip. Retake and unmount stop recording, discard unfinished buffers and remove handlers. Explicit simulation paints neutral watermarked canvas frames during encoder startup without advancing the challenge runner, then feeds timed synthetic observations after readiness; it never substitutes those observations for a real camera check.

Document guidance uses a separate worker with no external model or service. At about six frames per second, small preview frames are checked for a complete quadrilateral within the guide and for brightness, glare, sharpness and visible detail. The analysis accounts for the camera preview's crop, so framing refers to what the user sees. A steady suitable document automatically triggers a full-resolution JPEG after an 800 ms hold by default. The encoded photo is decoded and rechecked before review. Rejected quality resumes guidance. Duplicate/stale observations, drift, viewport changes and hidden pages reset or invalidate the hold. Manual capture remains available. `document.autoCapture: false` restores manual-only capture; `document.detection: false` removes analysis and uses a neutral manual guide.

These checks are image heuristics, not document recognition. A different rectangle can resemble a document, and real documents can fail the heuristics under low contrast, glare, motion, patterned backgrounds or unusual layouts. They do not read text or validate that a passport/ID is genuine. The feedback and intermediate preview frames remain local and are not added to the capture payload or upload metadata. They assist the user but cannot enforce a server's image-quality or verification policy.

The document analyzer requires Web Workers, `createImageBitmap` and OffscreenCanvas. Missing support, a blocked worker or an analysis failure leaves the outline red with a manual photo-review hint and keeps capture available. Disabled detection and simulation use a neutral outline. Neither fallback reports green when no image analysis succeeded.

The `closer` and `further` steps compare relative face size against a baseline. They do not measure distance in centimeters. Angles and face-size observations are approximate and affected by camera position, lighting, occlusion and device performance. User guidance should allow comfortable movement and retries.

Face model and WASM initialization, camera permission and worker startup add first-use latency. Host the assets from your own origin, including all three workers, cache immutable versioned assets, lazy-load the capture screen and test actual low-end devices. Document guidance downsamples preview frames separately from full-resolution photos. Browser workers still share device resources; KYC Lens makes no blanket performance guarantee.

## Local photo comparison

After the accepted document and selfie are captured and reviewed, a separate worker loads the pinned YuNet detector and ONNX Runtime WASM. It selects an unambiguous document portrait and exactly one selfie face, checks size/pose/detail, then lazily loads SFace. Five landmarks align each portrait to 112×112 pixels. YuNet inputs are raw BGR NCHW; SFace inputs are raw RGB NCHW, following OpenCV 4.12.0. Normalized embeddings yield a cosine score with a configurable inconclusive band. The default threshold and acquisition gates are provisional and require domain-specific evaluation.

Model/runtime requests stay on the application's origin, reject redirects and verify pinned sizes and SHA-256 hashes. The WASM module is imported through a temporary blob URL, requiring CSP permission for blob module scripts and WebAssembly compilation. One WASM thread avoids cross-origin-isolation requirements. No GPU or inference service is involved. Embeddings remain inside the worker, are cleared after use and are never included in the public result or upload payload.

The client terminates the worker after result, timeout, cancellation or unmount. Model failures offer retry with the accepted media retained; poor or ambiguous inputs produce an inconclusive advisory result. Simulation performs no face inference. A local comparison cannot enforce access control against a modified client.

## Capture completion is not verification

The SDK emits `capture_complete`, a selfie Blob, an optional silent video Blob, gesture evidence, optional document photo Blobs and an optional local face comparison. These fields are client-controlled and are not independently validated anti-spoofing evidence. Browser media streams may originate from virtual cameras or injected media. Recording a clip, completing head/distance movements and matching faces do not rule out a recording or deepfake. Document capture does not implement OCR or authenticity checks.

Liveness/presentation attack detection, comparison against an independently trusted identity reference, document authenticity verification and sanctions/AML checks are separate capabilities. The built-in face comparison uses the captured document portrait; it does not establish that the document or reference is genuine. Evaluate an authoritative verification workflow independently before using these captures for approval.

For a self-hosted ML extension, a recognition library's source license does not automatically cover pretrained weights or training data. Check model rights and evaluate PAD/recognition accuracy before using them commercially. There is deliberately no Python service or paid provider dependency in KYC Lens.

## Sample API

The Vite development API demonstrates a transport boundary:

- Creates a random session ID and random bearer token, expiring after 15 minutes.
- Binds a submission token to its session and accepts only local same-origin development requests.
- Caps active sessions at 100 and request bodies at 24 MiB total, with 6 MiB per image and 12 MiB per video.
- Accepts one JPEG/PNG selfie, an optional WebM/MP4 face video and optional document sides plus the allowed metadata JSON fields, checking matching basic MIME/container signatures, document type/side consistency and allowed values.
- Validates the complete submission before atomically committing media and `metadata.json` to `results/<sessionId>/` in the checkout. The files use fixed names and extensions matching their MIME types.
- Keeps session tokens, temporary session state and a retry digest in memory. Saved metadata contains the session ID, timestamps, evidence, media type/size and filenames, with no tokens or authorization headers; raw media is not logged.
- Accepts one capture per session, returns the same receipt for an identical retry, rejects a different capture and returns `capture_complete`, never an identity approval.

Basic media signature checks do not replace actual image/video decoders, malware/format handling, independent anti-spoofing, authenticated user binding or a production upload service. Video bytes are included in the retry digest; receipts contain only metadata and filenames. Restarting the server discards in-memory sessions but leaves saved folders intact. Expiring a session likewise does not delete its files. Remove saved folders manually when no longer needed. HTTP development tokens do not establish a production identity.

The playground disables upload by default. Optional local upload saves only at successful submission, after the final review is confirmed when enabled; recording and retaking remain local until then. Disabled upload creates no results folder. This filesystem behavior belongs to the development receiver, not the browser SDK: installed applications need their own backend storage implementation.

## Cleanup and ownership

The SDK owns its camera tracks, recorder and chunk buffers, face/document workers, image/video object URLs and abortable API requests. Camera and tracking resources stop after capture; preview URLs remain available for review until retake or unmount. Retake revokes the preceding media preview URLs and starts a fresh recording/check. The host must unmount the flow when its containing route/modal closes. Custom API functions should pass their `AbortSignal` to their network client. Custom screens should not keep using SDK object URLs beyond the flow lifetime.

The host owns any Blob passed to `onComplete` after receipt. If it creates its own object URLs, it must revoke them. If it stores media, it must implement its own access controls and deletion behavior. Avoid storing captured media in browser localStorage or sending it to analytics/error logs.

Built-in screens share a fixed frame with bounded heading, media and bottom action regions. The flexible media region scales to the viewport without making the screen scroll. Desktop centers the phone-sized frame; mobile fills the viewport. Screen transitions preserve frame size and action position. Custom screens are responsible for following the same space constraints.

## Browser constraints

Camera access requires a secure context and permission. HTTPS is required on deployed sites; localhost is allowed during development. For embedded flows, the host page's Permissions Policy and iframe camera allowance must permit capture. Video mode also needs a supported `MediaRecorder` encoder and playback support for its negotiated output. A package cannot override browser or host permission controls.

Test target browsers and physical devices. Mobile WebViews and in-app browsers can differ from standalone Safari/Chrome. Provide recovery instructions for denied permission, unavailable cameras, tracking timeout and failed uploads, and provide a fallback when a user cannot perform the movement sequence.

Official references: [MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [browser camera security requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
