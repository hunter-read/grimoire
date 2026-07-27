import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuSearch } from 'react-icons/lu'
import MultiSelectDropdown from '../metadata/MultiSelectDropdown'

/**
 * Modal housing all filter controls for a scope, plus a "save as filter"
 * section so a preset can be created right from here. Filter definitions are
 * passed in; the modal edits `state.filters` via `onChange` and can create a
 * saved preset via `onSavePreset`.
 *
 * Props:
 *  - state, onChange: the sort/filter state and its setter
 *  - selectFilters, multiFilters, toggleFilters: same shapes as the toolbar
 *  - onSavePreset(name, { asDefault }): create a preset from the current state
 *  - onClose()
 */
export default function FilterModal({
  state,
  onChange,
  selectFilters = [],
  multiFilters = [],
  toggleFilters = [],
  showSearch = true,
  searchPlaceholder,
  onSavePreset,
  onClose,
}) {
  const { t } = useTranslation()
  const [saveName, setSaveName] = useState('')
  const [saveAsDefault, setSaveAsDefault] = useState(false)

  const filters = state.filters || {}
  const setFilter = (key, value) => onChange({ ...state, filters: { ...filters, [key]: value } })

  const isActive = (v) =>
    v !== undefined &&
    v !== null &&
    v !== '' &&
    v !== 'any' &&
    !(Array.isArray(v) && v.length === 0)
  const activeCount = Object.values(filters).filter(isActive).length

  const clearFilters = () => onChange({ ...state, filters: {} })

  const submitSave = () => {
    const name = saveName.trim()
    if (!name) return
    onSavePreset?.(name, { asDefault: saveAsDefault })
    setSaveName('')
    setSaveAsDefault(false)
    onClose()
  }

  // Boolean toggles (e.g. "Favorites only") always render first; other toggle
  // filters (tri-state selects like Explicit) render after the select/multi
  // filters in their configured order.
  const booleanToggles = toggleFilters.filter((f) => f.boolean)
  const otherToggles = toggleFilters.filter((f) => !f.boolean)

  const renderToggle = (f) =>
    f.boolean ? (
      <label
        key={f.key}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={filters[f.key] === true}
          onChange={(e) => setFilter(f.key, e.target.checked ? true : undefined)}
          style={{ width: 15, height: 15, accentColor: 'var(--gold)' }}
        />
        <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{f.label}</span>
      </label>
    ) : (
      <div key={f.key}>
        <label style={label}>{f.label}</label>
        <select
          aria-label={f.label}
          value={filters[f.key] === undefined ? 'any' : String(filters[f.key])}
          onChange={(e) =>
            setFilter(f.key, e.target.value === 'any' ? undefined : e.target.value === 'true')
          }
          style={control}
        >
          <option value="any">{f.anyLabel || t('sortFilter.explicitAny')}</option>
          <option value="true">{f.trueLabel || t('sortFilter.filterExplicit')}</option>
          <option value="false">{f.falseLabel || t('sortFilter.filterHideExplicit')}</option>
        </select>
      </div>
    )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('sortFilter.filters')}
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panel}>
        <div style={header}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('sortFilter.filters')}</span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Favorites (and any other boolean toggles) are always the first
              filter option. */}
          {booleanToggles.map(renderToggle)}

          {/* Title search box (all categories). */}
          {showSearch && (
            <div>
              <label style={label}>{t('sortFilter.searchLabel')}</label>
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
                  type="text"
                  aria-label={t('sortFilter.searchLabel')}
                  value={filters.search || ''}
                  onChange={(e) => setFilter('search', e.target.value || undefined)}
                  placeholder={searchPlaceholder || t('sortFilter.searchPlaceholder')}
                  style={{ ...control, paddingLeft: 28 }}
                />
              </div>
            </div>
          )}

          {selectFilters.map((f) => (
            <div key={f.key}>
              <label style={label}>{f.label}</label>
              <select
                aria-label={f.label}
                value={filters[f.key] || ''}
                onChange={(e) => setFilter(f.key, e.target.value || undefined)}
                style={control}
              >
                <option value="">{f.allLabel}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {multiFilters.map((f) => (
            <div key={f.key}>
              <label style={label}>{f.label}</label>
              <MultiSelectDropdown
                label={f.label}
                options={f.options}
                selected={Array.isArray(filters[f.key]) ? filters[f.key] : []}
                onChange={(next) => setFilter(f.key, next.length ? next : undefined)}
                emptyLabel={f.emptyLabel}
                searchPlaceholder={f.searchPlaceholder}
              />
            </div>
          ))}

          {otherToggles.map(renderToggle)}
        </div>

        {/* Save-as-filter section. */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 14 }}>
          <label style={label}>{t('sortFilter.saveCurrent')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitSave()}
              placeholder={t('sortFilter.savePrompt')}
              aria-label={t('sortFilter.savePrompt')}
              style={{ ...control, flex: '1 1 160px' }}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
                style={{ accentColor: 'var(--gold)' }}
              />
              {t('sortFilter.saveAsDefault')}
            </label>
            <button
              type="button"
              onClick={submitSave}
              disabled={!saveName.trim()}
              style={{
                ...control,
                cursor: saveName.trim() ? 'pointer' : 'not-allowed',
                color: 'var(--gold)',
                opacity: saveName.trim() ? 1 : 0.5,
              }}
            >
              {t('common.save')}
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={clearFilters}
            disabled={activeCount === 0}
            style={{
              ...control,
              cursor: activeCount ? 'pointer' : 'not-allowed',
              color: 'var(--text-muted)',
              opacity: activeCount ? 1 : 0.5,
            }}
          >
            {t('sortFilter.clear')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...control,
              cursor: 'pointer',
              background: 'var(--gold-dim)',
              color: 'var(--bg-deep)',
              fontWeight: 600,
            }}
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
  width: '100%',
  maxWidth: 460,
  maxHeight: '85vh',
  overflowY: 'auto',
}
const header = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
}
const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const control = {
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  width: '100%',
  boxSizing: 'border-box',
}
