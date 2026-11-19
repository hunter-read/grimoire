import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settings as settingsApi } from '../../api'
import { defaultLayout, type StatId } from '../../lib/sidebarStats'
import Spinner from '../Spinner'
import StatsPicker from '../StatsPicker'
import { primaryButton } from '../statsButtonStyles'
import SettingsLoadError from './SettingsLoadError'
import { failureMessage } from './useInstantSettings'

// The sidebar re-reads its settings when told they changed.
const announce = () => window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))

/**
 * Which library stats the sidebar's footer shows, and in what order, for
 * everyone who has not chosen their own (each person can, from the footer).
 */
export default function StatsDisplaySection() {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<StatId[] | null>(null)
  const [draft, setDraft] = useState<StatId[]>([])
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'saved' | null>(null)
  const [saveError, setSaveError] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const layout = defaultLayout(await settingsApi.get())
      setSaved(layout)
      setDraft(layout)
    } catch (e) {
      setLoadError(failureMessage(e, t, 'load'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setStatus(null)
    setSaveError('')
    try {
      const layout = defaultLayout(await settingsApi.patch({ sidebar_stats: draft }))
      setSaved(layout)
      setDraft(layout)
      setStatus('saved')
      announce()
    } catch (e) {
      setSaveError(failureMessage(e, t))
    } finally {
      setSaving(false)
    }
  }

  const changed = saved !== null && draft.join(',') !== saved.join(',')

  return (
    <div>
      <h3 className="settings-section-title">{t('appSettings.sidebarStats.title')}</h3>
      <p className="settings-section-description">{t('appSettings.sidebarStats.description')}</p>

      {loadError ? (
        <SettingsLoadError message={loadError} onRetry={() => void load()} />
      ) : saved === null ? (
        <Spinner size={20} />
      ) : (
        <>
          <StatsPicker
            value={draft}
            onChange={(next) => {
              setDraft(next)
              setStatus(null)
              setSaveError('')
            }}
            disabled={saving}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              disabled={saving || !changed}
              onClick={() => void save()}
              style={primaryButton(saving || !changed)}
            >
              {t('stats.save')}
            </button>
            <span role="status" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {status === 'saved' && t('stats.saved')}
            </span>
          </div>
          {saveError && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>
              {saveError}
            </div>
          )}
        </>
      )}
    </div>
  )
}
