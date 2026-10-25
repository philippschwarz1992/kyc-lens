#!/usr/bin/env node
// The SFace model exceeds the Workers asset size limit; it is served from R2 instead (see worker.js).
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../playground/dist');
await writeFile(resolve(dist, '.assetsignore'), 'kyc-assets/matching/face_recognition_sface_2021dec.onnx\n');
