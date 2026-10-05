import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/multiplayer', outputDir: './test-results/multiplayer',
  fullyParallel: false, workers: 1, forbidOnly: true, retries: 0, timeout: 60_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4183', channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'multiplayer-chrome', metadata: { player: 'desktop' } },
    // Alignment is a desktop DM operation; its exact broadcast is checked once.
    // Mobile movement/navigation/reconnection remain covered in all three profiles.
    { name: 'multiplayer-android', grepInvert: /online alignment/, metadata: { player: 'android' } },
    { name: 'multiplayer-iphone', grepInvert: /online alignment/, metadata: { player: 'iphone' } },
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4183 --strictPort', url: 'http://127.0.0.1:4183', reuseExistingServer: false },
})
