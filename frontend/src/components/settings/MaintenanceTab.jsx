import FileManagerSection from './FileManagerSection'
import RescanSection from './RescanSection'
import ScheduledRescanSection from './ScheduledRescanSection'
import SidecarExportSection from './SidecarExportSection'
import DatabaseCleanupSection from './DatabaseCleanupSection'
import BackupSection from './BackupSection'

export default function MaintenanceTab() {
  return (
    <div>
      <FileManagerSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <RescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ScheduledRescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <SidecarExportSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <DatabaseCleanupSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <BackupSection />
    </div>
  )
}
