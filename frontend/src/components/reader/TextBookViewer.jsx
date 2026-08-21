import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuHeart } from 'react-icons/lu'
import api, { mediaUrl } from '../../api'
import { useFavorites } from '../../context/FavoritesContext'
import Spinner from '../Spinner'

const btnStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 4,
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
}

/**
 * Viewer for plain-text books — .txt, .md, .rtf (issue #200).
 *
 * These have no rendered pages, so instead of requesting page images we fetch
 * the backend's synthetic pages as text and render them in a readable column.
 * Pagination matches what the indexer wrote into the search index, so a search
 * result pointing at page 3 lands on the same page shown here.
 */
export default function TextBookViewer({ book, bookId, backPath }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isFavorite, toggleFavorite } = useFavorites()
  const totalPages = book?.page_count || 1
  const [page, setPage] = useState(1)
  const [text, setText] = useState(null)
  const [failed, setFailed] = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setFailed(false)
    api
      .get(`/books/${bookId}/page/${page}/text`)
      .then((data) => {
        if (cancelled) return
        setText(data.text || '')
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [bookId, page])

  // Start each page at the top; otherwise paging forward leaves the reader
  // halfway down the previous page's scroll position. Assigning scrollTop
  // rather than calling scrollTo() keeps this working in environments that do
  // not implement the method (jsdom, older browsers).
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [page])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input, textarea')) return
      if (e.key === 'ArrowRight') setPage((p) => Math.min(p + 1, totalPages))
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(p - 1, 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [totalPages])

  const fav = isFavorite('book', bookId)

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => (backPath ? navigate(backPath) : navigate(-1))}
          aria-label={t('reader.back')}
          style={{
            background: 'none',
            color: 'var(--text-dim)',
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <LuArrowLeft size={16} aria-hidden="true" /> {t('reader.back')}
        </button>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{book.title}</span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              aria-label={t('reader.previousPage')}
              style={{ ...btnStyle, opacity: page <= 1 ? 0.5 : 1 }}
            >
              ‹
            </button>
            <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              aria-label={t('reader.nextPage')}
              style={{ ...btnStyle, opacity: page >= totalPages ? 0.5 : 1 }}
            >
              ›
            </button>
          </div>
        )}
        <button
          onClick={() => toggleFavorite('book', bookId)}
          aria-label={fav ? t('reader.removeFromFavorites') : t('reader.addToFavorites')}
          style={btnStyle}
        >
          <LuHeart size={16} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
        <a
          href={mediaUrl(`/books/${bookId}/file`)}
          download={book.filename || ''}
          aria-label={t('reader.downloadFile')}
          style={{ ...btnStyle, textDecoration: 'none' }}
        >
          <LuDownload size={16} aria-hidden="true" />
        </a>
      </div>

      <div ref={contentRef} style={{ flex: 1, overflow: 'auto', padding: '32px 20px' }}>
        {text === null && !failed ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spinner size={28} />
          </div>
        ) : (
          <pre
            data-selectable
            style={{
              maxWidth: 760,
              margin: '0 auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-body, system-ui), sans-serif',
              fontSize: 16,
              lineHeight: 1.7,
              color: 'var(--text)',
            }}
          >
            {failed ? t('reader.textUnavailable') : text}
          </pre>
        )}
      </div>
    </div>
  )
}
