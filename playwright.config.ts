import { defineConfig, devices } from '@playwright/test'

const development = process.env.DND_TEST_DEV === '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // Browser contexts run serially to avoid resource contention on Windows.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chrome', grepInvert: /Android trusted touch|mobile tap/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', grepInvert: /Android trusted touch|mobile tap/, use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'firefox', grepInvert: /Android trusted touch|mobile tap/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', grepInvert: /Android trusted touch|mobile tap/, use: { ...devices['Desktop Safari'] } },
    { name: 'android', use: { ...devices['Pixel 5'] } },
    { name: 'iphone', grepInvert: /Android trusted touch/, use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: development
      ? 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort'
      : 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
