// Central pdf.js setup: import the library and point it at its worker.
//
// Vite resolves the `?url` import to a hashed asset URL at build time, and to a
// dev-server URL in dev, so the worker loads correctly in both. Kept in one
// place so every consumer shares the same configured instance.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Where pdf.js loads its image-codec WASM (OpenJPEG for JPEG2000, JBIG2) from at
// runtime. The vite config copies pdfjs-dist/wasm/ here; pass this as `wasmUrl`
// to getDocument or PDFs with JPX/JBIG2 images render blank. Trailing slash: the
// library appends the filename (e.g. `openjpeg.wasm`) directly.
export const WASM_URL = '/pdfjs-wasm/'

export default pdfjs
