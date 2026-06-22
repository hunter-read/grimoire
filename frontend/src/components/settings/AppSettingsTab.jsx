import SidebarVisibilitySection from './SidebarVisibilitySection'
import StatsDisplaySection from './StatsDisplaySection'
import ApiKeySection from './ApiKeySection'
import CampaignUploadsSection from './CampaignUploadsSection'

export default function AppSettingsTab() {
  return (
    <div>
      <SidebarVisibilitySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <StatsDisplaySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <CampaignUploadsSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ApiKeySection />
    </div>
  )
}
