import { useTranslation } from 'react-i18next'
import { VIS_META, badgeStyle } from './wikiShared'

/** Read-only pill showing a wiki page's visibility level. */
export default function VisibilityBadge({ visibility }) {
  const { t } = useTranslation()
  const meta = VIS_META[visibility] || VIS_META.gm
  const { Icon } = meta
  return (
    <span style={badgeStyle(meta, false)}>
      <Icon size={11} /> {t(`wiki.vis_${meta.key}`)}
    </span>
  )
}
