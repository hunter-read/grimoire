import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'
import { cpSync } from 'fs'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const reactVersion = require('react/package.json').version

// pdf.js decodes JPEG2000/JBIG2 images via OpenJPEG/JBIG2 WASM modules it loads
// at runtime from `wasmUrl`. Copy that directory (shipped in pdfjs-dist) into the
// served public dir so those images decode instead of failing — without it, PDF
// pages containing JPX images render blank. Copying from the package on every
// build keeps the WASM in lockstep with the installed pdf.js version. The copy
// lands in static/pdfjs-wasm/ (gitignored) and is served at /pdfjs-wasm/.
const pdfjsWasmDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'wasm')
function pdfjsWasm() {
  return {
    name: 'pdfjs-wasm-copy',
    buildStart() {
      cpSync(pdfjsWasmDir, join(import.meta.dirname, 'static', 'pdfjs-wasm'), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsWasm()],
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
      // Istanbul (not v8) so per-file coverage merges correctly across the many
      // test files that touch shared components — v8 under-reports cumulative
      // coverage in that case, which breaks the per-changed-file gate.
      provider: 'istanbul',
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
        // Third-party setup glue (e.g. pdf.js worker wiring) that is mocked in
        // tests and carries no logic of its own to exercise.
        'src/lib/**',
        'src/**/*.config.{js,jsx}',
      ],
    },
  },
})
