import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { getDefaultViewMode, saveDefaultViewMode, CONTENT_TYPES } from '../../hooks/useViewMode'
import { MODE_ICON } from '../ViewModeToggle'
import { RECENT_DEFAULT, RECENT_MAX } from '../../hooks/useBookPrefs'
import SegmentedControl from './SegmentedControl'

export default function LibrarySection() {
  const { t } = useTranslation()
  const prefs = getUserPrefs()
  const [sort, setSort] = useState(prefs.librarySort || 'az')
  const [viewModes, setViewModes] = useState(() =>
    Object.fromEntries(CONTENT_TYPES.map((type) => [type, getDefaultViewMode(type)]))
  )
  const [recentLimit, setRecentLimit] = useState(
    typeof prefs.recentLimit === 'number' ? prefs.recentLimit : RECENT_DEFAULT
  )
  const [saved, setSaved] = useState(false)

  const SORT_OPTIONS = [
    { value: 'az', label: 'A → Z' },
    { value: 'za', label: 'Z → A' },
  ]

  const VIEW_MODE_OPTIONS = [
    { value: 'card', label: t('library.viewMode.card'), icon: MODE_ICON.card },
    { value: 'compact', label: t('library.viewMode.compact'), icon: MODE_ICON.compact },
    { value: 'list', label: t('library.viewMode.list'), icon: MODE_ICON.list },
  ]

  // One default-view control per content type, in display order.
  const VIEW_MODE_SECTIONS = [
    { type: 'system', label: t('userSettings.library.viewModeSystems') },
    { type: 'book', label: t('userSettings.library.viewModeBooks') },
    { type: 'map', label: t('userSettings.library.viewModeMaps') },
    { type: 'token', label: t('userSettings.library.viewModeTokens') },
    { type: 'audio', label: t('userSettings.library.viewModeAudio') },
  ]

  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const handleSort = (v) => {
    setSort(v)
    saveUserPref('librarySort', v)
    flash()
  }
  const handleViewMode = (type, v) => {
    setViewModes((prev) => ({ ...prev, [type]: v }))
    saveDefaultViewMode(type, v)
    flash()
  }
  const handleRecentLimit = (e) => {
    const raw = e.target.value
    // Allow the field to be cleared transiently without snapping to a number.
    if (raw === '') {
      setRecentLimit('')
      return
    }
    const clamped = Math.max(0, Math.min(RECENT_MAX, Math.floor(Number(raw))))
    setRecentLimit(clamped)
    saveUserPref('recentLimit', clamped)
    flash()
  }
  const handleRecentLimitBlur = () => {
    if (recentLimit === '' || Number.isNaN(Number(recentLimit))) {
      setRecentLimit(RECENT_DEFAULT)
      saveUserPref('recentLimit', RECENT_DEFAULT)
      flash()
    }
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.library.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.6 }}>
        {t('userSettings.library.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('userSettings.library.sortOrder')}
          </div>
          <SegmentedControl options={SORT_OPTIONS} value={sort} onChange={handleSort} />
        </div>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {t('userSettings.library.viewMode')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {VIEW_MODE_SECTIONS.map(({ type, label }) => (
              <div
                key={type}
                style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
              >
                <span
                  style={{ fontSize: 13, color: 'var(--text-muted)', width: 140, flexShrink: 0 }}
                >
                  {label}
                </span>
                <SegmentedControl
                  options={VIEW_MODE_OPTIONS}
                  value={viewModes[type]}
                  onChange={(v) => handleViewMode(type, v)}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <label
            htmlFor="recent-limit"
            style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}
          >
            {t('userSettings.library.recentLimit')}
          </label>
          <input
            id="recent-limit"
            type="number"
            min={0}
            max={RECENT_MAX}
            value={recentLimit}
            onChange={handleRecentLimit}
            onBlur={handleRecentLimitBlur}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 14,
              padding: '7px 12px',
              width: 100,
            }}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('userSettings.library.recentLimitHint', { max: RECENT_MAX })}
          </div>
        </div>
      </div>
    </div>
  )
}
