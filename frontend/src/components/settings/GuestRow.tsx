import { useState, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUserCheck, LuTrash2, LuX } from 'react-icons/lu'
import api, { type BodyOf, type Schema } from '../../api'
import usePasswordRules from '../../hooks/usePasswordRules'

interface Props {
  guest: Schema<'backend__routers__users___schemas__GuestOut'>
  passwordAuthEnabled?: boolean
  converting?: boolean
  selected?: boolean
  onToggleSelected: () => void
  onStartConvert: () => void
  onCancelConvert: () => void
  onConverted: (user: Schema<'UserOut'>) => void
  onDeleted: () => void
  onError: (message: string) => void
}

// A failed request's message: the server's `detail` when it sent one.
const failure = (err: unknown): string | undefined => {
  const e = err as { body?: { detail?: unknown }; message?: string } | null | undefined
  const detail = e?.body?.detail
  return (typeof detail === 'string' && detail) || e?.message || undefined
}

// A single guest row with an inline convert-to-permanent form, a delete action,
// and a checkbox for selecting it as part of a merge. Password is only asked for
// when password auth is enabled on the server.
//
// Delete works regardless of whether the guest still has a campaign or an
// inviter — an orphaned guest (its campaign was deleted out from under it) is
// exactly the kind of row an admin needs to be able to clear out.
export default function GuestRow({
  guest,
  passwordAuthEnabled,
  converting,
  selected,
  onToggleSelected,
  onStartConvert,
  onCancelConvert,
  onConverted,
  onDeleted,
  onError,
}: Props) {
  const { t } = useTranslation()
  const { passwordMinLength } = usePasswordRules()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('player')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onError('')
    setSaving(true)
    try {
      const body: BodyOf<'/users/{user_id}/convert', 'post'> = { username: username.trim(), role }
      if (passwordAuthEnabled) body.password = password
      const updated = (await api.post(`/users/${guest.id}/convert`, body)) as Schema<'UserOut'>
      onConverted(updated)
    } catch (err) {
      onError(failure(err) || t('guests.convertFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(t('guests.confirmDelete'))) return
    onError('')
    setDeleting(true)
    try {
      await api.delete(`/users/${guest.id}`)
      onDeleted()
    } catch (err) {
      onError(failure(err) || t('guests.deleteFailed'))
      setDeleting(false)
    }
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border)' }}>
        <td style={{ ...cellStyle, width: 36 }}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelected}
            aria-label={t('guests.selectGuest', { name: guest.display_name || guest.id })}
            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--gold)' }}
          />
        </td>
        <td style={cellStyle}>{guest.display_name || '—'}</td>
        <td style={cellStyle}>{guest.campaign_name || <span style={dimStyle}>—</span>}</td>
        <td style={cellStyle}>{guest.invited_by || <span style={dimStyle}>—</span>}</td>
        <td style={{ ...cellStyle, textAlign: 'right' }}>
          {converting ? (
            <button onClick={onCancelConvert} style={iconBtnStyle} aria-label={t('common.cancel')}>
              <LuX size={14} />
            </button>
          ) : (
            <div
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={onStartConvert}
                style={{ ...iconBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <LuUserCheck size={14} /> {t('guests.convert')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                aria-label={t('guests.delete')}
                title={t('guests.delete')}
                style={{
                  ...iconBtnStyle,
                  color: 'var(--danger)',
                  opacity: deleting ? 0.5 : 1,
                  cursor: deleting ? 'default' : 'pointer',
                }}
              >
                <LuTrash2 size={14} />
              </button>
            </div>
          )}
        </td>
      </tr>
      {converting && (
        <tr style={{ background: 'var(--bg-deep)' }}>
          <td colSpan={5} style={{ padding: '12px 14px' }}>
            <form
              onSubmit={submit}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('guests.usernamePlaceholder')}
                required
                style={inputStyle}
              />
              {passwordAuthEnabled && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('users.newPasswordPlaceholder', { min: passwordMinLength })}
                  required
                  minLength={passwordMinLength}
                  style={inputStyle}
                />
              )}
              <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                <option value="player">{t('users.roles.player')}</option>
                <option value="gm">{t('users.roles.gm')}</option>
                <option value="admin">{t('users.roles.admin')}</option>
              </select>
              <button type="submit" disabled={saving} style={saveBtnStyle}>
                {saving ? t('guests.converting') : t('guests.convert')}
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

const cellStyle: CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--text)' }
const dimStyle: CSSProperties = { color: 'var(--text-dim)' }

const iconBtnStyle: CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}

const inputStyle: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
}

const saveBtnStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}
