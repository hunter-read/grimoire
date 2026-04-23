import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserRow from './UserRow'

const alice = { id: 'user-1', username: 'alice', role: 'player' }
const admin = { id: 'admin-1', username: 'admin', role: 'admin' }

describe('UserRow', () => {
  it('renders the username', () => {
    render(<UserRow user={alice} currentUserId="other" onRoleChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('shows (you) label when the row is the current user', () => {
    render(
      <UserRow user={alice} currentUserId="user-1" onRoleChange={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByText('(you)')).toBeInTheDocument()
  })

  it('does not show (you) for other users', () => {
    render(<UserRow user={alice} currentUserId="other" onRoleChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByText('(you)')).not.toBeInTheDocument()
  })

  it('disables the role select for the current user', () => {
    render(
      <UserRow user={alice} currentUserId="user-1" onRoleChange={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('enables the role select for other users', () => {
    render(<UserRow user={alice} currentUserId="other" onRoleChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('combobox')).not.toBeDisabled()
  })

  it('calls onRoleChange with user id and new role when changed', () => {
    const onRoleChange = vi.fn()
    render(
      <UserRow user={alice} currentUserId="other" onRoleChange={onRoleChange} onDelete={vi.fn()} />
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gm' } })
    expect(onRoleChange).toHaveBeenCalledWith('user-1', 'gm')
  })

  it('shows delete confirmation UI when the delete button is clicked', () => {
    render(<UserRow user={alice} currentUserId="other" onRoleChange={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Delete user alice'))
    expect(screen.getByText('Delete?')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('calls onDelete when Yes is confirmed', () => {
    const onDelete = vi.fn()
    render(
      <UserRow user={alice} currentUserId="other" onRoleChange={vi.fn()} onDelete={onDelete} />
    )
    fireEvent.click(screen.getByLabelText('Delete user alice'))
    fireEvent.click(screen.getByText('Yes'))
    expect(onDelete).toHaveBeenCalledWith('user-1')
  })

  it('cancels the confirmation when No is clicked', () => {
    render(<UserRow user={alice} currentUserId="other" onRoleChange={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Delete user alice'))
    fireEvent.click(screen.getByText('No'))
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
  })

  it('disables the delete button for the current user', () => {
    render(
      <UserRow user={alice} currentUserId="user-1" onRoleChange={vi.fn()} onDelete={vi.fn()} />
    )
    expect(screen.getByLabelText('Delete user alice')).toBeDisabled()
  })

  it('renders a RoleBadge for the user role', () => {
    render(<UserRow user={admin} currentUserId="other" onRoleChange={vi.fn()} onDelete={vi.fn()} />)
    // Username "admin" appears as plain text; the badge shows the translated "Admin"
    // (also appears in the role <select> option, so use getAllByText)
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1)
  })
})
