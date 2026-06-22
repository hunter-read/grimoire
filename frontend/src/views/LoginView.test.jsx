import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginView from './LoginView'

describe('LoginView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the GRIMOIRE heading', () => {
    render(<LoginView onLogin={vi.fn()} />)
    expect(screen.getByText('GRIMOIRE')).toBeInTheDocument()
  })

  it('renders username and password fields', () => {
    render(<LoginView onLogin={vi.fn()} />)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('calls onLogin with token and user on successful login', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'abc123', user: { username: 'admin', role: 'admin' } }),
    })
    const onLogin = vi.fn()

    render(<LoginView onLogin={onLogin} />)
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /enter/i }))

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith('abc123', { username: 'admin', role: 'admin' })
    )
  })

  it('sends trimmed username to the API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 't', user: {} }),
    })

    render(<LoginView onLogin={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), '  admin  ')
    await userEvent.type(screen.getByLabelText('Password'), 'password')
    fireEvent.click(screen.getByRole('button', { name: /enter/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const loginCall = fetch.mock.calls.find(([url]) => url === '/api/auth/login')
    const body = JSON.parse(loginCall[1].body)
    expect(body.username).toBe('admin')
  })

  it('shows the API error message on a failed login', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: 'Invalid username or password' }),
    })

    render(<LoginView onLogin={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'wrong')
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass')
    fireEvent.click(screen.getByRole('button', { name: /enter/i }))

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument()
  })

  it('shows a generic error when the server is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    render(<LoginView onLogin={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'password')
    fireEvent.click(screen.getByRole('button', { name: /enter/i }))

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument()
  })

  it('shows the guest invite field when guest access is enabled', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/api/auth/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ password_auth_enabled: true, guest_access_enabled: true }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<LoginView onLogin={vi.fn()} />)
    const toggle = await screen.findByText(/have an invite code/i)
    fireEvent.click(toggle)
    expect(screen.getByLabelText('Invite Code')).toBeInTheDocument()
  })

  it('logs in as a guest and stashes the campaign id for redirect', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/api/auth/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ password_auth_enabled: true, guest_access_enabled: true }),
        })
      }
      if (url === '/api/auth/guest-login') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              token: 'gtok',
              user: { username: 'guest_x', role: 'guest' },
              campaign_id: 'camp42',
            }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    const onLogin = vi.fn()

    render(<LoginView onLogin={onLogin} />)
    fireEvent.click(await screen.findByText(/have an invite code/i))
    await userEvent.type(screen.getByLabelText('Invite Code'), 'abc1234567')
    fireEvent.click(screen.getByRole('button', { name: /enter as guest/i }))

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith('gtok', {
        username: 'guest_x',
        role: 'guest',
      })
    )
    expect(sessionStorage.getItem('grimoire:guest_campaign')).toBe('camp42')
  })

  it('disables the button and shows loading text while submitting', async () => {
    let resolve
    global.fetch = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )

    render(<LoginView onLogin={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'password')
    fireEvent.click(screen.getByRole('button', { name: /enter/i }))

    const btn = screen.getByRole('button', { name: /entering/i })
    expect(btn).toBeDisabled()
  })
})
