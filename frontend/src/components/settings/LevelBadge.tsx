import { LEVEL_COLORS, LEVEL_LABELS } from './logShared'

/** Coloured log-level label for a logs viewer row. */
export default function LevelBadge({ level }: { level: string }) {
  const color = LEVEL_COLORS[level] ?? LEVEL_COLORS.INFO
  return (
    // No aria-label: it was English-only, and on a plain span screen readers
    // ignore it anyway. The visible level is what gets read.
    <span
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
