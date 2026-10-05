import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/multiplayer', outputDir: './test-results/multiplayer',
  fullyParallel: false, workers: 1, forbidOnly: true, retries: 0, timeout: 60_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4183', channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'multiplayer-chrome', metadata: { player: 'desktop' } },
    { name: 'multiplayer-android', metadata: { player: 'android' } },
    { name: 'multiplayer-iphone', metadata: { player: 'iphone' } },
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4183 --strictPort', url: 'http://127.0.0.1:4183', reuseExistingServer: false },
})
