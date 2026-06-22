import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'

export default function ExplicitContentSection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const allowed = user?.allow_explicit ?? true

  const toggle = async () => {
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { allow_explicit: !allowed })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
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
        {t('userSettings.contentPreferences.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.contentPreferences.description')}
      </p>
      <label
        htmlFor="explicit-content-allowed"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          width: 'fit-content',
        }}
      >
        <input
          id="explicit-content-allowed"
          type="checkbox"
          checked={allowed}
          onChange={toggle}
          disabled={saving}
          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
        />
        <span style={{ fontSize: 14, color: 'var(--text)' }}>
          {t('userSettings.contentPreferences.showExplicit')}
        </span>
        {saving && <Spinner size={13} />}
      </label>
    </div>
  )
}
