/**
 * Which source files are measured for coverage - the single list both
 * vite.config.js (the coverage `include`/`exclude`) and scripts/check-coverage.mjs
 * (the per-changed-file gate) read, so a file the report leaves out on purpose
 * is exactly a file the gate skips, and nothing else.
 *
 * Globs are relative to frontend/ and matched the way vitest matches them:
 * picomatch with `dot: true`, the excludes acting as its `ignore` list.
 */
export const COVERAGE_INCLUDE = ['src/**/*.{js,jsx,ts,tsx}']

export const COVERAGE_EXCLUDE = [
  'src/**/*.test.{js,jsx,ts,tsx}',
  // Type declarations (the generated API schema among them) hold no code.
  'src/**/*.d.ts',
  'src/test/**',
  'src/main.tsx',
  // Third-party setup glue (pdf.js worker wiring, the three.js bundle
  // entry) that is mocked in tests and carries no logic of its own to
  // exercise. Named individually rather than excluding all of `src/lib/`:
  // the rest of that directory is real logic with its own tests, and a
  // blanket exclusion silently left it ungated.
  'src/lib/pdfjs.js',
  'src/lib/three.js',
  'src/**/*.config.{js,jsx,ts,tsx}',
]
