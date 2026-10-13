import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'

/**
 * Save a personal DiceCloud v1 API key for private character URL imports.
 *
 * Keys are per-user credentials (not a shared server env). The plaintext is
 * write-only: /auth/me only reports whether one is stored.
 */
export default function DiceCloudApiKeySection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const hasKey = Boolean(user?.has_dicecloud_api_key)

  if (user?.role === 'guest') return null

  const save = async (event) => {
    event.preventDefault()
    if (!value.trim()) return
    setError(null)
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { dicecloud_api_key: value.trim() })
      setValue('')
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || t('common.save'))
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setError(null)
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { dicecloud_api_key: '' })
      setValue('')
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || t('common.save'))
    } finally {
      setSaving(false)
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
        {t('userSettings.dicecloudApiKey.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        {t('userSettings.dicecloudApiKey.description')}
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        {hasKey
          ? t('userSettings.dicecloudApiKey.saved')
          : t('userSettings.dicecloudApiKey.notSaved')}
      </p>
      <form
        onSubmit={save}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          maxWidth: 480,
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <label
            htmlFor="dicecloud-api-key"
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-dim)',
              marginBottom: 5,
            }}
          >
            {t('userSettings.dicecloudApiKey.label')}
          </label>
          <input
            id="dicecloud-api-key"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('userSettings.dicecloudApiKey.placeholder')}
            maxLength={500}
            autoComplete="off"
            disabled={saving}
            style={{ width: '100%', fontSize: 14, padding: '8px 12px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={saving || !value.trim()}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--gold-dim)',
            color: 'var(--gold)',
            border: '1px solid var(--gold)',
            cursor: saving || !value.trim() ? 'not-allowed' : 'pointer',
            opacity: saving || !value.trim() ? 0.6 : 1,
          }}
        >
          {saving ? <Spinner size={14} /> : t('userSettings.dicecloudApiKey.save')}
        </button>
        {hasKey ? (
          <button
            type="button"
            onClick={clear}
            disabled={saving}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'transparent',
              color: 'var(--text-dim)',
              border: '1px solid var(--border)',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {t('userSettings.dicecloudApiKey.clear')}
          </button>
        ) : null}
      </form>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
