import { DisplayNameSection, ExplicitContentSection, ChangePasswordSection, DeleteAccountSection, OPDSSection } from './UserAccountSections'
import { ReaderSection, LibrarySection, LanguageSection } from './UserPreferenceSections'

function SectionDivider() {
  return <div style={{ borderTop: '1px solid var(--border)' }} />
}

export default function UserSettingsTab({ user, onLogout }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <DisplayNameSection />
      <SectionDivider />
      <LanguageSection />
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
