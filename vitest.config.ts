import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/fixtures/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/mcp-server.ts'],
    },
    testTimeout: 30000,
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
});
