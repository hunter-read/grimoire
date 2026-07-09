import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'
import OIDCSettingsSection from './OIDCSettingsSection'
import RichTextEditor from './RichTextEditor'

export default function AuthenticationTab() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [envLocked, setEnvLocked] = useState(false)
  const [guestEnvLocked, setGuestEnvLocked] = useState(false)
  const [saving, setSaving] = useState(null)
  const [saved, setSaved] = useState(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [messageDirty, setMessageDirty] = useState(false)
  const [messageSaving, setMessageSaving] = useState(false)
  const [messageSaved, setMessageSaved] = useState(false)

  useEffect(() => {
    settingsApi
      .get()
      .then((d) => {
        setValues({
          password_auth_enabled: !!d.password_auth_enabled,
          guest_access_enabled: !!d.guest_access_enabled,
          custom_login_message_enabled: !!d.custom_login_message_enabled,
        })
        setEnvLocked(!!d.password_auth_env_locked)
        setGuestEnvLocked(!!d.guest_access_env_locked)
        setMessageDraft(d.custom_login_message || '')
      })
      .catch(() => {
        setValues({
          password_auth_enabled: true,
          guest_access_enabled: false,
          custom_login_message_enabled: false,
        })
        setEnvLocked(false)
        setGuestEnvLocked(false)
      })
  }, [])

  const toggle = async (key) => {
    const next = !values[key]
    setValues((v) => ({ ...v, [key]: next }))
    setSaving(key)
    try {
      await settingsApi.patch({ [key]: next })
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
    } finally {
      setSaving(null)
    }
  }

  const saveMessage = async () => {
    setMessageSaving(true)
    try {
      await settingsApi.patch({ custom_login_message: messageDraft })
      setMessageDirty(false)
      setMessageSaved(true)
      setTimeout(() => setMessageSaved(false), 2000)
    } finally {
      setMessageSaving(false)
    }
  }

  if (values === null) return <Spinner size={20} />

  return (
    <div>
      {/* Guest access — kept at the top so it's the first thing admins see. */}
      <div style={{ marginBottom: 40 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {t('authSettings.guestAccess.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('authSettings.guestAccess.description')}
        </p>

        <label
          htmlFor="guest_access_enabled"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: guestEnvLocked ? 'not-allowed' : 'pointer',
            width: 'fit-content',
            opacity: guestEnvLocked ? 0.7 : 1,
          }}
        >
          <input
            id="guest_access_enabled"
            type="checkbox"
            checked={values.guest_access_enabled}
            onChange={() => toggle('guest_access_enabled')}
            disabled={guestEnvLocked || saving === 'guest_access_enabled'}
            style={{
              width: 16,
              height: 16,
              cursor: guestEnvLocked ? 'not-allowed' : 'pointer',
              accentColor: 'var(--gold)',
            }}
          />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>
            {t('authSettings.guestAccess.enable')}
          </span>
          {saving === 'guest_access_enabled' && <Spinner size={13} />}
          {saved === 'guest_access_enabled' && (
            <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />
          )}
        </label>

        {guestEnvLocked && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              fontSize: 13,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            {t('authSettings.guestAccess.envLocked', {
              value: values.guest_access_enabled ? 'true' : 'false',
            })}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />

      {/* Custom login message */}
      <div style={{ marginBottom: 40 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {t('authSettings.customMessage.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('authSettings.customMessage.description')}
        </p>

        <label
          htmlFor="custom_login_message_enabled"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            width: 'fit-content',
            marginBottom: values.custom_login_message_enabled ? 16 : 0,
          }}
        >
          <input
            id="custom_login_message_enabled"
            type="checkbox"
            checked={values.custom_login_message_enabled}
            onChange={() => toggle('custom_login_message_enabled')}
            disabled={saving === 'custom_login_message_enabled'}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
          />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>
            {t('authSettings.customMessage.enable')}
          </span>
          {saving === 'custom_login_message_enabled' && <Spinner size={13} />}
          {saved === 'custom_login_message_enabled' && (
            <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />
          )}
        </label>

        {values.custom_login_message_enabled && (
          <>
            <RichTextEditor
              value={messageDraft}
              onChange={(html) => {
                setMessageDraft(html)
                setMessageDirty(true)
              }}
              ariaLabel={t('authSettings.customMessage.editorLabel')}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                onClick={saveMessage}
                disabled={!messageDirty || messageSaving}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: messageDirty ? 'var(--gold)' : 'var(--text-muted)',
                  cursor: messageDirty && !messageSaving ? 'pointer' : 'default',
                  opacity: messageDirty ? 1 : 0.7,
                }}
              >
                {messageSaving ? t('common.saving') : t('common.save')}
              </button>
              {messageSaved && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--green)',
                    fontSize: 13,
                  }}
                >
                  <LuCircleCheck size={14} /> {t('common.saved')}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />

      {/* Password authentication */}
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {t('authSettings.passwordAuth.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('authSettings.passwordAuth.description')}
        </p>

        <label
          htmlFor="password_auth_enabled"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: envLocked ? 'not-allowed' : 'pointer',
            width: 'fit-content',
            opacity: envLocked ? 0.7 : 1,
          }}
        >
          <input
            id="password_auth_enabled"
            type="checkbox"
            checked={values.password_auth_enabled}
            onChange={() => toggle('password_auth_enabled')}
            disabled={envLocked || saving === 'password_auth_enabled'}
            style={{
              width: 16,
              height: 16,
              cursor: envLocked ? 'not-allowed' : 'pointer',
              accentColor: 'var(--gold)',
            }}
          />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>
            {t('authSettings.passwordAuth.enable')}
          </span>
          {saving === 'password_auth_enabled' && <Spinner size={13} />}
          {saved === 'password_auth_enabled' && (
            <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />
          )}
        </label>

        {envLocked && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              fontSize: 13,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            {t('authSettings.passwordAuth.envLocked', {
              value: values.password_auth_enabled ? 'true' : 'false',
            })}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '40px 0' }} />

      <OIDCSettingsSection />
    </div>
  )
}
