import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareLinkRolesSection from './ShareLinkRolesSection'
import { settings as settingsApi, type Schema } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

type Settings = Schema<'SettingsResponse'>

const settings = (overrides: Partial<Settings> = {}) =>
  ({
    share_links_enabled: true,
    share_links_role_gm: true,
    share_links_role_player: false,
    ...overrides,
  }) as Settings

const get = vi.mocked(settingsApi.get)
const patch = vi.mocked(settingsApi.patch)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShareLinkRolesSection', () => {
  it('renders nothing until the settings arrive, or when they fail to', async () => {
    get.mockRejectedValue(new Error('down'))
    const { container } = render(<ShareLinkRolesSection />)
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('is a setting with its own heading and description', async () => {
    get.mockResolvedValue(settings() as never)
    render(<ShareLinkRolesSection />)
    expect(
      await screen.findByRole('heading', { level: 3, name: 'settings.entries.shareLinkRoles' })
    ).toBeInTheDocument()
    expect(screen.getByText('users.shareLinks.rolesHint')).toBeInTheDocument()
    expect(screen.getByLabelText('users.roles.admin')).toBeChecked()
    expect(screen.getByLabelText('users.roles.admin')).toBeDisabled()
    expect(screen.getByLabelText('users.roles.gm')).toBeChecked()
    expect(screen.getByLabelText('users.roles.player')).not.toBeChecked()
  })

  it('says so when share links are off on this server', async () => {
    get.mockResolvedValue(settings({ share_links_enabled: false }) as never)
    render(<ShareLinkRolesSection />)
    expect(await screen.findByText('users.shareLinks.disabled')).toBeInTheDocument()
    expect(screen.queryByLabelText('users.roles.gm')).toBeNull()
  })

  it('flips a role default and tells the caller', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockResolvedValue(settings({ share_links_role_player: true }) as never)
    const onChanged = vi.fn()
    render(<ShareLinkRolesSection onChanged={onChanged} />)
    fireEvent.click(await screen.findByLabelText('users.roles.player'))
    await waitFor(() => expect(screen.getByLabelText('users.roles.player')).toBeChecked())
    expect(patch).toHaveBeenCalledWith({ share_links_role_player: true })
    expect(onChanged).toHaveBeenCalled()
  })

  it('works without a change callback', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockResolvedValue(settings({ share_links_role_gm: false }) as never)
    render(<ShareLinkRolesSection />)
    fireEvent.click(await screen.findByLabelText('users.roles.gm'))
    await waitFor(() => expect(screen.getByLabelText('users.roles.gm')).not.toBeChecked())
    expect(patch).toHaveBeenCalledWith({ share_links_role_gm: false })
  })

  it('shows why a change failed', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockRejectedValueOnce(new Error('nope')).mockRejectedValueOnce({})
    render(<ShareLinkRolesSection />)
    fireEvent.click(await screen.findByLabelText('users.roles.gm'))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    fireEvent.click(screen.getByLabelText('users.roles.gm'))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('users.shareLinks.rolesFailed')
    )
  })
})

describe('ShareLinkRolesSection accessibility', () => {
  it('groups the role checkboxes under the heading', async () => {
    get.mockResolvedValue(settings() as never)
    render(<ShareLinkRolesSection />)
    const group = await screen.findByRole('group', { name: 'settings.entries.shareLinkRoles' })
    expect(group).toContainElement(screen.getByLabelText('users.roles.player'))
  })
})
