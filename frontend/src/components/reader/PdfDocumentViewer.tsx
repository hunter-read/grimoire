import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import 'pdfjs-dist/web/pdf_viewer.css'
import './pdfDocumentViewer.css'
import Spinner from '../Spinner'
import PdfViewerToolbar from './PdfViewerToolbar'
import usePdfJsViewer from './usePdfJsViewer'

export interface PdfDocumentViewerProps {
  /** The PDF's URL, token included (see `mediaUrl`). */
  url: string
  title: string
  /** What a saved, annotated copy is called. */
  filename: string
  page: number
  onPageChange?: (page: number) => void
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * PDF mode for browsers that can't embed a PDF themselves - phones and
 * tablets (issue #890). The whole file scrolls continuously, text can be
 * selected and links followed, and the reader can highlight, write and draw on
 * it, then save a copy with those annotations written in.
 */
export default function PdfDocumentViewer({
  url,
  title,
  filename,
  page,
  onPageChange,
  onDirtyChange,
}: PdfDocumentViewerProps) {
  const { t } = useTranslation()
  const pdf = usePdfJsViewer({ url, page, onPageChange, onDirtyChange })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const save = () => {
    setSaving(true)
    setSaveError(false)
    pdf
      .save(filename)
      .catch(() => setSaveError(true))
      .finally(() => setSaving(false))
  }

  return (
    <div className="pdf-document-viewer">
      <PdfViewerToolbar
        scale={pdf.scale}
        tool={pdf.tool}
        dirty={pdf.dirty}
        saving={saving}
        disabled={pdf.status !== 'ready'}
        onTool={pdf.setTool}
        onZoomIn={pdf.zoomIn}
        onZoomOut={pdf.zoomOut}
        onFitWidth={pdf.fitWidth}
        onSave={save}
      />
      {saveError && (
        <div className="pdf-viewer-message" role="alert">
          {t('reader.pdfViewer.saveFailed')}
        </div>
      )}
      <div className="pdf-viewer-stage">
        {/* pdf.js requires an absolutely positioned scroll container holding
            the `.pdfViewer` element it fills with pages. */}
        <div
          ref={pdf.containerRef}
          className="pdf-viewer-container"
          role="document"
          aria-label={title}
          aria-busy={pdf.status === 'loading'}
          tabIndex={0}
        >
          <div ref={pdf.viewerRef} className="pdfViewer" />
        </div>
        {pdf.status === 'loading' && (
          <div className="pdf-viewer-overlay">
            <Spinner />
          </div>
        )}
        {pdf.status === 'error' && (
          <div className="pdf-viewer-overlay" role="alert">
            {t('reader.pdfViewer.loadFailed')}
          </div>
        )}
      </div>
    </div>
  )
}
