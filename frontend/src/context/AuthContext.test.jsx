import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

function StatusDisplay() {
  const { status, user, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? 'none'}</span>
      <button onClick={() => login('tok', { username: 'alice', role: 'admin' })}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

function renderAuth() {
  return render(
    <AuthProvider>
      <StatusDisplay />
    </AuthProvider>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('starts in loading state before fetch resolves', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) // never resolves
    renderAuth()
    expect(screen.getByTestId('status').textContent).toBe('loading')
  })

  it('transitions to uninitialized when no users exist on the server', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initialized: false }),
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('uninitialized'))
  })

  it('transitions to unauthenticated when server is initialized but no token is stored', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initialized: true }),
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
  })

  it('transitions to authenticated when stored token validates successfully', async () => {
    localStorage.setItem('grimoire_token', 'valid-token')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ initialized: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', username: 'alice', role: 'admin' }),
      })

    renderAuth()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('alice')
  })

  it('removes invalid token and goes to unauthenticated', async () => {
    localStorage.setItem('grimoire_token', 'bad-token')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ initialized: true }) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve(null) })

    renderAuth()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
    expect(localStorage.getItem('grimoire_token')).toBeNull()
  })

  it('transitions to unauthenticated on grimoire:unauthorized event', async () => {
    localStorage.setItem('grimoire_token', 'tok')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ initialized: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', username: 'alice', role: 'admin' }),
      })

    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    act(() => window.dispatchEvent(new CustomEvent('grimoire:unauthorized')))

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(localStorage.getItem('grimoire_token')).toBeNull()
  })

  it('login() stores token and sets authenticated state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initialized: true }),
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))

    act(() => screen.getByText('Login').click())

    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(screen.getByTestId('user').textContent).toBe('alice')
    expect(localStorage.getItem('grimoire_token')).toBe('tok')
  })

  it('logout() clears token and sets unauthenticated state', async () => {
    localStorage.setItem('grimoire_token', 'tok')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ initialized: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', username: 'alice', role: 'admin' }),
      })

    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    act(() => screen.getByText('Logout').click())

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(localStorage.getItem('grimoire_token')).toBeNull()
  })

  it('becomes unauthenticated when fetch throws a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
  })
})
