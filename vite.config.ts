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
  build: { outDir: '../demo-dist', emptyOutDir: true },
  worker: { format: 'es' },
});
