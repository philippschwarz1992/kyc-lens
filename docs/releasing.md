# Releasing KYC Lens

The source repository is [philippschwarz1992/kyc-lens](https://github.com/philippschwarz1992/kyc-lens). The first npm release is pending. The proposed npm name is `kyc-lens-react`, with the `kyc-lens-copy-assets` command; that registry name is not reserved. CI runs verification and does not publish packages.

`OWNER` below is a placeholder used only when creating a fork or replacement repository. For this project, the owner is `philippschwarz1992` and package metadata already points to the source repository. The initial package version is `0.1.0`; use the actual release version in tarball and tag names for later releases.

## Before the first public upload

1. Confirm that you have permission to publish the project code under the MIT license. Review [LICENSE](../LICENSE) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
2. Check the MediaPipe runtime and Face Landmarker model sources, applicable distribution terms, and required notices. Setup records the runtime version, model URL, and SHA-256 in `assets/manifest.json`. A checksum establishes the downloaded version; it does not establish licensing rights. Review the upstream model documentation when preparing each release.
3. Inspect the source tree and future staged changes for credentials, personal media, private configuration, and other material unsuitable for a public repository. Use synthetic examples. Generated assets, builds, browser reports, dependencies, and tarballs are excluded by `.gitignore`.
4. Confirm that the README, API, integration, and architecture documentation describe the release accurately. Capture completion must remain distinct from liveness or identity approval. The sample receiver must remain clearly described as development code.
5. Check the proposed names. For GitHub, inspect the selected owner's existing repositories. For npm, query the registry:

```sh
npm view kyc-lens-react name version --registry https://registry.npmjs.org/
```

An existing package means the name is already in use. An `E404` can indicate it is currently absent; a network or authentication error is not evidence of availability. Availability may change before publication. If you select another name, update `package.json`, the lockfile, CLI name where appropriate, tests, and documentation consistently.

## Verify and inspect the package locally

Use Node.js 22.12 or newer. CI checks Node.js 22 and 24 and runs the Chrome browser tests. A configured workflow is not evidence that a GitHub run has passed; inspect its results after creating the repository.

```sh
npm ci
npm run setup
npm run check
npm run build:demo
npm run check:package
npx playwright install chrome
npm run test:e2e
npm pack --dry-run
npm pack
```

On Linux, use `npx playwright install --with-deps chrome`. Initial setup requires internet access for the pinned model and, if needed, its upstream license. `prepack` prepares assets and builds the distribution.

Review the dry-run file list and inspect `kyc-lens-react-0.1.0.tgz`. It should contain the JavaScript/TypeScript exports, scoped stylesheet, workers and their chunks, model, WASM assets, asset-copy script, documentation, project license, and third-party notices. It should exclude credentials, captures, test reports, and `node_modules`. Inspect `package.json` inside the tarball, including the name, version, exports, bin entry, engines, peer dependencies, and publish configuration. Test installation of the tarball in a separate React application and run its asset-copy command before release; `check:package` provides an automated distribution smoke check.

## Create a fork or replacement repository

These are manual publication steps to run after reviewing the files. They are not performed as part of local preparation. If this directory already has Git history, preserve it and skip initialization.

```sh
git init -b main
git add .
git diff --cached --stat
git diff --cached
git commit -m "Prepare KYC Lens open source package"
gh auth login
gh repo create OWNER/kyc-lens --public --source . --remote origin --push
```

If a repository or `origin` remote already exists, inspect it and choose the matching push workflow instead of creating a duplicate. The [GitHub CLI repository guide](https://cli.github.com/manual/gh_repo_create) explains the creation options.

After choosing the owner, set package metadata to the actual repository before packing the release. For example:

```sh
npm pkg set repository.type=git "repository.url=git+https://github.com/OWNER/kyc-lens.git"
npm pkg set "homepage=https://github.com/OWNER/kyc-lens#readme" "bugs.url=https://github.com/OWNER/kyc-lens/issues"
npm install --package-lock-only --ignore-scripts
```

Update any owner placeholders in documentation, commit the metadata, and repeat the package checks and packing steps. Do not publish metadata containing the literal `OWNER` placeholder. Enable GitHub private vulnerability reporting as described in [SECURITY.md](../SECURITY.md). Run CI and inspect all jobs. Repository settings, branch protection, and a private conduct contact are owner choices that need to be configured on GitHub.

## Prepare the release commit

Before producing the final tarball, set the intended version, replace that version's `Unreleased` marker in [CHANGELOG.md](../CHANGELOG.md) with the release date, and update publication-status text in the README and [SECURITY.md](../SECURITY.md). The initial `0.1.0` version is already set. For a later release, `npm version 0.1.1 --no-git-tag-version` is an example of updating both package files without creating a tag; choose the actual next version.

Review and commit the release changes, then repeat the verification and packing commands above. Record the commit with `git rev-parse HEAD`. Keep that commit unchanged until its tarball is published and tagged. If any source, documentation, or package metadata changes after packing, repeat the relevant checks and pack again.

## Publish the reviewed tarball to npm manually

Confirm that the name and version are correct and available, and that you have publication access. If the name is occupied by an unrelated package, choose a new name. For an existing package you own, use a version that has never been published.

```sh
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
npm publish ./kyc-lens-react-0.1.0.tgz --dry-run --access public --registry https://registry.npmjs.org/
```

Review the output. A dry run does not reserve a name or version and does not guarantee registry acceptance. When ready to make the public release, publish that same inspected tarball:

```sh
npm publish ./kyc-lens-react-0.1.0.tgz --access public --registry https://registry.npmjs.org/
npm view kyc-lens-react@0.1.0 version dist.integrity --registry https://registry.npmjs.org/
```

Complete any authentication or two-factor challenge requested by npm. The [npm publish reference](https://docs.npmjs.com/cli/v11/commands/npm-publish/) describes registry behavior. Publication makes the package publicly downloadable; a published name/version cannot simply be overwritten.

Test a fresh installation from the registry and copy its assets:

```sh
npm install kyc-lens-react@0.1.0
npx kyc-lens-copy-assets ./public/kyc-assets
```

Run those consumer commands in a separate application, not in this package's own source directory. Verify the capture flow, worker/model loading, recording playback, and your backend integration in that application.

## Record the release

Tag the release commit that produced the published tarball. The commands below assume it is still `HEAD`; otherwise supply the recorded commit to `git tag`. Push the commit and tag to the selected repository:

```sh
git tag -a v0.1.0 -m "KYC Lens 0.1.0"
git push origin main
git push origin v0.1.0
```

Create a GitHub release from that tag with the actual changes, relevant limitations, and checks performed. Do not claim device support or security properties that were not tested. For subsequent versions, update the package and lockfile together, add a changelog entry, repeat the checks, and publish a newly inspected tarball.

The CI workflow performs verification and saves browser reports. It has no npm publication step, publishing credentials, or automatic release process.
