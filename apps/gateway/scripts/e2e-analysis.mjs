// Local end-to-end check against the real analysis service (see README): two cases through
// gateway → analysis → signed delivery → reference receiver, then the stored verdicts are inspected.
// Samples: `python services/analysis/scripts/make_samples.py <dir>`; pass that directory as the argument.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const gateway = 'http://127.0.0.1:8797', receiver = 'http://127.0.0.1:8788', viewer = 'Basic ' + btoa('viewer:pass');
const samples = process.argv[2];
if (!samples) { console.error('Usage: node e2e-analysis.mjs <samples dir>'); process.exit(1); }
const file = name => readFile(join(samples, name));
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

async function runCase(label, selfieName) {
  const created = await fetch(`${gateway}/api/kyc/sessions`, { method: 'POST', headers: { Authorization: 'Bearer server-key' }, body: JSON.stringify({ reference: label }) });
  const session = await created.json();
  const form = new FormData();
  form.append('selfie', new Blob([await file(selfieName)], { type: 'image/jpeg' }), 'selfie.jpg');
  form.append('faceVideo', new Blob([await file('face-video.mp4')], { type: 'video/mp4' }), 'face-video.mp4');
  form.append('documentFront', new Blob([await file('document-front.jpg')], { type: 'image/jpeg' }), 'document-front.jpg');
  form.append('metadata', JSON.stringify({ challenges: [{ challenge: 'center', completedAt: 1, durationMs: 650 }], capturedAt: new Date().toISOString(), mode: 'camera', document: { type: 'passport' } }));
  const upload = await fetch(`${gateway}/api/kyc/sessions/${session.id}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form });
  check(upload.status === 200, `${label}: upload accepted (${upload.status} ${(await upload.text()).slice(0, 80)})`);
  let status;
  for (let i = 0; i < 120; i++) {
    status = await (await fetch(`${gateway}/api/kyc/sessions/${session.id}`, { headers: { Authorization: 'Bearer server-key' } })).json();
    if (status.status === 'delivered' || status.status === 'failed') break;
    await new Promise(done => setTimeout(done, 1000));
  }
  check(status.status === 'delivered', `${label}: delivered (${status.status})`);
  const page = await (await fetch(`${receiver}/cases/${session.id}`, { headers: { Authorization: viewer } })).text();
  const result = JSON.parse(page.match(/<pre>([\s\S]*)<\/pre>/)?.[1]?.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))) ?? 'null');
  return result;
}

const same = await runCase('e2e-same-person', 'selfie.jpg');
console.log('  verdict', same?.status, same?.reasons?.join(','), '| mrz', same?.document?.mrz?.format, same?.document?.mrz?.kind, same?.document?.mrz?.valid, '| face', same?.faceMatch?.decision, same?.faceMatch?.score, '| liveness', same?.liveness?.decision);
check(same?.document?.mrz?.format === 'TD3' && same.document.mrz.kind === 'passport' && same.document.mrz.valid, 'passport MRZ read and valid');
check(same?.document?.mrz?.fields?.surname === 'ERIKSSON', 'MRZ fields parsed (specimen surname)');
check(same?.faceMatch?.decision === 'match', 'same person matches');
check(same?.liveness?.decision === 'fail', 'still-image video fails liveness');
check(same?.status === 'rejected' && same.reasons.includes('document-expired'), 'expired specimen is rejected');

const other = await runCase('e2e-other-person', 'other-selfie.jpg');
console.log('  verdict', other?.status, other?.reasons?.join(','), '| face', other?.faceMatch?.decision, other?.faceMatch?.score);
check(other?.faceMatch?.decision === 'no-match' && other.reasons.includes('face-mismatch'), 'different person does not match');
console.log('  live face', same?.liveFaceMatch?.decision, same?.liveFaceMatch?.framesMatched, '/', same?.liveFaceMatch?.framesCompared, '| other', other?.liveFaceMatch?.decision);
