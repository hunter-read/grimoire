import { useTranslation } from 'react-i18next'
import SimpleLookupManager from './SimpleLookupManager'

/**
 * Admin panel to manage the system-family lookup list. Thin wrapper over the
 * shared SimpleLookupManager; the section title/description live in the
 * collapsible header in MetadataTab.
 */
export default function SystemFamilyManagerSection() {
  const { t } = useTranslation()
  return (
    <SimpleLookupManager
      endpoint="/system-families"
      listKey="families"
      addPlaceholder={t('lookupSettings.namePlaceholder')}
    />
  )
}
