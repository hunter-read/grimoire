import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserExpandedEditor from './UserExpandedEditor'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  default: {},
  campaigns: { adminListByUser: vi.fn(() => Promise.resolve([])) },
}))

beforeEach(() => {
  campaigns.adminListByUser.mockClear()
})

const baseUser = {
  id: 'u1',
  username: 'alice',
  email: 'a@b.com',
  role: 'player',
  allow_explicit: true,
  campaign_access: true,
}

function setup(overrides = {}) {
  const props = {
    user: baseUser,
    isSelf: false,
    currentUserRole: 'admin',
    passwordAuthEnabled: true,
    onRoleChange: vi.fn(),
    onExplicitChange: vi.fn(),
    onCampaignAccessChange: vi.fn(),
    onPasswordReset: vi.fn(),
    onEmailChange: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<UserExpandedEditor {...props} />)
  return props
}

describe('UserExpandedEditor', () => {
  it('reveals the password input after clicking Set Password', () => {
    setup()
    fireEvent.click(screen.getByText('Set Password'))
    expect(screen.getByLabelText('New password (min 8)')).toBeInTheDocument()
  })

  it('hides the password setter when password auth is disabled', () => {
    setup({ passwordAuthEnabled: false })
    expect(screen.queryByText('Set Password')).not.toBeInTheDocument()
  })

  it('hides the password setter for the current user', () => {
    setup({ isSelf: true })
    expect(screen.queryByText('Set Password')).not.toBeInTheDocument()
  })

  it('disables the explicit toggle for the current user', () => {
    setup({ isSelf: true })
    expect(screen.getByLabelText('Explicit')).toBeDisabled()
  })

  it('toggles explicit content for other users', () => {
    const onExplicitChange = vi.fn()
    setup({ onExplicitChange })
    fireEvent.click(screen.getByLabelText('Explicit'))
    expect(onExplicitChange).toHaveBeenCalledWith('u1', false)
  })

  it('does not load the campaigns list for the current user', () => {
    setup({ isSelf: true })
    expect(campaigns.adminListByUser).not.toHaveBeenCalled()
  })

  it('loads the campaigns list for other users', () => {
    setup()
    expect(campaigns.adminListByUser).toHaveBeenCalledWith('u1')
  })

  it('disables delete for the current user', () => {
    setup({ isSelf: true })
    expect(screen.getByLabelText('Delete user alice')).toBeDisabled()
  })

  it('saves a new password through onPasswordReset', async () => {
    const onPasswordReset = vi.fn().mockResolvedValue()
    setup({ onPasswordReset })
    fireEvent.click(screen.getByText('Set Password'))
    fireEvent.change(screen.getByLabelText('New password (min 8)'), {
      target: { value: 'longenough1' },
    })
    fireEvent.click(screen.getByText('Set Password'))
    await waitFor(() => expect(onPasswordReset).toHaveBeenCalledWith('u1', 'longenough1'))
  })

  it('changes the role through onRoleChange', () => {
    const onRoleChange = vi.fn()
    setup({ onRoleChange })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'gm' } })
    expect(onRoleChange).toHaveBeenCalledWith('u1', 'gm')
  })

  it('cancels the delete confirmation', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Delete user alice'))
    expect(screen.getByText('Delete?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('No'))
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
  })

  it('saves an edited email through onEmailChange', async () => {
    const onEmailChange = vi.fn().mockResolvedValue()
    setup({ onEmailChange })
    fireEvent.change(screen.getByLabelText('user@example.com'), {
      target: { value: 'new@b.com' },
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onEmailChange).toHaveBeenCalledWith('u1', 'new@b.com'))
  })
})
