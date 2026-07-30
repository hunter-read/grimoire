import { useTranslation } from 'react-i18next'
import SimpleLookupManager from './SimpleLookupManager'

/**
 * Admin panel to manage the license lookup list (OGL, ORC, CC-BY, Proprietary,
 * …). The section title/description live in the collapsible header.
 */
export default function LicenseManagerSection() {
  const { t } = useTranslation()
  return (
    <SimpleLookupManager
      endpoint="/licenses"
      listKey="licenses"
      addPlaceholder={t('lookupSettings.licensePlaceholder')}
    />
  )
}
