import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

export default function ChangePasswordSection() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (next !== confirm) {
      setError(t('userSettings.changePassword.mismatch'))
      return
    }
    if (next.length < 8) {
      setError(t('userSettings.changePassword.tooShort'))
      return
    }
    setSaving(true)
    try {
      await api.patch('/users/me/password', { current_password: current, new_password: next })
      setSaved(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err?.message || t('userSettings.changePassword.failed'))
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    {
      id: 'change-password-current',
      label: t('userSettings.changePassword.currentPassword'),
      value: current,
      onChange: setCurrent,
      complete: 'current-password',
    },
    {
      id: 'change-password-new',
      label: t('userSettings.changePassword.newPassword'),
      value: next,
      onChange: setNext,
      complete: 'new-password',
    },
    {
      id: 'change-password-confirm',
      label: t('userSettings.changePassword.confirmNewPassword'),
      value: confirm,
      onChange: setConfirm,
      complete: 'new-password',
    },
  ]

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        {t('userSettings.changePassword.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.changePassword.description')}
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}
      >
        {fields.map(({ label, value, onChange, complete, id }) => (
          <div key={label}>
            <label
              htmlFor={id}
              style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 5 }}
            >
              {label}
            </label>
            <input
              id={id}
              type="password"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              required
              autoComplete={complete}
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', boxSizing: 'border-box' }}
            />
          </div>
        ))}

        {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving && <Spinner size={13} />}
            {saving
              ? t('userSettings.changePassword.saving')
              : t('userSettings.changePassword.updatePassword')}
          </button>
          {saved && (
            <span
              style={{
                fontSize: 13,
                color: 'var(--green)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <LuCircleCheck size={14} /> {t('userSettings.changePassword.passwordUpdated')}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
