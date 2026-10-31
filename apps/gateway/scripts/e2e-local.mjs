// Local end-to-end check (see README):  customer backend creates a session, the browser uploads, the gateway analyses and delivers, the receiver stores.
import { readFile } from 'node:fs/promises';
const gateway = 'http://127.0.0.1:8797', receiver = 'http://127.0.0.1:8788', viewer = 'Basic ' + btoa('viewer:pass');
const png = await readFile(process.argv[2] ?? new URL('../../../packages/sdk/tests/fixtures/astronaut.png', import.meta.url));
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

const created = await fetch(`${gateway}/api/kyc/sessions`, { method: 'POST', headers: { Authorization: 'Bearer server-key' }, body: JSON.stringify({ reference: 'crm-e2e-1', applicant: { givenNames: 'Anna Maria', surname: 'Eriksson', birthDate: '1974-08-12' } }) });
check(created.status === 201, `session created (${created.status})`);
const session = await created.json();
check((await fetch(`${gateway}/api/kyc/sessions`, { method: 'POST', body: '{}' })).status === 401, 'browser cannot create sessions in server mode');

const form = new FormData();
form.append('selfie', new Blob([png], { type: 'image/png' }), 'selfie.png');
form.append('documentFront', new Blob([png], { type: 'image/png' }), 'document-front.png');
form.append('metadata', JSON.stringify({ challenges: [{ challenge: 'center', completedAt: 1, durationMs: 650 }], capturedAt: new Date().toISOString(), mode: 'camera', document: { type: 'passport' } }));
const uploaded = await fetch(`${gateway}/api/kyc/sessions/${session.id}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form });
const upload = await uploaded.json();
check(uploaded.status === 200 && upload.status === 'processing', `upload accepted (${uploaded.status} ${upload.status})`);

let status;
for (let i = 0; i < 60; i++) {
  status = await (await fetch(`${gateway}/api/kyc/sessions/${session.id}`, { headers: { Authorization: 'Bearer server-key' } })).json();
  if (status.status === 'delivered' || status.status === 'failed') break;
  await new Promise(done => setTimeout(done, 1000));
}
check(status.status === 'delivered', `session delivered (${status.status})`);
check(!('analysis' in status) && !JSON.stringify(status).includes('approved'), 'status carries no verdict');

const page = await (await fetch(`${receiver}/cases/${session.id}`, { headers: { Authorization: viewer } })).text();
check(page.includes('approved') && page.includes('crm-e2e-1'), 'receiver shows the case with verdict and reference');
const image = await fetch(`${receiver}/cases/${session.id}/files/selfie.png`, { headers: { Authorization: viewer } });
check(image.ok && Buffer.compare(Buffer.from(await image.arrayBuffer()), png) === 0, 'receiver stored the exact selfie bytes');
const forged = await fetch(`${receiver}/webhooks/kyc`, { method: 'POST', headers: { 'X-KYC-Signature': 't=1,v1=' + '0'.repeat(64), 'Content-Type': 'multipart/form-data; boundary=x' }, body: '--x--' });
check(forged.status === 401, `forged delivery rejected (${forged.status})`);
const retry = await fetch(`${gateway}/api/kyc/sessions/${session.id}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form });
check(retry.status === 200 && (await retry.json()).status === 'delivered', 'retried upload is answered without a second delivery');
