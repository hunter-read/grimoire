import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserExpandedEditor from './UserExpandedEditor'
import { campaigns, shareLinks } from '../../api'

vi.mock('../../api', () => ({
  default: {},
  campaigns: { adminListByUser: vi.fn(() => Promise.resolve([])) },
  shareLinks: { listForUser: vi.fn(() => Promise.resolve([])) },
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

  // Collapsed by default (issue #541): expanding a row fetches nothing more
  // until the admin opens the list.
  it('loads the campaigns list only once it is opened', () => {
    setup({ isSelf: true })
    expect(campaigns.adminListByUser).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Campaigns/ }))
    expect(campaigns.adminListByUser).toHaveBeenCalledWith('u1')
  })

  it('loads the campaigns list for other users', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Campaigns/ }))
    expect(campaigns.adminListByUser).toHaveBeenCalledWith('u1')
  })

  describe('share links', () => {
    it('shows the permission and where it comes from', () => {
      const onShareLinksChange = vi.fn()
      setup({
        shareLinksEnabled: true,
        onShareLinksChange,
        user: {
          // A player whose role an admin has allowed to share.
          ...baseUser,
          share_links: 'role',
          share_links_allowed: true,
          share_links_source: 'role',
        },
      })
      expect(screen.getByTestId('share-links-status-u1')).toHaveTextContent('Allowed')
      expect(screen.getByTestId('share-links-status-u1')).toHaveTextContent('(from role)')
      fireEvent.change(screen.getByLabelText('Share links'), {
        target: { value: 'deny' },
      })
      expect(onShareLinksChange).toHaveBeenCalledWith('u1', 'deny')
    })

    it("lists the user's links in a collapsed section", async () => {
      setup({ shareLinksEnabled: true, onShareLinksChange: vi.fn() })
      expect(shareLinks.listForUser).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: /Share links/ }))
      await waitFor(() => expect(shareLinks.listForUser).toHaveBeenCalledWith('u1'))
    })

    it('hides it all when share links are off', () => {
      setup({ shareLinksEnabled: false })
      expect(screen.queryByLabelText('Share links')).toBeNull()
      expect(screen.queryByRole('button', { name: /Share links/ })).toBeNull()
    })
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

  describe('API keys toggle', () => {
    it('is hidden while keys are off for the instance', () => {
      setup()
      expect(screen.queryByLabelText('API keys')).toBeNull()
    })

    it('grants and revokes a user', () => {
      const props = setup({ apiKeysEnabled: true, onApiKeysChange: vi.fn() })
      const toggle = screen.getByLabelText('API keys')
      expect(toggle).not.toBeChecked()
      fireEvent.click(toggle)
      expect(props.onApiKeysChange).toHaveBeenCalledWith('u1', true)
    })

    it('is always on, and locked, for an admin', () => {
      const props = setup({
        user: { ...baseUser, role: 'admin' },
        apiKeysEnabled: true,
        onApiKeysChange: vi.fn(),
      })
      const toggle = screen.getByLabelText('API keys')
      expect(toggle).toBeChecked()
      expect(toggle).toBeDisabled()
      fireEvent.click(toggle)
      expect(props.onApiKeysChange).not.toHaveBeenCalled()
    })
  })
})
