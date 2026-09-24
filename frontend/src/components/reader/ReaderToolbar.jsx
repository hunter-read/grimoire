import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuChevronLeft,
  LuChevronRight,
  LuSearch,
  LuList,
  LuBookmark,
  LuBookmarkPlus,
  LuMinus,
  LuPlus,
  LuRotateCcw,
} from 'react-icons/lu'
import ReaderMoreMenu from './ReaderMoreMenu'

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

/** One button in the zoom cluster. Dimmed and inert at the clamp bounds. */
const zoomBtnStyle = (disabled, divider) => ({
  background: 'var(--bg-card)',
  color: disabled ? 'var(--text-muted)' : 'var(--text-dim)',
  border: 'none',
  borderRight: divider ? '1px solid var(--border)' : 'none',
  padding: '5px 10px',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.45 : 1,
  display: 'flex',
  alignItems: 'center',
})

export default function ReaderToolbar({
  book,
  bookId,
  mode,
  onModeChange,
  spreadOffset,
  onSpreadOffsetChange,
  currentPage,
  totalPages,
  step,
  hasRight,
  rightPage,
  pageInput,
  onPageInputChange,
  onPageInputCommit,
  panel,
  onTogglePanel,
  isMobilePhone,
  showShortcuts,
  onToggleShortcuts,
  onBack,
  isFavorite,
  onToggleFavorite,
  onBookmarkPage,
  onShowDetails,
  onFileChanged,
  zoom = 1,
  canZoomIn = false,
  canZoomOut = false,
  isZoomed = false,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}) {
  const { t } = useTranslation()

  const panels = [
    book.mime_type === 'application/pdf' && mode !== 'pdf'
      ? { key: 'toc', Icon: LuList, label: t('reader.contents') }
      : null,
    mode !== 'pdf' ? { key: 'bookmarks', Icon: LuBookmark, label: t('reader.bookmarks') } : null,
    book.indexed ? { key: 'search', Icon: LuSearch, label: t('common.search') } : null,
  ].filter(Boolean)

  // The kebab sits beside the title on a phone and at the end of the controls
  // on a desktop, so it is built once here and placed by whichever row wants it.
  const moreMenu = (
    <ReaderMoreMenu
      book={book}
      bookId={bookId}
      mode={mode}
      onModeChange={onModeChange}
      spreadOffset={spreadOffset}
      onSpreadOffsetChange={onSpreadOffsetChange}
      isMobilePhone={isMobilePhone}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      onShowDetails={onShowDetails}
      onToggleShortcuts={onToggleShortcuts}
      onFileChanged={onFileChanged}
    />
  )

  return (
    <>
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
        {/* Left zone — back and title, plus the kebab on a phone. It takes the
            leftover width and gives it up first, so the title ellipsizes before
            anything else is pushed off. On a phone this is the whole first row:
            the panel buttons and page navigation share the row below. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: '1 1 160px',
            minWidth: isMobilePhone ? '100%' : 160,
          }}
        >
          <button
            onClick={onBack}
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
              flexShrink: 0,
            }}
          >
            <LuArrowLeft size={15} /> {t('reader.back')}
          </button>

          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

          {/* minWidth: 0 is what lets the ellipsis actually happen — without
              it the span holds its full text width and shoves the controls on
              the right off the row. */}
          <span
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: 'var(--text)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {book.title}
          </span>

          {/* On a phone the kebab rides with the title rather than taking room
              on the controls row below. */}
          {isMobilePhone && <div style={{ marginLeft: 'auto' }}>{moreMenu}</div>}
        </div>

        {/* Centre zone — page navigation. On a phone it shares the second row
            with the panel buttons, sitting to their right; `order` puts it
            after the right zone so the two land side by side on that row. */}
        {mode !== 'pdf' && totalPages > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
              ...(isMobilePhone ? { order: 1, marginLeft: 'auto' } : null),
            }}
          >
            <button
              onClick={() => onPageInputCommit(currentPage - step)}
              disabled={currentPage <= 1}
              aria-label={t('reader.previousPage')}
              style={{ ...btnStyle, opacity: currentPage <= 1 ? 0.4 : 1 }}
            >
              <LuChevronLeft size={14} />
            </button>
            <input
              id="reader-page-input"
              type="text"
              value={pageInput}
              onChange={(e) => onPageInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onPageInputCommit(parseInt(pageInput) || 1)}
              onBlur={() => onPageInputCommit(parseInt(pageInput) || 1)}
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
              onClick={() => onPageInputCommit(currentPage + step)}
              disabled={currentPage >= totalPages}
              aria-label={t('reader.nextPage')}
              style={{ ...btnStyle, opacity: currentPage >= totalPages ? 0.4 : 1 }}
            >
              <LuChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Right zone — reading controls, and the overflow menu on a desktop.
            It must not shrink, or the title would squeeze the panel buttons out
            of view, which is the only way in to contents, bookmarks and details
            on a phone. On a phone it starts the second row, with the page
            navigation to its right. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: '0 0 auto',
            ...(isMobilePhone ? null : { marginLeft: 'auto', justifyContent: 'flex-end' }),
          }}
        >
          {/* Zoom cluster — the native PDF viewer has its own zoom, and the
            controls are dropped on phones where pinch-to-zoom already works. */}
          {mode !== 'pdf' && !isMobilePhone && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <button
                onClick={onZoomOut}
                disabled={!canZoomOut}
                title={t('reader.zoomOut')}
                aria-label={t('reader.zoomOut')}
                style={zoomBtnStyle(!canZoomOut, true)}
              >
                <LuMinus size={13} />
              </button>
              <span
                aria-live="polite"
                style={{
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  padding: '0 8px',
                  minWidth: 44,
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={onZoomIn}
                disabled={!canZoomIn}
                title={t('reader.zoomIn')}
                aria-label={t('reader.zoomIn')}
                style={zoomBtnStyle(!canZoomIn, true)}
              >
                <LuPlus size={13} />
              </button>
              {/* Always rendered, inert at the default zoom: mounting it on the
                first zoom would widen the cluster and slide the button out from
                under the cursor mid-click (#472). */}
              <button
                onClick={onResetZoom}
                disabled={!isZoomed}
                title={t('reader.zoomReset')}
                aria-label={t('reader.zoomReset')}
                style={zoomBtnStyle(!isZoomed, false)}
              >
                <LuRotateCcw size={13} />
              </button>
            </div>
          )}

          {/* Panel selector */}
          {panels.length > 0 && (
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
                  onClick={() => onTogglePanel(key)}
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
          )}

          {mode !== 'pdf' && (
            <button onClick={onBookmarkPage} title={t('reader.bookmarkPage')} style={btnStyle}>
              <LuBookmarkPlus size={14} />
            </button>
          )}

          {/* On a phone this has already been rendered beside the title. */}
          {!isMobilePhone && moreMenu}
        </div>
      </div>

      {showShortcuts && (
        <div
          onClick={onToggleShortcuts}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--shadow)',
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
              boxShadow: '0 8px 32px var(--shadow)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>
              {t('reader.keyboardShortcuts')}
            </div>
            {[
              ['←  /  →', t('reader.shortcutPrevNext')],
              ['↑  /  ↓', t('reader.shortcutPrevNextVertical')],
              ...(mode !== 'pdf'
                ? [
                    ['+  /  -', t('reader.shortcutZoom')],
                    ['0', t('reader.shortcutZoomReset')],
                  ]
                : []),
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
    </>
  )
}
