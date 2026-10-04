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

No identity verification or liveness provider is contacted by this package.
