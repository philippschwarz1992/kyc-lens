// Stand-in for services/analysis in local runs: checks the secret and the fields, returns a fixed verdict.
import { createServer } from 'node:http';
createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/analyze') { res.writeHead(404).end(); return; }
  if (req.headers['x-analysis-secret'] !== 'analysis-secret') { res.writeHead(401).end(); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData();
  const fields = [...form.keys()].sort();
  console.log('analyze fields', fields.join(','));
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'approved', reasons: [], document: { type: 'passport', quality: { blur: 0.1 }, mrz: null }, faceMatch: { score: 0.8, threshold: 0.363, decision: 'pass' }, liveness: null, _fields: fields }));
}).listen(8099, '127.0.0.1', () => console.log('mock analysis on 8099'));
