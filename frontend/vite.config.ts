// frontend/vite.config.ts

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Učitavamo .env varijable za trenutno okruženje (development/production)
  const env = loadEnv(mode, process.cwd(), '');

  // Dinamički biramo backend URL — ako postoji u .env koristi njega, inače fallback na lokalni IP
  const apiEnvValue = env.VITE_API_URL;
  const backendTarget =
    apiEnvValue && apiEnvValue.trim() !== '' && !apiEnvValue.includes('invalid')
      ? apiEnvValue
      : 'http://localhost:4000';

  console.log(`📡 Proksi cilj postavljen na: ${backendTarget}`);

  return {
    plugins: [react()],

    // ⚙️ Vitest konfiguracija prilagođena modernim standardima
    test: {
      environment: 'jsdom',
      globals: true,
      // Kreiraj fajl src/setupTests.ts i u njega stavi: import '@testing-library/jest-dom';
      setupFiles: ['./src/setupTests.ts'],
    },

    // 🌐 Razvojni server sa optimizovanim proksijem za sesije
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendTarget, // Koristi dinamičku adresu umesto hardkodovane
          changeOrigin: true,
          // Automatski prepisuje domen kolačića u zavisnosti od backend adrese
          cookieDomainRewrite: { '*': 'localhost' },
        },
      },
    },

    // 📦 Produkcijski build parametri
    build: {
      sourcemap: true, // Zadržano za lakše debagovanje grešaka u produkciji
      outDir: 'dist',
      minify: 'esbuild',
    },
  };
});
