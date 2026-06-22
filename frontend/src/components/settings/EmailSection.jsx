import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'

export default function EmailSection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [value, setValue] = useState(user?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { email: value.trim() })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || t('userSettings.email.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.email.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.email.description')}
      </p>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          maxWidth: 460,
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <label
            htmlFor="user-email"
            style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 5 }}
          >
            {t('userSettings.email.label')}
          </label>
          <input
            id="user-email"
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('userSettings.email.placeholder')}
            maxLength={254}
            style={{ width: '100%', fontSize: 14, padding: '8px 12px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--gold-dim)',
            border: 'none',
            color: 'var(--bg-deep)',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {saving && <Spinner size={13} />}
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </form>
      {error && <div style={{ fontSize: 13, color: '#e07070', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
