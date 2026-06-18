import {
  DisplayNameSection,
  EmailSection,
  ExplicitContentSection,
  ChangePasswordSection,
  DeleteAccountSection,
  OPDSSection,
} from './UserAccountSections'
import { ReaderSection, LibrarySection, LanguageSection } from './UserPreferenceSections'
import SectionDivider from './SectionDivider'
import DemoModeBanner from './DemoModeBanner'
import { useUISettings } from '../../context/UISettingsContext'

export default function UserSettingsTab({ user, onLogout }) {
  const { demo_mode } = useUISettings()
  // In demo mode, non-admin accounts can view but not change anything here.
  const locked = demo_mode && user?.role !== 'admin'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {locked && <DemoModeBanner />}
      {/* A disabled fieldset natively disables every nested input and button. */}
      <fieldset
        disabled={locked}
        style={{
          border: 'none',
          margin: 0,
          padding: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 40,
        }}
      >
        <DisplayNameSection />
        <SectionDivider />
        <EmailSection />
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
      </fieldset>
    </div>
  )
}
