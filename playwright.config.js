const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/ui',
  outputDir: 'test-results',
  snapshotPathTemplate: 'playwright-screenshots/{arg}{ext}',
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 15_000 }
});
