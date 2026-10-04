# Third-party components

KYC Lens's MIT license applies to the project code. It does not replace the
licenses or terms of the third-party libraries and assets below.

This SDK uses `@mediapipe/tasks-vision` (Google MediaPipe), distributed under
Apache-2.0. Its worker includes the JavaScript runtime. Matching WASM files are
copied from the installed npm package. Preserve the upstream license notices
when redistributing these assets. The redistribution license is included in
`assets/MEDIAPIPE-LICENSE.txt` and copied into the consumer's public asset directory.
Upstream: [Google MediaPipe](https://github.com/google-ai-edge/mediapipe).

The Face Landmarker model is downloaded during developer setup from Google's
versioned MediaPipe model distribution. Its origin, runtime version, and SHA-256
are recorded in `assets/manifest.json`. Setup verifies the pinned checksum.
Review the applicable model distribution terms before redistributing it;
the checksum confirms its version, not its licensing terms. Model documentation:
[Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker).

XState is distributed under MIT. React and React DOM are peer dependencies
distributed under MIT. Their licenses remain with their respective packages.

The original project copyright in `LICENSE` names KYC Kit contributors; the
project is now called KYC Lens. That notice is retained for attribution.

Local face comparison uses ONNX Runtime Web (MIT), OpenCV YuNet `face_detection_yunet_2023mar.onnx` (MIT), and OpenCV SFace `face_recognition_sface_2021dec.onnx` (Apache-2.0). Their full published notices are included in `assets/matching/` and copied alongside the model files. ONNX Runtime is bundled into the comparison worker; its matching WASM files are packaged. Pinned model sizes and SHA-256 hashes, runtime version and asset hashes are recorded in `assets/matching/manifest.json`. The worker verifies model hashes before inference.

Upstream: [ONNX Runtime](https://github.com/microsoft/onnxruntime), [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface). Published code/model notices do not settle all training-data rights: [SFace training-data clarification issue #313](https://github.com/opencv/opencv_zoo/issues/313) remains unresolved. Packaging these notices is not a commercial rights certification. Evaluate model rights and domain-specific accuracy before production deployment.

The SFace example threshold is an engineering starting point, not a calibrated passport-to-selfie operating point. Local scores do not establish liveness or document authenticity, and browser results are not authoritative access-control evidence.

No identity verification or liveness provider is contacted by this package.
