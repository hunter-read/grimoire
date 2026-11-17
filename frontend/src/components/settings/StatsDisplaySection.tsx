import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'
import InstantToggle from './InstantToggle'
import SettingsLoadError from './SettingsLoadError'
import { useInstantSettings } from './useInstantSettings'

// The settings keys themselves are static; only their labels are translated.
const STAT_ITEMS = [
  { key: 'show_stat_systems', labelKey: 'stats.systems' },
  { key: 'show_stat_books', labelKey: 'stats.books' },
  { key: 'show_stat_pages', labelKey: 'stats.pages' },
  { key: 'show_stat_maps', labelKey: 'stats.maps' },
  { key: 'show_stat_tokens', labelKey: 'stats.tokens' },
  { key: 'show_stat_audio', labelKey: 'stats.audio' },
  { key: 'show_stat_models', labelKey: 'stats.models' },
  { key: 'show_stat_size', labelKey: 'stats.booksSize' },
  { key: 'show_stat_library_size', labelKey: 'stats.librarySize' },
] as const
const KEYS = STAT_ITEMS.map(({ key }) => key)

// The sidebar re-reads its settings when told they changed.
const announce = () => window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))

/** Which library counts the sidebar's footer shows. */
export default function StatsDisplaySection() {
  const { t } = useTranslation()
  const { values, loadError, reload, saving, saved, error, toggle } = useInstantSettings(KEYS, {
    onSaved: announce,
  })

  return (
    <div>
      <h3 className="settings-section-title">{t('appSettings.sidebarStats.title')}</h3>
      <p className="settings-section-description">{t('appSettings.sidebarStats.description')}</p>

      {loadError ? (
        <SettingsLoadError message={loadError} onRetry={reload} />
      ) : !values ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {STAT_ITEMS.map(({ key, labelKey }) => (
            <InstantToggle
              key={key}
              id={key}
              label={t(labelKey)}
              checked={values[key]}
              onChange={() => void toggle(key)}
              saving={saving === key}
              saved={saved === key}
              error={error?.key === key ? error.message : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
