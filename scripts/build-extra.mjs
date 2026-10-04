import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('dist', { recursive: true });
await copyFile('src/styles.css', 'dist/styles.css');
const main = resolve('dist/index.js');
const content = await readFile(main, 'utf8');
// Keep the client boundary in the published package, including when a bundler drops directives.
if (!/^['"]use client['"];/.test(content)) {
  await writeFile(main, `"use client";\n${content}`);
  const sourceMap = JSON.parse(await readFile(`${main}.map`, 'utf8'));
  sourceMap.mappings = `;${sourceMap.mappings}`;
  await writeFile(`${main}.map`, JSON.stringify(sourceMap));
}
