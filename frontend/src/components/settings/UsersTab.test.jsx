import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsersTab from './UsersTab'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { config: vi.fn() },
  campaigns: { adminListByUser: vi.fn(() => Promise.resolve([])) },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', role: 'admin' } }),
}))

import api, { auth } from '../../api'

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

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue(users)
  auth.config.mockResolvedValue({ password_auth_enabled: true })
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
    fireEvent.change(screen.getByLabelText('New password (min 8)'), {
      target: { value: 'longenough1' },
    })
    fireEvent.click(screen.getByText('Set Password'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/user-2', { password: 'longenough1' })
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
