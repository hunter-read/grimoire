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
import SectionDivider from './SectionDivider'

export default function UserSettingsTab({ user, onLogout }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <DisplayNameSection />
      <SectionDivider />
      <EmailSection />
      <SectionDivider />
      <LanguageSection />
      <SectionDivider />
      <AppearanceSection />
      <SectionDivider />
      <ReaderSection />
      <SectionDivider />
      <LibrarySection />
      <SectionDivider />
      <ExplicitContentSection />
      <OPDSSection />
      <SectionDivider />
      <ChangePasswordSection />
      <SectionDivider />
      <DeleteAccountSection user={user} onLogout={onLogout} />
    </div>
  )
}
