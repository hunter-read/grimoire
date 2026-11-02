import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UserRow from './UserRow'
import type { Schema } from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  campaigns: { adminListByUser: vi.fn(() => Promise.resolve([])) },
}))

const alice = {
  id: 'user-1',
  username: 'alice',
  role: 'player',
  campaign_count: 0,
} as Schema<'UserOut'>
const admin = {
  id: 'admin-1',
  username: 'admin',
  role: 'admin',
  campaign_count: 2,
} as Schema<'UserOut'>

type Props = ComponentProps<typeof UserRow>
// The handlers the harness leaves to each test.
type RowProps = Partial<Props> & Pick<Props, 'onApiKeysChange' | 'onShareLinksChange'>

// Wraps the row in a table and drives the expand state like UsersTab does.
function renderRow(props: Partial<Props> & { startExpanded?: boolean } = {}) {
  function Harness() {
    const [expanded, setExpanded] = useState(props.startExpanded || false)
    return (
      <table>
        <tbody>
          <UserRow
            user={alice}
            currentUserId="other"
            currentUserRole="admin"
            passwordAuthEnabled
            columnCount={5}
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
            onRoleChange={vi.fn()}
            onExplicitChange={vi.fn()}
            onCampaignAccessChange={vi.fn()}
            onPasswordReset={vi.fn()}
            onEmailChange={vi.fn()}
            onDelete={vi.fn()}
            {...(props as RowProps)}
          />
        </tbody>
      </table>
    )
  }
  return render(<Harness />, { wrapper: MemoryRouter })
}

describe('UserRow', () => {
  it('renders the username', () => {
    renderRow()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('shows (you) label when the row is the current user', () => {
    renderRow({ currentUserId: 'user-1' })
    expect(screen.getByText('(you)')).toBeInTheDocument()
  })

  it('does not show (you) for other users', () => {
    renderRow()
    expect(screen.queryByText('(you)')).not.toBeInTheDocument()
  })

  it('renders a RoleBadge for the user role', () => {
    renderRow({ user: admin })
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the owned campaign count', () => {
    renderRow({ user: admin })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('does not show the editor until expanded', () => {
    renderRow()
    expect(screen.queryByLabelText(/^role for/i)).not.toBeInTheDocument()
  })

  it('expands to reveal the editor when the row is clicked', () => {
    renderRow()
    fireEvent.click(screen.getByText('alice'))
    expect(screen.getByLabelText(/^role for/i)).toBeInTheDocument()
  })

  it('calls onRoleChange with user id and new role when changed in the editor', () => {
    const onRoleChange = vi.fn()
    renderRow({ onRoleChange, startExpanded: true })
    fireEvent.change(screen.getByLabelText(/^role for/i), { target: { value: 'gm' } })
    expect(onRoleChange).toHaveBeenCalledWith('user-1', 'gm')
  })

  it('disables the role select in the editor for the current user', () => {
    renderRow({ currentUserId: 'user-1', startExpanded: true })
    expect(screen.getByLabelText(/^role for/i)).toBeDisabled()
  })

  it('toggles campaign access from the editor', () => {
    const onCampaignAccessChange = vi.fn()
    renderRow({ onCampaignAccessChange, startExpanded: true })
    const toggle = screen.getByLabelText('Campaigns')
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(onCampaignAccessChange).toHaveBeenCalledWith('user-1', false)
  })

  it('shows delete confirmation and calls onDelete when confirmed', () => {
    const onDelete = vi.fn()
    renderRow({ onDelete, startExpanded: true })
    fireEvent.click(screen.getByLabelText('Delete user alice'))
    expect(screen.getByText('Delete?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Yes'))
    expect(onDelete).toHaveBeenCalledWith('user-1')
  })

  it('hides the password setter when password auth is disabled', () => {
    renderRow({ passwordAuthEnabled: false, startExpanded: true })
    expect(screen.queryByText('Set Password')).not.toBeInTheDocument()
  })
})

describe('UserRow accessibility', () => {
  it('opens the editor from a button named after the user', () => {
    renderRow()
    const toggle = screen.getByRole('button', { name: 'Edit alice' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
    // One toggle, not two: the click must not also bubble to the row's handler.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const editor = screen.getByRole('region', { name: 'Account settings for alice' })
    expect(toggle).toHaveAttribute('aria-controls', editor.id)
  })

  it('makes the username the row header', () => {
    renderRow()
    expect(screen.getByRole('rowheader', { name: /alice/ })).toBeInTheDocument()
  })

  it('says what the campaign count counts', () => {
    renderRow({ user: admin, currentUserId: 'admin-1' })
    expect(screen.getByText('Owned campaigns: 2')).toBeInTheDocument()
  })
})
