import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', 'core/index': 'src/core/index.ts', 'face-worker': 'src/camera/face.worker.ts', 'document-worker': 'src/camera/document.worker.ts' },
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  clean: true,
  deps: { alwaysBundle: ['@mediapipe/tasks-vision'], onlyBundle: ['@mediapipe/tasks-vision'] },
});
