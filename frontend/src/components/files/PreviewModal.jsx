import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuChevronLeft, LuChevronRight, LuTriangleAlert } from 'react-icons/lu'
import { mediaUrl, bookPageUrl } from '../../api'
import Spinner from '../Spinner'

// Rendered page width for a book preview. Deliberately small: this is a "is this
// the book I think it is" glance, not the reader, and a narrow render is both
// faster to produce server-side and cheaper to keep around.
const PREVIEW_WIDTH = 700

// How many rendered pages to hold at once. Page images are large, and a preview
// is a short-lived look at a handful of pages — keeping every page visited would
// grow without bound in a session spent checking a lot of books. Neighbours are
// prefetched, so this comfortably covers the pages a reader is moving between.
const PAGE_CACHE_LIMIT = 8

/**
 * Quick-look preview for a single library item (book, map, token, or audio).
 *
 * Deliberately *not* the reader or the detail page. Reorganising a library means
 * repeatedly asking "which book is this file?", and answering it by navigating
 * away to the reader loses the place in the tree that the question came from.
 * So this shows the item where it is, over the file manager, and closes back to
 * exactly the same view.
 *
 * For books that means page images only — no extracted text, no search, no
 * bookmarks — with page navigation, since the cover alone often is not enough to
 * tell two printings apart.
 *
 * Props:
 *   type     – 'book' | 'map' | 'token' | 'audio'
 *   item     – the full record from files.record()
 *   onClose  – () => void
 */
export default function PreviewModal({ type, item, onClose }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  // Rendered page URLs already fetched this session, so paging back and forth
  // does not re-request. Bounded by PAGE_CACHE_LIMIT and dropped entirely when
  // the modal closes — the short-lived cache the preview needs, rather than a
  // second long-lived store next to the reader's.
  const cache = useRef(new Map())

  const pageCount = item?.page_count || 0
  const isBook = type === 'book'

  const urlFor = useCallback(
    (p) => {
      const cached = cache.current.get(p)
      if (cached) return cached
      const url = bookPageUrl(item.id, p, PREVIEW_WIDTH, item.content_token)
      cache.current.set(p, url)
      // Map preserves insertion order, so the oldest key is the first one.
      if (cache.current.size > PAGE_CACHE_LIMIT) {
        cache.current.delete(cache.current.keys().next().value)
      }
      return url
    },
    [item]
  )

  const go = useCallback(
    (delta) => {
      if (!isBook) return
      setPage((p) => {
        const next = p + delta
        if (next < 1 || (pageCount && next > pageCount)) return p
        setLoading(true)
        setFailed(false)
        return next
      })
    },
    [isBook, pageCount]
  )

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, go])

  // Warm the next page while the current one is being looked at, so paging
  // forward — much the commonest direction — is usually instant.
  useEffect(() => {
    if (!isBook || !pageCount || page >= pageCount) return
    const img = new Image()
    img.src = urlFor(page + 1)
  }, [isBook, page, pageCount, urlFor])

  const title = item?.title || item?.name || item?.filename || ''

  const body = () => {
    if (isBook) {
      if (!pageCount) {
        return (
          <div style={emptyStyle}>
            <LuTriangleAlert size={16} /> {t('files.previewNoPages')}
          </div>
        )
      }
      return (
        <>
          {loading && !failed && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <Spinner size={22} />
            </div>
          )}
          {failed ? (
            <div style={emptyStyle}>
              <LuTriangleAlert size={16} /> {t('files.previewFailed')}
            </div>
          ) : (
            <img
              key={page}
              src={urlFor(page)}
              alt={t('files.previewPageAlt', { page })}
              data-testid="preview-page"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false)
                setFailed(true)
              }}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                display: 'block',
                margin: '0 auto',
              }}
            />
          )}
        </>
      )
    }

    if (type === 'audio') {
      return (
        <audio
          controls
          autoPlay={false}
          src={mediaUrl(`/audio/${item.id}/file`)}
          data-testid="preview-audio"
          style={{ width: '100%', maxWidth: 520 }}
        />
      )
    }

    // Maps and tokens are single images served whole.
    return failed ? (
      <div style={emptyStyle}>
        <LuTriangleAlert size={16} /> {t('files.previewFailed')}
      </div>
    ) : (
      <img
        src={mediaUrl(`/${type}s/${item.id}/file`)}
        alt={title}
        data-testid="preview-image"
        onError={() => setFailed(true)}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          display: 'block',
          margin: '0 auto',
        }}
      />
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('files.previewTitle', { name: title })}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          width: 880,
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            data-testid="close-preview"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
          >
            <LuX size={17} />
          </button>
        </div>

        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 240,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflow: 'auto',
            background: 'var(--bg-deep)',
          }}
        >
          {body()}
        </div>

        {isBook && pageCount > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              padding: '10px 16px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => go(-1)}
              disabled={page <= 1}
              aria-label={t('files.previewPrev')}
              data-testid="preview-prev"
              style={{ ...navBtn, opacity: page <= 1 ? 0.4 : 1 }}
            >
              <LuChevronLeft size={15} />
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {t('files.previewPageOf', { page, total: pageCount })}
            </span>
            <button
              onClick={() => go(1)}
              disabled={page >= pageCount}
              aria-label={t('files.previewNext')}
              data-testid="preview-next"
              style={{ ...navBtn, opacity: page >= pageCount ? 0.4 : 1 }}
            >
              <LuChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const navBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  cursor: 'pointer',
}

const emptyStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--text-muted)',
  fontSize: 13,
  padding: 24,
}
