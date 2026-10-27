import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { createRequire } from 'module'

// eslint-plugin-react has not declared ESLint 10 support yet: package.json's
// `overrides` lets it install beside ESLint 10, and only its `version: 'detect'`
// calls an API ESLint 10 removed - so hand it the installed React version
// instead (as vite.config.js does). Drop both once the plugin supports v10.
const reactVersion = createRequire(import.meta.url)('react/package.json').version

const reactRules = {
  // Project convention: one exported functional component per file.
  'react/no-multi-comp': ['error', { ignoreStateless: false }],
  // Rules of hooks is a correctness rule and the codebase is clean of
  // violations, so enforce it as an error. exhaustive-deps stays a warning
  // since legacy effects intentionally carry disable directives.
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
}

export default [
  // schema.d.ts is generated from the backend (npm run api:types).
  { ignores: ['dist/**', 'node_modules/**', 'src/api/schema.d.ts'] },
  // The project's React rules, plus typescript-eslint's recommended set. Types
  // themselves are checked by `npm run typecheck`.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    settings: { react: { version: reactVersion } },
    rules: reactRules,
  },
  {
    // Test files legitimately define local wrapper/harness components.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.vitest } },
    rules: {
      'react/no-multi-comp': 'off',
    },
  },
]
