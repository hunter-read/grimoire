import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuDownload, LuFiles, LuFolderInput, LuScissors, LuX } from 'react-icons/lu'
import api from '../../../api'
import { useAuth } from '../../../context/AuthContext'
import { useUISettings } from '../../../context/UISettingsContext'
import Spinner from '../../Spinner'
import ReaderSidebarShell from '../ReaderSidebarShell'
import ExportCutoutsTab from './ExportCutoutsTab'
import ExportPagesTab from './ExportPagesTab'
import ExportSegmented from './ExportSegmented'
import SaveToLibraryModal from './SaveToLibraryModal'
import { buttonStyle, errorStyle, hintStyle } from './exportStyles'
import { countSpreadImages, parsePageSpec } from './pageRanges'
import type { ExportTab, PageExporter, PageUrl } from './usePageExport'

export interface ExportSidebarProps {
  exporter: PageExporter
  title: string
  totalPages: number
  currentPage: number
  isSpread?: boolean
  spreadOffset?: number
  /** The table-of-contents endpoint; books only. */
  tocPath?: string | null
  pageUrl: PageUrl
  /** The source file's library path, so saving can open beside it. */
  sourcePath?: string | null
  onShowPage: (page: number) => void
  onClose: () => void
}

/**
 * The export panel (issue #207): whole pages, or areas cut out of them.
 *
 * Lives in the reader's sidebar slot, like contents and bookmarks, so it opens
 * beside the page rather than over it - the page is what is being exported.
 * The Cut out tab turns that page into a drawing surface (the viewer swaps in
 * CutoutStage while it is selected).
 *
 * The footer always says what the button will produce - "3 pages → 1 PDF",
 * "12 PNG files, zipped" - so there is no guessing what lands in Downloads.
 * Admins on a writable library can save into it instead.
 */
export default function ExportSidebar({
  exporter,
  title,
  totalPages,
  currentPage,
  isSpread,
  spreadOffset = 0,
  tocPath,
  pageUrl,
  sourcePath,
  onShowPage,
  onClose,
}: ExportSidebarProps) {
  const { t } = useTranslation()
  const user = useAuth()?.user
  const libraryWritable = useUISettings()?.library_writable
  const canSave = user?.role === 'admin' && libraryWritable !== false
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  const isCut = exporter.tab === 'cut'
  const parsed = useMemo(
    () => parsePageSpec(exporter.pagesSpec, totalPages),
    [exporter.pagesSpec, totalPages]
  )

  // A fresh choice clears the last attempt's error and "Downloaded" tick.
  useEffect(() => {
    setError(null)
    setDone(false)
  }, [
    exporter.tab,
    exporter.pagesSpec,
    exporter.pagesFormat,
    exporter.cutFormat,
    exporter.cutouts.length,
  ])

  const fmt = isCut ? exporter.cutFormat : exporter.pagesFormat
  const fmtName = t(`pageExport.format.${fmt}`)
  const hasRound = exporter.cutouts.some((c) => c.shape === 'ellipse')

  let summary = ''
  let blocked = false
  if (isCut) {
    const n = exporter.cutouts.length
    blocked = n === 0 || (fmt === 'pdf' && hasRound)
    summary = n ? t('pageExport.summaryFiles', { count: n, format: fmtName }) : ''
  } else if (parsed.pages) {
    const n = parsed.pages.length
    if (fmt === 'pdf') {
      summary = t('pageExport.summaryPdf', { count: n })
    } else {
      const images =
        exporter.joinSpreads && n > 1 ? countSpreadImages(parsed.pages, spreadOffset) : n
      summary = t('pageExport.summaryImages', { count: images, pages: n, format: fmtName })
    }
  } else {
    blocked = true
  }

  const body = exporter.requestBody(spreadOffset)

  const download = async () => {
    if (blocked || busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await api.download(`${exporter.basePath}/export`, `${title}.zip`, { method: 'POST', body })
      setDone(true)
    } catch (e) {
      setError((e as Error).message || t('pageExport.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReaderSidebarShell width={316} sheet={isCut} overflowHidden>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <LuScissors size={14} color="var(--text-muted)" aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>
          {t('pageExport.title')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('pageExport.close')}
          title={t('pageExport.close')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
          }}
        >
          <LuX size={16} />
        </button>
      </div>

      <div style={{ padding: '12px 14px 0', flexShrink: 0 }}>
        <ExportSegmented<ExportTab>
          ariaLabel={t('pageExport.title')}
          value={exporter.tab}
          onChange={exporter.setTab}
          options={[
            { value: 'pages', label: t('pageExport.tabPages'), Icon: LuFiles },
            { value: 'cut', label: t('pageExport.tabCut'), Icon: LuScissors },
          ]}
        />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {isCut ? (
          <ExportCutoutsTab exporter={exporter} pageUrl={pageUrl} onShowPage={onShowPage} />
        ) : (
          <ExportPagesTab
            exporter={exporter}
            parsed={parsed}
            totalPages={totalPages}
            tocPath={tocPath}
            currentPage={currentPage}
            isSpread={isSpread}
          />
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'var(--bg-panel)',
        }}
      >
        <div aria-live="polite" style={{ minHeight: 18 }}>
          {error ? (
            <p style={errorStyle} role="alert">
              {error}
            </p>
          ) : done ? (
            <p
              style={{
                ...hintStyle,
                color: 'var(--success)',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <LuCircleCheck size={14} aria-hidden="true" />
              {t('pageExport.downloaded')}
            </p>
          ) : (
            <p
              style={{ ...hintStyle, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
            >
              {summary || (isCut ? t('pageExport.nothingToExport') : ' ')}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSave && (
            <button
              type="button"
              onClick={() => setSaving(true)}
              disabled={blocked || busy}
              title={t('pageExport.saveToLibraryHint')}
              style={{ ...buttonStyle(false, blocked || busy), flex: 1 }}
            >
              <LuFolderInput size={14} aria-hidden="true" />
              {t('pageExport.saveToLibrary')}
            </button>
          )}
          <button
            type="button"
            onClick={download}
            disabled={blocked || busy}
            style={{ ...buttonStyle(true, blocked || busy), flex: 1 }}
          >
            {busy ? <Spinner size={13} /> : <LuDownload size={14} aria-hidden="true" />}
            {busy ? t('pageExport.preparing') : t('common.download')}
          </button>
        </div>
      </div>

      {saving && (
        <SaveToLibraryModal
          basePath={exporter.basePath}
          body={body}
          sourcePath={sourcePath}
          title={title}
          summary={summary}
          onClose={() => setSaving(false)}
        />
      )}
    </ReaderSidebarShell>
  )
}
