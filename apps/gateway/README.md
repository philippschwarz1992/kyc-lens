# Gateway

Cloudflare Worker in front of KYC Lens.

- **Default environment** (`kyc-lens-demo`): serves the playground, relays phone handoff, serves the SFace model from R2.
- **`verify` environment** (`kyc-lens-verify`): adds server-side verification:
  1. The customer backend creates a session with its API key: `POST /api/kyc/sessions`, `Authorization: Bearer <API_KEY>`, optional `{ "reference": "crm-42" }`. It passes `{ id, token }` to the browser.
  2. The SDK uploads the capture: `POST /api/kyc/sessions/:id/capture` with the session token. The checks are the same as the playground receiver's (`@kyc-lens/contracts`). The files are staged in R2 (EU) and a delivery job is queued.
  3. The queue consumer sends the files to the analysis container (`services/analysis`, `POST /analyze`). It then posts the case to `WEBHOOK_URL` as multipart, signed with `X-KYC-Signature`, and deletes the staged copy.
  4. `GET /api/kyc/sessions/:id` reports `pending_capture | processing | delivered | failed`, never the verdict.

Analysis failures are retried 3 times. After that the case is delivered without a verdict (`analysisError`) for manual review. Webhook failures are retried with backoff from 10 s to 15 min, up to 10 attempts. The session is then marked `failed`, and the staged files stay until the bucket's lifecycle rule removes them.

## Configuration (`--env verify`)

| Name | Kind | Purpose |
|---|---|---|
| `API_KEY` | secret | Lets your backend create and read sessions |
| `WEBHOOK_URL` | var | Your backend's receiver, e.g. `https://crm.example.com/webhooks/kyc` |
| `WEBHOOK_SECRET` | secret | Signs deliveries; your receiver verifies with `verifyDelivery` from `@kyc-lens/contracts` |
| `ANALYSIS_SECRET` | secret | Shared with the analysis container |
| `ANALYSIS_URL` | var, optional | Use an analysis service at this URL instead of the container (local runs) |
| `SESSION_MODE` | var | `server` (default) or `open` (anyone may create sessions; playground only) |

Resources: R2 bucket `kyc-lens-staging` (EU jurisdiction, add a 7-day lifecycle rule), queues `kyc-lens-delivery` and `kyc-lens-delivery-failed`, and the Workers Paid plan for Containers.

## Test

```sh
npm test -w @kyc-lens/gateway
```

Local end to end, against a stub analysis service and the reference receiver, in three terminals:

```sh
node apps/gateway/scripts/mock-analysis.mjs
```

```sh
cd apps/reference-receiver && npx wrangler d1 migrations apply kyc-lens-cases --local --persist-to %TEMP%/kycrcv && npx wrangler dev --port 8788 --persist-to %TEMP%/kycrcv --var WEBHOOK_SECRET:webhook-secret --var VIEWER_USERNAME:viewer --var VIEWER_PASSWORD:pass
```

```sh
cd apps/gateway && npx wrangler dev --env verify --port 8797 --persist-to %TEMP%/kycgw --var API_KEY:server-key --var WEBHOOK_URL:http://127.0.0.1:8788/webhooks/kyc --var WEBHOOK_SECRET:webhook-secret --var ANALYSIS_URL:http://127.0.0.1:8099 --var ANALYSIS_SECRET:analysis-secret
```

Then run `node apps/gateway/scripts/e2e-local.mjs`.

With the real analysis service instead of the stub, run `docker build -t kyc-lens-analysis services/analysis && docker run --rm -p 127.0.0.1:8099:8080 -e ANALYSIS_SECRET=analysis-secret kyc-lens-analysis`. Generate samples with `python services/analysis/scripts/make_samples.py <dir>`, then run `node apps/gateway/scripts/e2e-analysis.mjs <dir>`. It checks the passport MRZ, a face match and a mismatch, and the liveness failure of a still video.

On Windows, keep `--persist-to` short: local Durable Object, D1 and R2 state fails with `internal error` when the path is too long. Until the analysis image exists, local `wrangler dev --env verify` may try to build the container. In that case use a config copy without the `containers` entry, as the e2e run did.
