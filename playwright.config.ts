import { defineConfig } from '@playwright/test';
const publicEnv = {
  VITE_SUPABASE_URL: 'https://crm-test.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
  VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA', // Chave pública de teste Cloudflare; script é simulado.
};
export default defineConfig({
  testDir: './tests/browser', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  projects: [
    { name: 'chromium', testIgnore: '**/intake-disabled.spec.ts' },
    { name: 'intake-disabled', testMatch: '**/intake-disabled.spec.ts', use: { baseURL: 'http://127.0.0.1:4174' } },
    { name: 'intake-missing-key', testMatch: '**/intake-disabled.spec.ts', use: { baseURL: 'http://127.0.0.1:4175' } },
  ],
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', env: { ...publicEnv, VITE_INTAKE_ENABLED: 'true' }, reuseExistingServer: false },
    { command: 'npm run dev -- --host 127.0.0.1 --port 4175', url: 'http://127.0.0.1:4175', env: { ...publicEnv, VITE_INTAKE_ENABLED: 'true', VITE_TURNSTILE_SITE_KEY: '' }, reuseExistingServer: false },
    { command: 'npm run dev -- --host 127.0.0.1 --port 4174', url: 'http://127.0.0.1:4174', env: { ...publicEnv, VITE_INTAKE_ENABLED: 'false' }, reuseExistingServer: false },
  ],
});
