const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // vitest.config.js and the integration test files use ESM `import`/`export`
    // syntax (Vitest transforms this at run time), unlike the rest of the
    // CommonJS backend source — so this override tells ESLint's parser to
    // expect module syntax just for these files.
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        // describe/test/expect resolve through globals.jest (above), but
        // that set predates Vitest and has no `vi`.
        vi: 'readonly',
      },
    },
  },
  {
    ignores: ['node_modules/**', 'migrations/**'],
  },
];
