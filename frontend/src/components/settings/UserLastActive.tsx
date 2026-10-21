import { useTranslation } from 'react-i18next'
import { formatDateTime, formatRelative, parseUtc, recency } from '../../utils/relativeTime'

interface Props {
  lastActiveAt?: string | null
  lastLoginAt?: string | null
}

// Fresh activity reads at full strength and fades as it ages, so the people
// who have drifted away stand out down the column without another badge.
const TONE = {
  day: 'var(--text)',
  month: 'var(--text-dim)',
  older: 'var(--text-muted)',
  never: 'var(--text-muted)',
} as const

/** The users table's "Last active" cell: relative time, exact times on hover. */
export default function UserLastActive({ lastActiveAt, lastLoginAt }: Props) {
  const { t, i18n } = useTranslation()
  const active = parseUtc(lastActiveAt)
  const login = parseUtc(lastLoginAt)

  if (!active) {
    return <span style={{ fontSize: 13, color: TONE.never }}>{t('users.activity.never')}</span>
  }

  const title = [
    t('users.activity.lastActiveAt', { when: formatDateTime(active, i18n.language) }),
    login && t('users.activity.lastLoginAt', { when: formatDateTime(login, i18n.language) }),
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <time
      dateTime={active.toISOString()}
      title={title}
      style={{ fontSize: 13, color: TONE[recency(active)], whiteSpace: 'nowrap' }}
    >
      {formatRelative(active, i18n.language)}
    </time>
  )
}
