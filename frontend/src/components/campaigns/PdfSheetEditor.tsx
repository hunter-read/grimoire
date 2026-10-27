import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import 'pdfjs-dist/web/pdf_viewer.css'
import './pdfSheetEditor.css'
import pdfjs, { WASM_URL } from '../../lib/pdfjs'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import { overlay, goldBtn, ghostBtn } from './sheetEditorStyles'

// Links inside a fillable character sheet aren't the point here, so a no-op
// link service satisfies the annotation layer's interface without navigating.
const NOOP_LINK_SERVICE = {
  externalLinkTarget: 0,
  externalLinkRel: 'noopener noreferrer nofollow',
  externalLinkEnabled: false,
  getDestinationHash: () => '#',
  getAnchorUrl: () => '#',
  setHash: () => {},
  addLinkAttributes: (link, url) => {
    link.href = url || '#'
  },
  goToDestination: () => Promise.resolve(),
  goToPage: () => {},
  isPageVisible: () => true,
  isPageCached: () => true,
}

// The width we render each page at (CSS px). Kept modest so large multi-page
// sheets stay responsive; the page scales to fit its natural aspect ratio.
const RENDER_WIDTH = 820

// Browsers cap canvas area (~16M px in Safari, higher elsewhere); exceeding it
// yields a blank canvas. Stay conservatively under the smallest common limit.
const MAX_CANVAS_AREA = 16_777_216

/**
 * Edit a form-fillable PDF character sheet directly on the rendered document.
 *
 * pdf.js renders each page to a canvas with an interactive AcroForm layer on
 * top, so the player fills the real sheet in place. On save, pdf.js writes the
 * filled values back into the PDF bytes (saveDocument), and we upload that copy
 * to the member's sheet slot — replacing the field-list modal with true
 * in-browser editing.
 */
export default function PdfSheetEditor({ campaignId, memberId, onClose, onSaved }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const docRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const renderPdf = useCallback(
    async (signal) => {
      setLoading(true)
      setError(null)
      try {
        // Bust the upload cache on open so a sheet just saved in-app loads with
        // the latest edits, not the stale copy the browser cached for 5 minutes.
        const url = campaigns.memberSheetUrl(campaignId, memberId, Date.now())
        // wasmUrl lets pdf.js decode JPEG2000/JBIG2 page images; without it such
        // pages render blank (OpenJPEG fails to initialize).
        const doc = await pdfjs.getDocument({ url, isEvalSupported: false, wasmUrl: WASM_URL })
          .promise
        // A superseded run (React StrictMode double-invokes effects) must not touch
        // the DOM or leave a half-rendered doc behind, or the page renders blank.
        // The doc is owned by this run's signal so cleanup destroys exactly the
        // doc it created — never a newer run's live doc.
        signal.doc = doc
        if (signal.cancelled) {
          doc.destroy()
          return
        }
        docRef.current = doc
        const container = containerRef.current
        if (!container) return
        container.replaceChildren()

        // On narrow screens (phones) the full 820px sheet would render wider than
        // the viewport, forcing horizontal panning per page. Fit the render width
        // to the available scroll area instead, never exceeding RENDER_WIDTH.
        const available = container.clientWidth - 8
        const renderWidth = available > 0 ? Math.min(RENDER_WIDTH, available) : RENDER_WIDTH

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          if (signal.cancelled) return
          const page = await doc.getPage(pageNum)
          const baseViewport = page.getViewport({ scale: 1 })
          const scale = renderWidth / baseViewport.width
          const viewport = page.getViewport({ scale })

          // pdf.js sizes pages and positions every AcroForm widget from CSS custom
          // properties (--total-scale-factor, --scale-round-x/y) that its stylesheet
          // only defines under `.pdfViewer .page`. So the page must live inside a
          // `.pdfViewer` element carrying --scale-factor, or the layer and all its
          // fields collapse into a tiny box in the top-left corner.
          //
          // Widgets are positioned as percentages of the layer, whose box is
          // --total-scale-factor (= --scale-factor, since --user-unit defaults to
          // 1) × the raw page width. That factor must equal the viewport's true
          // scale — which folds in the PDF's UserUnit — or positions drift more
          // the further a field sits from the top-left. So derive it from the
          // rendered viewport rather than assuming it equals the nominal scale.
          const layerScale = viewport.width / viewport.rawDims.pageWidth
          const pageDiv = document.createElement('div')
          pageDiv.className = 'page'
          pageDiv.style.setProperty('--scale-factor', String(layerScale))
          pageDiv.style.width = `${viewport.width}px`
          pageDiv.style.height = `${viewport.height}px`
          pageDiv.style.margin = '0 auto 16px'
          pageDiv.style.boxShadow = '0 2px 12px var(--shadow)'

          const canvasWrapper = document.createElement('div')
          canvasWrapper.className = 'canvasWrapper'
          // The viewer CSS sizes the wrapper as 100% of .page and absolutely
          // positions its canvas; pin explicit page px so it doesn't depend on
          // percentage resolution timing.
          canvasWrapper.style.width = `${viewport.width}px`
          canvasWrapper.style.height = `${viewport.height}px`
          canvasWrapper.style.position = 'relative'
          const canvas = document.createElement('canvas')
          // Render the bitmap at device resolution for sharpness, then let CSS
          // scale it to the page's CSS px box. Cap the effective scale so a large
          // sheet on a hi-DPI screen can't exceed the browser's max canvas area
          // (which would paint the whole page blank).
          const maxDpr = Math.sqrt(MAX_CANVAS_AREA / (viewport.width * viewport.height))
          const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${viewport.width}px`
          canvas.style.height = `${viewport.height}px`
          canvasWrapper.appendChild(canvas)
          pageDiv.appendChild(canvasWrapper)

          const annotationDiv = document.createElement('div')
          annotationDiv.className = 'annotationLayer'
          pageDiv.appendChild(annotationDiv)
          container.appendChild(pageDiv)

          // Render page graphics only; the live annotation layer below draws every
          // form field. DISABLE keeps the canvas from also painting the widgets,
          // which would double each value and blur the text.
          const renderTask = page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            annotationMode: pdfjs.AnnotationMode.DISABLE,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          })
          try {
            await renderTask.promise
          } catch (err) {
            if (err?.name === 'RenderingCancelledException') return
            throw err
          }
          if (signal.cancelled) return

          const annotations = await page.getAnnotations({ intent: 'display' })
          const layer = new pdfjs.AnnotationLayer({
            div: annotationDiv,
            page,
            viewport: viewport.clone({ dontFlip: true }),
            linkService: NOOP_LINK_SERVICE,
            annotationStorage: doc.annotationStorage,
          })
          // renderForms wires each widget's input to doc.annotationStorage, which
          // is what saveDocument() serializes.
          await layer.render({ annotations, renderForms: true })
        }
      } catch (err) {
        setError(err?.message || String(err))
      } finally {
        setLoading(false)
      }
    },
    [campaignId, memberId]
  )

  useEffect(() => {
    const signal = { cancelled: false, doc: null }
    renderPdf(signal)
    return () => {
      signal.cancelled = true
      // Destroy only this run's doc. If it's the one currently in docRef, clear
      // that too; a newer run's live doc (already in docRef) is left untouched.
      signal.doc?.destroy?.()
      if (docRef.current === signal.doc) docRef.current = null
    }
  }, [renderPdf])

  const save = async () => {
    const doc = docRef.current
    if (!doc || busy) return
    // A field being edited only commits to annotationStorage on blur, so flush
    // the focused input first or its value is missing from the saved PDF.
    document.activeElement?.blur?.()
    setBusy(true)
    setError(null)
    try {
      const bytes = await doc.saveDocument()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const file = new File([blob], 'character-sheet.pdf', { type: 'application/pdf' })
      await campaigns.uploadMemberSheet(campaignId, memberId, file)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <div style={headerRow}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            {t('members.editSheetTitle')}
          </h3>
          <button onClick={onClose} aria-label={t('common.close')} style={inlineCloseBtn}>
            <LuX size={18} />
          </button>
        </div>

        <div style={pagesArea}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spinner size={22} />
            </div>
          )}
          {/* pdf.js writes canvases + form layers here imperatively, so this div
              has no React children to reconcile against. The `pdfViewer` class
              brings in the viewer stylesheet's page/annotation scaling variables. */}
          <div ref={containerRef} className="pdfViewer" data-testid="pdf-pages" />
        </div>

        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: '10px 0 0' }}>
            {t('members.sheetEditError')}
          </p>
        )}

        <div style={footerRow}>
          <button onClick={onClose} style={ghostBtn}>
            {t('members.cancel')}
          </button>
          <button onClick={save} disabled={busy || loading} style={goldBtn}>
            {busy ? t('members.saving') : t('members.saveCopy')}
          </button>
        </div>
      </div>
    </div>
  )
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  width: 'min(900px, 96vw)',
  height: '92vh',
  display: 'flex',
  flexDirection: 'column',
  padding: 16,
  boxSizing: 'border-box',
}
const headerRow = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
  flexShrink: 0,
}
const inlineCloseBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const pagesArea = {
  flex: 1,
  overflow: 'auto',
  background: 'var(--bg-deep)',
  borderRadius: 8,
  padding: 16,
}
const footerRow = {
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
  marginTop: 12,
  flexShrink: 0,
}
