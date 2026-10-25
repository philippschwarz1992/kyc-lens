# Matching reference fixture

`astronaut.png` is the 512 × 512 color photograph of NASA astronaut Eileen Collins redistributed by scikit-image v0.25.2. It is a development fixture only, excluded from the npm package. It is used to check implementation mechanics, not to measure biometric accuracy or represent a real passport.

- Pinned source: https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png
- Source documentation and public-domain statement: https://scikit-image.org/docs/0.25.x/api/skimage.data.html#skimage.data.astronaut
- Original NASA Great Images source: https://flic.kr/p/r9qvLn

The source documentation states that the image has no known copyright restrictions and was released into the public domain. No endorsement by NASA or the depicted astronaut is implied.

Reference preprocessing uses OpenCV 4.12.0 (`opencv-python-headless` 4.12.0.88), with the exact YuNet and SFace models recorded in the package asset manifest. Reference values are generated offline in development; no Python or OpenCV server is required by the release package.
