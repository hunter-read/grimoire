import { LEVEL_COLORS, LEVEL_LABELS } from './logShared'

/** Coloured log-level label for a logs viewer row. */
export default function LevelBadge({ level }) {
  const color = LEVEL_COLORS[level] ?? LEVEL_COLORS.INFO
  return (
    <span
      aria-label={`Log level: ${LEVEL_LABELS[level] ?? level}`}
      style={{
        color,
        fontWeight: level === 'DEBUG' ? 400 : 600,
        letterSpacing: '0.02em',
        minWidth: 56,
        display: 'inline-block',
      }}
    >
      {LEVEL_LABELS[level] ?? level}
    </span>
  )
}
