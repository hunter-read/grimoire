import { useTranslation } from 'react-i18next'
import { LuX, LuListChecks, LuSearch, LuHeart } from 'react-icons/lu'
import ViewModeToggle from '../ViewModeToggle'

const toolBtnStyle = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}

/**
 * Header controls for a media gallery: filter input, collapse/expand-all,
 * bulk-select toggle, view-mode toggle, and favorites-only toggle.
 * Shared by the maps and tokens views via `config` (mediaConfig.js).
 */
export default function GalleryToolbar({
  config,
  filter,
  onFilter,
  bulkMode,
  onToggleBulk,
  showBulk,
  collapseDisabled,
  expandDisabled,
  onCollapseAll,
  onExpandAll,
  viewMode,
  onCycleViewMode,
  favOnly,
  onToggleFavOnly,
}) {
  const { t } = useTranslation()
  const { i18n } = config

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        minWidth: 0,
      }}
    >
      {!bulkMode && (
        <div style={{ position: 'relative' }}>
          <LuSearch
            size={13}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            id={`${i18n}-filter`}
            type="text"
            placeholder={t(`${i18n}.filterPlaceholder`)}
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            aria-label={t(`${i18n}.filterAriaLabel`)}
            style={{
              width: '100%',
              fontSize: 13,
              padding: '6px 28px 6px 30px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              boxSizing: 'border-box',
            }}
          />
          {filter && (
            <button
              onClick={() => onFilter('')}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                padding: 0,
              }}
            >
              <LuX size={12} />
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={onCollapseAll}
          disabled={collapseDisabled}
          style={{ ...toolBtnStyle, opacity: collapseDisabled ? 0.4 : 1 }}
        >
          {t('common.collapseAll')}
        </button>
        <button
          onClick={onExpandAll}
          disabled={expandDisabled}
          style={{ ...toolBtnStyle, opacity: expandDisabled ? 0.4 : 1 }}
        >
          {t('common.expandAll')}
        </button>
        {showBulk && (
          <button
            onClick={onToggleBulk}
            style={{
              ...toolBtnStyle,
              color: bulkMode ? 'var(--gold)' : 'var(--text-dim)',
              outline: bulkMode ? '1px solid var(--gold-dim)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <LuListChecks size={13} />
            {bulkMode ? t(`${i18n}.cancelBulk`) : t('common.select')}
          </button>
        )}
        <ViewModeToggle mode={viewMode} onCycle={onCycleViewMode} style={toolBtnStyle} />
        <button
          onClick={onToggleFavOnly}
          aria-pressed={favOnly}
          title={t('favorites.onlyFavorites')}
          style={{
            ...toolBtnStyle,
            color: favOnly ? 'var(--gold)' : 'var(--text-muted)',
            background: favOnly ? 'rgba(180,120,60,0.15)' : 'var(--bg-card)',
            outline: favOnly ? '1px solid var(--gold-dim)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <LuHeart size={13} fill={favOnly ? 'var(--gold)' : 'none'} />
          {t('favorites.onlyFavorites')}
        </button>
      </div>
    </div>
  )
}
