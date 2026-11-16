import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    env: { VITE_SUPABASE_URL: 'https://crm-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-public-key' },
    reuseExistingServer: false,
  },
});
