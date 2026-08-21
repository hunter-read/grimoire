import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuHeart } from 'react-icons/lu'
import api, { bookPageUrl, mediaUrl } from '../api'
import { isArchiveBook } from '../constants'
import Spinner from '../components/Spinner'
import { getBookPrefs, saveBookPrefs, saveRecentBook } from '../hooks/useBookPrefs'
import { getUserPrefs, getWheelAction } from '../hooks/useUserPrefs'
import { useFavorites } from '../context/FavoritesContext'
import useReaderGestures from '../hooks/useReaderGestures'
import useReaderZoom, { renderWidthFor } from '../hooks/useReaderZoom'
import useIsMobile from '../hooks/useIsMobile'
import TocSidebar from '../components/reader/TocSidebar'
import SearchSidebar from '../components/reader/SearchSidebar'
import BookmarkSidebar from '../components/reader/BookmarkSidebar'
import DetailsSidebar from '../components/reader/DetailsSidebar'
import BookmarkDialog from '../components/reader/BookmarkDialog'
import SelectionPopup from '../components/reader/SelectionPopup'
import ReaderToolbar from '../components/reader/ReaderToolbar'
import SpreadPage from '../components/reader/SpreadPage'
import SinglePage from '../components/reader/SinglePage'
import ImageBookViewer from '../components/reader/ImageBookViewer'
import {
  PAGE_WIDTH,
  PRELOAD_CACHE_MAX,
  SPREAD_WIDTH,
  TEXT_CACHE_MAX,
  pruneCache,
} from '../components/reader/pageRender'

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

export default function ReaderView() {
  const { t } = useTranslation()
  const { bookId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // Capture the referring path on mount so the back button always exits the reader in one click,
  // regardless of how many jump-navigation history entries were pushed (ToC, bookmarks, search).
  const backPathRef = useRef(location.state?.from ?? null)

  // Exiting the reader is a *return* to the referring view, not a fresh visit, so
  // flag it: views that persist transient state (in-system search, sort/filter)
  // restore it only when this flag is present. Falling back to history.back()
  // preserves that state implicitly, since the entry is still on the stack.
  const goBack = () =>
    backPathRef.current
      ? navigate(backPathRef.current, { state: { restoreView: true } })
      : navigate(-1)

  const _prefs = getBookPrefs(bookId)
  const _userPrefs = getUserPrefs()
  const initialPage = parseInt(searchParams.get('page')) || _prefs.page || 1
  const isMobilePhone = useIsMobile(640)
  const _globalMode = ['page', 'spread', 'pdf'].includes(_userPrefs.readerMode)
    ? _userPrefs.readerMode
    : null
  const initialMode = isMobilePhone
    ? 'page'
    : ['page', 'spread', 'pdf'].includes(searchParams.get('view'))
      ? searchParams.get('view')
      : (_globalMode ?? (['page', 'spread', 'pdf'].includes(_prefs.mode) ? _prefs.mode : 'page'))

  const initialSpreadOffset = _prefs.spreadOffset ?? 0

  const [book, setBook] = useState(null)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [totalPages, setTotalPages] = useState(0)
  const [mode, setMode] = useState(initialMode)
  const [spreadOffset, setSpreadOffset] = useState(initialSpreadOffset)
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
      if ((currentMode ?? mode) === 'spread') {
        // Snap to the nearest left page based on spreadOffset.
        // offset=0: left pages are even (2,4,6…), page 1 stands alone.
        // offset=1: left pages are odd (1,3,5…), cover is part of a spread.
        const isLeftPage = spreadOffset === 1 ? page % 2 !== 0 : page % 2 === 0 || page === 1
        if (!isLeftPage) page = page - 1
      }
      directionRef.current = page >= currentPageRef.current ? 1 : -1
      axisRef.current = axis
      currentPageRef.current = page
      setCurrentPage(page)
      setPageInput(String(page))
    },
    [totalPages, mode, spreadOffset]
  )

  // Zoom/pan for the page image. Keyed on currentPage so both reset when you
  // turn the page — landing on a new page zoomed into a corner is disorienting.
  const {
    zoom,
    pan,
    setPan,
    setZoomDirect,
    zoomRef,
    panRef,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomAt,
    canZoomIn,
    canZoomOut,
    isZoomed,
  } = useReaderZoom({ resetKey: currentPage })

  useEffect(() => {
    setSelectionPopup(null)
    saveBookPrefs(bookId, { page: currentPage })
  }, [currentPage, bookId])

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name))

  useEffect(() => {
    if (!book || mode === 'pdf') return
    const pages = [currentPage]
    if (
      mode === 'spread' &&
      (spreadOffset === 1 || currentPage !== 1) &&
      currentPage + 1 <= totalPages
    )
      pages.push(currentPage + 1)
    pages.forEach((p) => {
      if (pageTextCacheRef.current[p] !== undefined) return
      api
        .get(`/books/${bookId}/page/${p}/text`)
        .then((data) => {
          pageTextCacheRef.current[p] = data.text || ''
          pruneCache(pageTextCacheRef, TEXT_CACHE_MAX)
          setPageTextVersion((v) => v + 1)
        })
        .catch(() => {
          pageTextCacheRef.current[p] = ''
          pruneCache(pageTextCacheRef, TEXT_CACHE_MAX)
        })
    })
  }, [currentPage, mode, spreadOffset, book, bookId, totalPages])

  useEffect(() => {
    if (!book || book.mime_type !== 'application/pdf' || mode === 'pdf') return
    const pages = [currentPage]
    if (
      mode === 'spread' &&
      (spreadOffset === 1 || currentPage !== 1) &&
      currentPage + 1 <= totalPages
    )
      pages.push(currentPage + 1)
    pages.forEach((p) => {
      if (wordsCacheRef.current[p] !== undefined) return
      wordsCacheRef.current[p] = null
      api
        .get(`/books/${bookId}/page/${p}/words`)
        .then((data) => {
          wordsCacheRef.current[p] = data
          pruneCache(wordsCacheRef, TEXT_CACHE_MAX)
          setWordsVersion((v) => v + 1)
        })
        .catch(() => {
          wordsCacheRef.current[p] = null
          pruneCache(wordsCacheRef, TEXT_CACHE_MAX)
        })
    })
  }, [currentPage, mode, spreadOffset, book, bookId, totalPages])

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

  // Page URLs carry the book's content token so that replacing the PDF on disk
  // busts the browser's (year-long, immutable) cache of the previous renders.
  const contentToken = book?.content_token
  const pageUrl = useCallback(
    (p, width) => bookPageUrl(bookId, p, width, contentToken),
    [bookId, contentToken]
  )

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
        img.src = bookPageUrl(bookId, p, w, contentToken)
        preloadCacheRef.current[key] = img
      }
    }
    // Drop the oldest decoded bitmaps so a long flip-through doesn't pin every
    // page it passed in memory (each is ~12MB decoded, WebP size notwithstanding).
    pruneCache(preloadCacheRef, PRELOAD_CACHE_MAX)
  }, [currentPage, mode, book, bookId, totalPages, contentToken])

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

  useEffect(() => {
    if (mode === 'spread') goToPage(currentPage, 'spread')
  }, [spreadOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = mode === 'spread' ? 2 : 1
  useEffect(() => {
    const handleKeyDown = (e) => {
      const el = e.target
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
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
      // Zoom shortcuts. Deliberately non-letter keys — the reader already binds
      // bare f/t/b/s. The native PDF viewer has its own zoom, so skip them there.
      if (mode !== 'pdf') {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          zoomIn()
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          zoomOut()
        }
        if (e.key === '0') {
          e.preventDefault()
          resetZoom()
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
  }, [mode, currentPage, step, goToPage, bookId, toggleFavorite, zoomIn, zoomOut, resetZoom])

  // Page images are pre-rendered WebP, so scaling them up in CSS softens the
  // text. Past the threshold, re-request the page at a higher render width and
  // let the browser swap it in — the CSS transform covers the intervening
  // frames, so zooming stays smooth while the sharper image loads.
  const baseWidth = mode === 'spread' ? SPREAD_WIDTH : PAGE_WIDTH
  const renderWidth = renderWidthFor(baseWidth, zoom)

  const wheelAction = getWheelAction()

  const { handleTouchStart, handleTouchMove, handleTouchEnd, handleMouseDown } = useReaderGestures({
    mode,
    currentPage,
    zoom,
    pan,
    zoomRef,
    panRef,
    setPan,
    setZoomDirect,
    zoomAt,
    goToPage,
    contentRef,
    wheelAction,
  })

  if (!book)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  if (book.mime_type?.startsWith('image/')) {
    return <ImageBookViewer book={book} bookId={bookId} backPath={backPathRef.current} />
  }

  // Archives have no page reader — offer a download instead of a broken viewer.
  if (isArchiveBook(book)) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <button
          onClick={goBack}
          aria-label={t('common.back')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 24,
          }}
        >
          <LuArrowLeft size={16} aria-hidden="true" /> {t('common.back')}
        </button>
        <h2 style={{ marginBottom: 8 }}>{book.title}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          {t('reader.archiveNotViewable')}
        </p>
        <a
          href={mediaUrl(`/books/${bookId}/file`)}
          download={book.filename || ''}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 8,
            background: 'var(--gold)',
            color: 'var(--bg-deep)',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          <LuDownload size={16} aria-hidden="true" /> {t('common.download')}
        </a>
      </div>
    )
  }

  const rightPage = currentPage + 1
  // With offset=0: page 1 stands alone; with offset=1, page 1 pairs with page 2.
  const hasRight =
    mode === 'spread' && (spreadOffset === 1 || currentPage !== 1) && rightPage <= totalPages

  const getAlt = (p) => {
    const text = pageTextCacheRef.current[p]
    return text || `${t('reader.page')} ${p} — ${book.title}`
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ReaderToolbar
        book={book}
        bookId={bookId}
        mode={mode}
        onModeChange={(key) => {
          setMode(key)
          saveBookPrefs(bookId, { mode: key })
        }}
        spreadOffset={spreadOffset}
        onSpreadOffsetChange={(next) => {
          setSpreadOffset(next)
          saveBookPrefs(bookId, { spreadOffset: next })
        }}
        currentPage={currentPage}
        totalPages={totalPages}
        step={step}
        hasRight={hasRight}
        rightPage={rightPage}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onPageInputCommit={goToPage}
        panel={panel}
        onTogglePanel={togglePanel}
        isMobilePhone={isMobilePhone}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts((v) => !v)}
        onBack={goBack}
        isFavorite={isFavorite('book', bookId)}
        onToggleFavorite={() => toggleFavorite('book', bookId)}
        onBookmarkPage={() => {
          setPendingBookmark({ page: currentPage })
          setPendingLabel('')
        }}
        onShowDetails={() => setPanel('details')}
        onFileChanged={({ action }) => {
          // A deleted book has nothing left to render, and a moved one is served
          // from a path this view already resolved, so both leave the reader.
          // A rename is safe to stay on: the record — and so every page URL,
          // which is keyed by id — is unchanged.
          if (action === 'delete' || action === 'move') goBack()
        }}
        zoom={zoom}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        isZoomed={isZoomed}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
      />

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
          onMouseDown={handleMouseDown}
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
              renderWidth={renderWidth}
              pageUrl={pageUrl}
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
              renderWidth={renderWidth}
              pageUrl={pageUrl}
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
        {panel === 'details' && (
          <DetailsSidebar
            book={book}
            onSave={(updated) => setBook(updated)}
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
