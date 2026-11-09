import SettingsSection from '../SettingsSection'
import ShareLinkRolesSection from '../ShareLinkRolesSection'
import CategoryAccessSection from '../CategoryAccessSection'
import FolderAccessSection from '../FolderAccessSection'
import CampaignUploadsSection from '../CampaignUploadsSection'
import ApiKeySection from '../ApiKeySection'
import type { SettingsVisibility } from '../registry'

interface AccessAreaProps {
  visibility: SettingsVisibility
}

/**
 * What people may do across the whole server: share links by role, restricted
 * categories and folders, campaign upload limits, and every API key in use.
 */
export default function AccessArea({ visibility }: AccessAreaProps) {
  return (
    <div className="settings-stack">
      {visibility.shareLinks && (
        <SettingsSection id="share-link-roles">
          <ShareLinkRolesSection />
        </SettingsSection>
      )}
      <SettingsSection id="category-access">
        <CategoryAccessSection />
      </SettingsSection>
      <SettingsSection id="folder-access">
        <FolderAccessSection />
      </SettingsSection>
      <SettingsSection id="campaign-uploads">
        <CampaignUploadsSection />
      </SettingsSection>
      {visibility.apiKeysOnInstance && (
        <SettingsSection id="all-api-keys">
          <ApiKeySection scope="all" />
        </SettingsSection>
      )}
    </div>
  )
}
