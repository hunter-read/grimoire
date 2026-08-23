import { useTranslation } from 'react-i18next'
import FileManagerSection from './FileManagerSection'
import RescanSection from './RescanSection'
import ScheduledRescanSection from './ScheduledRescanSection'
import SidecarExportSection from './SidecarExportSection'
import DatabaseCleanupSection from './DatabaseCleanupSection'
import DuplicatesSection from './DuplicatesSection'
import BackupSection from './BackupSection'
import CollapsibleSection from './CollapsibleSection'
import SectionDivider from './SectionDivider'

/**
 * The maintenance settings tab, grouped into collapsible categories the same
 * way the account tab is.
 *
 * Everything still lives on one page — the groups only give the page structure
 * so a specific setting is findable without reading the whole thing. Grouping
 * is deliberately one level deep: a category holds settings directly, never
 * further sub-categories.
 */
export default function MaintenanceTab() {
  const { t } = useTranslation()

  return (
    <div>
      <CollapsibleSection
        title={t('maintenance.groups.scanning')}
        description={t('maintenance.groups.scanningDesc')}
        storageKey="grimoire:settings:maintenance:scanning"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <RescanSection />
          <SectionDivider />
          <DatabaseCleanupSection />
          <SectionDivider />
          <ScheduledRescanSection />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('maintenance.groups.library')}
        description={t('maintenance.groups.libraryDesc')}
        storageKey="grimoire:settings:maintenance:library"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <FileManagerSection />
          <SectionDivider />
          <DuplicatesSection />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('maintenance.groups.metadata')}
        description={t('maintenance.groups.metadataDesc')}
        storageKey="grimoire:settings:maintenance:metadata"
      >
        <SidecarExportSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('maintenance.groups.backups')}
        description={t('maintenance.groups.backupsDesc')}
        storageKey="grimoire:settings:maintenance:backups"
      >
        <BackupSection />
      </CollapsibleSection>
    </div>
  )
}
