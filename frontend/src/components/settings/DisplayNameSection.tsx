import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'

export default function DisplayNameSection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [value, setValue] = useState(user?.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { display_name: value.trim() })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || t('common.save'))
    } finally {
      setSaving(false)
    }
  }

  // No heading of its own: this sits under the Profile group heading, and the
  // field's own label names it. The saved tick moves next to the field label.
  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.6 }}>
        {t('userSettings.displayName.description')}
      </p>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          maxWidth: 400,
        }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <label
            htmlFor="display-name"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--text-dim)',
              marginBottom: 5,
            }}
          >
            {t('userSettings.displayName.label')}
            {saved && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
          </label>
          <input
            id="display-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={user?.username}
            maxLength={100}
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
          {saving ? t('userSettings.displayName.saving') : t('userSettings.displayName.save')}
        </button>
      </form>
      {error && <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
