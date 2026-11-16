// pdf.js's viewer layer (PDFViewer, EventBus, link service...).
//
// The viewer module reads the core library from `globalThis.pdfjsLib` as it is
// evaluated, so the core must load first. Importing it from here, ahead of the
// re-export, fixes that order for every consumer, whatever order their own
// imports end up in.
import './pdfjs'

export {
  EventBus,
  LinkTarget,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs'
