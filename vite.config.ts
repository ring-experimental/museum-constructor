import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // 상대 경로 base: 해시 라우팅이라 어떤 하위 경로(GitHub Pages 의 /museum-constructor/ 등)에 올려도 동작
  base: './',
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5173, host: '127.0.0.1' },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
