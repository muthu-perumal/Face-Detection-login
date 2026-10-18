import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
