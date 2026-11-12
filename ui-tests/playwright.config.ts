import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the admin page and the visitor play page.
 * Starts its own server on port 3100 (built Angular app served by the backend) with relaxed
 * rate limits, so it never collides with a Docker deployment on port 3000.
 * Set BASE_URL to test an already running deployment instead.
 */
const PORT = 3100;
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'bash ../scripts/run.sh',
        url: `${baseURL}/healthz`,
        timeout: 180_000,
        reuseExistingServer: false,
        env: {
          PORT: String(PORT),
          PUBLIC_BASE_URL: baseURL,
          REDEEM_LIMIT_PER_IP_PER_MINUTE: '1000',
          REDEEM_LIMIT_PER_SHARE_PER_MINUTE: '1000',
        },
      },
});
