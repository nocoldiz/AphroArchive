import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.cjs'],
    testTimeout: 30000,
    fileParallelism: false,
    globals: true,
  },
});