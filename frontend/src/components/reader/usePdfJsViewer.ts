import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { DocumentInitParameters, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import pdfjs, { WASM_URL } from '../../lib/pdfjs'
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from '../../lib/pdfjsViewer'

/** The annotation tools the viewer offers; `none` is plain reading. */
export type PdfTool = 'none' | 'highlight' | 'text' | 'draw'

const { AnnotationEditorType } = pdfjs

const EDITOR_MODE: Record<PdfTool, number> = {
  none: AnnotationEditorType.NONE,
  highlight: AnnotationEditorType.HIGHLIGHT,
  text: AnnotationEditorType.FREETEXT,
  draw: AnnotationEditorType.INK,
}

const toolFor = (mode: number): PdfTool =>
  (Object.keys(EDITOR_MODE) as PdfTool[]).find((k) => EDITOR_MODE[k] === mode) ?? 'none'

// pdf.js's own highlight palette, so its colour picker has something to offer.
const HIGHLIGHT_COLORS = 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F'

// The viewer is for phones and tablets, whose canvases run out of memory well
// before a desktop's. pdf.js uses this same cap on mobile; past it, a zoomed
// page is drawn at this size and its visible part re-rendered sharply on top.
const MAX_CANVAS_PIXELS = 5_242_880

/** The callbacks pdf.js's annotation storage fires as edits appear and are saved. */
interface ModifiedHooks {
  onSetModified: (() => void) | null
  onResetModified: (() => void) | null
}

// The two zoom-button steps, as pdf.js counts them (each is a factor of 1.1).
const ZOOM_STEPS = 2

/** Everything the viewer's chrome reads and drives. */
export interface PdfJsViewer {
  containerRef: RefObject<HTMLDivElement | null>
  viewerRef: RefObject<HTMLDivElement | null>
  status: 'loading' | 'ready' | 'error'
  pageCount: number
  /** Current zoom, 1 = 100%. */
  scale: number
  tool: PdfTool
  setTool: (tool: PdfTool) => void
  zoomIn: () => void
  zoomOut: () => void
  fitWidth: () => void
  /** Annotations made since opening (or the last save) that only live here. */
  dirty: boolean
  /** Download the document, annotations written into it, as `filename`. */
  save: (filename: string) => Promise<void>
}

interface Options {
  url: string
  /** The page to show; changing it scrolls there. */
  page: number
  /** Called with the page scrolled to, as the reader moves through the file. */
  onPageChange?: (page: number) => void
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Drive pdf.js's `PDFViewer` - the continuous-scroll viewer Firefox is built
 * on - inside two divs the caller renders: an absolutely positioned scroll
 * container and, inside it, the `.pdfViewer` element the pages go into.
 *
 * The browser's own viewer can't be embedded on phones and tablets, so this is
 * what PDF mode shows there: text selection, links, pinch to zoom, and
 * highlight / text / drawing annotations that `save` writes into a copy of the
 * file. Nothing is stored server-side; `dirty` says there is work to lose.
 */
export default function usePdfJsViewer({
  url,
  page,
  onPageChange,
  onDirtyChange,
}: Options): PdfJsViewer {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<PDFViewer | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const [status, setStatus] = useState<PdfJsViewer['status']>('loading')
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1)
  const [tool, setToolState] = useState<PdfTool>('none')
  const [dirty, setDirty] = useState(false)

  // Read inside the pdf.js callbacks, which are bound once per document.
  const pageRef = useRef(page)
  pageRef.current = page
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  // Pages the viewer has scrolled to that the caller has yet to hand back as
  // `page`. A `page` found here is that echo, not a request to jump: acting on
  // it would yank a reader mid-scroll back to a page they have already left.
  const reportedRef = useRef<number[]>([])

  useEffect(() => {
    const container = containerRef.current
    const viewerEl = viewerRef.current
    if (!container || !viewerEl) return
    const ac = new AbortController()
    const { signal } = ac
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: LinkTarget.BLANK,
      externalLinkRel: 'noopener noreferrer nofollow',
    })
    const viewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus,
      linkService,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS,
      maxCanvasPixels: MAX_CANVAS_PIXELS,
      abortSignal: signal,
      // The viewer reads `abortSignal` (it disconnects its resize observer on
      // abort), but the shipped typings leave it out of the options.
    } as ConstructorParameters<typeof PDFViewer>[0])
    linkService.setViewer(viewer)
    pdfViewerRef.current = viewer
    reportedRef.current = []
    setStatus('loading')
    setToolState('none')
    setDirty(false)

    eventBus.on(
      'pagesinit',
      () => {
        viewer.currentScaleValue = 'page-width'
        if (pageRef.current > 1) viewer.currentPageNumber = pageRef.current
        setStatus('ready')
      },
      { signal }
    )
    eventBus.on(
      'pagechanging',
      ({ pageNumber }: { pageNumber: number }) => {
        if (pageNumber === pageRef.current) return
        reportedRef.current.push(pageNumber)
        onPageChangeRef.current?.(pageNumber)
      },
      { signal }
    )
    eventBus.on('scalechanging', ({ scale: s }: { scale: number }) => setScale(s), { signal })
    eventBus.on(
      'annotationeditormodechanged',
      ({ mode }: { mode: number }) => setToolState(toolFor(mode)),
      { signal }
    )

    // Range requests: only the pages being read are fetched, which matters for
    // a 300 MB rulebook over a phone's connection.
    const task = pdfjs.getDocument({
      url,
      wasmUrl: WASM_URL,
      isEvalSupported: false,
      disableAutoFetch: true,
    } as DocumentInitParameters)
    task.promise.then(
      (doc) => {
        if (signal.aborted) return
        docRef.current = doc
        // Typed as always-null fields, but they are the hooks pdf.js calls.
        const storage = doc.annotationStorage as unknown as ModifiedHooks
        storage.onSetModified = () => setDirty(true)
        storage.onResetModified = () => setDirty(false)
        setPageCount(doc.numPages)
        viewer.setDocument(doc)
        linkService.setDocument(doc)
      },
      () => {
        if (!signal.aborted) setStatus('error')
      }
    )

    // Two fingers zoom about the point between them, as pdf.js's own app
    // does. The manager stops the browser zooming the whole page, and with it
    // the native scroll, so a two-finger drag that isn't a pinch scrolls here.
    let unusedFactor = 1
    new pdfjs.TouchManager({
      container,
      signal,
      onPinching: (origin: [number, number], prevDistance: number, distance: number) => {
        // updateScale rounds to the hundredth, so a slow pinch's tiny factors
        // would round away to nothing: carry what was dropped into the next.
        const factor = (distance / prevDistance) * unusedFactor
        const current = viewer.currentScale
        const applied = Math.floor(current * factor * 100) / (100 * current)
        unusedFactor = factor / applied
        viewer.updateScale({ scaleFactor: applied, origin, drawingDelay: 400 })
      },
      onPinchEnd: () => {
        unusedFactor = 1
      },
      onPanning: (dx: number, dy: number) => container.scrollBy(-dx, -dy),
    })
    // A tablet's trackpad pinches as Ctrl + wheel.
    container.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        viewer.updateScale({
          scaleFactor: Math.exp(-e.deltaY / 100),
          origin: [e.clientX, e.clientY],
          drawingDelay: 400,
        })
      },
      { passive: false, signal }
    )

    return () => {
      ac.abort()
      pdfViewerRef.current = null
      docRef.current = null
      void task.destroy()
    }
  }, [url])

  // A jump asked for from outside - the page box, contents, a search hit.
  useEffect(() => {
    const viewer = pdfViewerRef.current
    if (status !== 'ready' || !viewer) return
    const reported = reportedRef.current
    const echo = reported.lastIndexOf(page)
    if (echo !== -1) {
      reported.splice(0, echo + 1)
      return
    }
    reportedRef.current = []
    if (viewer.currentPageNumber !== page) viewer.currentPageNumber = page
  }, [page, status])

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty)
    if (!dirty) return
    // Unsaved annotations are lost with the page: ask before it goes.
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const setTool = useCallback((next: PdfTool) => {
    const viewer = pdfViewerRef.current
    if (!viewer) return
    viewer.annotationEditorMode = { mode: EDITOR_MODE[next] }
  }, [])

  const zoomIn = useCallback(() => pdfViewerRef.current?.increaseScale({ steps: ZOOM_STEPS }), [])
  const zoomOut = useCallback(() => pdfViewerRef.current?.decreaseScale({ steps: ZOOM_STEPS }), [])
  const fitWidth = useCallback(() => {
    if (pdfViewerRef.current) pdfViewerRef.current.currentScaleValue = 'page-width'
  }, [])

  const save = useCallback(async (filename: string) => {
    const doc = docRef.current
    if (!doc) return
    const data = await doc.saveDocument()
    const href = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked a beat later: Safari starts the download after click() returns.
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
    doc.annotationStorage.resetModified()
  }, [])

  return {
    containerRef,
    viewerRef,
    status,
    pageCount,
    scale,
    tool,
    setTool,
    zoomIn,
    zoomOut,
    fitWidth,
    dirty,
    save,
  }
}
