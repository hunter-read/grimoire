import { useTranslation } from 'react-i18next'
import SimpleLookupManager from './SimpleLookupManager'

/**
 * Admin panel to manage the parent-system lookup list (e.g. "Dungeons &
 * Dragons"). The section title/description live in the collapsible header.
 */
export default function ParentSystemManagerSection() {
  const { t } = useTranslation()
  return (
    <SimpleLookupManager
      endpoint="/parent-systems"
      listKey="parent_systems"
      addPlaceholder={t('lookupSettings.parentSystemPlaceholder')}
    />
  )
}
