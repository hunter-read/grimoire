import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import 'pdfjs-dist/web/pdf_viewer.css'
import pdfjs from '../../lib/pdfjs'
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

  const renderPdf = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = campaigns.memberSheetUrl(campaignId, memberId)
      const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise
      docRef.current = doc
      const container = containerRef.current
      if (!container) return
      container.replaceChildren()

      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum)
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = RENDER_WIDTH / baseViewport.width
        const viewport = page.getViewport({ scale })

        const pageDiv = document.createElement('div')
        pageDiv.className = 'page'
        pageDiv.style.position = 'relative'
        pageDiv.style.width = `${viewport.width}px`
        pageDiv.style.height = `${viewport.height}px`
        pageDiv.style.margin = '0 auto 16px'
        pageDiv.style.boxShadow = '0 2px 12px rgba(0,0,0,0.5)'

        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.display = 'block'
        pageDiv.appendChild(canvas)

        const annotationDiv = document.createElement('div')
        annotationDiv.className = 'annotationLayer'
        pageDiv.appendChild(annotationDiv)
        container.appendChild(pageDiv)

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

        const annotations = await page.getAnnotations({ intent: 'display' })
        const layer = new pdfjs.AnnotationLayer({
          div: annotationDiv,
          page,
          viewport: viewport.clone({ dontFlip: true }),
          linkService: NOOP_LINK_SERVICE,
          annotationStorage: doc.annotationStorage,
        })
        await layer.render({ annotations, renderForms: true })
      }
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [campaignId, memberId])

  useEffect(() => {
    renderPdf()
    return () => {
      docRef.current?.destroy?.()
      docRef.current = null
    }
  }, [renderPdf])

  const save = async () => {
    const doc = docRef.current
    if (!doc || busy) return
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
              has no React children to reconcile against. */}
          <div ref={containerRef} data-testid="pdf-pages" />
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
