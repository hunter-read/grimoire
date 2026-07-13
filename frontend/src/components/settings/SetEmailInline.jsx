import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ghostBtnStyle, saveBtnStyle } from './settingsButtons'

/**
 * Inline email editor used in the admin user editor.
 * When `persistent` is set the field stays open after saving (it lives in an
 * always-visible panel) and shows a brief "saved" hint instead of closing.
 */
export default function SetEmailInline({ initial, onSave, onCancel, persistent = false }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async () => {
    setSaving(true)
    setErr('')
    try {
      await onSave(value.trim())
      if (persistent) {
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      } else {
        onCancel()
      }
    } catch (e) {
      setErr(e?.message || t('users.failedSetEmail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="email"
        id="set-email-inline"
        aria-label={t('users.emailPlaceholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setErr('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={t('users.emailPlaceholder')}
        autoFocus
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 13,
          width: 240,
        }}
      />
      {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      {saved && <span style={{ fontSize: 12, color: 'var(--gold)' }}>{t('common.saved')}</span>}
      <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
        {saving ? '…' : t('common.save')}
      </button>
      {!persistent && (
        <button onClick={onCancel} style={ghostBtnStyle}>
          {t('common.cancel')}
        </button>
      )}
    </div>
  )
}
