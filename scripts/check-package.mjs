#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelSha256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFile(resolve(root, path));
const readText = async path => (await read(path)).toString('utf8');
const unixPath = path => path.split(sep).join('/');

function localTarget(target) {
  assert.equal(typeof target, 'string', 'Package export targets must be strings.');
  const normalized = unixPath(target).replace(/^\.\//, '');
  assert(!isAbsolute(target) && !normalized.split('/').includes('..'), `Unsafe package path: ${target}`);
  return normalized;
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected symbolic link: ${path}`);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

async function packedFiles() {
  const args = ['pack', '--ignore-scripts', '--dry-run', '--json'];
  // npm supplies its CLI path to npm scripts; the sibling path covers direct Node invocation.
  const cli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  let output;
  try {
    await stat(cli);
    output = run(process.execPath, [cli, ...args]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // The Windows shell receives a fixed command, with no interpolated paths or user input.
    output = process.platform === 'win32'
      ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm pack --ignore-scripts --dry-run --json'])
      : run('npm', args);
  }
  const packs = JSON.parse(output);
  assert.equal(packs.length, 1, 'Expected one package in npm pack output.');
  return packs[0];
}

function checkPublicTypes(packageName) {
  // A virtual consumer inside this package uses the published export map and declaration files.
  const filename = resolve(root, '__kyc_lens_typecheck__.mts');
  const source = `
    import { KycFlow, createHttpApi, type KycFlowProps, type CapturePayload, type CaptureResult } from '${packageName}';
    import { ChallengeRunner, isCenteredFace, type FaceObservation } from '${packageName}/core';
    const props = { face: { challenges: ['center'], holdDurationMs: 100 }, locale: 'en' } satisfies KycFlowProps;
    KycFlow(props);
    const payload = { selfie: new Blob(), challenges: [], capturedAt: new Date().toISOString(), mode: 'camera' } satisfies CapturePayload;
    const result: CaptureResult = { status: 'capture_complete', payload };
    createHttpApi('/api/kyc').submitCapture({ id: 'session' }, result.payload, new AbortController().signal);
    const observation: FaceObservation = { timestamp: 0, faceCount: 1, centerX: 0.5, centerY: 0.5, relativeSize: 0.4, yaw: 0, pitch: 0 };
    new ChallengeRunner(['center'], 100).update(observation);
    isCenteredFace(observation);
  `;
  const options = {
    noEmit: true, strict: true, skipLibCheck: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, ...rest) => resolve(path) === filename
    ? ts.createSourceFile(path, source, languageVersion, true)
    : originalGetSourceFile(path, languageVersion, ...rest);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
}

async function checkJavaScriptImports(files, base) {
  for (const path of files.filter(path => path.endsWith('.js'))) {
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/\b(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)) {
      const dependency = resolve(dirname(path), match[2]);
      const relativePath = relative(base, dependency);
      assert(!relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath), `Import escapes build: ${path}`);
      assert((await stat(dependency)).isFile(), `Missing local import ${match[2]} in ${path}`);
    }
  }
}

async function checkCopyAssets(assetFiles, builtFiles) {
  const temporaryParent = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryParent, 'kyc-lens-package-check-'));
  const destination = join(temporary, 'public', 'kyc-assets');
  try {
    run(process.execPath, [resolve(root, 'scripts/copy-assets.mjs'), destination]);
    const runtimeFiles = builtFiles.filter(path => {
      const name = unixPath(relative(resolve(root, 'dist'), path));
      return (name.startsWith('chunks/') || !name.includes('/')) && /\.js(\.map)?$/.test(name);
    });
    for (const path of [...assetFiles, ...runtimeFiles]) {
      const base = assetFiles.includes(path) ? resolve(root, 'assets') : resolve(root, 'dist');
      const copied = await readFile(join(destination, relative(base, path)));
      assert.equal(hash(copied), hash(await readFile(path)), `Asset-copy changed or missed ${path}`);
    }
    await checkJavaScriptImports(await filesBelow(destination), destination);
    process.stdout.write('Asset-copy CLI: model, WASM, licenses, workers and relative chunks verified.\n');
  } finally {
    // Remove only the directory this run created, after checking its resolved parent and prefix.
    assert.equal(dirname(resolve(temporary)), temporaryParent);
    assert(relative(temporaryParent, temporary).startsWith('kyc-lens-package-check-'));
    await rm(temporary, { recursive: true, force: true });
  }
}

async function checkPackage() {
  const pkg = JSON.parse(await readText('package.json'));
  assert.equal(pkg.name, 'kyc-lens-react');
  assert.notEqual(pkg.private, true, 'The package must allow publication.');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.bin['kyc-lens-copy-assets'], './scripts/copy-assets.mjs');
  assert.equal(pkg.main, pkg.exports['.'].import);
  assert.equal(pkg.module, pkg.exports['.'].import);
  assert.equal(pkg.types, pkg.exports['.'].types);
  const exportedPaths = ['.', './core'].flatMap(key => [
    localTarget(pkg.exports[key].import), localTarget(pkg.exports[key].types),
  ]);
  exportedPaths.push(localTarget(pkg.exports['./styles.css']), localTarget(pkg.bin['kyc-lens-copy-assets']));
  assert.equal(pkg.exports['./assets/*'], './assets/*');
  assert.equal(pkg.exports['./package.json'], './package.json');
  assert(pkg.sideEffects?.includes('**/*.css'), 'CSS must remain marked as a side effect.');
  for (const path of exportedPaths) assert((await stat(resolve(root, path))).size > 0, `Empty export: ${path}`);
  assert((await readText(pkg.bin['kyc-lens-copy-assets'])).startsWith('#!/usr/bin/env node'), 'Asset-copy CLI needs its Node shebang.');
  assert(/^['"]use client['"];/.test(await readText(pkg.exports['.'].import)), 'React entry must preserve its client directive.');
  assert((await readText(pkg.exports['./styles.css'])).includes('.kyc-kit'), 'Published styles are missing the capture shell.');
  assert((await readText('LICENSE')).includes('MIT License'), 'Missing MIT license.');
  assert((await readText('THIRD_PARTY_NOTICES.md')).includes('MediaPipe'), 'Missing third-party notices.');

  const main = await import(pkg.name);
  const core = await import(`${pkg.name}/core`);
  for (const name of ['KycFlow', 'createHttpApi', 'KycHttpError']) assert.equal(typeof main[name], 'function', `Missing public export: ${name}`);
  for (const name of ['ChallengeRunner', 'validateChallenges', 'validateFaceOptions', 'isCenteredFace', 'isNeutralFace']) assert.equal(typeof core[name], 'function', `Missing core export: ${name}`);
  assert.deepEqual(main.DEFAULT_CHALLENGES, core.DEFAULT_CHALLENGES);
  const error = new main.KycHttpError('Example', 401);
  assert(error instanceof Error && error.status === 401);
  const api = main.createHttpApi('/api/kyc');
  assert.equal(typeof api.createSession, 'function');
  assert.equal(typeof api.submitCapture, 'function');
  const runner = new core.ChallengeRunner(['center'], 100);
  const observation = { timestamp: 0, faceCount: 1, centerX: 0.5, centerY: 0.5, relativeSize: 0.4, yaw: 0, pitch: 0 };
  assert.equal(runner.update(observation).completed, false);
  assert.equal(runner.update({ ...observation, timestamp: 100 }).completed, true);
  checkPublicTypes(pkg.name);

  const builtFiles = await filesBelow(resolve(root, 'dist'));
  const assetFiles = await filesBelow(resolve(root, 'assets'));
  await checkJavaScriptImports(builtFiles, resolve(root, 'dist'));
  for (const worker of ['face-worker.js', 'document-worker.js']) run(process.execPath, ['--check', resolve(root, 'dist', worker)]);
  const manifest = JSON.parse(await readText('assets/manifest.json'));
  assert.equal(manifest.runtime, '@mediapipe/tasks-vision');
  assert.equal(manifest.version, pkg.devDependencies['@mediapipe/tasks-vision']);
  const visionRoot = dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision'));
  assert.equal(JSON.parse(await readFile(join(visionRoot, 'package.json'), 'utf8')).version, manifest.version);
  assert.equal(manifest.modelSha256, modelSha256, 'Manifest model checksum must match the pinned model.');
  assert.equal(hash(await read('assets/face_landmarker.task')), modelSha256, 'Model checksum mismatch.');
  assert((await readText('assets/MEDIAPIPE-LICENSE.txt')).includes('Apache License'), 'Missing MediaPipe redistribution license.');
  for (const variant of ['internal', 'module_internal', 'nosimd_internal']) {
    const base = `assets/wasm/vision_wasm_${variant}`;
    assert((await read(`${base}.wasm`)).subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), `Invalid WASM file: ${base}`);
    assert((await stat(resolve(root, `${base}.js`))).size > 0, `Missing WASM loader: ${base}`);
    for (const extension of ['js', 'wasm']) {
      const filename = `vision_wasm_${variant}.${extension}`;
      assert.equal(hash(await read(`${base}.${extension}`)), hash(await readFile(join(visionRoot, 'wasm', filename))), `WASM assets do not match the pinned runtime: ${filename}`);
    }
  }

  const pack = await packedFiles();
  assert.equal(pack.name, pkg.name);
  assert.equal(pack.version, pkg.version);
  const packed = new Set(pack.files.map(file => file.path));
  const required = [
    ...exportedPaths, ...builtFiles.map(path => unixPath(relative(root, path))),
    ...assetFiles.map(path => unixPath(relative(root, path))),
    'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'demo/server.ts',
    'docs/api.md', 'docs/integration.md', 'docs/architecture.md',
  ];
  for (const path of required) assert(packed.has(path), `npm pack omitted ${path}`);
  for (const path of packed) {
    assert(path === 'demo/server.ts' || !/^(?:src|demo|tests|node_modules|\.github|\.git|\.cache|test-results|playwright-report)\//.test(path), `Development file would be published: ${path}`);
    assert(!/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc)$|\.(?:log|tgz)$/.test(path), `Local file would be published: ${path}`);
  }
  await checkCopyAssets(assetFiles, builtFiles);
  process.stdout.write(`Package verified: ${pack.name}@${pack.version}, ${packed.size} files, ${(pack.size / 1024 / 1024).toFixed(1)} MiB packed.\n`);
}

checkPackage().catch(error => {
  process.stderr.write(`Package check failed: ${error.message}\n`);
  process.exitCode = 1;
});
