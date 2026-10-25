import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { demoApiPlugin } from './demo/server';

export default defineConfig({
  root: 'demo',
  plugins: [react(), demoApiPlugin()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/[rR][eE][sS][uU][lL][tT][sS]/**'] },
  },
  build: {
    outDir: '../demo-dist', emptyOutDir: true,
    rollupOptions: { input: { main: fileURLToPath(new URL('./demo/index.html', import.meta.url)), element: fileURLToPath(new URL('./demo/element.html', import.meta.url)) } },
  },
  // Pre-bundle packages that only workers or lazy screens import. Discovering them mid-session makes
  // Vite re-optimize and reload the page, which drops an in-progress capture (seen on fresh CI caches).
  optimizeDeps: { include: ['@mediapipe/tasks-vision', 'onnxruntime-web/wasm', 'uqr', 'xstate', 'react', 'react-dom/client'] },
  worker: { format: 'es' },
});
