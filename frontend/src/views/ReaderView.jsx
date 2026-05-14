import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuChevronLeft,
  LuChevronRight,
  LuDownload,
  LuFileText,
  LuColumns2,
  LuFile,
  LuSearch,
  LuList,
  LuBookmark,
  LuBookmarkPlus,
  LuHeart,
  LuKeyboard,
} from 'react-icons/lu'
import api, { mediaUrl } from '../api'
import Spinner from '../components/Spinner'
import { getBookPrefs, saveBookPrefs, saveRecentBook } from '../hooks/useBookPrefs'
import { getUserPrefs } from '../hooks/useUserPrefs'
import { useFavorites } from '../context/FavoritesContext'
import useReaderGestures from '../hooks/useReaderGestures'
import TocSidebar from '../components/reader/TocSidebar'
import SearchSidebar from '../components/reader/SearchSidebar'
import BookmarkSidebar from '../components/reader/BookmarkSidebar'
import BookmarkDialog from '../components/reader/BookmarkDialog'
import SelectionPopup from '../components/reader/SelectionPopup'
import TextOverlay from '../components/reader/TextOverlay'
import AddToCampaignButton from '../components/campaigns/AddToCampaignButton'

// Inject page-turn keyframes once at module load
if (typeof document !== 'undefined' && !document.getElementById('reader-anim')) {
  const s = document.createElement('style')
  s.id = 'reader-anim'
  s.textContent = `
    @keyframes pageEnterRight  { from { opacity: 0.2; transform: translateX(60px);  } to { opacity: 1; transform: none; } }
    @keyframes pageEnterLeft   { from { opacity: 0.2; transform: translateX(-60px); } to { opacity: 1; transform: none; } }
    @keyframes pageEnterBottom { from { opacity: 0.2; transform: translateY(60px);  } to { opacity: 1; transform: none; } }
    @keyframes pageEnterTop    { from { opacity: 0.2; transform: translateY(-60px); } to { opacity: 1; transform: none; } }
  `
  document.head.appendChild(s)
}

// Must match across visible images and preloader so browser cache hits
const PAGE_WIDTH = 1600
const SPREAD_WIDTH = 1000

export default function ReaderView() {
  const { t } = useTranslation()
  const { bookId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const MODES = [
    { key: 'page', Icon: LuFileText, label: t('reader.page') },
    { key: 'spread', Icon: LuColumns2, label: t('reader.spread') },
    { key: 'pdf', Icon: LuFile, label: t('reader.pdf') },
  ]

  const _prefs = getBookPrefs(bookId)
  const _userPrefs = getUserPrefs()
  const initialPage = parseInt(searchParams.get('page')) || _prefs.page || 1
  const isMobilePhone = window.matchMedia('(max-width: 640px)').matches
  const _globalMode = ['page', 'spread', 'pdf'].includes(_userPrefs.readerMode)
    ? _userPrefs.readerMode
    : null
  const initialMode = isMobilePhone
    ? 'page'
    : ['page', 'spread', 'pdf'].includes(searchParams.get('view'))
      ? searchParams.get('view')
      : (_globalMode ?? (['page', 'spread', 'pdf'].includes(_prefs.mode) ? _prefs.mode : 'page'))

  const [book, setBook] = useState(null)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [totalPages, setTotalPages] = useState(0)
  const [mode, setMode] = useState(initialMode)
  const [pageInput, setPageInput] = useState(String(initialPage))
  const [panel, setPanel] = useState(null)
  const [activeSearchQuery, setActiveSearchQuery] = useState(null)
  const [activeHighlight, setActiveHighlight] = useState(null)
  const [bookmarkRefreshKey, setBookmarkRefreshKey] = useState(0)
  const [selectionPopup, setSelectionPopup] = useState(null)
  const [pendingBookmark, setPendingBookmark] = useState(null)
  const [pendingLabel, setPendingLabel] = useState('')
  const [pendingNotes, setPendingNotes] = useState('')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const { isFavorite, toggleFavorite } = useFavorites()

  const directionRef = useRef(1)
  const axisRef = useRef('x')
  const currentPageRef = useRef(1)
  const contentRef = useRef(null)
  const isMountedSyncRef = useRef(false)
  // When true, the next setSearchParams call will push a new history entry
  // rather than replacing the current one. Set before any jump navigation
  // (ToC, bookmarks) so the back button returns to the page before the jump.
  const pushNextRef = useRef(false)
  const preloadCacheRef = useRef({})
  const pageTextCacheRef = useRef({})
  const wordsCacheRef = useRef({})
  const [, setPageTextVersion] = useState(0)
  const [, setWordsVersion] = useState(0)

  useEffect(() => {
    api.get(`/books/${bookId}`).then((b) => {
      setBook(b)
      setTotalPages(b.page_count || 0)
      saveRecentBook(b)
    })
  }, [bookId])

  const goToPage = useCallback(
    (p, currentMode, axis = 'x') => {
      if (totalPages === 0) return
      let page = Math.max(1, Math.min(p, totalPages))
      if ((currentMode ?? mode) === 'spread' && page > 1 && page % 2 !== 0) {
        page = page - 1
      }
      directionRef.current = page >= currentPageRef.current ? 1 : -1
      axisRef.current = axis
      currentPageRef.current = page
      setCurrentPage(page)
      setPageInput(String(page))
    },
    [totalPages, mode]
  )

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSelectionPopup(null)
    saveBookPrefs(bookId, { page: currentPage })
  }, [currentPage, bookId])

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name))

  useEffect(() => {
    if (!book || mode === 'pdf') return
    const pages = [currentPage]
    if (mode === 'spread' && currentPage !== 1 && currentPage + 1 <= totalPages)
      pages.push(currentPage + 1)
    pages.forEach((p) => {
      if (pageTextCacheRef.current[p] !== undefined) return
      api
        .get(`/books/${bookId}/page/${p}/text`)
        .then((data) => {
          pageTextCacheRef.current[p] = data.text || ''
          setPageTextVersion((v) => v + 1)
        })
        .catch(() => {
          pageTextCacheRef.current[p] = ''
        })
    })
  }, [currentPage, mode, book, bookId, totalPages])

  useEffect(() => {
    if (!book || book.mime_type !== 'application/pdf' || mode === 'pdf') return
    const pages = [currentPage]
    if (mode === 'spread' && currentPage !== 1 && currentPage + 1 <= totalPages)
      pages.push(currentPage + 1)
    pages.forEach((p) => {
      if (wordsCacheRef.current[p] !== undefined) return
      wordsCacheRef.current[p] = null
      api
        .get(`/books/${bookId}/page/${p}/words`)
        .then((data) => {
          wordsCacheRef.current[p] = data
          setWordsVersion((v) => v + 1)
        })
        .catch(() => {
          wordsCacheRef.current[p] = null
        })
    })
  }, [currentPage, mode, book, bookId, totalPages])

  useEffect(() => {
    const onMouseUp = (e) => {
      if (e.target.closest('[data-bookmark-ui]')) return
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          if (!e.target.closest('[data-bookmark-ui]')) setSelectionPopup(null)
          return
        }
        if (!sel.anchorNode?.parentElement?.closest('[data-selectable]')) {
          setSelectionPopup(null)
          return
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        setSelectionPopup({
          x: rect.left + rect.width / 2,
          y: rect.top,
          text: sel.toString().trim(),
          page: currentPageRef.current,
        })
      }, 0)
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  const saveBookmark = () => {
    if (!pendingBookmark) return
    api
      .post('/bookmarks', {
        book_id: bookId,
        page_number: pendingBookmark.page,
        label: pendingLabel.trim(),
        notes: pendingNotes.trim(),
        selected_text: pendingBookmark.selectedText || null,
      })
      .then(() => {
        setBookmarkRefreshKey((k) => k + 1)
        setPendingBookmark(null)
        setPendingLabel('')
        setPendingNotes('')
        window.getSelection()?.removeAllRanges()
        setSelectionPopup(null)
      })
  }

  useEffect(() => {
    if (!book || mode === 'pdf') return
    const w = mode === 'spread' ? SPREAD_WIDTH : PAGE_WIDTH
    const forward = directionRef.current >= 0
    const ahead = mode === 'spread' ? 12 : 6
    const behind = mode === 'spread' ? 4 : 2
    const start = currentPage - (forward ? behind : ahead)
    const end = currentPage + (forward ? ahead : behind)
    const visible = new Set(mode === 'spread' ? [currentPage, currentPage + 1] : [currentPage])
    for (let p = start; p <= end; p++) {
      if (p < 1 || p > totalPages || visible.has(p)) continue
      const key = `${p}:${w}`
      if (!preloadCacheRef.current[key]) {
        const img = new Image()
        img.src = mediaUrl(`/books/${bookId}/page/${p}`, { width: w })
        preloadCacheRef.current[key] = img
      }
    }
  }, [currentPage, mode, book, bookId, totalPages])

  useEffect(() => {
    if (!isMountedSyncRef.current) {
      isMountedSyncRef.current = true
      return
    }
    const params = {}
    if (currentPage > 1) params.page = String(currentPage)
    if (mode !== 'page') params.view = mode
    const push = pushNextRef.current
    pushNextRef.current = false
    setSearchParams(params, { replace: !push })
  }, [currentPage, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode === 'spread') goToPage(currentPage, 'spread')
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = mode === 'spread' ? (currentPage === 1 ? 1 : 2) : 1
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (mode !== 'pdf') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          goToPage(currentPage - step, undefined, 'x')
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          goToPage(currentPage + step, undefined, 'x')
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          goToPage(currentPage - step, undefined, 'y')
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          goToPage(currentPage + step, undefined, 'y')
        }
      }
      if (e.key === 'f') toggleFavorite('book', bookId)
      if (e.key === 't') togglePanel('toc')
      if (e.key === 'b') togglePanel('bookmarks')
      if (e.key === 's') togglePanel('search')
      if (e.key === '?') setShowShortcuts((v) => !v)
      if (e.key === 'Escape') setShowShortcuts(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, currentPage, step, goToPage, bookId, toggleFavorite])

  const wheelNav = getUserPrefs().wheelNav !== false

  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useReaderGestures({
    mode,
    currentPage,
    zoom,
    pan,
    setZoom,
    setPan,
    goToPage,
    contentRef,
    wheelNav,
  })

  if (!book)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  if (book.mime_type?.startsWith('image/')) {
    return <ImageBookViewer book={book} bookId={bookId} />
  }

  const rightPage = currentPage + 1
  const hasRight = currentPage !== 1 && rightPage <= totalPages

  const getAlt = (p) => {
    const text = pageTextCacheRef.current[p]
    return text || `${t('reader.page')} ${p} — ${book.title}`
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
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
          onClick={() => navigate(-1)}
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
          <LuArrowLeft size={15} /> {t('reader.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {book.title}
        </span>

        {mode !== 'pdf' && totalPages > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => goToPage(currentPage - step)}
              disabled={currentPage <= 1}
              aria-label={t('reader.previousPage')}
              style={{ ...btnStyle, opacity: currentPage <= 1 ? 0.4 : 1 }}
            >
              <LuChevronLeft size={14} />
            </button>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && goToPage(parseInt(pageInput) || 1)}
              onBlur={() => goToPage(parseInt(pageInput) || 1)}
              aria-label={t('reader.currentPageNumber')}
              style={{ width: 50, textAlign: 'center', padding: '4px 6px', fontSize: 15 }}
            />
            {mode === 'spread' && hasRight && (
              <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>– {rightPage}</span>
            )}
            <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>
              {t('common.pageOf', { total: totalPages })}
            </span>
            <button
              onClick={() => goToPage(currentPage + step)}
              disabled={currentPage >= totalPages}
              aria-label={t('reader.nextPage')}
              style={{ ...btnStyle, opacity: currentPage >= totalPages ? 0.4 : 1 }}
            >
              <LuChevronRight size={14} />
            </button>
          </div>
        )}

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {/* Mode toggle — hidden on mobile phones, locked to page view */}
        <div
          style={{
            display: isMobilePhone ? 'none' : 'flex',
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {MODES.map(({ key, Icon, label }) => (
            <button
              key={key}
              onClick={() => {
                setMode(key)
                saveBookPrefs(bookId, { mode: key })
              }}
              title={label}
              style={{
                background: mode === key ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                color: mode === key ? 'var(--gold)' : 'var(--text-dim)',
                border: 'none',
                borderRight: key !== 'pdf' ? '1px solid var(--border)' : 'none',
                padding: '5px 12px',
                cursor: 'pointer',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* Panel selector */}
        {(() => {
          const panels = [
            book.mime_type === 'application/pdf' && mode !== 'pdf'
              ? { key: 'toc', Icon: LuList, label: t('reader.contents') }
              : null,
            mode !== 'pdf'
              ? { key: 'bookmarks', Icon: LuBookmark, label: t('reader.bookmarks') }
              : null,
            book.indexed ? { key: 'search', Icon: LuSearch, label: t('common.search') } : null,
          ].filter(Boolean)
          if (panels.length === 0) return null
          return (
            <div
              style={{
                display: 'flex',
                border: '1px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {panels.map(({ key, Icon, label }, idx) => (
                <button
                  key={key}
                  onClick={() => togglePanel(key)}
                  title={label}
                  style={{
                    background: panel === key ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                    color: panel === key ? 'var(--gold)' : 'var(--text-dim)',
                    border: 'none',
                    borderRight: idx < panels.length - 1 ? '1px solid var(--border)' : 'none',
                    padding: '5px 12px',
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Icon size={13} />
                  {!isMobilePhone && key !== 'search' && <span>{label}</span>}
                </button>
              ))}
            </div>
          )
        })()}

        <AddToCampaignButton resourceType="book" resourceId={bookId} />

        <button
          onClick={() => toggleFavorite('book', bookId)}
          title={
            isFavorite('book', bookId)
              ? t('reader.removeFromFavorites')
              : t('reader.addToFavorites')
          }
          style={{
            ...btnStyle,
            color: isFavorite('book', bookId) ? 'var(--gold)' : 'var(--text-muted)',
          }}
        >
          <LuHeart size={14} fill={isFavorite('book', bookId) ? 'var(--gold)' : 'none'} />
        </button>

        {mode !== 'pdf' && (
          <button
            onClick={() => {
              setPendingBookmark({ page: currentPage })
              setPendingLabel('')
            }}
            title={t('reader.bookmarkPage')}
            style={btnStyle}
          >
            <LuBookmarkPlus size={14} />
          </button>
        )}

        <a
          href={mediaUrl(`/books/${bookId}/file`)}
          download
          title={t('reader.downloadFile')}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LuDownload size={13} />
        </a>

        <button
          onClick={() => setShowShortcuts((v) => !v)}
          title="Keyboard shortcuts (?)"
          style={{ ...btnStyle, color: showShortcuts ? 'var(--gold)' : 'var(--text-muted)' }}
        >
          <LuKeyboard size={14} />
        </button>
      </div>

      {showShortcuts && (
        <div
          onClick={() => setShowShortcuts(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 24,
              minWidth: 280,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>
              {t('reader.keyboardShortcuts')}
            </div>
            {[
              ['←  /  →', t('reader.shortcutPrevNext')],
              ['↑  /  ↓', t('reader.shortcutPrevNextVertical')],
              ['f', t('reader.shortcutFavorite')],
              ['t', t('reader.shortcutToc')],
              ['b', t('reader.shortcutBookmarks')],
              ['s', t('reader.shortcutSearch')],
              ['?', t('reader.shortcutHelp')],
              ['Esc', t('reader.shortcutClose')],
            ].map(([key, desc]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 24,
                  padding: '5px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <kbd
                  style={{
                    fontFamily: 'monospace',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '1px 7px',
                    color: 'var(--gold)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {key}
                </kbd>
                <span style={{ color: 'var(--text-dim)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content + optional sidebar */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
        <div
          ref={contentRef}
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            background: 'var(--bg-deep)',
            touchAction: 'none',
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {mode === 'pdf' ? (
            <iframe
              src={mediaUrl(`/books/${bookId}/file`) + `#page=${currentPage}`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title={book.title}
            />
          ) : mode === 'spread' ? (
            <SpreadPage
              bookId={bookId}
              currentPage={currentPage}
              rightPage={rightPage}
              hasRight={hasRight}
              wordsCacheRef={wordsCacheRef}
              getAlt={getAlt}
              zoom={zoom}
              pan={pan}
              axisRef={axisRef}
              directionRef={directionRef}
              activeSearchQuery={activeSearchQuery}
              activeHighlight={activeHighlight}
            />
          ) : (
            <SinglePage
              bookId={bookId}
              currentPage={currentPage}
              wordsCacheRef={wordsCacheRef}
              getAlt={getAlt}
              zoom={zoom}
              pan={pan}
              axisRef={axisRef}
              directionRef={directionRef}
              activeSearchQuery={activeSearchQuery}
              activeHighlight={activeHighlight}
            />
          )}
        </div>

        {panel === 'toc' && (
          <TocSidebar
            bookId={bookId}
            currentPage={currentPage}
            onGoToPage={(page) => {
              pushNextRef.current = true
              goToPage(page)
            }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'search' && (
          <SearchSidebar
            bookId={bookId}
            onGoToPage={(page, q) => {
              setActiveSearchQuery(q || null)
              pushNextRef.current = true
              goToPage(page)
            }}
            onClose={() => {
              setActiveSearchQuery(null)
              setPanel(null)
            }}
          />
        )}
        {panel === 'bookmarks' && (
          <BookmarkSidebar
            bookId={bookId}
            currentPage={currentPage}
            refreshKey={bookmarkRefreshKey}
            onGoToPage={(page, text) => {
              setActiveHighlight(text || null)
              pushNextRef.current = true
              goToPage(page)
            }}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {selectionPopup && !pendingBookmark && (
        <SelectionPopup
          selectionPopup={selectionPopup}
          onBookmark={(page, text) => {
            setPendingBookmark({ page, selectedText: text })
            setPendingLabel('')
          }}
        />
      )}

      {pendingBookmark && (
        <BookmarkDialog
          pendingBookmark={pendingBookmark}
          pendingLabel={pendingLabel}
          pendingNotes={pendingNotes}
          onLabelChange={setPendingLabel}
          onNotesChange={setPendingNotes}
          onSave={saveBookmark}
          onClose={() => {
            setPendingBookmark(null)
            setPendingNotes('')
            setSelectionPopup(null)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page display sub-components (pure render, no hooks)
// ---------------------------------------------------------------------------

function animStyle(axisRef, directionRef, zoom, pan) {
  const axis = axisRef.current
  const dir = directionRef.current
  return {
    animation: `${
      axis === 'y'
        ? dir >= 0
          ? 'pageEnterBottom'
          : 'pageEnterTop'
        : dir >= 0
          ? 'pageEnterRight'
          : 'pageEnterLeft'
    } 0.25s cubic-bezier(0.22,1,0.36,1)`,
    transform: zoom !== 1 ? `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` : undefined,
    transformOrigin: 'center center',
  }
}

function SpreadPage({
  bookId,
  currentPage,
  rightPage,
  hasRight,
  wordsCacheRef,
  getAlt,
  zoom,
  pan,
  axisRef,
  directionRef,
  activeSearchQuery,
  activeHighlight,
}) {
  return (
    <div
      key={currentPage}
      style={{
        padding: 20,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'center',
        ...animStyle(axisRef, directionRef, zoom, pan),
      }}
    >
      {[currentPage, hasRight ? rightPage : null].filter(Boolean).map((p) => {
        const wd = wordsCacheRef.current[p]
        return wd ? (
          <div
            key={p}
            style={{
              position: 'relative',
              aspectRatio: `${wd.width} / ${wd.height}`,
              maxHeight: '100%',
              maxWidth: 'calc(50% - 6px)',
              lineHeight: 0,
            }}
          >
            <img
              src={mediaUrl(`/books/${bookId}/page/${p}`, { width: SPREAD_WIDTH })}
              alt={getAlt(p)}
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                borderRadius: 4,
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                userSelect: 'none',
              }}
            />
            <TextOverlay
              words={wd.words}
              naturalWidth={wd.width}
              naturalHeight={wd.height}
              highlightQuery={activeSearchQuery}
              highlightText={activeHighlight}
            />
          </div>
        ) : (
          <img
            key={p}
            src={mediaUrl(`/books/${bookId}/page/${p}`, { width: SPREAD_WIDTH })}
            alt={getAlt(p)}
            style={{
              maxHeight: '100%',
              maxWidth: 'calc(50% - 6px)',
              width: 'auto',
              display: 'block',
              borderRadius: 4,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          />
        )
      })}
    </div>
  )
}

function SinglePage({
  bookId,
  currentPage,
  wordsCacheRef,
  getAlt,
  zoom,
  pan,
  axisRef,
  directionRef,
  activeSearchQuery,
  activeHighlight,
}) {
  const wd = wordsCacheRef.current[currentPage]
  return (
    <div
      key={currentPage}
      style={{
        padding: 20,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...animStyle(axisRef, directionRef, zoom, pan),
      }}
    >
      {wd ? (
        <div
          style={{
            position: 'relative',
            aspectRatio: `${wd.width} / ${wd.height}`,
            maxHeight: '100%',
            maxWidth: '100%',
            lineHeight: 0,
          }}
        >
          <img
            src={mediaUrl(`/books/${bookId}/page/${currentPage}`, { width: PAGE_WIDTH })}
            alt={getAlt(currentPage)}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              borderRadius: 4,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              userSelect: 'none',
            }}
          />
          <TextOverlay
            words={wd.words}
            naturalWidth={wd.width}
            naturalHeight={wd.height}
            highlightQuery={activeSearchQuery}
            highlightText={activeHighlight}
          />
        </div>
      ) : (
        <img
          src={mediaUrl(`/books/${bookId}/page/${currentPage}`, { width: PAGE_WIDTH })}
          alt={getAlt(currentPage)}
          style={{
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto',
            borderRadius: 4,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        />
      )}
    </div>
  )
}

function ImageBookViewer({ book, bookId }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isFavorite, toggleFavorite } = useFavorites()

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
          onClick={() => navigate(-1)}
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
          <LuArrowLeft size={15} /> {t('reader.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {book.title}
        </span>
        <button
          onClick={() => toggleFavorite('book', bookId)}
          title={
            isFavorite('book', bookId) ? t('reader.removeFromFavorites') : t('reader.addToFavorites')
          }
          style={{
            ...btnStyle,
            color: isFavorite('book', bookId) ? 'var(--gold)' : 'var(--text-muted)',
          }}
        >
          <LuHeart size={14} fill={isFavorite('book', bookId) ? 'var(--gold)' : 'none'} />
        </button>
        <AddToCampaignButton resourceType="book" resourceId={bookId} />
        <a
          href={mediaUrl(`/books/${bookId}/file`)}
          download
          title={t('reader.downloadFile')}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LuDownload size={13} />
        </a>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-deep)',
          padding: 20,
        }}
      >
        <img
          src={mediaUrl(`/books/${bookId}/file`)}
          alt={book.title}
          style={{
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto',
            borderRadius: 4,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        />
      </div>
    </div>
  )
}

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
