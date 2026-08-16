import FileManagerSection from './FileManagerSection'
import RescanSection from './RescanSection'
import ScheduledRescanSection from './ScheduledRescanSection'
import FolderCategorySection from './FolderCategorySection'
import ExportTagsSection from './ExportTagsSection'
import DatabaseCleanupSection from './DatabaseCleanupSection'

export default function MaintenanceTab() {
  return (
    <div>
      <FileManagerSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <RescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ScheduledRescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <FolderCategorySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ExportTagsSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <DatabaseCleanupSection />
    </div>
  )
}
