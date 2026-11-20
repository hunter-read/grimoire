import { useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { Schema } from '../../api'
import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'
import useDialogFocus from '../../hooks/useDialogFocus'
import ApiKeyPermissionPicker from './ApiKeyPermissionPicker'
import { EXPIRY_CHOICES, expiryFromDays, formatWhen } from './apiKeyUtils'

const KEEP = 'keep'

type Permission = Schema<'ApiKeyPermissionOut'>

interface Props {
  apiKey: Schema<'ApiKeyOut'> | null
  permissions: Permission[]
  onSave: (payload: Schema<'ApiKeyCreate'>) => Promise<unknown>
  onClose: () => void
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-control)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 14,
}

// Create or edit an API key: its name, expiry, and its level per permission
// (ApiKeyPermissionPicker). `apiKey` is null when creating.
export default function ApiKeyDialog({ apiKey, permissions, onSave, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const editing = Boolean(apiKey)
  const [name, setName] = useState(apiKey?.name || '')
  const [levels, setLevels] = useState<Record<string, string>>(() => ({
    ...(apiKey?.permissions || {}),
  }))
  // Editing starts on "keep the current expiry"; creating defaults to 90 days.
  const [expiry, setExpiry] = useState<string>(editing ? KEEP : '90')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Focus in on open (the name field), held inside, Escape closes, and back to
  // the button that opened it afterwards.
  const formRef = useRef<HTMLFormElement>(null)
  useDialogFocus(formRef, { onClose })

  const setLevel = (id: string, level: string) => setLevels((prev) => ({ ...prev, [id]: level }))

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('appSettings.apiKeys.dialog.nameRequired'))
      return
    }
    const payload: Schema<'ApiKeyCreate'> = { name: name.trim(), permissions: levels }
    if (expiry !== KEEP) {
      payload.expires_at = expiryFromDays(expiry === 'never' ? null : Number(expiry))
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(payload)
    } catch (err) {
      setError((err as Error | null)?.message || t('appSettings.apiKeys.dialog.saveFailed'))
      setSaving(false)
    }
  }

  const currentExpiry = apiKey?.expires_at
    ? t('appSettings.apiKeys.dialog.keepExpiry', {
        when: formatWhen(apiKey.expires_at, i18n.language),
      })
    : t('appSettings.apiKeys.dialog.keepNever')

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-dialog-title"
        onSubmit={(e) => void submit(e)}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 640,
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <h2 id="api-key-dialog-title" style={{ marginTop: 0, fontSize: 16, marginBottom: 16 }}>
          {editing
            ? t('appSettings.apiKeys.dialog.editTitle')
            : t('appSettings.apiKeys.dialog.createTitle')}
        </h2>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <label style={{ flex: '2 1 240px', fontSize: 13, color: 'var(--text-dim)' }}>
            {t('appSettings.apiKeys.dialog.name')}
            <input
              type="text"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('appSettings.apiKeys.dialog.namePlaceholder')}
              autoComplete="off"
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={{ flex: '1 1 160px', fontSize: 13, color: 'var(--text-dim)' }}>
            {t('appSettings.apiKeys.dialog.expiration')}
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            >
              {editing && <option value={KEEP}>{currentExpiry}</option>}
              {EXPIRY_CHOICES.map((days) =>
                days == null ? (
                  <option key="never" value="never">
                    {t('appSettings.apiKeys.dialog.never')}
                  </option>
                ) : (
                  <option key={days} value={String(days)}>
                    {t('appSettings.apiKeys.dialog.days', { count: days })}
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          {t('appSettings.apiKeys.dialog.permissions')}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
          {t('appSettings.apiKeys.dialog.permissionsHint')}
        </p>
        <ApiKeyPermissionPicker permissions={permissions} levels={levels} onChange={setLevel} />

        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 6,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              cursor: saving ? 'default' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving && <Spinner size={12} />}
            {editing
              ? t('appSettings.apiKeys.dialog.save')
              : t('appSettings.apiKeys.dialog.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
