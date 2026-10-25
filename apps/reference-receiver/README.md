# Reference receiver

A minimal stand-in for the system that keeps verified cases (your CRM). It shows what your backend has to do with a gateway delivery:

1. Read the raw body and verify `X-KYC-Signature` with the shared `WEBHOOK_SECRET` before parsing anything: `verifyDelivery` from `@kyc-lens/contracts`. Deliveries older than 5 minutes are refused.
2. Parse the multipart body. Part `event` is a `VerificationEvent` (session id, your reference, capture metadata, the analysis verdict or `analysisError`). The media parts are named by capture field: `selfie`, `documentFront`, `documentBack`, `faceVideo`.
3. Store the case once per `sessionId` and answer `2xx`, for redeliveries too. Anything else makes the gateway retry.

This app keeps cases in D1 (`migrations/`) and media in R2 (EU), and lists them at `/` behind Basic auth (`VIEWER_USERNAME`, `VIEWER_PASSWORD`).

Verifying a signature without the TypeScript helper (Python):

```python
import hashlib, hmac, time

def verify(secret: str, header: str, body: bytes) -> bool:
    fields = dict(part.split("=", 1) for part in header.split(","))
    t = int(fields["t"])
    if abs(time.time() - t) > 300:
        return False
    message = f"{t}.{hashlib.sha256(body).hexdigest()}".encode()
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, fields["v1"])
```
