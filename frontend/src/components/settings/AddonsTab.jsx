import { useTranslation } from 'react-i18next'
import AddonsSection from './AddonsSection'
import CollapsibleSection from './CollapsibleSection'

/**
 * Admin settings tab: install and manage community add-ons (issue #203).
 *
 * Add-ons are grouped by what they do rather than where they came from —
 * everything shipping today is a metadata scraper, and future categories (VTT
 * integrations, character sheet builders) slot in alongside it.
 */
export default function AddonsTab() {
  const { t } = useTranslation()
  return (
    <div>
      <CollapsibleSection
        title={t('addons.categories.metadata')}
        description={t('addons.categories.metadataDesc')}
        storageKey="grimoire:settings:addons:metadata"
      >
        <AddonsSection />
      </CollapsibleSection>
    </div>
  )
}
