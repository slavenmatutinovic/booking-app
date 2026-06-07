// =============================================================================
// ⚙️ D:\booking-app\playwright.config.ts (Zero-Dependency Clean Version)
// =============================================================================
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1, // Only 1 worker to prevent concurrent write database locks
  reporter: 'list',

  use: {
    // Standard static addresses matching your Vite frontend configuration rules
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
