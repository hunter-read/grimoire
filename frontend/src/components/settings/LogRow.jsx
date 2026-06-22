import LevelBadge from './LevelBadge'
import { LEVEL_COLORS, LEVEL_BG } from './logShared'

/** A single log line: timestamp, level badge, and message with optional highlight. */
export default function LogRow({ entry, searchQuery }) {
  const bg = LEVEL_BG[entry.level] ?? 'transparent'
  const time = entry.timestamp.slice(11, 23)

  let messageContent = entry.message
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
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        wordBreak: 'break-word',
      }}
    >
      <span
        role="cell"
        aria-label={`Time: ${time}`}
        style={{ color: '#6b7280', flexShrink: 0, userSelect: 'none' }}
      >
        {time}
      </span>
      <span role="cell">
        <LevelBadge level={entry.level} />
      </span>
      <span
        role="cell"
        aria-label={`Message: ${entry.message}`}
        style={{ color: LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.INFO }}
      >
        {messageContent}
      </span>
    </div>
  )
}
