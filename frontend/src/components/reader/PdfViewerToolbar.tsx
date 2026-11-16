import { useTranslation } from 'react-i18next'
import {
  LuHighlighter,
  LuMinus,
  LuMousePointer2,
  LuMoveHorizontal,
  LuPencil,
  LuPlus,
  LuSave,
  LuType,
} from 'react-icons/lu'
import type { IconType } from 'react-icons'
import type { PdfTool } from './usePdfJsViewer'

const TOOLS: { key: PdfTool; Icon: IconType }[] = [
  { key: 'none', Icon: LuMousePointer2 },
  { key: 'highlight', Icon: LuHighlighter },
  { key: 'text', Icon: LuType },
  { key: 'draw', Icon: LuPencil },
]

interface PdfViewerToolbarProps {
  scale: number
  tool: PdfTool
  dirty: boolean
  saving: boolean
  disabled: boolean
  onTool: (tool: PdfTool) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onSave: () => void
}

/**
 * The in-app PDF viewer's own controls: zoom, the annotation tools, and - once
 * there is something to keep - saving a copy with the annotations in it.
 * Page navigation stays in the reader's toolbar, which drives this viewer too.
 */
export default function PdfViewerToolbar({
  scale,
  tool,
  dirty,
  saving,
  disabled,
  onTool,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onSave,
}: PdfViewerToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="pdf-viewer-toolbar" role="toolbar" aria-label={t('reader.pdfViewer.toolbar')}>
      <div className="pdf-viewer-group">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={disabled}
          title={t('reader.zoomOut')}
          aria-label={t('reader.zoomOut')}
        >
          <LuMinus size={14} aria-hidden="true" />
        </button>
        <span className="pdf-viewer-scale" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={disabled}
          title={t('reader.zoomIn')}
          aria-label={t('reader.zoomIn')}
        >
          <LuPlus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onFitWidth}
          disabled={disabled}
          title={t('reader.pdfViewer.fitWidth')}
          aria-label={t('reader.pdfViewer.fitWidth')}
        >
          <LuMoveHorizontal size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="pdf-viewer-group" role="group" aria-label={t('reader.pdfViewer.tools')}>
        {TOOLS.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onTool(key)}
            disabled={disabled}
            aria-pressed={tool === key}
            title={t(`reader.pdfViewer.tool.${key}`)}
            aria-label={t(`reader.pdfViewer.tool.${key}`)}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        ))}
      </div>

      {dirty && (
        <button
          type="button"
          className="pdf-viewer-save"
          onClick={onSave}
          disabled={saving}
          title={t('reader.pdfViewer.saveHint')}
        >
          <LuSave size={14} aria-hidden="true" />
          <span>{t('reader.pdfViewer.save')}</span>
        </button>
      )}
    </div>
  )
}
