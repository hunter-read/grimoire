import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ghostBtnStyle, saveBtnStyle } from './settingsButtons'

interface Props {
  initial?: string | null
  onSave: (email: string) => unknown
  onCancel: () => void
  persistent?: boolean
}

/**
 * Inline email editor used in the admin user editor.
 * When `persistent` is set the field stays open after saving (it lives in an
 * always-visible panel) and shows a brief "saved" hint instead of closing.
 */
export default function SetEmailInline({ initial, onSave, onCancel, persistent = false }: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const errId = useId()

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
      setErr((e as Error | null)?.message || t('users.failedSetEmail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="email"
        id="set-email-inline"
        name="email"
        // Another user's address: not something to fill from the admin's own.
        autoComplete="off"
        spellCheck={false}
        aria-label={t('users.emailPlaceholder')}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? errId : undefined}
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
        // Only when opened on purpose: in the always-open editor, focus jumping
        // into this field on expanding a row would lose a screen reader's place.
        autoFocus={!persistent}
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-control)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 13,
          width: 240,
        }}
      />
      {err && (
        <span id={errId} role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>
          {err}
        </span>
      )}
      {/* Always mounted, so "Saved" is announced when it appears. */}
      <span
        role="status"
        // Out of the row while empty, so it doesn't add a gap.
        className={saved ? undefined : 'sr-only'}
        style={{ fontSize: 12, color: 'var(--gold)' }}
      >
        {saved ? t('common.saved') : ''}
      </span>
      <button onClick={handleSave} disabled={saving} aria-busy={saving} style={saveBtnStyle}>
        {saving ? t('common.saving') : t('common.save')}
      </button>
      {!persistent && (
        <button onClick={onCancel} style={ghostBtnStyle}>
          {t('common.cancel')}
        </button>
      )}
    </div>
  )
}
