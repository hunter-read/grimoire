import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserSettingsTab from './UserSettingsTab'

// Each section is covered by its own test file; stub them so this one asserts
// the tab's composition and ordering rather than re-testing their internals.
// The factories are inlined because vi.mock is hoisted above any local helper.
vi.mock('./UserAccountSections', () => ({
  DisplayNameSection: () => <div>display-name</div>,
  EmailSection: () => <div>email</div>,
  ExplicitContentSection: () => <div>explicit</div>,
  ChangePasswordSection: () => <div>password</div>,
  DeleteAccountSection: ({ user }) => <div>delete:{user?.username}</div>,
  OPDSSection: () => <div>opds</div>,
}))

vi.mock('./UserPreferenceSections', () => ({
  ReaderSection: () => <div>reader</div>,
  LibrarySection: () => <div>library</div>,
  LanguageSection: () => <div>language</div>,
}))

vi.mock('./AppearanceSection', () => ({ default: () => <div>appearance</div> }))

vi.mock('./SectionDivider', () => ({ default: () => <hr /> }))

describe('UserSettingsTab', () => {
  it('renders every account and preference section', () => {
    render(<UserSettingsTab user={{ username: 'ada' }} onLogout={() => {}} />)

    for (const label of [
      'display-name',
      'email',
      'language',
      'appearance',
      'reader',
      'library',
      'explicit',
      'opds',
      'password',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  // Appearance belongs with the other presentation preferences, immediately
  // after Language, rather than in a settings tab of its own.
  it('places Appearance directly after Language', () => {
    const { container } = render(<UserSettingsTab user={{}} onLogout={() => {}} />)
    const text = Array.from(container.querySelectorAll('div'))
      .map((n) => n.textContent)
      .join('|')

    expect(text.indexOf('language')).toBeLessThan(text.indexOf('appearance'))
    expect(text.indexOf('appearance')).toBeLessThan(text.indexOf('reader'))
  })

  it('passes the user through to the delete-account section', () => {
    render(<UserSettingsTab user={{ username: 'ada' }} onLogout={() => {}} />)
    expect(screen.getByText('delete:ada')).toBeInTheDocument()
  })
})
