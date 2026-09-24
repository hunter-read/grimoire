import SidebarVisibilitySection from './SidebarVisibilitySection'
import StatsDisplaySection from './StatsDisplaySection'
import ApiKeySection from './ApiKeySection'
import CampaignUploadsSection from './CampaignUploadsSection'
import FolderCategorySection from './FolderCategorySection'
import CategoryAccessSection from './CategoryAccessSection'
import { useUISettings } from '../../context/UISettingsContext'

export default function AppSettingsTab() {
  const { api_keys_enabled: keysEnabled } = useUISettings()
  return (
    <div>
      <SidebarVisibilitySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <StatsDisplaySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <CampaignUploadsSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <FolderCategorySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <CategoryAccessSection />
      {keysEnabled !== false && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
          <ApiKeySection scope="all" />
        </>
      )}
    </div>
  )
}
