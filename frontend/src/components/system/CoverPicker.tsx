import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImage } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import LazyImg from '../LazyImg'
import { sortForCoverPicker } from './coverPickerUtils'

// A system can have hundreds of books; showing every thumbnail at once is both
// slow and unusable, so start with a page and let the user ask for more. The
// bulk-edit modal is narrower and passes a smaller page via `pageSize`.
const PAGE_SIZE = 10

// Hover delay before the enlarged preview appears. Long enough that sweeping
// the cursor across the row doesn't flash previews, short enough to feel
// responsive — the usual range for hover cards is 300–700ms.
const PREVIEW_DELAY_MS = 500

/**
 * Cover chooser for a game system: pick which book's thumbnail represents it.
 *
 * Core books come first (they're almost always what someone wants), the list is
 * paged, and hovering a thumbnail shows a larger preview after a short delay —
 * 60x80 is too small to tell two rulebooks apart.
 *
 * Props:
 *   books    – the system's books (only ones with a thumbnail are shown)
 *   value    – currently selected book id, or null
 *   onChange – (bookId | null) => void
 *   pageSize – how many covers to show per page (default 10)
 *   loading  – books are still being fetched; hold the section's space rather
 *              than rendering nothing and expanding once they arrive
 */
export default function CoverPicker({
  books,
  value,
  onChange,
  pageSize = PAGE_SIZE,
  loading = false,
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(pageSize)
  const [preview, setPreview] = useState(null)
  const timerRef = useRef(null)

  const candidates = useMemo(() => sortForCoverPicker(books, value), [books, value])

  // Never leave a timer running after unmount — it would set state on a gone
  // component and, worse, pop a preview over whatever replaced it.
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const openPreview = (book) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setPreview(book), PREVIEW_DELAY_MS)
  }

  const closePreview = () => {
    clearTimeout(timerRef.current)
    setPreview(null)
  }

  // Nothing to show and nothing coming — collapse entirely. While books are
  // still loading we keep the space instead, so the section doesn't pop into
  // existence and shove everything below it (the modal's buttons) down.
  if (candidates.length === 0 && !loading) return null

  const visible = candidates.slice(0, shown)
  const remaining = candidates.length - visible.length
  const selectedBook = candidates.find((b) => b.id === value)

  return (
    <div style={{ marginTop: 8, marginBottom: 8 }}>
      <label
        style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 10,
        }}
      >
        <LuImage size={14} /> {t('systemEditor.coverImage')}
      </label>

      {/* One tile's worth of height, held while the book list is in flight. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, minHeight: loading ? 80 : 0 }}>
        {visible.map((b) => (
          <div key={b.id} style={{ position: 'relative' }}>
            <button
              onClick={() => onChange(value === b.id ? null : b.id)}
              onMouseEnter={() => openPreview(b)}
              onMouseLeave={closePreview}
              onFocus={() => setPreview(b)}
              onBlur={closePreview}
              title={b.title}
              style={{
                padding: 0,
                border: `2px solid ${value === b.id ? 'var(--gold)' : 'var(--border)'}`,
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'none',
                width: 60,
                height: 80,
                flexShrink: 0,
                boxShadow: value === b.id ? '0 0 0 2px var(--gold-dim)' : 'none',
              }}
            >
              <LazyImg
                src={mediaUrl(`/books/${b.id}/thumbnail`)}
                alt={b.title}
                placeholder
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>

            {preview?.id === b.id && (
              <div
                role="tooltip"
                aria-label={b.title}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 8,
                  padding: 6,
                  borderRadius: 8,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 6px 24px var(--shadow)',
                  zIndex: 50,
                  pointerEvents: 'none',
                }}
              >
                <img
                  src={mediaUrl(`/books/${b.id}/thumbnail`)}
                  alt={b.title}
                  style={{ width: 220, height: 'auto', display: 'block', borderRadius: 4 }}
                />
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text)',
                    marginTop: 6,
                    maxWidth: 220,
                    textAlign: 'center',
                  }}
                >
                  {b.title}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <button
          onClick={() => setShown((n) => n + pageSize)}
          style={{
            marginTop: 10,
            padding: '6px 14px',
            borderRadius: 6,
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {t('systemEditor.loadMoreCovers', { count: remaining })}
        </button>
      )}

      {value && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
          {t('systemEditor.selected', { title: selectedBook?.title })}
          <button
            onClick={() => onChange(null)}
            style={{
              background: 'none',
              color: 'var(--text-muted)',
              fontSize: 13,
              marginLeft: 8,
              textDecoration: 'underline',
            }}
          >
            {t('systemEditor.clearCover')}
          </button>
        </div>
      )}
    </div>
  )
}
