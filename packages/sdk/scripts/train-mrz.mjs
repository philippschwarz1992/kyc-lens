#!/usr/bin/env node
// Trains the bundled MRZ character classifier (src/mrz/model.ts) and writes the MRZ test fixtures.
//
// It renders synthetic document pages with random, correctly formatted MRZ lines in OCR-B, degrades
// them like phone photos (rotation, blur, low resolution, noise, JPEG), runs the same locate/cell code
// the SDK uses, and trains a one-hidden-layer network on the resulting character cells.
//
// The OCR-B outline fonts (CTAN ocr-b-outline, free to use, modify and distribute) are only needed
// here; the SDK ships the trained weights, not the fonts.
//
//   node scripts/train-mrz.mjs --fonts <dir with ocrb*.otf> [--samples 2500] [--epochs 14] [--hidden 80]
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []));
if (!args.fonts) { console.error('Usage: node scripts/train-mrz.mjs --fonts <dir with ocrb*.otf>'); process.exit(1); }
const pages = Number(args.samples ?? 2500), epochs = Number(args.epochs ?? 14), hidden = Number(args.hidden ?? 80);
const root = resolve(import.meta.dirname, '..');
const ALPHABET = '<0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INPUTS = 16 * 22;

const bundle = await build({ entryPoints: [join(root, 'src/mrz/train-entry.ts')], bundle: true, write: false, format: 'iife', globalName: 'Mrz', target: 'es2022' });
const fonts = readdirSync(args.fonts).filter(name => /^ocrb\d+\.otf$/i.test(name)).map(name => readFileSync(join(args.fonts, name)).toString('base64'));
if (!fonts.length) throw new Error('No ocrb*.otf fonts found.');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.addScriptTag({ content: bundle.outputFiles[0].text });
await page.evaluate(async fonts => {
  for (const [i, data] of fonts.entries()) {
    const face = new FontFace(`ocrb${i}`, Uint8Array.from(atob(data), c => c.charCodeAt(0)));
    document.fonts.add(await face.load());
  }
  window.fontCount = fonts.length;
}, fonts);

/** Page-side generator: renders, degrades, locates and cuts cells, or reads a page end to end. */
await page.evaluate(() => {
  const ALPHABET = '<0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', LETTERS = ALPHABET.slice(11), DIGITS = '0123456789';
  let state = 1;
  const random = () => { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = text => text[Math.floor(random() * text.length)];
  const many = (text, n) => Array.from({ length: n }, () => pick(text)).join('');
  const range = (a, b) => a + random() * (b - a);
  const date = () => String(Math.floor(range(0, 99))).padStart(2, '0') + String(Math.floor(range(1, 13))).padStart(2, '0') + String(Math.floor(range(1, 29))).padStart(2, '0');
  const pad = (text, n) => (text + '<'.repeat(n)).slice(0, n);
  const name = n => pad(`${many(LETTERS, 3 + Math.floor(random() * 9))}<<${many(LETTERS, 3 + Math.floor(random() * 8))}${random() < 0.5 ? `<${many(LETTERS, 3 + Math.floor(random() * 7))}` : ''}`, n);
  const country = () => random() < 0.2 ? 'D<<' : many(LETTERS, 3);
  const number = () => random() < 0.15 ? pad(many(ALPHABET.slice(1), 7), 9) : many(ALPHABET.slice(1), 9);
  const optional = n => random() < 0.6 ? '<'.repeat(n) : pad(many(ALPHABET.slice(1), Math.floor(range(3, n + 1))), n);
  const check = text => String(Mrz.checkDigit(text));
  function text(format) {
    const sex = pick('MFX<');
    if (format === 'TD3') {
      const doc = number(), birth = date(), expiry = date(), personal = optional(14);
      const personalCheck = /^<+$/.test(personal) && random() < 0.5 ? '<' : check(personal);
      const line2 = doc + check(doc) + country() + birth + check(birth) + sex + expiry + check(expiry) + personal + personalCheck;
      return [`P${random() < 0.8 ? '<' : pick(LETTERS)}${country()}${name(39)}`, line2 + check(line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43))];
    }
    if (format === 'TD2') {
      const doc = number(), birth = date(), expiry = date();
      const line2 = doc + check(doc) + country() + birth + check(birth) + sex + expiry + check(expiry) + optional(7);
      return [`${pick('IAC')}${random() < 0.7 ? '<' : pick(LETTERS)}${country()}${name(31)}`, line2 + check(line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 35))];
    }
    const doc = number(), birth = date(), expiry = date();
    const line1 = `${pick('IAC')}${random() < 0.6 ? '<' : pick(LETTERS)}${country()}${doc}${check(doc)}${optional(15)}`;
    const line2 = birth + check(birth) + sex + expiry + check(expiry) + country() + optional(11);
    return [line1, line2 + check(line1.slice(5) + line2.slice(0, 7) + line2.slice(8, 15) + line2.slice(18, 29)), name(30)];
  }
  // Physical sizes in millimetres: page, MRZ left margin, character pitch (10 per inch).
  const SIZES = { TD1: [85.6, 54], TD2: [105, 74], TD3: [125, 88] };
  function render(format, lines) {
    const [mmW, mmH] = SIZES[format], W = 1100, H = Math.round(W * mmH / mmW), mm = W / mmW;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const tone = range(205, 250);
    g.fillStyle = `rgb(${tone + range(-12, 5)},${tone + range(-8, 5)},${tone + range(-15, 5)})`; g.fillRect(0, 0, W, H);
    // Security-print guilloche and faint decorative text, partly across the MRZ.
    g.lineWidth = range(0.5, 1.6);
    for (let k = 0; k < 6; k++) {
      g.strokeStyle = `rgba(${range(80, 200)},${range(80, 200)},${range(120, 220)},${range(0.08, 0.3)})`; g.beginPath();
      const amplitude = range(10, 60), frequency = range(0.005, 0.03), offset = range(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, offset + Math.sin(x * frequency + k) * amplitude);
      g.stroke();
    }
    g.fillStyle = `rgba(30,40,60,${range(0.5, 0.9)})`;
    for (let k = 0; k < 6; k++) { g.font = `${range(14, 34)}px sans-serif`; g.fillText(many(LETTERS + '  ', Math.floor(range(5, 24))), range(20, W * 0.5), range(30, H * 0.5)); }
    const font = `ocrb${Math.floor(random() * window.fontCount)}`, pitch = 2.54 * mm * range(0.97, 1.03);
    g.font = `100px ${font}`;
    const size = 100 * pitch / g.measureText('<').width;
    g.font = `${size}px ${font}`;
    const count = lines[0].length, left = (W - count * pitch) / 2 + range(-0.015, 0.015) * W;
    const capital = size * 0.72, spacing = capital * range(1.45, 1.8), bottom = H - range(0.035, 0.08) * H;
    const ink = range(0, 70);
    g.fillStyle = `rgb(${ink},${ink},${ink + range(0, 25)})`;
    lines.forEach((line, l) => {
      const y = bottom - (lines.length - 1 - l) * spacing;
      for (let i = 0; i < line.length; i++) g.fillText(line[i], left + i * pitch + range(-0.03, 0.03) * pitch, y + range(-0.02, 0.02) * capital);
    });
    return canvas;
  }
  /** Places the page into a camera-like frame with rotation, scale, blur, noise and JPEG; returns pixels and corners. */
  async function photograph(pageCanvas, upsideDown = false) {
    const scale = range(0.5, 1.05), angle = range(-2.5, 2.5) * Math.PI / 180 + (upsideDown ? Math.PI : 0);
    const W = Math.round(pageCanvas.width * scale * 1.18), H = Math.round(pageCanvas.height * scale * 1.3);
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const back = range(20, 120); g.fillStyle = `rgb(${back},${back * range(0.9, 1.1)},${back})`; g.fillRect(0, 0, W, H);
    const cx = W / 2 + range(-0.03, 0.03) * W, cy = H / 2 + range(-0.03, 0.03) * H;
    g.save(); g.translate(cx, cy); g.rotate(angle); g.scale(scale, scale);
    g.filter = `blur(${range(0, 1.3) / scale}px)`;
    g.drawImage(pageCanvas, -pageCanvas.width / 2, -pageCanvas.height / 2); g.restore(); g.filter = 'none';
    // Uneven lighting and sensor noise.
    const light = g.createLinearGradient(0, 0, W, H);
    light.addColorStop(0, `rgba(255,255,255,${range(0, 0.15)})`); light.addColorStop(1, `rgba(0,0,0,${range(0, 0.25)})`);
    g.fillStyle = light; g.fillRect(0, 0, W, H);
    const image = g.getImageData(0, 0, W, H), amount = range(2, 12);
    for (let i = 0; i < image.data.length; i += 4) { const n = (random() - 0.5) * amount; image.data[i] += n; image.data[i + 1] += n; image.data[i + 2] += n; }
    g.putImageData(image, 0, 0);
    const blob = await new Promise(done => canvas.toBlob(done, 'image/jpeg', range(0.45, 0.92)));
    const bitmap = await createImageBitmap(blob);
    g.drawImage(bitmap, 0, 0); bitmap.close();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = sx * pageCanvas.width / 2 * scale, y = sy * pageCanvas.height / 2 * scale;
      // The live outline is only approximately on the document edge.
      return { x: cx + x * Math.cos(angle) - y * Math.sin(angle) + range(-4, 4), y: cy + x * Math.sin(angle) + y * Math.cos(angle) + range(-4, 4) };
    });
    // The detector reports corners clockwise from the visual top left; upside down that is the page's bottom right.
    return { rgba: g.getImageData(0, 0, W, H).data, width: W, height: H, corners: upsideDown ? [corners[2], corners[3], corners[0], corners[1]] : corners };
  }
  const formats = ['TD1', 'TD3', 'TD2'];
  window.generate = async (count, seed) => {
    state = seed;
    const cells = [], labels = [];
    let located = 0;
    for (let n = 0; n < count; n++) {
      const format = formats[n % 3], lines = text(format);
      const shot = await photograph(render(format, lines));
      const { page, width, height } = Mrz.rectify(Mrz.grayscale(shot.rgba, shot.width, shot.height), shot.width, shot.height, shot.corners);
      const found = Mrz.locateMrz(page, width, height);
      if (!found || found.format !== format) continue;
      located++;
      found.lines.forEach((line, l) => Mrz.cells(page, width, height, line, lines[l].length).forEach((cell, i) => {
        cells.push(Array.from(cell, value => Math.round(value * 255))); labels.push(ALPHABET.indexOf(lines[l][i]));
      }));
    }
    const bytes = Uint8Array.from(cells.flat());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { cells: btoa(binary), labels, located };
  };
  window.evaluate = async (model, count, seed) => {
    state = seed;
    const results = { TD1: [0, 0, 0], TD2: [0, 0, 0], TD3: [0, 0, 0] };
    for (let n = 0; n < count; n++) {
      const format = formats[n % 3], lines = text(format);
      const shot = await photograph(render(format, lines), n % 4 === 3);
      const read = Mrz.readMrz(model, shot.rgba, shot.width, shot.height, shot.corners);
      results[format][0]++;
      if (read?.summary.valid) results[format][1]++;
      if (read && read.lines.join() === lines.join()) results[format][2]++;
    }
    return results;
  };
  window.fixture = async (lines, seed) => {
    state = seed;
    const format = lines.length === 3 ? 'TD1' : lines[0].length === 44 ? 'TD3' : 'TD2';
    return photograph(render(format, lines));
  };
});

// ---- Generate cells in chunks (each chunk is a page call) ----
const cells = [], labels = [];
let located = 0;
for (let done = 0; done < pages; done += 250) {
  const chunk = await page.evaluate(([count, seed]) => window.generate(count, seed), [Math.min(250, pages - done), 1000 + done]);
  const bytes = Buffer.from(chunk.cells, 'base64');
  for (let i = 0; i < chunk.labels.length; i++) { cells.push(bytes.subarray(i * INPUTS, (i + 1) * INPUTS)); labels.push(chunk.labels[i]); }
  located += chunk.located;
  console.log(`pages ${done + Math.min(250, pages - done)}/${pages}, located ${located}, cells ${cells.length}`);
}

// ---- Train: 352 -> hidden (ReLU) -> 37 softmax, Adam, cross-entropy ----
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gaussian = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const K = ALPHABET.length;
const w1 = Float32Array.from({ length: hidden * INPUTS }, () => gaussian() * Math.sqrt(2 / INPUTS)), b1 = new Float32Array(hidden);
const w2 = Float32Array.from({ length: K * hidden }, () => gaussian() * Math.sqrt(2 / hidden)), b2 = new Float32Array(K);
const params = [w1, b1, w2, b2], moments = params.map(p => [new Float32Array(p.length), new Float32Array(p.length)]), grads = params.map(p => new Float32Array(p.length));
const order = cells.map((_, i) => i);
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const validation = order.splice(0, Math.floor(order.length * 0.05));
const x = new Float32Array(INPUTS), h = new Float32Array(hidden), out = new Float32Array(K), dh = new Float32Array(hidden);
function forward(index) {
  const cell = cells[index];
  for (let i = 0; i < INPUTS; i++) x[i] = cell[i] / 255;
  for (let j = 0; j < hidden; j++) { let s = b1[j]; for (let i = 0, r = j * INPUTS; i < INPUTS; i++) s += w1[r + i] * x[i]; h[j] = s > 0 ? s : 0; }
  let max = -Infinity;
  for (let k = 0; k < K; k++) { let s = b2[k]; for (let j = 0, r = k * hidden; j < hidden; j++) s += w2[r + j] * h[j]; out[k] = s; if (s > max) max = s; }
  let total = 0; for (let k = 0; k < K; k++) { out[k] = Math.exp(out[k] - max); total += out[k]; }
  for (let k = 0; k < K; k++) out[k] /= total;
}
let step = 0;
for (let epoch = 0; epoch < epochs; epoch++) {
  const rate = 0.002 * Math.pow(0.8, epoch), batch = 64;
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let loss = 0;
  for (let start = 0; start < order.length; start += batch) {
    grads.forEach(g => g.fill(0));
    const end = Math.min(order.length, start + batch);
    for (let n = start; n < end; n++) {
      const index = order[n], label = labels[index];
      forward(index);
      loss -= Math.log(out[label] + 1e-9);
      out[label] -= 1;
      dh.fill(0);
      for (let k = 0; k < K; k++) {
        const d = out[k]; grads[3][k] += d;
        for (let j = 0, r = k * hidden; j < hidden; j++) { grads[2][r + j] += d * h[j]; dh[j] += d * w2[r + j]; }
      }
      for (let j = 0; j < hidden; j++) {
        if (h[j] <= 0) continue;
        const d = dh[j]; grads[1][j] += d;
        for (let i = 0, r = j * INPUTS; i < INPUTS; i++) grads[0][r + i] += d * x[i];
      }
    }
    step++;
    const size = end - start, c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
    params.forEach((p, q) => {
      const [m, v] = moments[q], g = grads[q];
      for (let i = 0; i < p.length; i++) {
        const gi = g[i] / size + (q % 2 === 0 ? 1e-5 * p[i] : 0);
        m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi;
        p[i] -= rate * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    });
  }
  let correct = 0;
  for (const index of validation) { forward(index); let best = 0; for (let k = 1; k < K; k++) if (out[k] > out[best]) best = k; if (best === labels[index]) correct++; }
  console.log(`epoch ${epoch + 1}/${epochs}: loss ${(loss / order.length).toFixed(4)}, validation accuracy ${(100 * correct / validation.length).toFixed(2)}%`);
}

// ---- Quantize to int8 per output row and write the model module ----
function quantize(weights, rows, columns) {
  const scales = [], bytes = new Int8Array(weights.length);
  for (let r = 0; r < rows; r++) {
    let max = 1e-9; for (let c = 0; c < columns; c++) max = Math.max(max, Math.abs(weights[r * columns + c]));
    const scale = max / 127; scales.push(Number(scale.toPrecision(6)));
    for (let c = 0; c < columns; c++) bytes[r * columns + c] = Math.round(weights[r * columns + c] / scale);
  }
  return { scales, data: Buffer.from(bytes.buffer).toString('base64') };
}
const q1 = quantize(w1, hidden, INPUTS), q2 = quantize(w2, K, hidden);
const round = values => Array.from(values, value => Number(value.toPrecision(6)));
const model = { hidden, w1: q1.data, s1: q1.scales, b1: round(b1), w2: q2.data, s2: q2.scales, b2: round(b2) };
writeFileSync(join(root, 'src/mrz/model.ts'), `// Generated by scripts/train-mrz.mjs from synthetic OCR-B renderings. Do not edit by hand.
import type { MrzModel } from './read.js';

const DATA = ${JSON.stringify(model)};

function weights(base64: string, scales: number[], columns: number): Float32Array {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const values = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) values[i] = ((bytes[i]! << 24) >> 24) * scales[Math.floor(i / columns)]!;
  return values;
}

/** The bundled OCR-B character classifier (int8 weights, about ${Math.round((hidden * INPUTS + K * hidden) / 1024)} KB). */
export function mrzModel(): MrzModel {
  return { hidden: DATA.hidden, w1: weights(DATA.w1, DATA.s1, ${INPUTS}), b1: Float32Array.from(DATA.b1),
    w2: weights(DATA.w2, DATA.s2, DATA.hidden), b2: Float32Array.from(DATA.b2) };
}
`);

// ---- Evaluate the quantized model end to end on fresh pages (a quarter upside down) ----
const dequantize = (base64, scales, columns) => { const bytes = Buffer.from(base64, 'base64'); return Array.from(bytes, (b, i) => ((b << 24) >> 24) * scales[Math.floor(i / columns)]); };
const pageModel = { hidden, w1: dequantize(model.w1, model.s1, INPUTS), b1: model.b1, w2: dequantize(model.w2, model.s2, hidden), b2: model.b2 };
const results = await page.evaluate(([m, count]) => window.evaluate(m, count, 987654), [pageModel, Number(args.evaluate ?? 300)]);
for (const [format, [total, valid, exact]] of Object.entries(results)) console.log(`${format}: ${valid}/${total} valid, ${exact}/${total} exact`);

// ---- Fixtures: the ICAO specimen zones, photographed once ----
const specimens = {
  'mrz-td3': ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'],
  'mrz-td1': ['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'],
};
for (const [name, lines] of Object.entries(specimens)) {
  const shot = await page.evaluate(([l, s]) => window.fixture(l, s).then(f => ({ ...f, rgba: Array.from(f.rgba.filter((_, i) => i % 4 === 0)) })), [lines, 4242]);
  const gray = gzipSync(Buffer.from(shot.rgba)).toString('base64');
  writeFileSync(join(root, `tests/fixtures/${name}.json`), JSON.stringify({ width: shot.width, height: shot.height, corners: shot.corners, lines, gray }));
}
await browser.close();
