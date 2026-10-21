import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LuArrowRight } from 'react-icons/lu'
import EditorField from './EditorField'
import { formatDateTime, formatRelative, parseUtc } from '../../utils/relativeTime'

interface Props {
  username: string
  lastActiveAt?: string | null
  lastLoginAt?: string | null
}

/**
 * The expanded user editor's Activity field: when the account last signed in
 * and was last seen, and a way into the log lines its requests produced.
 */
export default function UserActivityField({ username, lastActiveAt, lastLoginAt }: Props) {
  const { t, i18n } = useTranslation()
  const active = parseUtc(lastActiveAt)
  const login = parseUtc(lastLoginAt)

  // The table row already says how long ago; the editor gives the exact moment.
  const line = (label: string, date: Date | null) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)', minWidth: 64 }}>{label}</span>
      {date ? (
        <time dateTime={date.toISOString()} title={formatRelative(date, i18n.language)}>
          {formatDateTime(date, i18n.language)}
        </time>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>{t('users.activity.never')}</span>
      )}
    </div>
  )

  return (
    <EditorField label={t('users.activity.label')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {line(t('users.activity.signedIn'), login)}
        {line(t('users.activity.active'), active)}
      </div>
      <Link
        to={`/settings/logs?user=${encodeURIComponent(username)}`}
        // The row toggles on click; following the link should not collapse it first.
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-start',
          fontSize: 12,
          color: 'var(--gold)',
          textDecoration: 'none',
          textUnderlineOffset: 3,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.textDecoration = 'underline'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.textDecoration = 'none'
        }}
      >
        {t('users.activity.viewLogs')}
        <LuArrowRight size={12} aria-hidden="true" />
      </Link>
    </EditorField>
  )
}
