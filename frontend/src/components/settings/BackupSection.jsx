import { useState } from 'react'
import BackupListSection from './BackupListSection'
import BackupScheduleSection from './BackupScheduleSection'

export default function BackupSection() {
  // Saving the schedule can change the storage directory, which changes which
  // backups the list should be showing — so a save re-fetches the list.
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div>
      <BackupListSection refreshKey={refreshKey} />
      <div style={{ height: 32 }} />
      <BackupScheduleSection onSaved={() => setRefreshKey((k) => k + 1)} />
    </div>
  )
}
