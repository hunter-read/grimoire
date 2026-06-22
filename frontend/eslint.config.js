import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Project convention: one exported functional component per file.
      'react/no-multi-comp': ['error', { ignoreStateless: false }],
      // Rules of hooks is a correctness rule and the codebase is clean of
      // violations, so enforce it as an error. exhaustive-deps stays a warning
      // since legacy effects intentionally carry disable directives.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Test files legitimately define local wrapper/harness components.
    files: ['src/**/*.test.{js,jsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.vitest } },
    rules: {
      'react/no-multi-comp': 'off',
    },
  },
]
