# Advanced installation

How to run the verification stack (gateway Worker, analysis container, webhook receiver) locally and on Cloudflare. For what the parts do, read the [system guide](./system.md) first; for the SDK alone, [getting started](../packages/sdk/docs/getting-started.md).

## What you install

| Part | Where | Cloudflare name |
|---|---|---|
| Gateway Worker, `verify` environment | `apps/gateway` | `kyc-lens-verify` |
| Analysis service (Cloudflare Container) | `services/analysis` | built and pushed by the gateway deploy |
| Webhook receiver (your CRM, or the reference one) | `apps/reference-receiver` | `kyc-lens-reference-receiver` |
| Public playground, no verification (optional) | `apps/gateway`, default environment | `kyc-lens-demo` |

## Requirements

- Node.js 22.18 or newer, then `npm ci` and `npm run setup` from the repository root.
- Docker (Docker Desktop on Windows), running, for the analysis image.
- A Cloudflare account on the **Workers Paid** plan (Containers need it), and `npx wrangler login`. Check with `npx wrangler whoami`.
- Python 3.12 only if you want to generate test samples (`services/analysis/scripts/make_samples.py`).

All `wrangler` commands below run from `apps/gateway` unless a step says otherwise.

## 1. Run it locally

Three terminals, one per service. Keep `--persist-to` paths short on Windows: long paths make local Durable Object, D1 and R2 state fail with `internal error`.

**Analysis.** Either the stub, which answers instantly with a fixed verdict:

```sh
node apps/gateway/scripts/mock-analysis.mjs
```

or the real service:

```sh
docker build -t kyc-lens-analysis services/analysis
docker run --rm -p 127.0.0.1:8099:8080 -e ANALYSIS_SECRET=analysis-secret kyc-lens-analysis
```

Wait for `curl http://127.0.0.1:8099/health` to report `"ready": true` (the models load at start).

**Receiver** (from `apps/reference-receiver`):

```sh
npx wrangler d1 migrations apply kyc-lens-cases --local --persist-to %TEMP%/kycrcv
npx wrangler dev --port 8788 --persist-to %TEMP%/kycrcv --var WEBHOOK_SECRET:webhook-secret --var VIEWER_USERNAME:viewer --var VIEWER_PASSWORD:pass
```

**Gateway** (from `apps/gateway`):

```sh
npx wrangler dev --env verify --port 8797 --persist-to %TEMP%/kycgw --var API_KEY:server-key --var WEBHOOK_URL:http://127.0.0.1:8788/webhooks/kyc --var WEBHOOK_SECRET:webhook-secret --var ANALYSIS_URL:http://127.0.0.1:8099 --var ANALYSIS_SECRET:analysis-secret
```

`ANALYSIS_URL` makes the gateway call your local service instead of the container. If `wrangler dev` still tries to build the container image, run it against a copy of `wrangler.jsonc` without the `containers` entry (`--config wrangler.local.jsonc`). On macOS/Linux use `/tmp/...` instead of `%TEMP%`.

**Check it:**

```sh
node apps/gateway/scripts/e2e-local.mjs
```

With the real analysis service, also run the content checks (passport MRZ, face match and mismatch, liveness failure of a still video):

```sh
python services/analysis/scripts/make_samples.py samples
node apps/gateway/scripts/e2e-analysis.mjs samples
```

Open `http://127.0.0.1:8788/` (viewer / pass) to see the delivered cases.

## 2. Create the Cloudflare resources

One time per account:

```sh
npx wrangler r2 bucket create kyc-lens-staging --jurisdiction eu
npx wrangler r2 bucket lifecycle add kyc-lens-staging expire-staging --expire-days 7 --jurisdiction eu
npx wrangler queues create kyc-lens-delivery
npx wrangler queues create kyc-lens-delivery-failed
npx wrangler r2 bucket create kyc-lens-demo-assets
```

`kyc-lens-demo-assets` holds the SFace model, which is too large for Workers static assets. Upload it once:

```sh
npx wrangler r2 object put kyc-lens-demo-assets/kyc-assets/matching/face_recognition_sface_2021dec.onnx --file ../../packages/sdk/assets/matching/face_recognition_sface_2021dec.onnx --remote
```

## 3. Deploy the webhook receiver

Skip this when your own backend receives the webhook; it has to do what the [webhook contract](./system.md#webhook-contract) says.

From `apps/reference-receiver`:

```sh
npx wrangler d1 create kyc-lens-cases
```

Put the printed `database_id` into `apps/reference-receiver/wrangler.jsonc`, then:

```sh
npx wrangler r2 bucket create kyc-lens-cases --jurisdiction eu
npx wrangler d1 migrations apply kyc-lens-cases --remote
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put VIEWER_USERNAME
npx wrangler secret put VIEWER_PASSWORD
npm run deploy -w @kyc-lens/reference-receiver
```

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. `WEBHOOK_SECRET` must be the same value on the receiver and the gateway.

## 4. Configure and deploy the gateway

Edit the `verify` environment in `apps/gateway/wrangler.jsonc`:

| Var | Value |
|---|---|
| `WEBHOOK_URL` | Your receiver, e.g. `https://crm.example.com/webhooks/kyc` or the reference receiver's `workers.dev` URL + `/webhooks/kyc` |
| `SESSION_MODE` | `open` for testing with the playground; **`server`** before real users (only your backend, with `API_KEY`, creates sessions) |
| `SESSION_TTL_MINUTES` | How long a session token is valid (default config: 15) |
| `ANALYSIS_INSTANCES` | Container instances the gateway spreads analyses over; keep ≤ `containers[0].max_instances` |

The `services` binding `WEBHOOK_SERVICE` delivers to the reference receiver Worker directly. Remove it when `WEBHOOK_URL` points at your own backend.

Set the secrets:

```sh
npx wrangler secret put API_KEY --env verify
npx wrangler secret put WEBHOOK_SECRET --env verify
npx wrangler secret put ANALYSIS_SECRET --env verify
```

Deploy (Docker must be running):

```sh
npm run deploy:verify -w @kyc-lens/gateway
```

This builds the playground, excludes the SFace model from the static assets (`scripts/prepare-deploy.mjs`), builds and pushes the analysis image and deploys `kyc-lens-verify`. The first container start takes a minute or two while the image is pulled and the models load; the gateway retries analysis 3 times, so early cases still arrive.

`npx wrangler containers list` and `npx wrangler containers images list` show the container state.

## 5. Verify the deployment

Create a session as your backend would:

```sh
curl -X POST https://kyc-lens-verify.<subdomain>.workers.dev/api/kyc/sessions -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" -d "{\"reference\":\"test-1\",\"applicant\":{\"surname\":\"Mustermann\"}}"
```

The answer is `{ id, token, expiresAt }`. Then:

1. Open the gateway URL in a browser (in `open` mode the playground creates its own session) and complete a capture, or pass `{ id, token }` to `KycLens` in your app.
2. Poll `GET /api/kyc/sessions/<id>` with the API key: `pending_capture` → `processing` → `delivered`.
3. Check the case in your receiver (reference receiver: its URL, Basic auth).

Logs: `npx wrangler tail kyc-lens-verify` (errors only by name, never media or tokens).

## 6. Before real users

- `SESSION_MODE` is `server`, and `WEBHOOK_URL` points at your backend, which verifies `X-KYC-Signature` and stores each `sessionId` once.
- Secrets are random, at least 32 bytes, and not reused between environments.
- The 7-day lifecycle rule is on `kyc-lens-staging`: `npx wrangler r2 bucket lifecycle list kyc-lens-staging --jurisdiction eu`.
- Something watches `kyc-lens-delivery-failed` and sessions in `failed`.
- GDPR: legal basis (usually explicit consent), DPIA and retention policy for biometric data; check where Cloudflare runs your Containers. See [privacy and security](./system.md#privacy-and-security).

## Updating and rotating

- **Code changes:** run `npm run deploy:verify -w @kyc-lens/gateway` again; the container image is rebuilt when `services/analysis` changed.
- **Rotating `WEBHOOK_SECRET`:** set the new value on the receiver and the gateway close together; deliveries signed with the old one fail and are retried (up to 10 attempts over about an hour), so a short gap loses nothing.
- **Rotating `API_KEY`:** update your backend right after `wrangler secret put`; running sessions keep working, since they use their own tokens.
- **Rollback:** `npx wrangler rollback --env verify`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `internal error` in local `wrangler dev` | `--persist-to` path too long (Windows) |
| Local dev builds a container | Use a config copy without `containers` and set `ANALYSIS_URL` |
| Deploy fails at the image step | Docker not running, or the account lacks Workers Paid |
| Cases arrive with `analysisError` | Container not ready or `ANALYSIS_SECRET` differs; check `wrangler tail` |
| Session stays `processing`, then `failed` | Receiver answers non-2xx or refuses the signature (`WEBHOOK_SECRET` mismatch, clock skew > 5 min) |
| `401` on `POST /api/kyc/sessions` | Wrong or missing `API_KEY` in `server` mode |
| `403` on `POST /api/kyc/sessions` | `applicant` sent from a browser in `open` mode |
| `404` "verification is not configured" | Deployed without `--env verify`, or `WEBHOOK_URL` / `WEBHOOK_SECRET` missing |
| Face matching model 404 | SFace model not uploaded to `kyc-lens-demo-assets` |
