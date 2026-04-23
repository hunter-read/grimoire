import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddUserForm from './AddUserForm'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

describe('AddUserForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders username, password, and role fields', () => {
    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })

  it('defaults role to player', () => {
    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Role')).toHaveValue('player')
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(<AddUserForm onAdd={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows validation error when password is shorter than 8 characters', async () => {
    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    fireEvent.click(screen.getByText('Create User'))
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('submits the form and calls onAdd on success', async () => {
    const created = { id: '1', username: 'alice', role: 'player' }
    api.post.mockResolvedValueOnce(created)
    const onAdd = vi.fn()

    render(<AddUserForm onAdd={onAdd} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'securepassword')
    fireEvent.click(screen.getByText('Create User'))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(created))
    expect(api.post).toHaveBeenCalledWith('/users', {
      username: 'alice',
      password: 'securepassword',
      role: 'player',
    })
  })

  it('shows API error message when creation fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Username already exists'))

    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'duplicate')
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword')
    fireEvent.click(screen.getByText('Create User'))

    expect(await screen.findByText('Username already exists')).toBeInTheDocument()
  })

  it('shows loading state while submitting', async () => {
    let resolve
    api.post.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      })
    )

    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword')
    fireEvent.click(screen.getByText('Create User'))

    expect(await screen.findByText('Creating…')).toBeInTheDocument()
  })

  it('can submit with gm role selected', async () => {
    const created = { id: '2', username: 'bob', role: 'gm' }
    api.post.mockResolvedValueOnce(created)
    const onAdd = vi.fn()

    render(<AddUserForm onAdd={onAdd} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'bob')
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'gm' } })
    fireEvent.click(screen.getByText('Create User'))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users', expect.objectContaining({ role: 'gm' }))
    )
  })
})
