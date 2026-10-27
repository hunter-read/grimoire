import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import { CATEGORY_ORDER, categoryLabel } from '../../constants'
import { ACCESS_ADMIN, ACCESS_GM, ACCESS_OPEN, UNRESTRICTABLE_CATEGORIES } from '../../accessLevels'
import Spinner from '../Spinner'

// App-wide category restrictions (issue #258). Sets the *default* level for
// every book in a category — a book or its system can still override it in
// either direction, which is why this is presented as a baseline rather than a
// guarantee.
export default function CategoryAccessSection() {
  const { t } = useTranslation()
  const [levels, setLevels] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    settingsApi
      .get()
      .then((d) => setLevels(d.restricted_categories || {}))
      .catch(() => setLevels({}))
  }, [])

  // Core rulebooks and character sheets are excluded by the backend too; hiding
  // them here keeps the UI from offering a choice that would be rejected.
  const categories = CATEGORY_ORDER.filter((c) => !UNRESTRICTABLE_CATEGORIES.includes(c))

  const setLevel = async (category, level) => {
    const next = { ...levels }
    if (level === ACCESS_OPEN) delete next[category]
    else next[category] = level

    const previous = levels
    setLevels(next)
    setSaving(true)
    setError('')
    try {
      await settingsApi.patch({ restricted_categories: next })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      // Put the old value back rather than leaving the UI showing a change the
      // server rejected.
      setLevels(previous)
      setError(e?.message || t('appSettings.categoryAccess.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (levels === null) return <Spinner size={20} />

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('appSettings.categoryAccess.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.categoryAccess.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {categories.map((category) => (
          <div
            key={category}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            {/* Plain text, not a <label for>: the accessible name comes from
                aria-label below, and a real label would additionally match the
                bare category text — colliding with the identically named stat
                toggles elsewhere on this page. */}
            <span style={{ fontSize: 14, color: 'var(--text)' }}>{categoryLabel(category)}</span>
            <select
              id={`access-${category}`}
              value={levels[category] || ACCESS_OPEN}
              onChange={(e) => setLevel(category, e.target.value)}
              disabled={saving}
              /* The visible label is the bare category name, but several of
                 those ("Maps") also name an unrelated toggle elsewhere on this
                 page. The accessible name says which control this is. */
              aria-label={t('appSettings.categoryAccess.selectLabel', {
                category: categoryLabel(category),
              })}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: 14,
                minWidth: 180,
              }}
            >
              <option value={ACCESS_OPEN}>{t('access.levels.open')}</option>
              <option value={ACCESS_GM}>{t('access.levels.gm')}</option>
              <option value={ACCESS_ADMIN}>{t('access.levels.admin')}</option>
            </select>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 18 }}>
        {saving && <Spinner size={13} />}
        {saved && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
        {error && <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        {t('appSettings.categoryAccess.hint')}
      </p>
    </div>
  )
}
