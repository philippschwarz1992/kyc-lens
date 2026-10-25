# KYC Lens

Guided identity capture for the browser, with server-side verification and delivery to your own backend.

| Path | What it is |
|---|---|
| [`packages/sdk`](./packages/sdk) | `kyc-lens-react`, the published React SDK: automatic document capture, guided selfie and video, on-device MRZ and face checks. [SDK README](./packages/sdk/README.md) |
| [`apps/playground`](./apps/playground) | Development playground and theme studio. Runs the SDK from source, with a local sample upload receiver (`server.ts`). |
| [`apps/gateway`](./apps/gateway) | Cloudflare Worker that serves the playground and relays phone handoff. |

The browser checks guide the user; they are not a verification decision. A server-side analysis service and delivery of the final images and result to your backend are being added (see `docs/` once available).

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
