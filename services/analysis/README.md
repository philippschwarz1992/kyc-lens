# kyc-lens analysis service

A stateless Python 3.12 FastAPI service that checks one kyc-lens capture: the document photo (outline, quality,
machine-readable zone, printed text, type), the face match between the document portrait and the selfie, and
liveness from the face video. It runs as a container on Cloudflare Containers. The gateway Worker
(`apps/gateway`) calls it after storing the upload in EU R2.

```
SDK ──upload──▶ gateway Worker ──POST /analyze──▶ analysis container
                     │                                  │
                     └──signed webhook (images + VerificationResult)──▶ customer backend
```

## Data protection

Faces and identity documents are biometric and special-category data (GDPR Art. 9). The service keeps nothing:

- The multipart body is read into memory with a size cap and parsed in memory (python-multipart's streaming
  parser, never Starlette's disk-spooled `UploadFile`). Images and video are decoded from memory (Pillow, PyAV).
- Nothing is written to disk. The image runs as an unprivileged user and needs no writable path.
- Nothing derived from the media is logged. Uvicorn's access log shows method, path and status only; analysis
  errors log the exception type, never its message or traceback.
- Models are baked into the image at build time. The container makes no outbound requests.

The response itself contains personal data (MRZ fields, OCR text). Treat it like the images.

## API

### `GET /health`

`{"status": "ok", "ready": true}` once the models are loaded.

### `POST /analyze`

Header `X-Analysis-Secret: <ANALYSIS_SECRET>` (compared in constant time). Without it the service answers 401; when
`ANALYSIS_SECRET` is not set it answers 503.

`multipart/form-data` fields, the same as `packages/sdk/src/api.ts` sends:

| Field | Required | Content |
| --- | --- | --- |
| `documentFront` | yes | JPEG, PNG or WebP |
| `documentBack` | no | JPEG, PNG or WebP |
| `selfie` | yes | JPEG, PNG or WebP |
| `faceVideo` | no | WebM or MP4 |
| `metadata` | yes | JSON: `{challenges, capturedAt, mode, document?: {type, mrz?}}` |

Errors are `{"error": "..."}`: 400 (malformed body, missing field, bad metadata), 401, 413 (over
`MAX_UPLOAD_BYTES`), 422 (an image that cannot be decoded), 500, 503.

The response is a `VerificationResult` (pydantic models in [`app/schema.py`](app/schema.py)):

```jsonc
{
  "status": "approved" | "review" | "rejected",
  "reasons": ["document-expired", ...],
  "document": {
    "type": "passport" | "id-card" | "drivers-license" | null,
    "quality": {"sharpness": 282.9, "glare": 0.0, "brightness": 203.7, "rectified": true, "acceptable": true, "issues": []},
    "mrz": {"format": "TD3", "kind": "passport", "valid": true,
            "fields": {"documentCode": "P", "issuingState": "UTO", "documentNumber": "L898902C3", "surname": "ERIKSSON",
                       "givenNames": "ANNA MARIA", "nationality": "UTO", "birthDate": "1974-08-12", "sex": "F",
                       "expiryDate": "2012-04-15", "optionalData": "ZE184226B"}} | null,
    "ocrText": "..."
  },
  "faceMatch": {"score": 0.8098, "threshold": 0.363, "decision": "match" | "no-match"} | null,
  "liveFaceMatch": {"score": 0.8098, "threshold": 0.363, "decision": "match" | "no-match",
                    "framesCompared": 8, "framesMatched": 8} | null,
  "liveness": {"score": 0.76, "decision": "pass" | "fail", "framesWithFace": 8, "framesSampled": 8} | null
}
```

## Pipeline

1. **Document.** Pillow decodes the photo (EXIF orientation applied, at most 2400 px). OpenCV finds the largest
   four-cornered contour and flattens it; without one the full photo is used. Quality is measured at 1000 px
   width: variance of the Laplacian (blur), share of near-white pixels (glare) and mean grey level (brightness).
2. **Text and MRZ.** RapidOCR (PP-OCRv4 ONNX models) reads the page. The zone is looked for in those lines, then
   in the sharpened bottom band, then in the band turned upside down. [`app/mrz.py`](app/mrz.py) ports the SDK's
   `packages/sdk/src/mrz/parse.ts`: the ICAO 9303 TD1, TD2 and TD3 layouts, check digits (weights 7, 3, 1), per-field character
   classes, check-digit repair from look-alike alternatives (O/0, I/1, B/8, …) and date validity. It adds field
   parsing and dates with their century.
3. **Type.** A valid zone decides: a `P` code in TD3 is a passport, `I`/`A`/`C` in TD1 or TD2 an identity card.
   Without one, printed keywords decide: PASSPORT/REISEPASS, PERSONALAUSWEIS/IDENTITY CARD,
   FÜHRERSCHEIN/DRIVING LICENCE (and a few other languages).
4. **Face match.** YuNet finds the document portrait, which is cut out, upscaled to at least 400 px and detected
   again. SFace embeds it and the selfie's largest face, and the cosine similarity is compared with
   `FACE_MATCH_THRESHOLD`.
5. **Liveness.** PyAV samples `LIVENESS_FRAMES` evenly spaced frames. Every frame must show a face, every face
   must match the selfie, the frames must change (`LIVENESS_MIN_MOTION`), and the mean MiniFASNetV2 + V1SE
   real-face probability must reach `LIVENESS_THRESHOLD`. The motion check matters: in testing, a still photo
   replayed as a video got a high passive anti-spoofing score, and only the missing motion failed it.
6. **Document against live face.** The document portrait is also compared with the face in every sampled video
   frame, so a selfie of the right person cannot cover for someone else in front of the camera. `liveFaceMatch`
   holds the median similarity over those frames, compared with `FACE_MATCH_THRESHOLD`, and how many frames
   matched on their own. It is `null` without a video, or when the document or the video shows no face.

### Decision

| Reason | Effect |
| --- | --- |
| `document-expired` (valid zone, expiry before today) | rejected |
| `document-type-mismatch` (detected type ≠ `metadata.document.type`) | rejected |
| `face-mismatch` (document portrait ≠ selfie) | rejected |
| `live-face-mismatch` (document portrait ≠ face in the video) | rejected |
| `liveness-failed` (identity mismatch, no motion or spoof suspected; the detailed `liveness-*` reasons follow) | rejected |
| `mrz-invalid` (zone found, check digits or dates fail; often a misread) | review |
| `mrz-not-found` (passport or identity card without a readable zone) | review |
| `document-quality-poor`, `document-type-unknown` | review |
| `document-face-not-found`, `selfie-face-not-found` | review |
| `liveness-inconclusive` (too few frames, or a frame without a face) | review |
| `liveness-missing` (no video while `REQUIRE_LIVENESS` is on) | review |

No reason means `approved`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANALYSIS_SECRET` | (none) | Shared secret expected in `X-Analysis-Secret`. Required. |
| `MODELS_DIR` | `./models` (`/app/models` in the image) | Where `fetch_models.py` put the models. |
| `MAX_UPLOAD_BYTES` | `41943040` (40 MiB) | Largest accepted request body. |
| `FACE_MATCH_THRESHOLD` | `0.363` | SFace cosine similarity for a match (OpenCV Zoo operating point). |
| `LIVENESS_THRESHOLD` | `0.6` | Mean anti-spoofing real-face probability. |
| `LIVENESS_FRAMES` | `8` | Frames sampled from the video. |
| `LIVENESS_MIN_FRAMES` | `4` | Fewer decoded frames fail liveness. |
| `LIVENESS_MIN_MOTION` | `1.0` | Mean grey-level change between sampled frames (0–255). |
| `REQUIRE_LIVENESS` | `true` | A capture without a video goes to review. |
| `QUALITY_MIN_SHARPNESS` | `40` | Variance of the Laplacian at 1000 px width. |
| `QUALITY_MAX_GLARE` | `0.05` | Share of near-white pixels. |
| `QUALITY_MIN_BRIGHTNESS` / `QUALITY_MAX_BRIGHTNESS` | `60` / `230` | Mean grey level. |

The thresholds are starting points. Calibrate them on your own captures before production use.

## Local run

Requires [uv](https://docs.astral.sh/uv/).

```bash
cd services/analysis
uv sync
uv run python scripts/fetch_models.py
ANALYSIS_SECRET=dev-secret uv run uvicorn app.main:app --port 8080
```

Tests download the models on their first run, then only re-verify the hashes:

```bash
uv run pytest
```

## Docker

```bash
docker build -t kyc-lens-analysis services/analysis
docker run --rm -p 8080:8080 -e ANALYSIS_SECRET=dev-secret kyc-lens-analysis
```

Try it with sample uploads built from the test fixtures: the ICAO TD3 specimen with a public-domain portrait,
another photo of the same person as the selfie, and a still image replayed as video.

```bash
uv run python scripts/make_samples.py samples
```

```bash
curl -s -H "X-Analysis-Secret: dev-secret" -F documentFront=@samples/document-front.jpg -F selfie=@samples/selfie.jpg -F faceVideo=@samples/face-video.mp4 -F "metadata=<samples/metadata.json" localhost:8080/analyze
```

The result is `rejected`: the specimen expired in 2012 and the video does not move. The face match is a `match`.
Use `samples/other-selfie.jpg` for a `faceMatch` `no-match`, or `samples/other-face-video.mp4` for a `liveFaceMatch`
`no-match` (someone else in front of the camera).

## Models and licences

All models are licensed for commercial use; see [NOTICE.md](NOTICE.md). They are not stored in the repository.
`scripts/fetch_models.py` downloads them and checks each against a pinned SHA-256. In the image, the licence texts
and a manifest are in `/usr/share/licenses/kyc-lens-analysis/`. Test fixture sources are in
[tests/fixtures/NOTICE.md](tests/fixtures/NOTICE.md).
