import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { formatDuration } from '../../utils'
import { chapterLabel } from '../../hooks/useTrackChapters'

/**
 * The current track's chapter list, shown above the global player bar in the
 * same slot as the queue (issue #564). Clicking a chapter seeks to its start;
 * the chapter playing now is highlighted.
 */
export interface AudioChaptersPanelProps {
  chapters: Schema<'AudioChapterOut'>[]
  currentIndex: number
  onSelect: (start: number) => void
  bottom?: number
  left?: number
}

export default function AudioChaptersPanel({
  chapters,
  currentIndex,
  onSelect,
  bottom = 72,
  left = 0,
}: AudioChaptersPanelProps) {
  const { t } = useTranslation()

  return (
    <div
      role="region"
      aria-label={t('audio.player.chapters')}
      style={{
        position: 'fixed',
        left,
        right: 0,
        bottom,
        zIndex: 94,
        maxHeight: '40vh',
        overflowY: 'auto',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        boxShadow: '0 -2px 12px var(--shadow)',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          borderBottom: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          background: 'var(--bg-panel)',
        }}
      >
        {t('audio.player.chapters')} ({chapters.length})
      </div>

      {chapters.map((chapter, i) => {
        const isCurrent = i === currentIndex
        return (
          <button
            key={`${chapter.start}-${i}`}
            type="button"
            onClick={() => onSelect(chapter.start)}
            aria-current={isCurrent ? 'true' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '8px 16px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: isCurrent ? 'var(--bg-card-hover)' : 'transparent',
              color: isCurrent ? 'var(--gold)' : 'var(--text)',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 13,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                minWidth: 52,
                fontSize: 11,
                color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatDuration(chapter.start)}
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {chapterLabel(t, chapters, i)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
