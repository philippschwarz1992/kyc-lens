# Security policy

KYC Lens is a pre-release capture SDK. There are no published releases yet. Once releases exist, maintainers will focus fixes on the latest release; there is no guaranteed response time or long-term support commitment.

## Report a vulnerability privately

Private vulnerability reporting is enabled for [KYC Lens on GitHub](https://github.com/philippschwarz1992/kyc-lens). Use **Security → Advisories → Report a vulnerability** to contact maintainers privately.

If that option is unavailable, request that maintainers restore it without posting vulnerability details. This project has no dedicated security email address configured.

Please provide:

- The affected version or commit, browser, and operating system.
- Reproduction steps or a minimal example using synthetic media and test credentials.
- Expected and actual behavior, potential impact, and any suggested fix.

Do not include real identity documents, face media, access tokens, or other personal information. Do not disclose an exploitable issue in public issues or pull requests before coordinating with maintainers.

## Scope and deployment responsibilities

Security-relevant problems can include unintended media or token disclosure, unsafe asset loading, camera or recorder cleanup failures, and weaknesses in the sample receiver's request handling.

Movement completion and document-framing feedback do not establish liveness, document authenticity, or identity approval. The SDK deliberately reports `capture_complete`; an application must make its authoritative verification decision on the server.

Applications remain responsible for authentication, media validation and storage, retention and deletion, permissions, asset hosting, and their verification policy. The sample Vite receiver is a temporary development example. See [architecture and limitations](./docs/architecture.md) and [integration guidance](./docs/integration.md).
