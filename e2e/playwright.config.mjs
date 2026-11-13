import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  workers: 1,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    headless: true,
    launchOptions: {
      // optional: reuse an already installed Chromium instead of downloading one
      executablePath: process.env.E2E_CHROME || undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },
});
