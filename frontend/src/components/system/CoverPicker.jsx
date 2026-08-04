import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImage } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import LazyImg from '../LazyImg'
import { sortForCoverPicker } from './coverPickerUtils'

// A system can have hundreds of books; showing every thumbnail at once is both
// slow and unusable, so start with a page and let the user ask for more.
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
 */
export default function CoverPicker({ books, value, onChange }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(PAGE_SIZE)
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

  if (candidates.length === 0) return null

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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
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
                  boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
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
          onClick={() => setShown((n) => n + PAGE_SIZE)}
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
