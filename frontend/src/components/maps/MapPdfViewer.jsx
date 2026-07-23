import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuChevronLeft,
  LuChevronRight,
  LuFileText,
  LuColumns2,
  LuFile,
  LuPanelLeft,
} from 'react-icons/lu'
import { mediaUrl } from '../../api'
import useReaderGestures from '../../hooks/useReaderGestures'
import { getUserPrefs } from '../../hooks/useUserPrefs'
import { getBookPrefs, saveBookPrefs } from '../../hooks/useBookPrefs'
import SinglePage from '../reader/SinglePage'
import SpreadPage from '../reader/SpreadPage'
import { PAGE_WIDTH, SPREAD_WIDTH } from '../reader/pageRender'

const MODES = [
  { key: 'page', Icon: LuFileText },
  { key: 'spread', Icon: LuColumns2 },
  { key: 'pdf', Icon: LuFile },
]

// Inject the page-turn keyframes the reader page components rely on (the reader
// registers these too, but a map PDF may be opened without ever mounting it).
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

const toolbarBtn = (active) => ({
  background: active ? 'var(--bg-card-hover)' : 'var(--bg-card)',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  border: 'none',
  padding: '5px 12px',
  cursor: 'pointer',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
})

const stepBtn = {
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
 * PDF map viewer with the same single / spread / raw-PDF modes as the book
 * reader, but without the text-highlight overlay. `mapId` identifies the map,
 * `filename` is used for the raw-PDF iframe title, and `totalPages` is the PDF
 * page count.
 */
export default function MapPdfViewer({ mapId, filename, totalPages, isMobilePhone }) {
  const { t } = useTranslation()

  const _prefs = getBookPrefs(`map:${mapId}`)
  const _userPrefs = getUserPrefs()
  const _globalMode = ['page', 'spread', 'pdf'].includes(_userPrefs.readerMode)
    ? _userPrefs.readerMode
    : null
  const initialMode = isMobilePhone
    ? 'page'
    : (_globalMode ?? (['page', 'spread', 'pdf'].includes(_prefs.mode) ? _prefs.mode : 'page'))
  const initialSpreadOffset = _prefs.spreadOffset ?? 0

  const [mode, setMode] = useState(initialMode)
  const [spreadOffset, setSpreadOffset] = useState(initialSpreadOffset)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const directionRef = useRef(1)
  const axisRef = useRef('x')
  const currentPageRef = useRef(1)
  const contentRef = useRef(null)
  const preloadCacheRef = useRef({})

  const pageUrl = useCallback(
    (p, width) => mediaUrl(`/maps/${mapId}/page/${p}`, { width }),
    [mapId]
  )

  const goToPage = useCallback(
    (p, currentMode, axis = 'x') => {
      if (totalPages === 0) return
      let page = Math.max(1, Math.min(p, totalPages))
      if ((currentMode ?? mode) === 'spread') {
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

  // Reset zoom/pan when the page changes.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [currentPage])

  // Re-snap the current page to a valid left page when spread settings change.
  useEffect(() => {
    if (mode === 'spread') goToPage(currentPageRef.current, 'spread')
  }, [mode, spreadOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  // Preload neighbouring pages for snappy navigation.
  useEffect(() => {
    if (mode === 'pdf') return
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
        img.src = pageUrl(p, w)
        preloadCacheRef.current[key] = img
      }
    }
  }, [currentPage, mode, totalPages, pageUrl])

  const step = mode === 'spread' ? 2 : 1

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (mode === 'pdf') return
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
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, currentPage, step, goToPage])

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

  const rightPage = currentPage + 1
  const hasRight =
    mode === 'spread' && (spreadOffset === 1 || currentPage !== 1) && rightPage <= totalPages

  const getAlt = (p) => `${t('reader.page')} ${p} — ${filename}`

  const changeMode = (key) => {
    setMode(key)
    saveBookPrefs(`map:${mapId}`, { mode: key })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Sub-toolbar: page nav + mode toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        {mode !== 'pdf' && totalPages > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => goToPage(currentPage - step)}
              disabled={currentPage <= 1}
              aria-label={t('reader.previousPage')}
              style={{ ...stepBtn, opacity: currentPage <= 1 ? 0.4 : 1 }}
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
              style={{ ...stepBtn, opacity: currentPage >= totalPages ? 0.4 : 1 }}
            >
              <LuChevronRight size={14} />
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Mode toggle — hidden on mobile phones (forced to single page) */}
        <div
          style={{
            display: isMobilePhone ? 'none' : 'flex',
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {MODES.map(({ key, Icon }) => (
            <button
              key={key}
              onClick={() => changeMode(key)}
              title={t(`reader.${key}`)}
              style={{
                ...toolbarBtn(mode === key),
                borderRight: key !== 'pdf' ? '1px solid var(--border)' : 'none',
              }}
            >
              <Icon size={13} /> {t(`reader.${key}`)}
            </button>
          ))}
        </div>

        {/* Spread offset toggle — only in spread mode */}
        {mode === 'spread' && !isMobilePhone && (
          <button
            onClick={() => {
              const next = spreadOffset === 0 ? 1 : 0
              setSpreadOffset(next)
              saveBookPrefs(`map:${mapId}`, { spreadOffset: next })
            }}
            title={
              spreadOffset === 0 ? t('reader.spreadIncludeCover') : t('reader.spreadExcludeCover')
            }
            style={{
              ...toolbarBtn(spreadOffset === 1),
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <LuPanelLeft size={13} /> {t('reader.spreadCover')}
          </button>
        )}
      </div>

      {/* Page content */}
      <div
        ref={contentRef}
        style={{
          flex: 1,
          minHeight: 0,
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
            src={mediaUrl(`/maps/${mapId}/file`) + `#page=${currentPage}`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title={filename}
          />
        ) : mode === 'spread' ? (
          <SpreadPage
            currentPage={currentPage}
            rightPage={rightPage}
            hasRight={hasRight}
            getAlt={getAlt}
            zoom={zoom}
            pan={pan}
            axisRef={axisRef}
            directionRef={directionRef}
            pageUrl={pageUrl}
          />
        ) : (
          <SinglePage
            currentPage={currentPage}
            getAlt={getAlt}
            zoom={zoom}
            pan={pan}
            axisRef={axisRef}
            directionRef={directionRef}
            pageUrl={pageUrl}
          />
        )}
      </div>
    </div>
  )
}
