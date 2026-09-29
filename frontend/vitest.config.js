// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    globals: true,
    setupFiles: './src/test-setup.js',
    // The data-heavy pages (LiveMatch, EventDetail, Dashboard...) exceed the
    // 5s default on slower machines — CI already raised individual timeouts,
    // so raise the global default to keep local runs deterministic.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      // json-summary produces coverage-summary.json, which the CI coverage
      // dashboard reads to show line-coverage percentages on its index page.
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      exclude: ['src/test-setup.js', '**/*.test.jsx', '**/*.test.js', 'vitest.config.js'],
    },
  },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:5001'),
    'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_mock'),
  },
})
