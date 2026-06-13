import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment since we test server-side code
    environment: 'node',
    // Enable globals so CJS test files can use describe/it/expect without importing vitest
    globals: true,
    // Where test files are
    include: ['tests/**/*.test.cjs'],
    // Timeout for each test (some crypto tests may take long)
    testTimeout: 30000,
    // Single fork to avoid module state issues with mocks
    fileParallelism: false,
    // Show full diff on failure
    reporters: ['default'],
  },
});