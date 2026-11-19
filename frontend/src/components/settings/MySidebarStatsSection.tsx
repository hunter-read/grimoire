import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api, { settings as settingsApi, type Schema } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { cleanLayout, defaultLayout, type StatId } from '../../lib/sidebarStats'
import StatsPicker from '../StatsPicker'
import { primaryButton, secondaryButton } from '../statsButtonStyles'
import { failureMessage } from './useInstantSettings'

/**
 * The stats your own sidebar shows. Until you save a choice it follows the
 * admin's default (Settings → Sidebar), and Use the default goes back to it.
 */
export default function MySidebarStatsSection() {
  const { t } = useTranslation()
  const auth = useAuth()
  const own = auth?.user && 'sidebar_stats' in auth.user ? auth.user.sidebar_stats : null
  const ownLayout = Array.isArray(own) ? cleanLayout(own) : null

  // The default is read once; without it the picker starts from the older
  // flags' defaults, which is what the sidebar shows before settings load.
  const [uiSettings, setUiSettings] = useState<Partial<Schema<'UISettingsResponse'>>>({})
  useEffect(() => {
    let cancelled = false
    settingsApi
      .getUi()
      .then((data) => {
        if (!cancelled) setUiSettings(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const current = ownLayout ?? defaultLayout(uiSettings)
  const [draft, setDraft] = useState<StatId[] | null>(null)
  const shown = draft ?? current
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = async (next: StatId[] | null) => {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await api.patch('/users/me/preferences', { sidebar_stats: next })
      await auth?.refreshUser()
      setDraft(null)
      setSaved(true)
    } catch (e) {
      setError(failureMessage(e, t))
    } finally {
      setSaving(false)
    }
  }

  const changed = draft !== null && draft.join(',') !== current.join(',')

  return (
    <div>
      <h3 className="settings-section-title">{t('userSettings.sidebarStats.title')}</h3>
      <p className="settings-section-description">
        {t('userSettings.sidebarStats.description')}{' '}
        {ownLayout ? t('stats.yourSidebarOwn') : t('stats.yourSidebarDefault')}
      </p>
      <StatsPicker
        value={shown}
        onChange={(next) => {
          setDraft(next)
          setSaved(false)
          setError('')
        }}
        disabled={saving}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={saving || !changed}
          onClick={() => void save(shown)}
          style={primaryButton(saving || !changed)}
        >
          {t('stats.save')}
        </button>
        {ownLayout && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(null)}
            style={secondaryButton(saving)}
          >
            {t('stats.useDefault')}
          </button>
        )}
        <span role="status" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {saved && t('stats.saved')}
        </span>
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  )
}
