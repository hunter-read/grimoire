import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsersTab from './UsersTab'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { config: vi.fn(), status: vi.fn() },
  campaigns: { adminListByUser: vi.fn(() => Promise.resolve([])) },
  settings: { get: vi.fn(), patch: vi.fn() },
  shareLinks: { listForUser: vi.fn() },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', role: 'admin' } }),
}))

import api, { auth, settings as settingsApi } from '../../api'

const users = [
  {
    id: 'admin-1',
    username: 'admin',
    role: 'admin',
    allow_explicit: true,
    campaign_access: true,
    campaign_count: 1,
  },
  {
    id: 'user-2',
    username: 'bob',
    email: 'bob@x.com',
    role: 'player',
    allow_explicit: false,
    campaign_access: true,
    campaign_count: 0,
  },
]

const shareDefaults = {
  share_links_enabled: true,
  share_links_role_gm: true,
  share_links_role_player: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue(users)
  auth.config.mockResolvedValue({ password_auth_enabled: true })
  // The password minimums: the defaults, as every test here starts from them.
  auth.status.mockRejectedValue(new Error('not needed'))
  settingsApi.get.mockResolvedValue(shareDefaults)
})

describe('UsersTab', () => {
  it('renders a table row per user with the campaign count', async () => {
    render(<UsersTab />)
    expect(await screen.findByText('admin')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('bob@x.com')).toBeInTheDocument()
    expect(screen.getByText('2 users')).toBeInTheDocument()
  })

  it('toggles the add-user form', async () => {
    render(<UsersTab />)
    await screen.findByText('admin')
    fireEvent.click(screen.getByText('Add User'))
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
  })

  it('expands a row and patches the role from the editor', async () => {
    api.patch.mockResolvedValue({ id: 'user-2', role: 'gm' })
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'gm' } })
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/user-2', { role: 'gm' }))
  })

  it('deletes a user and removes the row', async () => {
    api.delete.mockResolvedValue({})
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByLabelText('Delete user bob'))
    fireEvent.click(screen.getByText('Yes'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/users/user-2'))
    await waitFor(() => expect(screen.queryByText('bob')).not.toBeInTheDocument())
  })

  it('shows an error when a patch fails', async () => {
    api.patch.mockRejectedValue(new Error('nope'))
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByLabelText('Campaigns'))
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('hides the password setter when password auth is disabled', async () => {
    auth.config.mockResolvedValue({ password_auth_enabled: false })
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    await waitFor(() => expect(screen.queryByText('Set Password')).not.toBeInTheDocument())
  })

  it('toggles explicit content for a user', async () => {
    api.patch.mockResolvedValue({ id: 'user-2', allow_explicit: true })
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByLabelText('Explicit'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/user-2', { allow_explicit: true })
    )
  })

  it('grants API keys to a user and shows the badge', async () => {
    api.patch.mockResolvedValue({ id: 'user-2', api_keys_enabled: true })
    render(<UsersTab />)
    await screen.findByText('bob')
    // The admin row carries the badge already; bob's does not until granted.
    expect(screen.getAllByText('API keys')).toHaveLength(1)
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByLabelText('API keys'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/user-2', { api_keys_enabled: true })
    )
    await waitFor(() => expect(screen.getAllByText('API keys').length).toBeGreaterThan(1))
  })

  it('shows an error when granting API keys fails', async () => {
    api.patch.mockRejectedValue(new Error('nope'))
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByLabelText('API keys'))
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('saves an edited email', async () => {
    api.patch.mockResolvedValue({ id: 'user-2', email: 'new@x.com' })
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.change(screen.getByLabelText('user@example.com'), {
      target: { value: 'new@x.com' },
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/user-2', { email: 'new@x.com' })
    )
  })

  it('resets a password', async () => {
    api.patch.mockResolvedValue({})
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByText('Set Password'))
    fireEvent.change(screen.getByLabelText('New password (min 12)'), {
      target: { value: 'longenough12' },
    })
    fireEvent.click(screen.getByText('Set Password'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/user-2', { password: 'longenough12' })
    )
  })

  it('adds a new user to the table', async () => {
    api.post.mockResolvedValue({ id: 'user-3', username: 'carol', role: 'gm', campaign_count: 0 })
    render(<UsersTab />)
    await screen.findByText('admin')
    fireEvent.click(screen.getByText('Add User'))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'carol' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'validpassword' } })
    fireEvent.click(screen.getByText('Create User'))
    await waitFor(() => expect(screen.getByText('carol')).toBeInTheDocument())
    expect(screen.getByText('3 users')).toBeInTheDocument()
  })

  describe('share links', () => {
    it('lets an admin grant the player role and re-reads the users', async () => {
      settingsApi.patch.mockResolvedValue({ ...shareDefaults, share_links_role_player: true })
      render(<UsersTab />)
      const player = await screen.findByLabelText('Player')
      expect(player).not.toBeChecked()
      expect(screen.getByLabelText('Admin')).toBeDisabled()
      fireEvent.click(player)
      await waitFor(() =>
        expect(settingsApi.patch).toHaveBeenCalledWith({ share_links_role_player: true })
      )
      await waitFor(() => expect(screen.getByLabelText('Player')).toBeChecked())
      // Everyone following the role just changed, so the table is fetched again.
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    })

    it('reports a failed role change', async () => {
      settingsApi.patch.mockRejectedValue(new Error('denied'))
      render(<UsersTab />)
      fireEvent.click(await screen.findByLabelText('GM'))
      expect(await screen.findByText('denied')).toBeInTheDocument()
    })

    it('says so when share links are off for the instance', async () => {
      settingsApi.get.mockResolvedValue({ ...shareDefaults, share_links_enabled: false })
      render(<UsersTab />)
      expect(await screen.findByText(/SHARE_LINKS_ENABLED=false/)).toBeInTheDocument()
    })

    it("patches a user's override from the editor", async () => {
      api.patch.mockResolvedValue({ id: 'user-2', share_links: 'allow', share_links_allowed: true })
      render(<UsersTab />)
      fireEvent.click(await screen.findByText('bob'))
      fireEvent.change(screen.getByLabelText('Share links'), { target: { value: 'allow' } })
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith('/users/user-2', { share_links: 'allow' })
      )
    })

    it('shows an error when the override fails', async () => {
      api.patch.mockRejectedValue(new Error('no way'))
      render(<UsersTab />)
      fireEvent.click(await screen.findByText('bob'))
      fireEvent.change(screen.getByLabelText('Share links'), { target: { value: 'deny' } })
      expect(await screen.findByText('no way')).toBeInTheDocument()
    })
  })

  it('dismisses the error banner', async () => {
    api.patch.mockRejectedValue(new Error('boom'))
    render(<UsersTab />)
    await screen.findByText('bob')
    fireEvent.click(screen.getByText('bob'))
    fireEvent.click(screen.getByLabelText('Campaigns'))
    await screen.findByText('boom')
    fireEvent.click(screen.getByLabelText('Dismiss error'))
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })
})
