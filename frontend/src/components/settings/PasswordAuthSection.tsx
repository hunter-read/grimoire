import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'
import InstantToggle from './InstantToggle'
import SettingsLoadError from './SettingsLoadError'
import { useInstantSettings } from './useInstantSettings'
import { envNoticeStyle } from './envNoticeStyle'

const KEYS = ['password_auth_enabled'] as const

/**
 * Whether anyone can sign in with a username and password. Turning it off
 * leaves single sign-on as the only way in, so it asks first - and refuses
 * outright while single sign-on isn't set up, since nobody could get back in.
 */
export default function PasswordAuthSection() {
  const { t } = useTranslation()
  const { data, values, loadError, reload, saving, saved, error, toggle } = useInstantSettings(KEYS)
  const [confirming, setConfirming] = useState(false)
  const locked = !!data?.password_auth_env_locked
  // Read defensively: older servers don't report it, and absent means "unknown".
  const oidcConfigured = (data as { oidc_configured?: boolean } | null)?.oidc_configured
  const enabled = !!values?.password_auth_enabled
  const blocked = enabled && oidcConfigured === false
  // The dialog hands focus back to the checkbox, but the box is disabled while
  // the change saves, so focus would fall to the page. Put it back once the
  // save settles.
  const refocus = useRef(false)
  const isSaving = saving === 'password_auth_enabled'
  useEffect(() => {
    if (!isSaving && refocus.current) {
      refocus.current = false
      document.getElementById('password_auth_enabled')?.focus()
    }
  }, [isSaving])

  const onChange = () => {
    if (enabled) setConfirming(true)
    else void toggle('password_auth_enabled')
  }

  return (
    <div>
      <h3 className="settings-section-title">{t('authSettings.passwordAuth.title')}</h3>
      <p className="settings-section-description">{t('authSettings.passwordAuth.description')}</p>

      {loadError ? (
        <SettingsLoadError message={loadError} onRetry={reload} />
      ) : !values ? (
        <Spinner size={20} />
      ) : (
        <InstantToggle
          id="password_auth_enabled"
          label={t('authSettings.passwordAuth.enable')}
          checked={enabled}
          onChange={onChange}
          locked={locked}
          disabled={blocked}
          saving={isSaving}
          saved={saved === 'password_auth_enabled'}
          error={error?.message}
        >
          {locked ? (
            <div style={envNoticeStyle}>
              {t('authSettings.passwordAuth.envLocked', { value: enabled ? 'true' : 'false' })}
            </div>
          ) : (
            blocked && (
              <p style={{ ...envNoticeStyle, margin: '12px 0 0' }}>
                {t('authSettings.passwordAuth.needsOidc')}{' '}
                <Link to="/settings/sign-in#oidc" style={{ color: 'var(--gold)' }}>
                  {t('authSettings.passwordAuth.setUpOidc')}
                </Link>
              </p>
            )
          )}
        </InstantToggle>
      )}

      {confirming && (
        <ConfirmModal
          title={t('authSettings.passwordAuth.confirmOffTitle')}
          message={t('authSettings.passwordAuth.confirmOffMessage')}
          confirmLabel={t('authSettings.passwordAuth.confirmOff')}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            refocus.current = true
            void toggle('password_auth_enabled')
          }}
        />
      )}
    </div>
  )
}
