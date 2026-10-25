# KYC Lens system guide

How the parts fit together, how to deploy them, and what your backend has to do.

## Flow

```
Your backend ── POST /api/kyc/sessions (API key) ──▶ Gateway Worker ── creates a session (Durable Object)
     │  { id, token }
     ▼
Browser (kyc-lens-react, session={{ id, token }}) ── POST /sessions/:id/capture ──▶ Gateway
                                                                                     │ validates, stages in R2 (EU), queues
                                                                                     ▼
                                                     Queue consumer ── POST /analyze ──▶ Analysis container (Python)
                                                                                     │ verdict
                                                                                     ▼
Your backend (webhook) ◀── signed multipart: event + media ── Queue consumer, then deletes the staged copy
```

- The **SDK** guides the capture and checks quality on the device. Its checks, including `document.mrz` and the local face comparison, are capture aids, not a decision.
- The **gateway** (`apps/gateway`, `--env verify`) owns sessions, upload validation (`packages/contracts`), staging, retries and signed delivery. Status responses never include the verdict.
- The **analysis service** (`services/analysis`) returns the verdict: `approved`, `review` or `rejected`, with reasons, MRZ fields, face-match and liveness scores. It runs without persistence and never writes media to disk or logs.
- **Your backend** creates the session with your own `reference` (for example your user id) and, optionally, the `applicant` data you already hold. The analysis service compares that data with the document, and the case comes back with both.
- **Your backend** receives each case once and stores it. `apps/reference-receiver` is a working example to copy or replace.

## Session request

`POST /api/kyc/sessions` with `Authorization: Bearer <API_KEY>`:

```json
{
  "reference": "user-123",
  "applicant": { "givenNames": "Anna Maria", "surname": "Müller", "birthDate": "1974-08-12" }
}
```

Both are optional. `reference` is 1–128 letters, digits or `._:-` and comes back unchanged in the webhook. `applicant` takes any of `givenNames`, `surname` and `birthDate` (`YYYY-MM-DD`). It is never shown to the browser or in the session status, and only your backend may send it (in `open` mode a browser request with `applicant` is refused).

The answer is `{ id, token, expiresAt }`; pass `{ id, token }` to the SDK as its `session`.

## Applicant check

With applicant data, `analysis.applicantCheck` says field by field what the document holds:

```json
{
  "result": "mismatch",
  "fields": {
    "givenNames": { "expected": "ANNA MARIA", "document": "ANNA MARIA", "source": "mrz", "result": "match" },
    "surname":    { "expected": "MUELLER",    "document": "MUELLER",    "source": "mrz", "result": "match" },
    "birthDate":  { "expected": "1974-08-12", "document": "1975-08-12", "source": "mrz", "result": "mismatch" }
  }
}
```

- `result`: `match` (every field agrees), `mismatch` (at least one disagrees) or `incomplete` (none disagrees, but one could not be read). A mismatch adds the reason `applicant-data-mismatch`, an incomplete check `applicant-data-not-read`; both send the case to `review`, so your backend decides.
- `source`: `mrz` for a valid machine-readable zone, `printed` for the printed page. A field matches when either agrees.
- Names are compared on their letters, upper case without diacritics: Müller matches MUELLER and MULLER, Anna-Maria matches ANNA MARIA. A first given name alone (Anna) matches ANNA MARIA. A name the zone truncated only has to start yours.
- The full document data stays in `analysis.document.mrz.fields` and `analysis.document.printedFields`.

## Webhook contract

`POST <WEBHOOK_URL>` with `Content-Type: multipart/form-data`:

| Part | Content |
|---|---|
| `event` | JSON `VerificationEvent`: `type: "verification.completed"`, `sessionId`, your `reference` and `applicant`, `receivedAt`, capture `metadata`, `analysis` (the `VerificationResult`, or `null` with `analysisError` when analysis was unavailable) and `files` |
| `selfie`, `documentFront`, `documentBack`, `faceVideo` | The media, as listed in `event.files` |

Headers:
- `X-KYC-Signature: t=<unix seconds>,v1=<hex>`, where `v1 = HMAC-SHA256(WEBHOOK_SECRET, "<t>.<hex SHA-256 of the raw body>")`.
- `X-KYC-Delivery: <sessionId>`.

Verify the signature over the raw bytes before parsing, and refuse it when `t` is more than 5 minutes old. `verifyDelivery` in `packages/contracts` does both; the reference receiver's README has a Python version.

Store each `sessionId` once and answer `2xx`, for redeliveries too. Anything else is retried with backoff for up to 10 attempts. After that the session status becomes `failed`.

## Deploy

Requirements: Workers Paid plan (Containers), Docker for the image build, `wrangler login`.

1. Create the resources (one time):
   ```sh
   npx wrangler r2 bucket create kyc-lens-staging --jurisdiction eu
   npx wrangler r2 bucket lifecycle add kyc-lens-staging expire-staging --expire-days 7 --jurisdiction eu
   npx wrangler queues create kyc-lens-delivery
   npx wrangler queues create kyc-lens-delivery-failed
   ```
2. Set the secrets: `npx wrangler secret put API_KEY --env verify`, then the same for `WEBHOOK_SECRET` and `ANALYSIS_SECRET` (run from `apps/gateway`). Set `WEBHOOK_URL` in the `verify` vars of `apps/gateway/wrangler.jsonc`.
3. Deploy: `npm run deploy:verify -w @kyc-lens/gateway`. This builds the playground, builds and pushes the analysis image, and deploys `kyc-lens-verify`.
4. Reference receiver (optional): create the D1 database `kyc-lens-cases` and put its id in `apps/reference-receiver/wrangler.jsonc`. Create the R2 bucket `kyc-lens-cases` (EU). Set `WEBHOOK_SECRET`, `VIEWER_USERNAME` and `VIEWER_PASSWORD`, then run `npm run deploy -w @kyc-lens/reference-receiver`.

The default environment (`npm run deploy:cloudflare`) stays the public playground without verification.

## Privacy and security

- The data includes biometric data (GDPR Art. 9). You need a legal basis (usually explicit consent), a data protection impact assessment and a retention policy before going live.
- **Staging:** media sit in an EU-jurisdiction R2 bucket only between upload and delivery. They are deleted after a successful delivery, and by a 7-day lifecycle rule otherwise. Check where Cloudflare runs your Containers before production.
- **Tokens and logs:** session tokens are stored only as SHA-256 hashes. Logs carry error names and short messages, never media, tokens or verdicts.
- **What to trust:** only a signature-verified webhook delivery is authoritative. Browser-side results and session status are not.
