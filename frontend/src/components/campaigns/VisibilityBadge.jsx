import { useTranslation } from 'react-i18next'
import { VIS_META, badgeStyle, visLabelKey } from './wikiShared'

/** Read-only pill showing a wiki page's visibility level.
 *
 * `authorIsGm` picks the wording for the author-only level, which reads "GM
 * only" on the GM's own page and "Self only" on a player's — the same rule, seen
 * from whichever side you're on.
 */
export default function VisibilityBadge({ visibility, authorIsGm = true }) {
  const { t } = useTranslation()
  const meta = VIS_META[visibility] || VIS_META.gm
  const { Icon } = meta
  return (
    <span style={badgeStyle(meta, false)}>
      <Icon size={11} /> {t(visLabelKey(meta.key, authorIsGm))}
    </span>
  )
}
