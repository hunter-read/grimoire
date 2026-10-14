import { useTranslation } from 'react-i18next'
import {
  DisplayNameSection,
  EmailSection,
  ExplicitContentSection,
  ChangePasswordSection,
  DeleteAccountSection,
  OPDSSection,
} from './UserAccountSections'
import { ReaderSection, LibrarySection, LanguageSection } from './UserPreferenceSections'
import AppearanceSection from './AppearanceSection'
import ActiveSessionsSection from './ActiveSessionsSection'
import ApiKeySection from './ApiKeySection'
import ShareLinksSection from './ShareLinksSection'
import { useUISettings } from '../../context/UISettingsContext'
import CollapsibleSection from './CollapsibleSection'
import SectionDivider from './SectionDivider'

/**
 * The account settings tab, grouped into a handful of collapsible categories.
 *
 * Everything still lives on one page — the groups only give the page structure
 * so a specific setting is findable without reading the whole thing. Grouping
 * is deliberately one level deep: a category holds settings directly, never
 * further sub-categories.
 */
export default function UserSettingsTab({ user, onLogout }) {
  const { t } = useTranslation()
  const { api_keys_enabled: keysEnabled, share_links_enabled: shareEnabled } = useUISettings()
  // `api_keys_allowed` is the server's answer for this user: admins always, anyone
  // else once an admin grants it, never a guest - and never with keys off.
  const canHoldKeys = keysEnabled !== false && Boolean(user?.api_keys_allowed)
  // Share links (issue #541): listed for every non-guest while the instance has
  // them, so someone whose permission was withdrawn can still see and revoke
  // the links they made.
  const showShareLinks = shareEnabled !== false && user?.role !== 'guest'
  return (
    <div>
      <CollapsibleSection
        title={t('userSettings.groups.profile')}
        description={t('userSettings.groups.profileDesc')}
        storageKey="grimoire:settings:account:profile"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <DisplayNameSection />
          <SectionDivider />
          <EmailSection />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('userSettings.groups.appearance')}
        description={t('userSettings.groups.appearanceDesc')}
        storageKey="grimoire:settings:account:appearance"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <LanguageSection />
          <SectionDivider />
          <AppearanceSection />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('userSettings.groups.reading')}
        description={t('userSettings.groups.readingDesc')}
        storageKey="grimoire:settings:account:reading"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <ReaderSection />
          <SectionDivider />
          <LibrarySection />
          <SectionDivider />
          <ExplicitContentSection />
          <OPDSSection />
        </div>
      </CollapsibleSection>

      {showShareLinks && (
        <CollapsibleSection
          title={t('userSettings.groups.sharing')}
          description={t('userSettings.groups.sharingDesc')}
          storageKey="grimoire:settings:account:sharing"
        >
          <ShareLinksSection canShare={Boolean(user?.share_links_allowed)} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={t('userSettings.groups.security')}
        description={t('userSettings.groups.securityDesc')}
        storageKey="grimoire:settings:account:security"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <ChangePasswordSection />
          <SectionDivider />
          <ActiveSessionsSection />
          <SectionDivider />
          {canHoldKeys && (
            <>
              <ApiKeySection />
              <SectionDivider />
            </>
          )}
          <DeleteAccountSection user={user} onLogout={onLogout} />
        </div>
      </CollapsibleSection>
    </div>
  )
}
