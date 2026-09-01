import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  LuEllipsisVertical,
  LuInfo,
  LuPencil,
  LuDownload,
  LuScanText,
  LuRefreshCw,
  LuScroll,
  LuFolderInput,
  LuFilePen,
  LuTrash2,
  LuBookmarkX,
} from 'react-icons/lu'
import api, { mediaUrl } from '../../api'
import { useUISettings } from '../../context/UISettingsContext'
import { getBookPrefs, saveBookPrefs } from '../../hooks/useBookPrefs'
import useFileActions from '../../hooks/useFileActions'
import AddToCampaignModal from '../AddToCampaignModal'
import VariantMenuItems from './VariantMenuItems'
import DownloadVariantItems from './DownloadVariantItems'

const MENU_WIDTH = 220

/**
 * Consolidated per-book actions dropdown (kebab): View details, Edit, Add to
 * campaign, Download, and a context-aware re-index item. Details, Add to
 * campaign, and Download are available to every user; Edit and re-index are
 * gm/admin only. Favorite is deliberately left out — it stays a standalone
 * always-visible control on the row.
 *
 * "Reset reading progress" clears this book's saved page. Reading progress is
 * per-user browser state, so — unlike the metadata editor it used to live in —
 * the item is offered to every role, not just gm/admin. It appears only when
 * there is progress to clear.
 *
 * "Add to campaign" opens the shared AddToCampaignModal with this one book,
 * mirroring the bulk-select action so a single book doesn't need multi-select.
 * It is hidden when the user has campaigns hidden in their UI settings.
 *
 * The re-index item adapts to the book:
 *   - successfully OCR / image-only PDF → "Re-OCR…" which reveals an inline DPI
 *     field, then POSTs /books/:id/reindex (optionally ?ocr_dpi=N).
 *   - text-layer PDF, or any index-failed PDF → "Re-scan & re-index" which POSTs
 *     /books/:id/rescan to re-read the file and rebuild its index. For a failed
 *     book this recovers it through the full scan → index → OCR flow.
 * Re-index items are shown only when `onEdit` is passed (gm/admin), the book is
 * a PDF, and it has actually been processed (indexed or index-failed) — a
 * never-scanned / still-pending book has nothing to re-do yet.
 *
 * File actions (move / rename / delete) are grouped last, behind a divider:
 * they act on the bytes on disk rather than on the record, and two of them are
 * irreversible, so they are kept away from the routine items above. They appear
 * only for an admin on a writable library — see `useFileActions`.
 *
 * The menu is portalled to document.body at fixed coordinates so it isn't
 * clipped by the book row's `overflow: hidden`.
 */
export default function BookActionsMenu({ book, onEdit, onDetails, editing, onFileChanged }) {
  const { t } = useTranslation()
  const { hide_campaigns } = useUISettings()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const [addToCampaign, setAddToCampaign] = useState(false)
  const [showDpi, setShowDpi] = useState(false)
  const [dpi, setDpi] = useState(book.ocr_dpi ? String(book.ocr_dpi) : '')
  const [state, setState] = useState('idle') // idle | working | done | error
  // Read once per open so the item doesn't vanish mid-interaction; `reset`
  // keeps it visible (as a confirmation) after the page is cleared.
  const [progressReset, setProgressReset] = useState(false)
  const hasProgress = open && (!!getBookPrefs(book.id).page || progressReset)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const fileActions = useFileActions({ onChanged: onFileChanged })
  // A book only has file actions once we know where its file lives; rows served
  // by an older payload without `relative_path` simply do not offer them.
  const knowsFile = Boolean(book.relative_path)
  const showFileActions = fileActions.available && knowsFile
  // Removing is offered on a read-only library too: its default is the soft
  // remove, which drops the record and never touches the file.
  const showRemove = fileActions.canRemove && knowsFile

  const isPdf = book.mime_type === 'application/pdf'
  // A book that finished indexing via OCR / as image-only. A hard index failure
  // resets index_error to the error message, so index_failed takes precedence:
  // failed books always go through the full re-scan → index → OCR flow below.
  const isOcrBook =
    !book.index_failed && (book.index_error === 'ocr' || book.index_error === 'image-only')
  // Re-index items only make sense once a book has actually been processed —
  // successfully indexed, or index-failed (which the re-scan can recover from).
  // A never-scanned / still-pending book has nothing to re-do yet.
  const canReindex = Boolean(onEdit) && isPdf && (book.indexed || book.index_failed)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.right - MENU_WIDTH
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - MENU_WIDTH))
    setCoords({ top: r.bottom + 4, left })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onReposition = () => place()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, place])

  const close = () => {
    setOpen(false)
    setShowDpi(false)
    setState('idle')
  }

  const runReocr = (e) => {
    e.stopPropagation()
    setState('working')
    const value = dpi.trim() ? parseInt(dpi, 10) : null
    const qs = value ? `?ocr_dpi=${value}` : ''
    api
      .post(`/books/${book.id}/reindex${qs}`)
      .then(() => {
        setState('done')
        setTimeout(close, 1200)
      })
      .catch(() => setState('error'))
  }

  const runRescan = (e) => {
    e.stopPropagation()
    setState('working')
    api
      .post(`/books/${book.id}/rescan`)
      .then(() => {
        setState('done')
        setTimeout(close, 1200)
      })
      .catch(() => setState('error'))
  }

  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    color: 'var(--text)',
    textAlign: 'left',
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
          setShowDpi(false)
          setState('idle')
          setProgressReset(false)
        }}
        aria-label={t('bookActions.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('bookActions.menu')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          padding: '6px',
          color: open || editing ? 'var(--gold)' : 'var(--text-muted)',
        }}
      >
        <LuEllipsisVertical size={16} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: 2000,
              width: MENU_WIDTH,
              padding: '4px 0',
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px var(--shadow)',
              overflow: 'hidden',
            }}
          >
            {onDetails && (
              <button
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  onDetails()
                }}
                style={itemStyle}
              >
                <LuInfo size={15} aria-hidden="true" />
                {t('bookActions.details')}
              </button>
            )}
            {book.variant_count > 0 && (
              <VariantMenuItems book={book} itemStyle={itemStyle} onPick={close} />
            )}
            {onEdit && (
              <button
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  onEdit()
                }}
                style={itemStyle}
              >
                <LuPencil size={15} aria-hidden="true" />
                {t('bookActions.edit')}
              </button>
            )}

            {!hide_campaigns && (
              <button
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  setAddToCampaign(true)
                }}
                style={itemStyle}
              >
                <LuScroll size={15} aria-hidden="true" />
                {t('resources.addToCampaign')}
              </button>
            )}

            {book.variant_count > 0 ? (
              <DownloadVariantItems book={book} itemStyle={itemStyle} onPick={close} />
            ) : (
              <a
                role="menuitem"
                href={mediaUrl(`/books/${book.id}/file`)}
                download
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                }}
                style={{ ...itemStyle, textDecoration: 'none' }}
              >
                <LuDownload size={15} aria-hidden="true" />
                {t('bookActions.download')}
              </a>
            )}

            {hasProgress && (
              <button
                role="menuitem"
                data-testid="book-reset-progress"
                onClick={(e) => {
                  e.stopPropagation()
                  saveBookPrefs(book.id, { page: null })
                  setProgressReset(true)
                }}
                disabled={progressReset}
                style={{
                  ...itemStyle,
                  color: progressReset ? 'var(--green)' : 'var(--text)',
                  cursor: progressReset ? 'default' : 'pointer',
                }}
              >
                <LuBookmarkX size={15} aria-hidden="true" />
                {progressReset
                  ? `✓ ${t('bookActions.progressReset')}`
                  : t('bookActions.resetProgress')}
              </button>
            )}

            {canReindex && isOcrBook && (
              <button
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDpi((s) => !s)
                }}
                aria-expanded={showDpi}
                style={{ ...itemStyle, color: showDpi ? 'var(--gold)' : 'var(--text)' }}
              >
                <LuScanText size={15} aria-hidden="true" />
                {t('bookActions.reocr')}
              </button>
            )}

            {canReindex && isOcrBook && showDpi && (
              <div
                style={{ padding: '4px 12px 10px', display: 'flex', gap: 6, alignItems: 'center' }}
              >
                <input
                  type="number"
                  min="72"
                  max="600"
                  step="10"
                  value={dpi}
                  onChange={(e) => setDpi(e.target.value)}
                  placeholder={t('reocr.dpiPlaceholder')}
                  aria-label={t('reocr.dpiLabel')}
                  style={{ width: 80, fontSize: 13 }}
                />
                <button
                  onClick={runReocr}
                  disabled={state === 'working' || state === 'done'}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    borderRadius: 5,
                    background: 'var(--gold-dim)',
                    border: 'none',
                    color: 'var(--bg-deep)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: state === 'working' || state === 'done' ? 'default' : 'pointer',
                  }}
                >
                  {state === 'working'
                    ? t('reocr.working')
                    : state === 'done'
                      ? `✓ ${t('reocr.queued')}`
                      : t('reocr.run')}
                </button>
              </div>
            )}

            {canReindex && !isOcrBook && (
              <button
                role="menuitem"
                onClick={runRescan}
                disabled={state === 'working' || state === 'done'}
                style={{
                  ...itemStyle,
                  cursor: state === 'working' || state === 'done' ? 'default' : 'pointer',
                }}
              >
                <LuRefreshCw size={15} aria-hidden="true" />
                {state === 'working'
                  ? t('reocr.working')
                  : state === 'done'
                    ? `✓ ${t('bookActions.rescanQueued')}`
                    : t('bookActions.rescan')}
              </button>
            )}

            {state === 'error' && (
              <div style={{ fontSize: 11, color: 'var(--danger)', padding: '2px 12px 8px' }}>
                {isOcrBook ? t('reocr.error') : t('bookActions.rescanError')}
              </div>
            )}

            {(showFileActions || showRemove) && (
              <div
                role="separator"
                style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }}
              />
            )}
            {showFileActions && (
              <>
                <button
                  role="menuitem"
                  data-testid="book-move-file"
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                    fileActions.move(book)
                  }}
                  style={itemStyle}
                >
                  <LuFolderInput size={15} aria-hidden="true" />
                  {fileActions.labels.move}
                </button>
                <button
                  role="menuitem"
                  data-testid="book-rename-file"
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                    fileActions.rename(book)
                  }}
                  style={itemStyle}
                >
                  <LuFilePen size={15} aria-hidden="true" />
                  {fileActions.labels.rename}
                </button>
              </>
            )}
            {showRemove && (
              <button
                role="menuitem"
                data-testid="book-delete-file"
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  fileActions.remove(book)
                }}
                style={{ ...itemStyle, color: 'var(--danger)' }}
              >
                <LuTrash2 size={15} aria-hidden="true" />
                {fileActions.labels.remove}
              </button>
            )}
          </div>,
          document.body
        )}

      {/* Portalled with propagation stopped for the same reason as the campaign
          modal below: these sit inside a book row whose click handler opens the
          reader, which would otherwise fire behind the dialog. */}
      {createPortal(
        <div onClick={(e) => e.stopPropagation()}>{fileActions.modals}</div>,
        document.body
      )}

      {/* Rendered outside the menu so it survives the menu closing on click, and
          portalled with propagation stopped: the menu sits inside a book row
          whose own click handler opens the reader, which would otherwise fire
          behind the modal on every click inside it. */}
      {addToCampaign &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            <AddToCampaignModal
              items={[{ resource_type: 'book', resource_id: book.id }]}
              onClose={() => setAddToCampaign(false)}
              onAdded={() => setAddToCampaign(false)}
            />
          </div>,
          document.body
        )}
    </>
  )
}
