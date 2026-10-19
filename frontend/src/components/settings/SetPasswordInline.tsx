import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import usePasswordRules from '../../hooks/usePasswordRules'
import { ghostBtnStyle, saveBtnStyle } from './settingsButtons'

interface Props {
  onSave: (password: string) => Promise<unknown>
  onCancel: () => void
}

/** Inline password setter used in the admin user row. */
export default function SetPasswordInline({ onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const { passwordMinLength } = usePasswordRules()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async () => {
    if (value.length < passwordMinLength) {
      setErr(t('users.minChars', { min: passwordMinLength }))
      return
    }
    setSaving(true)
    try {
      await onSave(value)
      onCancel()
    } catch {
      // The caller (UsersTab) shows the server's reason in its error banner.
      setErr(t('users.failedSetPassword'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="password"
        id="set-password-inline"
        aria-label={t('users.newPasswordPlaceholder', { min: passwordMinLength })}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setErr('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={t('users.newPasswordPlaceholder', { min: passwordMinLength })}
        autoFocus
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 13,
          width: 180,
        }}
      />
      {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
        {saving ? '…' : t('users.setPassword')}
      </button>
      <button onClick={onCancel} style={ghostBtnStyle}>
        {t('common.cancel')}
      </button>
    </div>
  )
}
