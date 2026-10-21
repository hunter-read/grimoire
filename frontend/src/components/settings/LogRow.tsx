import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import LevelBadge from './LevelBadge'
import { LEVEL_COLORS, LEVEL_BG } from './logShared'

type Level = keyof typeof LEVEL_COLORS

interface Props {
  entry: Schema<'LogEntry'>
  searchQuery?: string
  /** Shows the line's user as a chip that narrows the log to them. Omitted
   *  while the log is already narrowed, where every chip would say the same. */
  onUserClick?: (user: string) => void
}

/** A single log line: timestamp, level badge, and message with optional highlight. */
export default function LogRow({ entry, searchQuery, onUserClick }: Props) {
  const { t } = useTranslation()
  const level = entry.level as Level
  const bg = LEVEL_BG[level] ?? 'transparent'
  const time = entry.timestamp.slice(11, 23)
  const user = entry.user

  let messageContent: ReactNode = entry.message
  if (searchQuery) {
    const idx = entry.message.toLowerCase().indexOf(searchQuery.toLowerCase())
    if (idx !== -1) {
      messageContent = (
        <>
          {entry.message.slice(0, idx)}
          <mark style={{ background: 'rgba(251,191,36,0.35)', color: 'inherit', borderRadius: 2 }}>
            {entry.message.slice(idx, idx + searchQuery.length)}
          </mark>
          {entry.message.slice(idx + searchQuery.length)}
        </>
      )
    }
  }

  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 72px 1fr',
        gap: '0 10px',
        padding: '3px 12px',
        fontSize: 12,
        fontFamily: 'monospace',
        lineHeight: 1.55,
        background: bg,
        borderBottom: '1px solid var(--border)',
        wordBreak: 'break-word',
      }}
    >
      <span
        role="cell"
        aria-label={`Time: ${time}`}
        style={{ color: 'var(--text-muted)', flexShrink: 0, userSelect: 'none' }}
      >
        {time}
      </span>
      <span role="cell">
        <LevelBadge level={entry.level} />
      </span>
      <span role="cell" style={{ color: LEVEL_COLORS[level] ?? LEVEL_COLORS.INFO }}>
        {user && onUserClick && (
          <button
            type="button"
            onClick={() => onUserClick(user)}
            title={t('logs.filterToUser', { user })}
            style={userChipStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--gold)'
              e.currentTarget.style.borderColor = 'var(--gold-dim)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            {user}
          </button>
        )}
        <span aria-label={`Message: ${entry.message}`}>{messageContent}</span>
      </span>
    </div>
  )
}

const userChipStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  lineHeight: '16px',
  padding: '0 6px',
  marginRight: 8,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  verticalAlign: 'baseline',
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  display: 'inline-block',
  transition: 'color 0.15s, border-color 0.15s',
}
