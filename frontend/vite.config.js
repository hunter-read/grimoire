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
  },
})
