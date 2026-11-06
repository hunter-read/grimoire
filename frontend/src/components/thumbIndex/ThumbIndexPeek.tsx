import { useTranslation } from 'react-i18next'
import type { RailTab } from '../../utils/thumbIndex'

interface Props {
  tab: RailTab
  /** The tab's label as the rail shows it. */
  label: string
  /** "9 folders · 1,012 maps". */
  summary: string
  /** Vertical centre of the tab it belongs to, in px from the rail's top. */
  top: number
  /** Opened from the keyboard: say how to act on it. */
  keyboard: boolean
  /** A finger dragging along the rail: just the letter, large. */
  scrubbing: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
}

/**
 * The preview beside a rail tab: what the letter holds and its first few names.
 *
 * Supplementary - the tab's own accessible name already carries the letter and
 * the count - so it is hidden from assistive technology rather than announced a
 * second time. It stays open while the pointer is over it (WCAG 1.4.13) and
 * Escape on the rail dismisses it.
 */
export default function ThumbIndexPeek({
  tab,
  label,
  summary,
  top,
  keyboard,
  scrubbing,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const { t } = useTranslation()
  if (scrubbing) {
    return (
      <div aria-hidden="true" className="thumb-index__bubble" style={{ top }}>
        {label}
      </div>
    )
  }
  const more = tab.count - tab.preview.length
  return (
    <div
      aria-hidden="true"
      className="thumb-index__peek"
      style={{ top }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <p className="thumb-index__peek-title">
        {label}
        <span>{summary}</span>
      </p>
      {tab.preview.length > 0 && (
        <ul>
          {tab.preview.map((name, i) => (
            <li key={`${i}-${name}`}>{name}</li>
          ))}
          {more > 0 && (
            <li className="thumb-index__peek-more">{t('thumbIndex.more', { count: more })}</li>
          )}
        </ul>
      )}
      {keyboard && <p className="thumb-index__peek-hint">{t('thumbIndex.enterToJump')}</p>}
    </div>
  )
}
