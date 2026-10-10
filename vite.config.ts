import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5173, host: '127.0.0.1' },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
