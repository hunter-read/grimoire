import { useTranslation } from 'react-i18next'
import CollapsibleSection from './CollapsibleSection'
import GenreManagerSection from './GenreManagerSection'
import SystemFamilyManagerSection from './SystemFamilyManagerSection'
import ParentSystemManagerSection from './ParentSystemManagerSection'
import LicenseManagerSection from './LicenseManagerSection'
import DiceMaterialManagerSection from './DiceMaterialManagerSection'

/** Admin settings tab: manage the metadata lookup lists, each collapsible. */
export default function MetadataTab() {
  const { t } = useTranslation()
  return (
    <div>
      <CollapsibleSection
        title={t('lookupSettings.genresTitle')}
        description={t('lookupSettings.genresDesc')}
        storageKey="grimoire:settings:metadata:genres"
      >
        <GenreManagerSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('lookupSettings.familiesTitle')}
        description={t('lookupSettings.familiesDesc')}
        storageKey="grimoire:settings:metadata:families"
      >
        <SystemFamilyManagerSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('lookupSettings.parentSystemsTitle')}
        description={t('lookupSettings.parentSystemsDesc')}
        storageKey="grimoire:settings:metadata:parent-systems"
      >
        <ParentSystemManagerSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('lookupSettings.licensesTitle')}
        description={t('lookupSettings.licensesDesc')}
        storageKey="grimoire:settings:metadata:licenses"
      >
        <LicenseManagerSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('lookupSettings.diceTitle')}
        description={t('lookupSettings.diceDesc')}
        storageKey="grimoire:settings:metadata:dice-materials"
      >
        <DiceMaterialManagerSection />
      </CollapsibleSection>
    </div>
  )
}
