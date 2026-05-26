import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000', // 👈 Izmenjeno sa localhost na 127.0.0.1
        changeOrigin: true,
        cookieDomainRewrite: { '*': '127.0.0.1' },
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
