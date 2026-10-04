# QA plan for local document capture and face matching

This plan covers a React package that detects documents, automatically photographs them when quality is adequate, captures a guided selfie, and compares that selfie with the document portrait entirely in the browser. The package must ship its required models, workers and processing files. It must work without an inference service, external CDN or automatic media upload.

**Status:** planned validation, dated 4 October 2026. No tests or performance measurements were run while preparing this plan. Numerical goals below are proposed engineering targets, not measured results or KYC certification criteria.

## Scope and current baseline

The current package has document framing and quality guidance with a manual shutter, automatic MediaPipe face capture, local asset copying, and an optional upload adapter. It does not yet implement document auto-capture or selfie-to-document matching. Those are the features this plan is intended to validate.

Use the existing document worker, optionally extended with OpenCV.js, and keep MediaPipe for live face guidance. The initial matching candidate is ONNX Runtime Web with YuNet and SFace. Test the exact chosen model versions before declaring browser support. SFace needs a JavaScript adapter for landmark alignment, input preparation, embedding normalization and comparison; the Python OpenCV example is not a drop-in browser implementation.

The required local acceptance configuration has no `api` or `apiBaseUrl`, has simulation disabled, and includes the document and face steps. Existing upload examples can remain separate, but must not be required by this configuration.

A face-comparison result does not establish document authenticity or liveness. The local result must describe comparison only, and must not label a person as having passed identity verification.

## Test environments and evidence

Use a clean consumer application installed from the actual release tarball, not only the repository playground. Cover React 18.3 and 19, a Vite application, and a Next.js client component. Test root and nested application paths, configurable asset locations, HTTPS deployment, localhost, and an iframe with camera permission allowed or denied.

The proposed supported browser matrix is:

- iPhone Safari on a current device and an older device within the declared support range.
- Android Chrome on a midrange phone and an older phone with limited memory.
- Windows Chrome, Edge and Firefox.
- macOS Safari and Chrome.

Record exact device, OS, browser version, camera resolution and processing backend. Test the oldest version the package will claim to support and a current stable version. Physical phones are mandatory for release evidence; simulated cameras and desktop WebKit cannot establish mobile autofocus, exposure or performance.

WebAssembly is the required matching baseline. GPU acceleration is optional and must have separate accuracy and failure tests. Cover deployments without cross-origin isolation if they are supported; unavailable threading or GPU support must lead to the documented compatible mode or a clear error.

For each run retain the package version, model hashes, threshold configuration, case results, timings and defect references. Network traces and screenshots must use synthetic media where possible; redact or protect evidence containing participant information.

## Package installation and local processing

These are release blockers:

- **PKG01:** Install the tarball in a clean consumer app and run the asset-copy utility. Complete document capture, selfie capture and matching using only files shipped in the package. No repository-only files or development dependencies may be needed.
- **PKG02:** Verify that every model, WASM file, worker and relative chunk exists. Record exact versions, checksums, file sizes and redistribution notices. Consumer installation must not download models through a lifecycle script.
- **PKG03:** Run the whole flow with external origins blocked. Allow only same-origin GET requests for explicitly listed application, worker, runtime and model assets; fail any unexpected request, including POST or PUT. Monitor page and worker traffic, fetch/XHR, beacons, WebSockets, navigation and resource URLs. There must be no image, video, embedding or score transmission, including to same-origin endpoints.
- **PKG04:** Verify that local completion returns its result exactly once without creating a server session or contacting the sample receiver. The acceptance demo must have upload disabled.
- **PKG05:** Cover missing assets, wrong paths, corrupt/truncated models, mismatched runtime versions, stale caches, unsuitable MIME types and worker startup failure. Return a bounded, recoverable error; never produce a match or silently fetch a CDN replacement.
- **PKG06:** Test warm operation after all required assets are available while network access is disabled. If offline reload is offered, explicitly cache the application shell and every required asset and test a fresh page load offline. A cold start without cached files must explain that assets are unavailable. Local processing alone must not be advertised as guaranteed offline reload.
- **PKG07:** Inspect storage, logs, analytics and error reports throughout the flow. Persist no biometric media or embeddings by default. If public model caching is offered, verify that it contains only model/runtime assets, works without persistent storage, and recovers from a stale cache.

## Automatic document capture

Use passports, ID cards and driving licences with representative layouts, laminated surfaces, backgrounds and camera orientations. Fixtures must distinguish acceptable capture quality from authentic-document validation.

- **DOC01:** A readable, fully visible document held steadily inside the guide triggers one capture after the configured hold. The resulting original color image preserves the entire document at the available source resolution.
- **DOC02:** Missing corners, clipped edges, an undersized document, excessive tilt, motion, blur, low light and glare over important content prevent automatic capture and give a useful adjustment hint.
- **DOC03:** Sharp borders with blurred text or portrait regions must not pass. Assess detail inside the document rather than borrowing sharpness from the background or outline.
- **DOC04:** Blank paper, phone screens, textured backgrounds and other rectangular objects must not be represented as a recognized or authentic passport. Record false automatic triggers on a labelled negative set. Generic rectangular detection alone cannot guarantee document-type classification.
- **DOC05:** A green preview followed by movement or defocus must not bypass final-image validation. Recheck the actual captured image; ask for a retake if it is unusable.
- **DOC06:** Rotate the phone, resize the viewport and switch cameras during tracking. Detected corners, the visible guide and the final crop must remain consistent. Preserve the original alongside any separate perspective-corrected image.
- **DOC07:** Trigger automatic capture and the manual fallback together, deliver duplicate/stale frames, interrupt a hold and remove the document just before encoding finishes. Accept one photo per attempt and side. Old observations must never trigger a later attempt.
- **DOC08:** ID and driving-licence flows require the configured front/back captures; passports require the photo page. Retake must replace the selected side and invalidate any comparison based on it.
- **DOC09:** Block or crash the analyzer. Show its unavailable state and disable automatic capture. A documented manual fallback may remain usable, but its photo must not inherit a successful quality result from the failed analyzer.

**Proposed pilot goal:** at least 95% of acceptable-document attempts auto-capture within 20 seconds after usable camera frames begin, under specified ordinary indoor lighting. Report results by device and document type, including failed attempts. Every mandatory invalid fixture must prevent automatic capture. Real-world false-trigger rates require a separately labelled evaluation set.

## Automatic selfie capture

- **FACE01:** One visible, adequately sized face follows the configured guidance and produces a clear final still after returning to a neutral pose. Test mirrored preview against unmirrored captured media.
- **FACE02:** No face, multiple faces, obstruction, extreme pose, movement and inadequate lighting prevent automatic completion. Detect additional faces outside the visible preview crop as well.
- **FACE03:** Duplicate/backwards timestamps, gaps between observations, disappearing faces and interrupted holds do not accumulate successful hold time. Repeat and reorder allowed challenges.
- **FACE04:** Test glasses, facial hair, different appearances and users unable to perform a movement comfortably. Recovery must preserve meaningful quality requirements and explain what to do next.
- **FACE05:** If video remains enabled, verify supported playback, no audio/microphone request, configured size/time limits, and cleanup. Unsupported recording must give the documented error rather than silently dropping requested video.
- **FACE06:** Simulation remains visibly labelled and cannot generate a usable identity-comparison decision.

Existing challenge, recording and preview tests are the regression baseline. Add real-camera checks for final sharpness and pose; passing synthetic tests is insufficient.

## Face matching correctness and accuracy

### Reference checks

Prepare fixed, permitted image fixtures and expected intermediate results using the pinned official OpenCV pipeline. Reference generation is a development-only check, not a production service dependency. The release package must perform the complete comparison locally.

- **MATCH01:** Check portrait selection, coordinate transforms, landmark order, alignment to the model input, color-channel order, tensor layout and normalization. Compare intermediate crops/tensors as well as final scores.
- **MATCH02:** Compare embeddings and similarity against the reference within documented numerical tolerances. Establish tolerances from actual backend variation; require identical outcomes outside the uncertainty range on every supported backend.
- **MATCH03:** Test a passport with a secondary ghost portrait or other faces in the scene. Select the designated main portrait, or return an inconclusive result if it cannot be identified safely. Do not select the first detected face indiscriminately.
- **MATCH04:** No portrait, multiple selfie faces, unusable quality, invalid tensor dimensions, nonfinite values, a zero-norm embedding and model errors return retry, inconclusive or unavailable. None may fall through to a successful match.
- **MATCH05:** Test genuine pairs from separate capture sessions, unrelated people, similar-looking people and older document photos. Repeating or swapping identical input images is useful for correctness but does not measure passport-to-selfie accuracy.
- **MATCH06:** Test scores immediately below, at and above decision boundaries. Retrying must not silently lower the threshold. A raw similarity score must not be presented as a percentage probability that identities match.
- **MATCH07:** Retaking either image during an active comparison invalidates the previous job and score. The final result must refer to the accepted current images and identify the model/threshold versions used.

### Evaluation study

Collect consented, representative document/selfie pairs, including different skin tones, ages, appearances, passport-photo ages, phones, lighting conditions and image quality. Keep participant data out of the published package, public repository and routine CI logs. Synthetic images test mechanics; they do not establish biometric accuracy.

Split development and final evaluation data by identity. Use development data to choose quality rules, the matching threshold and an explicit inconclusive range; freeze them before opening the held-out evaluation. A practical initial pilot can start with about 100 participants and multiple independently captured selfies per participant, but that is not sufficient evidence for a low false-match claim by itself.

Report false match rate, false nonmatch rate, acquisition failures and inconclusive outcomes separately, with denominators and confidence intervals. Report overall completion across all attempts and conditional accuracy among usable images so quality rejection cannot hide failures. Include subgroup results and state when sample sizes are too small for a conclusion.

Set the intended error-rate target before the final evaluation, according to the application's use of the result. A proposed starting target for an advisory pilot is observed false match rate no greater than 0.1% and false nonmatch rate no greater than 5% among usable pairs; these are planning goals, not established safe approval thresholds. Publish uncertainty alongside the point estimates. Do not infer statistical confidence from thousands of pair combinations that reuse a few identities.

A face match with a printed portrait or replay can still succeed. Include these cases to verify that the product does not label matching or head movement as proof of liveness. Evaluated spoof detection would need its own future test plan and release gate.

## Reliability and package integration

- Cancel or unmount during permission prompts, model loading, worker startup, photo encoding and matching. Stop late-arriving camera streams, terminate workers and dispose of processing sessions. Deliver no late completion callback or stale result.
- Test repeated start/cancel/retake, rapid double clicks, React StrictMode, two mounted instances and configuration changes. Enforce one accepted completion per active flow and correct resource ownership.
- Hide the tab, lock the phone, rotate, disconnect the camera, revoke permission and navigate away/back. Resume safely or give a recoverable error. A timeout must end work rather than leave a spinner running.
- Test denied permission, camera busy, unsupported constraints and unavailable browser APIs. No error path may substitute simulation or produce a match without actual processing.
- Verify public TypeScript exports, optional document capture, optional recording, configurable screens, callbacks, English/German copy and custom asset paths. If face matching is disabled, preserve the existing capture contract.
- Test keyboard navigation, readable focus, screen-reader status updates, reduced motion, 200% text sizing and small phone viewports. Actions and error recovery must remain reachable.

## Performance and resource budgets

Measure asset transfer, model initialization and inference separately. Record cold and cached initialization, image decode/alignment, pair-comparison p50/p95 latency, guide cadence, main-thread responsiveness, peak memory and total transferred asset size. Measure actual phones while both capture and matching resources follow the intended lifecycle.

Proposed initial budgets are:

- Final pair comparison p95 at most 3 seconds on the reference midrange phone and 8 seconds on the older supported phone, after models are ready.
- Cancel stops camera and worker activity within 1 second; pending jobs cannot later complete the cancelled attempt.
- One frame-analysis job in flight per tracker and one active matching job per flow, with no unbounded queue or retained full-resolution frames.
- After 20 complete/cancel/retake cycles, resource counts return to baseline and memory settles rather than growing with every cycle. Allow documented persistent model caches; use instrumented resource counts where browser memory metrics are unavailable.
- The interface remains usable during initialization and comparison, including on the slowest supported device. Record long tasks and response latency; set startup and download budgets after the first benchmark against the chosen models.

Revise these provisional budgets using the first measured baseline and freeze the agreed budgets before final release validation. Test GPU failure and a WebAssembly-only configuration independently; faster acceleration must not change the comparison decision outside the allowed uncertainty range.

## Execution order and existing tests

1. **Baseline and package checks:** preserve current regression coverage, define the local result contract, pin model/runtime assets, and validate a clean tarball consumer. Extend `scripts/check-package.mjs` for every new asset and notice.
2. **Deterministic correctness:** extend `tests/document.test.ts` and add meaningful tests for automatic-shutter races, final-image checks, face preprocessing, comparison boundaries and stale results. Use official reference fixtures for the matcher.
3. **Complete browser flow:** extend `tests/e2e/document-detection.spec.ts`, `face-video.spec.ts` and `capture.spec.ts`; add a local matching flow and network-monitoring coverage from initialization through completion, retry and cancellation. Run from the actual consumer build with upload disabled.
4. **Real devices and pilot:** execute the declared browser matrix, measure performance, run the consented held-out comparison study and record evidence. Correct defects and rerun affected cases plus the relevant regressions.

Use the existing checks: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:demo`, `npm run check:package` and `npm run test:e2e`. Add new cases to those checks as implementation lands. Current Chrome fake-camera E2E coverage must be expanded; it is not a completed cross-browser test.

## Release gates and signoff record

The following must pass before declaring the planned features supported:

- [ ] Clean tarball installation completes the local flow with all required files present.
- [ ] No off-device processing, external requests, automatic uploads or default biometric persistence occurs.
- [ ] All mandatory capture, reference-parity, invalid-input and cancellation cases pass.
- [ ] Every declared supported physical device/browser passes the complete flow; unsupported configurations show a bounded error.
- [ ] Frozen quality/matching rules have held-out evaluation evidence, including error rates, uncertainty, acquisition failures and subgroup limitations.
- [ ] Performance meets the frozen device budgets and repeated-use cleanup passes.
- [ ] Result wording distinguishes capture, comparison, uncertainty and processing failure from authenticity or liveness.
- [ ] Every redistributed code/model asset has recorded provenance, checksums and applicable notices. Resolve the known SFace provenance question before claiming unqualified commercial clearance, or select a model with adequate documentation.
- [ ] No open defect can leak media, return a false successful processing result, use stale images or leave a camera active after cleanup.

Keep pilot use advisory when accuracy evidence does not support the intended decision. Recalibrate and rerun held-out evaluation after changing models, preprocessing, quality gates or thresholds; rerun backend parity when enabling a new execution backend.

The signoff record must contain: release and model versions, test dates, actual device/browser matrix, passed/failed case counts, unresolved limitations, biometric evaluation denominators and intervals, performance results, protected evidence locations, and the person responsible for each test run. A QA plan or build passing is not itself release evidence.

## Technical references

- [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html) describes the JavaScript, WASM, worker and model assets required for browser processing.
- [ONNX Runtime flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) covers paths, threading and execution configuration to validate.
- [OpenCV face recognition source](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_recognize.cpp) is the reference for SFace alignment, input preparation and comparison. Pin an exact revision when generating fixtures.
- [SFace model documentation](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) states its published license; [the provenance question](https://github.com/opencv/opencv_zoo/issues/313) remains a documented release consideration.
- Current project behavior is documented in [Architecture and limitations](./architecture.md) and [API reference](./api.md); those describe the existing capture package, not completed matching functionality.
