import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    // Integration-test hooks (TRUNCATE + seed) share a Postgres service
    // container on the CI runner; the default 10s hook timeout is too tight
    // there and produced flaky "Hook timed out" failures.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      exclude: [
        'migrations/**',
        '**/*.test.js',
        'vitest.config.js',
      ],
    },
  },
})