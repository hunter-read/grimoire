import { useState } from 'react'
import { LuX, LuKeyRound } from 'react-icons/lu'
import RoleBadge from './RoleBadge'

const isMobile = window.matchMedia('(max-width: 640px)').matches

function SetPasswordInline({ onSave, onCancel }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async () => {
    if (value.length < 8) { setErr('Min 8 characters'); return }
    setSaving(true)
    try {
      await onSave(value)
      onCancel()
    } catch {
      setErr('Failed to set password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="password"
        value={value}
        onChange={e => { setValue(e.target.value); setErr('') }}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
        placeholder="New password (min 8)"
        autoFocus
        style={{
          background: 'var(--bg-input)', border: '1px solid var(--border)',
          color: 'var(--text)', borderRadius: 6, padding: '4px 8px',
          fontSize: 13, width: 180,
        }}
      />
      {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
        {saving ? '…' : 'Save'}
      </button>
      <button onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
    </div>
  )
}

export default function UserRow({ user, currentUserId, onRoleChange, onExplicitChange, onPasswordReset, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [settingPassword, setSettingPassword] = useState(false)
  const isSelf = user.id === currentUserId
  const canSetPassword = !isSelf

  if (isMobile) {
    return (
      <div style={{
        padding: '12px 14px', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 8,
      }}>
        {/* Top row: username + delete */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.username}
            </span>
            {isSelf && <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>(you)</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <RoleBadge role={user.role} />
            {confirmDelete ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Delete?</span>
                <button onClick={() => onDelete(user.id)} style={dangerBtnStyle}>Yes</button>
                <button onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>No</button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={isSelf}
                title={isSelf ? 'Cannot delete your own account' : 'Delete user'}
                aria-label={`Delete user ${user.username}`}
                style={{
                  ...ghostBtnStyle, padding: '5px 8px',
                  opacity: isSelf ? 0.3 : 1, cursor: isSelf ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <LuX size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Bottom row: role select + explicit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={user.role}
            onChange={e => onRoleChange(user.id, e.target.value)}
            disabled={isSelf}
            title={isSelf ? 'Cannot change your own role' : 'Change role'}
            style={{
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 6, padding: '4px 8px',
              fontSize: 13, cursor: isSelf ? 'not-allowed' : 'pointer',
              opacity: isSelf ? 0.4 : 1,
            }}
          >
            <option value="player">Player</option>
            <option value="gm">GM</option>
            <option value="admin">Admin</option>
          </select>

          <label
            title="Allow explicit content"
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: isSelf ? 'default' : 'pointer', opacity: isSelf ? 0.4 : 1 }}
          >
            <input
              type="checkbox"
              checked={user.allow_explicit ?? true}
              onChange={() => !isSelf && onExplicitChange(user.id, !(user.allow_explicit ?? true))}
              disabled={isSelf}
              style={{ width: 14, height: 14, cursor: isSelf ? 'not-allowed' : 'pointer', accentColor: '#e07070' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Explicit</span>
          </label>

          {canSetPassword && !settingPassword && (
            <button
              onClick={() => setSettingPassword(true)}
              title="Set password for this user"
              style={{ ...ghostBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12 }}
            >
              <LuKeyRound size={12} /> Set Password
            </button>
          )}
        </div>

        {settingPassword && (
          <div style={{ marginTop: 8 }}>
            <SetPasswordInline
              onSave={(pw) => onPasswordReset(user.id, pw)}
              onCancel={() => setSettingPassword(false)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{user.username}</span>
          {isSelf && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>(you)</span>}
        </div>

        <RoleBadge role={user.role} />

        <label
          title="Allow explicit content"
          style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: isSelf ? 'default' : 'pointer', opacity: isSelf ? 0.4 : 1 }}
        >
          <input
            type="checkbox"
            checked={user.allow_explicit ?? true}
            onChange={() => !isSelf && onExplicitChange(user.id, !(user.allow_explicit ?? true))}
            disabled={isSelf}
            style={{ width: 14, height: 14, cursor: isSelf ? 'not-allowed' : 'pointer', accentColor: '#e07070' }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Explicit</span>
        </label>

        <select
          value={user.role}
          onChange={e => onRoleChange(user.id, e.target.value)}
          disabled={isSelf}
          title={isSelf ? 'Cannot change your own role' : 'Change role'}
          style={{
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text)', borderRadius: 6, padding: '4px 8px',
            fontSize: 13, cursor: isSelf ? 'not-allowed' : 'pointer',
            opacity: isSelf ? 0.4 : 1,
          }}
        >
          <option value="player">Player</option>
          <option value="gm">GM</option>
          <option value="admin">Admin</option>
        </select>

        {canSetPassword && (
          <button
            onClick={() => setSettingPassword(v => !v)}
            title="Set password for this user"
            aria-label={`Set password for ${user.username}`}
            style={{
              ...ghostBtnStyle, padding: '5px 8px', display: 'flex', alignItems: 'center',
              color: settingPassword ? 'var(--gold)' : 'var(--text-dim)',
              outline: settingPassword ? '1px solid var(--gold-dim)' : 'none',
            }}
          >
            <LuKeyRound size={13} />
          </button>
        )}

        {confirmDelete ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Delete?</span>
            <button onClick={() => onDelete(user.id)} style={dangerBtnStyle}>Yes</button>
            <button onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>No</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={isSelf}
            title={isSelf ? 'Cannot delete your own account' : 'Delete user'}
            aria-label={`Delete user ${user.username}`}
            style={{
              ...ghostBtnStyle, padding: '5px 8px',
              opacity: isSelf ? 0.3 : 1, cursor: isSelf ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <LuX size={13} />
          </button>
        )}
      </div>

      {settingPassword && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
          <SetPasswordInline
            onSave={(pw) => onPasswordReset(user.id, pw)}
            onCancel={() => setSettingPassword(false)}
          />
        </div>
      )}
    </div>
  )
}

const ghostBtnStyle = {
  padding: '6px 12px', borderRadius: 6, fontSize: 13,
  background: 'var(--bg-card)', color: 'var(--text-dim)',
  border: '1px solid var(--border)', cursor: 'pointer',
}

const saveBtnStyle = {
  padding: '4px 12px', borderRadius: 6, fontSize: 13,
  background: 'var(--gold-dim)', color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)', cursor: 'pointer',
}

const dangerBtnStyle = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12,
  background: 'rgba(196, 80, 64, 0.15)', color: 'var(--red)',
  border: '1px solid var(--red)', cursor: 'pointer',
}
