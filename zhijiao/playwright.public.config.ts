import { defineConfig } from '@playwright/test';
import dynamicConfig from './playwright.config';

// Run against an already served static tour; never reuse its identity as a dynamic test.
export default defineConfig(dynamicConfig, {
  testMatch: '**/public-demo.spec.ts',
  testIgnore: [],
  globalTeardown: undefined,
  webServer: undefined,
  use: { baseURL: process.env.E2E_WEB_ORIGIN ?? 'http://127.0.0.1:4180' },
});
