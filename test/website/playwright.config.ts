import { defineConfig } from '@playwright/test';
import { browserOutputRoot, websiteRoot } from '../../scripts/lib/website-paths.mjs';

export default defineConfig({
  testDir: './browser',
  outputDir: browserOutputRoot,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173/capability-graph/',
    browserName: 'chromium',
    ...(process.env.DOCS_CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.DOCS_CHROMIUM_EXECUTABLE } } : {}),
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: websiteRoot,
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/capability-graph/',
    timeout: 120_000,
    reuseExistingServer: false
  }
});
