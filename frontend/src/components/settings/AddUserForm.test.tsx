import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddUserForm from './AddUserForm'
import { UISettingsProvider } from '../../context/UISettingsContext'
import api, { auth } from '../../api'
import { clearPasswordRulesCache } from '../../hooks/usePasswordRules'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { status: vi.fn() },
}))

const status = (passwordMin: number) => ({
  initialized: true,
  password_min_length: passwordMin,
  share_link_password_min_length: 8,
})

describe('AddUserForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearPasswordRulesCache()
    vi.mocked(auth.status).mockResolvedValue(status(12))
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

  it('requires 12 characters by default', async () => {
    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'elevenchars')
    fireEvent.click(screen.getByText('Create User'))
    expect(await screen.findByText('Password must be at least 12 characters.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it("uses the server's minimum when it has been changed", async () => {
    vi.mocked(auth.status).mockResolvedValue(status(8))
    vi.mocked(api.post).mockResolvedValue({ id: '5', username: 'erin', role: 'player' })
    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(auth.status).toHaveBeenCalled())
    await userEvent.type(screen.getByLabelText('Username'), 'erin')
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    fireEvent.click(screen.getByText('Create User'))
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()

    // Eight characters is enough on this server.
    await userEvent.type(screen.getByLabelText('Password'), 'pwd')
    fireEvent.click(screen.getByText('Create User'))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/users',
        expect.objectContaining({ password: 'shortpwd' })
      )
    )
  })

  it("shows the server's reason when it refuses a password as too common", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error('That password is too common - choose one that is harder to guess')
    )
    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'password1234')
    fireEvent.click(screen.getByText('Create User'))
    expect(
      await screen.findByText('That password is too common - choose one that is harder to guess')
    ).toBeInTheDocument()
  })

  it('submits the form and calls onAdd on success', async () => {
    const created = { id: '1', username: 'alice', role: 'player' }
    vi.mocked(api.post).mockResolvedValueOnce(created)
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
      allow_explicit: true,
      campaign_access: true,
      api_keys_enabled: false,
    })
  })

  it('grants API keys when ticked, and leaves them out when keys are off', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: '9', username: 'dee', role: 'player' })
    const { unmount } = render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'dee')
    await userEvent.type(screen.getByLabelText('Password'), 'securepassword')
    fireEvent.click(screen.getByLabelText('API keys'))
    fireEvent.click(screen.getByText('Create User'))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/users',
        expect.objectContaining({ api_keys_enabled: true })
      )
    )
    unmount()

    vi.mocked(api.post).mockClear()
    render(
      <UISettingsProvider value={{ api_keys_enabled: false }}>
        <AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />
      </UISettingsProvider>
    )
    expect(screen.queryByLabelText('API keys')).toBeNull()
    await userEvent.type(screen.getByLabelText('Username'), 'eve')
    await userEvent.type(screen.getByLabelText('Password'), 'securepassword')
    fireEvent.click(screen.getByText('Create User'))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('api_keys_enabled')
  })

  it('hides the password field and omits password when password auth is disabled', async () => {
    const created = { id: '3', username: 'carol', role: 'player' }
    vi.mocked(api.post).mockResolvedValueOnce(created)
    const onAdd = vi.fn()

    render(<AddUserForm onAdd={onAdd} onCancel={vi.fn()} passwordAuthEnabled={false} />)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Username'), 'carol')
    fireEvent.click(screen.getByText('Create User'))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('password')
  })

  it('passes permission toggles in the payload', async () => {
    const created = { id: '4', username: 'dave', role: 'player' }
    vi.mocked(api.post).mockResolvedValueOnce(created)

    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'dave')
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword')
    fireEvent.click(screen.getByLabelText('Campaigns'))
    fireEvent.click(screen.getByText('Create User'))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/users',
        expect.objectContaining({ campaign_access: false, allow_explicit: true })
      )
    )
  })

  it('shows API error message when creation fails', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Username already exists'))

    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'duplicate')
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword')
    fireEvent.click(screen.getByText('Create User'))

    expect(await screen.findByText('Username already exists')).toBeInTheDocument()
  })

  it('shows loading state while submitting', async () => {
    // Never settles, so the form stays mid-submit.
    vi.mocked(api.post).mockReturnValueOnce(new Promise(() => {}))

    render(<AddUserForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword')
    fireEvent.click(screen.getByText('Create User'))

    expect(await screen.findByText('Creating…')).toBeInTheDocument()
  })

  it('can submit with gm role selected', async () => {
    const created = { id: '2', username: 'bob', role: 'gm' }
    vi.mocked(api.post).mockResolvedValueOnce(created)
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
