import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import path from 'node:path';
import { browserOutputRoot } from '../../scripts/lib/website-paths.mjs';

export default defineConfig({
  ...base,
  testMatch: 'browser-smoke.spec.ts',
  outputDir: path.join(browserOutputRoot, 'cross'),
  use: { ...base.use, launchOptions: {} },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ]
});
