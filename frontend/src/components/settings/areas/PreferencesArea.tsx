import { useTranslation } from 'react-i18next'
import CollapsibleSection from '../CollapsibleSection'
import SettingsSection from '../SettingsSection'
import { LanguageSection, LibrarySection, ReaderSection } from '../UserPreferenceSections'
import AppearanceSection from '../AppearanceSection'
import ExplicitContentSection from '../ExplicitContentSection'
import MySidebarStatsSection from '../MySidebarStatsSection'

/** How Grimoire looks and reads for you. */
export default function PreferencesArea() {
  const { t } = useTranslation()
  return (
    <>
      <CollapsibleSection
        id="look"
        title={t('settings.groups.look')}
        description={t('userSettings.groups.appearanceDesc')}
        storageKey="grimoire:settings:account:appearance"
      >
        <div className="settings-stack">
          <SettingsSection id="language">
            <LanguageSection />
          </SettingsSection>
          <SettingsSection id="theme">
            <AppearanceSection />
          </SettingsSection>
          <SettingsSection id="my-sidebar-stats">
            <MySidebarStatsSection />
          </SettingsSection>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="reading"
        title={t('settings.groups.reading')}
        description={t('settings.groups.readingDesc')}
        storageKey="grimoire:settings:account:reading"
      >
        <div className="settings-stack">
          <SettingsSection id="reader">
            <ReaderSection />
          </SettingsSection>
          <SettingsSection id="library-browsing">
            <LibrarySection />
          </SettingsSection>
          <SettingsSection id="content-preferences">
            <ExplicitContentSection />
          </SettingsSection>
        </div>
      </CollapsibleSection>
    </>
  )
}
