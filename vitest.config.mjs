import { defineConfig } from 'vitest/config';

// e2e/ holds Playwright specs; they run with `npm run e2e`, not vitest
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
