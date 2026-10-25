# Test fixtures

Development fixtures only. They check implementation mechanics; they do not measure biometric accuracy and do
not represent real identity documents.

## MRZ photos

`mrz-td1.json` and `mrz-td3.json` are copied from `packages/sdk/tests/fixtures/`. They are synthetic, photographed
(rotated, blurred, compressed) renderings of the fictional ICAO 9303 specimens (Utopia, Anna Maria Eriksson),
produced by `packages/sdk/scripts/train-mrz.mjs`. Each holds a gzip+base64 greyscale image with `width`, `height`,
the document `corners` and the expected MRZ `lines`.

## Faces

All three photographs are works of NASA, a US federal agency, and are in the public domain. No endorsement by
NASA or the people shown is implied.

| File | Person | Source | Licence |
| --- | --- | --- | --- |
| `astronaut.png` | Eileen Collins | Copied from `packages/sdk/tests/fixtures/` (see its `matching-reference-notice.md`): scikit-image v0.25.2 [`skimage/data/astronaut.png`](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png), from NASA Great Images | Public domain |
| `collins-portrait.jpg` | Eileen Collins | [File:Eileen Collins, early NASA portrait.jpg](https://commons.wikimedia.org/wiki/File:Eileen_Collins,_early_NASA_portrait.jpg) on Wikimedia Commons (original SHA-256 `788e97c3a72c1a3e06a21a24841a6e4b71b38df7b37c0699658b091043b45207`), downscaled to 506 × 640 | Public domain (NASA) |
| `ride-portrait.jpg` | Sally Ride | [File:Sally Ride (1984).jpg](https://commons.wikimedia.org/wiki/File:Sally_Ride_(1984).jpg) on Wikimedia Commons, NASA photo [S84-37256](https://images.nasa.gov/details-S84-37256) (original SHA-256 `ea25b741c25978a84efbd5c0c333c61e59486768178799c7f32b05d07e851cef`), downscaled to 512 × 640 | Public domain (NASA) |

`astronaut.png` and `collins-portrait.jpg` are different photographs of the same person; `ride-portrait.jpg` shows
someone else. `tests/fixtures.py` pastes `astronaut.png` into the TD3 specimen to make a passport-like photo with a
portrait, and turns a still photo into a short MP4 to simulate a replayed image.
