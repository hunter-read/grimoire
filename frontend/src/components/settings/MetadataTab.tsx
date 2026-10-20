import { useTranslation } from 'react-i18next'
import CollapsibleSection from './CollapsibleSection'
import GenreManagerSection from './GenreManagerSection'
import SystemFamilyManagerSection from './SystemFamilyManagerSection'
import ParentSystemManagerSection from './ParentSystemManagerSection'
import LicenseManagerSection from './LicenseManagerSection'
import DiceMaterialManagerSection from './DiceMaterialManagerSection'
import FolderNamingSection from './FolderNamingSection'
import VariantRulesSection from './VariantRulesSection'

/**
 * Admin settings tab: the metadata lookup lists, and the filename rules that
 * read metadata out of filenames (and write filenames back), each collapsible.
 */
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

      <CollapsibleSection
        title={t('filenameRules.folderTitle')}
        description={t('filenameRules.folderDesc')}
        storageKey="grimoire:settings:metadata:folder-naming"
      >
        <FolderNamingSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('filenameRules.variantTitle')}
        description={t('filenameRules.variantDesc')}
        storageKey="grimoire:settings:metadata:variant-rules"
      >
        <VariantRulesSection />
      </CollapsibleSection>
    </div>
  )
}
