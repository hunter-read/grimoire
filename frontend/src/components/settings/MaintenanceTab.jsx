import RescanSection from './RescanSection'
import ScheduledRescanSection from './ScheduledRescanSection'
import ExportTagsSection from './ExportTagsSection'
import DatabaseCleanupSection from './DatabaseCleanupSection'

export default function MaintenanceTab() {
  return (
    <div>
      <RescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ScheduledRescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ExportTagsSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <DatabaseCleanupSection />
    </div>
  )
}
