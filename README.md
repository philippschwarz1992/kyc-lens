# KYC Lens

Guided identity capture for the browser, with server-side verification and delivery to your own backend.

| Path | What it is |
|---|---|
| [`packages/sdk`](./packages/sdk) | `kyc-lens-react`, the published React SDK: automatic document capture, guided selfie and video, on-device MRZ and face checks. [SDK README](./packages/sdk/README.md) |
| [`apps/playground`](./apps/playground) | Development playground and theme studio. Runs the SDK from source, with a local sample upload receiver (`server.ts`). |
| [`apps/gateway`](./apps/gateway) | Cloudflare Worker: serves the playground and relays phone handoff; with `--env verify` it runs the capture API, the analysis container and signed delivery to your backend. |
| [`apps/reference-receiver`](./apps/reference-receiver) | Stand-in for your CRM: verifies signed deliveries and keeps cases in D1 and R2. |
| [`packages/contracts`](./packages/contracts) | Upload validation, the verification result and webhook signing, shared by all of the above. |
| [`services/analysis`](./services/analysis) | Python analysis service: MRZ/OCR (RapidOCR), face match (YuNet + SFace), passive liveness (MiniFASNet), run as a Cloudflare Container. |

The browser checks guide the user; they are not a verification decision. The server-side flow is SDK → gateway → analysis → your backend: the gateway stages the upload in EU R2, the analysis service returns a verdict, and the case (media + verdict) is delivered to your webhook, signed, and then deleted from staging.

## Develop

Use Node.js 22.12 or newer. On Windows, `start-demo.cmd` runs the same steps.

```sh
npm ci
npm run setup
npm run dev
```

`npm run setup` downloads the pinned models into `packages/sdk/assets`. The playground opens at `http://localhost:5173`.

## Check

```sh
npm run check
npm run test:e2e -- --project=chrome
```

`npm run check` typechecks all workspaces, runs their unit tests and builds the SDK. Package checks run from the root as well: `check:package`, `check:size`, `check:consumer` and `check:matching-reference`. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [releasing](./packages/sdk/docs/releasing.md).

## License

MIT, see [LICENSE](./LICENSE). Third-party models and runtimes keep their own licences: [THIRD_PARTY_NOTICES.md](./packages/sdk/THIRD_PARTY_NOTICES.md).
