import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { demoApiPlugin } from './server';

const sdkSource = fileURLToPath(new URL('../../packages/sdk/src', import.meta.url));

export default defineConfig({
  plugins: [react(), demoApiPlugin()],
  // The playground runs the SDK from source so edits hot-reload without a library build.
  resolve: { alias: { '@sdk': sdkSource } },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/[rR][eE][sS][uU][lL][tT][sS]/**'] },
  },
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), element: fileURLToPath(new URL('./element.html', import.meta.url)) } },
  },
  // Pre-bundle packages that only workers or lazy screens import. Discovering them mid-session makes
  // Vite re-optimize and reload the page, which drops an in-progress capture (seen on fresh CI caches).
  optimizeDeps: { include: ['@mediapipe/tasks-vision', 'onnxruntime-web/wasm', 'uqr', 'xstate', 'react', 'react-dom/client'] },
  worker: { format: 'es' },
});
