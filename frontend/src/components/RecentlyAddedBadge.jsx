import { useTranslation } from 'react-i18next'
import { LuSparkles } from 'react-icons/lu'
import { isRecentlyAdded } from '../utils/recentlyAdded'

/**
 * A small sparkle marking a library item - book, map, token, audio track or 3D
 * model - added in the last few days (issue #199). Hovering it reads "New".
 * Renders nothing for an older item or one with no recorded date, so callers
 * can drop it in unconditionally.
 */
export default function RecentlyAddedBadge({ addedAt, size = 14, style }) {
  const { t } = useTranslation()
  if (!isRecentlyAdded(addedAt)) return null
  const label = t('common.newBadge')
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="recently-added-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        color: 'var(--gold)',
        marginRight: 6,
        verticalAlign: 'middle',
        ...style,
      }}
    >
      <LuSparkles size={size} aria-hidden="true" />
    </span>
  )
}
