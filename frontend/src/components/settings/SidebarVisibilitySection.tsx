import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'
import InstantToggle from './InstantToggle'
import SettingsLoadError from './SettingsLoadError'
import { useInstantSettings } from './useInstantSettings'

const ITEMS = [
  { key: 'hide_armory', labelKey: 'appSettings.sidebarVisibility.hideArmory' },
  { key: 'hide_maps', labelKey: 'appSettings.sidebarVisibility.hideMaps' },
  { key: 'hide_tokens', labelKey: 'appSettings.sidebarVisibility.hideTokens' },
  { key: 'hide_audio', labelKey: 'appSettings.sidebarVisibility.hideAudio' },
  { key: 'hide_models', labelKey: 'appSettings.sidebarVisibility.hideModels' },
  { key: 'hide_campaigns', labelKey: 'appSettings.sidebarVisibility.hideCampaigns' },
] as const
const KEYS = ITEMS.map(({ key }) => key)

// The sidebar re-reads its settings when told they changed.
const announce = () => window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))

/** Which library sections the sidebar lists, for everyone. */
export default function SidebarVisibilitySection() {
  const { t } = useTranslation()
  const { values, loadError, reload, saving, saved, error, toggle } = useInstantSettings(KEYS, {
    onSaved: announce,
  })

  return (
    <div>
      <h3 className="settings-section-title">{t('appSettings.sidebarVisibility.title')}</h3>
      <p className="settings-section-description">
        {t('appSettings.sidebarVisibility.description')}
      </p>

      {loadError ? (
        <SettingsLoadError message={loadError} onRetry={reload} />
      ) : !values ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ITEMS.map(({ key, labelKey }) => (
            <InstantToggle
              key={key}
              id={key}
              label={t(labelKey)}
              checked={values[key]}
              onChange={() => toggle(key)}
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
