import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const reactVersion = require('react/package.json').version

export default defineConfig({
  plugins: [react()],
  define: {
    __REACT_VERSION__: JSON.stringify(reactVersion),
  },
  publicDir: 'static',
  server: {
    proxy: {
      '/api': 'http://localhost:9481',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      // Reporters: human-readable text in the terminal, an HTML report under
      // coverage/, and a json-summary that scripts/check-coverage.mjs reads to
      // gate per-file coverage on changed files. No global `thresholds` here by
      // design — the per-changed-file gate lives in the CI script instead.
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.test.{js,jsx}',
        'src/test/**',
        'src/main.jsx',
        'src/**/*.config.{js,jsx}',
      ],
    },
  },
})
