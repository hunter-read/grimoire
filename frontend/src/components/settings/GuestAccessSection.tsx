import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'
import InstantToggle from './InstantToggle'
import SettingsLoadError from './SettingsLoadError'
import { useInstantSettings } from './useInstantSettings'
import { envNoticeStyle } from './envNoticeStyle'

const KEYS = ['guest_access_enabled'] as const

/** Whether GMs and admins can hand out campaign guest codes. */
export default function GuestAccessSection() {
  const { t } = useTranslation()
  const { data, values, loadError, reload, saving, saved, error, toggle } = useInstantSettings(KEYS)
  const locked = !!data?.guest_access_env_locked

  return (
    <div>
      <h3 className="settings-section-title">{t('authSettings.guestAccess.title')}</h3>
      <p className="settings-section-description">{t('authSettings.guestAccess.description')}</p>

      {loadError ? (
        <SettingsLoadError message={loadError} onRetry={reload} />
      ) : !values ? (
        <Spinner size={20} />
      ) : (
        <InstantToggle
          id="guest_access_enabled"
          label={t('authSettings.guestAccess.enable')}
          checked={values.guest_access_enabled}
          onChange={() => void toggle('guest_access_enabled')}
          locked={locked}
          saving={saving === 'guest_access_enabled'}
          saved={saved === 'guest_access_enabled'}
          error={error?.message}
        >
          {locked && (
            <div style={envNoticeStyle}>
              {t('authSettings.guestAccess.envLocked', {
                value: values.guest_access_enabled ? 'true' : 'false',
              })}
            </div>
          )}
        </InstantToggle>
      )}
    </div>
  )
}
