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
  LuPanelLeft,
  LuMinus,
  LuPlus,
  LuRotateCcw,
} from 'react-icons/lu'
import { mediaUrl } from '../../api'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'

export const MODES = [
  { key: 'page', Icon: LuFileText },
  { key: 'spread', Icon: LuColumns2 },
  { key: 'pdf', Icon: LuFile },
]

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

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {/* Mode toggle — hidden on mobile phones */}
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
              onClick={() => onModeChange(key)}
              title={t(`reader.${key}`)}
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
              <Icon size={13} /> {t(`reader.${key}`)}
            </button>
          ))}
        </div>

        {/* Spread offset toggle — only in spread mode */}
        {mode === 'spread' && !isMobilePhone && (
          <button
            onClick={() => onSpreadOffsetChange(spreadOffset === 0 ? 1 : 0)}
            title={
              spreadOffset === 0 ? t('reader.spreadIncludeCover') : t('reader.spreadExcludeCover')
            }
            style={{
              background: spreadOffset === 1 ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              color: spreadOffset === 1 ? 'var(--gold)' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 12px',
              cursor: 'pointer',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <LuPanelLeft size={13} /> {t('reader.spreadCover')}
          </button>
        )}

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
              style={zoomBtnStyle(!canZoomIn, isZoomed)}
            >
              <LuPlus size={13} />
            </button>
            {isZoomed && (
              <button
                onClick={onResetZoom}
                title={t('reader.zoomReset')}
                aria-label={t('reader.zoomReset')}
                style={zoomBtnStyle(false, false)}
              >
                <LuRotateCcw size={13} />
              </button>
            )}
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

        <AddToCampaignButton resourceType="book" resourceId={bookId} />

        <button
          onClick={onToggleFavorite}
          title={isFavorite ? t('reader.removeFromFavorites') : t('reader.addToFavorites')}
          style={{ ...btnStyle, color: isFavorite ? 'var(--gold)' : 'var(--text-muted)' }}
        >
          <LuHeart size={14} fill={isFavorite ? 'var(--gold)' : 'none'} />
        </button>

        {mode !== 'pdf' && (
          <button onClick={onBookmarkPage} title={t('reader.bookmarkPage')} style={btnStyle}>
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
          onClick={onToggleShortcuts}
          title="Keyboard shortcuts (?)"
          style={{ ...btnStyle, color: showShortcuts ? 'var(--gold)' : 'var(--text-muted)' }}
        >
          <LuKeyboard size={14} />
        </button>
      </div>

      {showShortcuts && (
        <div
          onClick={onToggleShortcuts}
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
