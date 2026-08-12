import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuArrowUp,
  LuArrowDown,
  LuArrowDownUp,
  LuBookmark,
  LuStar,
  LuX,
  LuFilter,
} from 'react-icons/lu'
import FilterModal from './FilterModal'
import useIsMobile from '../../hooks/useIsMobile'

/**
 * Compact, stash-inspired sort + filter toolbar with server-backed saved
 * presets. Sort lives inline (label + connected select/order button); all
 * filters live in a modal opened by the "Filters (N)" button.
 *
 * Saved-filter state is owned by the parent (so a per-scope default can be
 * applied on page load) and passed in via props:
 *  - saved:        [{ id, name, state, is_default }]
 *  - onSavePreset: (name, { asDefault }) => void   — save current state
 *  - onDeletePreset: (id) => void
 *  - onSetDefault: (id, value) => void
 *
 * Other props:
 *  - state: { sort, order, filters: {...} }
 *  - onChange: (nextState) => void
 *  - sortOptions: [{ value, label }]
 *  - selectFilters / multiFilters / toggleFilters: filter definitions (rendered in the modal)
 *  - trailing: extra controls (multi-select, view-mode, …) rendered at the right
 *    end of the row, so gallery pages get one uniform toolbar line (#255)
 *  - sticky: pin the row to the top of the scroll container while scrolling
 */
export default function SortFilterBar({
  state,
  onChange,
  sortOptions,
  selectFilters = [],
  multiFilters = [],
  toggleFilters = [],
  showSearch = true,
  searchPlaceholder,
  saved = [],
  onSavePreset,
  onDeletePreset,
  onSetDefault,
  trailing,
  sticky = false,
}) {
  const { t } = useTranslation()
  const [showSaved, setShowSaved] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  // On narrow screens the row collapses to icon-only buttons so everything
  // still fits on a single line instead of wrapping into a tall block.
  const isMobile = useIsMobile()
  const filters = state.filters || {}
  const setSort = (sort) => onChange({ ...state, sort })
  const toggleOrder = () => onChange({ ...state, order: state.order === 'asc' ? 'desc' : 'asc' })

  const isActive = (v) =>
    v !== undefined &&
    v !== null &&
    v !== '' &&
    v !== 'any' &&
    !(Array.isArray(v) && v.length === 0)
  const activeFilterCount = Object.values(filters).filter(isActive).length
  const clearFilters = () => onChange({ ...state, filters: {} })

  const controlStyle = {
    fontSize: 13,
    padding: '5px 8px',
    borderRadius: 6,
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  }

  const groupLabelStyle = {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }

  return (
    <>
      {/* The backdrop is the row's own background, so it tracks the page
          container's width instead of bleeding to the viewport edges — a
          full-bleed bar looked stranded on wide screens, where the content it
          belongs to stops well short of the edge. */}
      {sticky && (
        <style>{`
          .sort-filter-bar-sticky { position: sticky; top: 0; z-index: 30; }
        `}</style>
      )}
      <div
        data-testid="sort-filter-bar"
        className={sticky ? 'sort-filter-bar-sticky' : undefined}
        style={{
          display: 'flex',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          gap: isMobile ? 6 : 10,
          alignItems: 'center',
          marginBottom: 16,
          ...(sticky
            ? {
                padding: '10px 0',
                marginBottom: 16,
                background: 'var(--bg-deep)',
                borderBottom: '1px solid var(--border)',
              }
            : null),
        }}
      >
        {/* Sort group: label + icon + connected select/order button. The text
            label drops on mobile (the icon carries the meaning) and the select
            is allowed to shrink so the row stays on one line. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!isMobile && (
            <span style={groupLabelStyle}>
              <LuArrowDownUp size={12} />
              {t('sortFilter.sort')}
            </span>
          )}
          <div style={{ display: 'flex', minWidth: 0 }}>
            <select
              aria-label={t('sortFilter.sort')}
              value={state.sort}
              onChange={(e) => setSort(e.target.value)}
              style={{
                ...controlStyle,
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0,
                borderRight: 'none',
                ...(isMobile ? { minWidth: 0, maxWidth: 110 } : null),
              }}
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={toggleOrder}
              aria-label={
                state.order === 'asc' ? t('sortFilter.ascending') : t('sortFilter.descending')
              }
              title={state.order === 'asc' ? t('sortFilter.ascending') : t('sortFilter.descending')}
              style={{
                ...controlStyle,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
              }}
            >
              {state.order === 'asc' ? <LuArrowUp size={14} /> : <LuArrowDown size={14} />}
            </button>
          </div>
        </div>

        {/* Filters button → modal, with an attached X that clears every active
            filter in one click (disabled while nothing is set). `marginLeft: auto`
            pushes the pair (and the saved-filters menu) to the right, leaving
            Sort left. */}
        <div style={{ display: 'flex', marginLeft: 'auto', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            aria-label={t('sortFilter.filters')}
            style={{
              ...controlStyle,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: activeFilterCount ? 'var(--gold)' : 'var(--text)',
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              borderRight: 'none',
            }}
          >
            <LuFilter size={13} />
            {!isMobile && t('sortFilter.filters')}
            {activeFilterCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--gold-dim)',
                  color: 'var(--bg-deep)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            disabled={activeFilterCount === 0}
            aria-label={t('sortFilter.clearFilters')}
            title={t('sortFilter.clearFilters')}
            style={{
              ...controlStyle,
              cursor: activeFilterCount ? 'pointer' : 'not-allowed',
              opacity: activeFilterCount ? 1 : 0.4,
              display: 'flex',
              alignItems: 'center',
              padding: '5px 7px',
              color: activeFilterCount ? 'var(--gold)' : 'var(--text-muted)',
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
            }}
          >
            <LuX size={13} />
          </button>
        </div>

        {/* Saved filters menu. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setShowSaved((v) => !v)}
            aria-label={t('sortFilter.savedFilters')}
            style={{
              ...controlStyle,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <LuBookmark size={13} />
            {!isMobile && t('sortFilter.savedFilters')}
          </button>
          {showSaved && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '110%',
                zIndex: 20,
                minWidth: 220,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 8,
                boxShadow: '0 6px 20px var(--shadow)',
              }}
            >
              {saved.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 8px' }}>
                  {t('sortFilter.noSaved')}
                </div>
              ) : (
                saved.map((f) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(f.state)
                        setShowSaved(false)
                      }}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        fontSize: 13,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {f.name}
                      {f.is_default && (
                        <span style={{ fontSize: 10, color: 'var(--gold)' }}>
                          {t('sortFilter.defaultBadge')}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetDefault?.(f.id, !f.is_default)}
                      aria-label={`${t('sortFilter.setDefault')} ${f.name}`}
                      title={t('sortFilter.setDefault')}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: f.is_default ? 'var(--gold)' : 'var(--text-muted)',
                        display: 'flex',
                        padding: 4,
                      }}
                    >
                      <LuStar size={12} fill={f.is_default ? 'var(--gold)' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePreset?.(f.id)}
                      aria-label={`${t('sortFilter.delete')} ${f.name}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        padding: 4,
                      }}
                    >
                      <LuX size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Page-supplied controls (multi-select, view-mode, …) close out the row. */}
        {trailing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {trailing}
          </div>
        )}

        {showFilters && (
          <FilterModal
            state={state}
            onChange={onChange}
            selectFilters={selectFilters}
            multiFilters={multiFilters}
            toggleFilters={toggleFilters}
            showSearch={showSearch}
            searchPlaceholder={searchPlaceholder}
            onSavePreset={onSavePreset}
            onClose={() => setShowFilters(false)}
          />
        )}
      </div>
    </>
  )
}
