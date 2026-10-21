import { useTranslation } from 'react-i18next'
import { LuUser } from 'react-icons/lu'

interface Props {
  /** The username the log is narrowed to, or '' for everyone. */
  value: string
  /** Usernames with lines in the buffer, as the server lists them. */
  users: string[]
  onChange: (user: string) => void
}

/** The log toolbar's user picker (issue #576). */
export default function LogUserFilter({ value, users, onChange }: Props) {
  const { t } = useTranslation()
  // A filter arriving by link may name someone with no lines (yet): keep them
  // selectable rather than letting the select fall back to "All users".
  const options = value && !users.includes(value) ? [value, ...users] : users
  const active = Boolean(value)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <LuUser
        size={13}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: active ? 'var(--gold)' : 'var(--text-muted)',
          pointerEvents: 'none',
        }}
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('logs.userFilterAriaLabel')}
        style={{
          maxWidth: 200,
          paddingLeft: 30,
          paddingRight: 10,
          paddingTop: 6,
          paddingBottom: 6,
          fontSize: 13,
          borderRadius: 6,
          cursor: 'pointer',
          background: active ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: `1px solid ${active ? 'var(--gold-dim)' : 'var(--border)'}`,
          color: active ? 'var(--gold)' : 'var(--text-dim)',
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        }}
      >
        <option value="">{t('logs.allUsers')}</option>
        {options.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  )
}
