import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // public/sw.js runs in the service-worker scope (self/caches/clients),
  // not the browser window eslint's globals describe — and it is shipped
  // verbatim by vite, so it keeps its own deliberate style.
  globalIgnores(['dist', 'public/sw.js']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Fetch-on-mount via useEffect is one of React's own documented uses of
      // an effect (react.dev/learn/you-might-not-need-an-effect). This rule
      // flags that pattern everywhere it's used across the app (Dashboard,
      // Events, Roster, LiveMatch, AccountSettings, AthleteStats, EventDetail),
      // so we disable it here rather than add a disable-comment on every page.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Test files run under vitest's node runtime (jsdom included), so node
    // APIs are legitimately available there — sw.test.js reads the shipped
    // public/sw.js and manifest off disk with node:fs to exercise the real
    // files. Production code keeps browser-only globals.
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
