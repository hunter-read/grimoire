import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import UserRow from './UserRow'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  campaigns: { adminListByUser: vi.fn(() => Promise.resolve([])) },
}))

const alice = { id: 'user-1', username: 'alice', role: 'player', campaign_count: 0 }
const admin = { id: 'admin-1', username: 'admin', role: 'admin', campaign_count: 2 }

// Wraps the row in a table and drives the expand state like UsersTab does.
function renderRow(props = {}) {
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
            {...props}
          />
        </tbody>
      </table>
    )
  }
  return render(<Harness />)
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
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument()
  })

  it('expands to reveal the editor when the row is clicked', () => {
    renderRow()
    fireEvent.click(screen.getByText('alice'))
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })

  it('calls onRoleChange with user id and new role when changed in the editor', () => {
    const onRoleChange = vi.fn()
    renderRow({ onRoleChange, startExpanded: true })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'gm' } })
    expect(onRoleChange).toHaveBeenCalledWith('user-1', 'gm')
  })

  it('disables the role select in the editor for the current user', () => {
    renderRow({ currentUserId: 'user-1', startExpanded: true })
    expect(screen.getByLabelText('Role')).toBeDisabled()
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
