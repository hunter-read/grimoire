import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuScanText } from 'react-icons/lu'
import api from '../api'

const POPOVER_WIDTH = 220

/**
 * Per-book re-OCR action. Shown only for scanned/OCR'd books (an embedded-text
 * book has nothing to re-read). Clicking opens a small popover to optionally set
 * a DPI, then POSTs to /books/:id/reindex — the server clears the book's search
 * index and re-queues it for OCR in the background.
 *
 * The popover is portalled to document.body at fixed coordinates so it isn't
 * clipped by the book row's `overflow: hidden` (used for the progress bar).
 *
 * Props:
 *   book     – the book object (needs id and ocr_dpi)
 *   onQueued – optional callback fired after a successful queue
 */
export default function ReocrButton({ book, onQueued }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const [dpi, setDpi] = useState(book.ocr_dpi ? String(book.ocr_dpi) : '')
  const [state, setState] = useState('idle') // idle | working | queued | error
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  // Right-align the popover under the trigger, clamped to the viewport.
  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.right - POPOVER_WIDTH
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - POPOVER_WIDTH))
    setCoords({ top: r.bottom + 4, left })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || popoverRef.current?.contains(e.target)) return
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

  const submit = (e) => {
    e.stopPropagation()
    setState('working')
    const value = dpi.trim() ? parseInt(dpi, 10) : null
    const qs = value ? `?ocr_dpi=${value}` : ''
    api
      .post(`/books/${book.id}/reindex${qs}`)
      .then(() => {
        setState('queued')
        onQueued?.()
        setTimeout(() => setOpen(false), 1200)
      })
      .catch(() => setState('error'))
  }

  const label = t('reocr.button')

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
          setState('idle')
        }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          padding: '6px',
          color: open ? 'var(--gold)' : 'var(--text-muted)',
        }}
      >
        <LuScanText size={16} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: 2000,
              width: POPOVER_WIDTH,
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
              {t('reocr.title')}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min="72"
                max="600"
                step="10"
                value={dpi}
                onChange={(e) => setDpi(e.target.value)}
                placeholder={t('reocr.dpiPlaceholder')}
                aria-label={t('reocr.dpiLabel')}
                style={{ width: 90, fontSize: 13 }}
              />
              <button
                onClick={submit}
                disabled={state === 'working' || state === 'queued'}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: 5,
                  background: 'var(--gold-dim)',
                  border: 'none',
                  color: 'var(--bg-deep)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: state === 'working' || state === 'queued' ? 'default' : 'pointer',
                }}
              >
                {state === 'working'
                  ? t('reocr.working')
                  : state === 'queued'
                    ? `✓ ${t('reocr.queued')}`
                    : t('reocr.run')}
              </button>
            </div>
            {state === 'error' && (
              <div style={{ fontSize: 11, color: '#e07070', marginTop: 6 }}>{t('reocr.error')}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              {t('reocr.hint')}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
