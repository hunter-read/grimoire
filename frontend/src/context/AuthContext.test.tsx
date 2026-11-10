import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAccessToken, setAccessToken } from '../api/accessToken'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth, type AuthUser } from './AuthContext'
import { getRecentBooks, saveRecentBook, setRecentAccount } from '../hooks/useBookPrefs'

function StatusDisplay() {
  const { status, user, login, logout } = useAuth()!
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? 'none'}</span>
      <button
        onClick={() => login('tok', { id: '1', username: 'alice', role: 'admin' } as AuthUser)}
      >
        Login
      </button>
      <button
        onClick={() => login('tok2', { id: '2', username: 'bob', role: 'player' } as AuthUser)}
      >
        Login Bob
      </button>
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
    setAccessToken(null)
    setRecentAccount(null)
    vi.restoreAllMocks()
  })

  const BOOK = { id: 'b1', title: 'Secret Tome', has_thumbnail: false, page_count: 1 }

  // Signs alice in from a stored token, then gives her a recently-opened book
  // and some per-tab view state.
  async function signInAliceWithHistory() {
    setAccessToken('tok')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ initialized: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', username: 'alice', role: 'admin' }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    saveRecentBook(BOOK)
    sessionStorage.setItem('grimoire:audio:queue', '[{"id":"t1","title":"Theme"}]')
    sessionStorage.setItem('other-app', 'kept')
    expect(getRecentBooks().map((b) => b.id)).toEqual(['b1'])
    expect(localStorage.getItem('grimoire:recently-opened:1')).toContain('Secret Tome')
  }

  function expectHistoryGone() {
    expect(localStorage.getItem('grimoire:recently-opened:1')).toBeNull()
    expect(getRecentBooks()).toEqual([])
    expect(sessionStorage.getItem('grimoire:audio:queue')).toBeNull()
    expect(sessionStorage.getItem('other-app')).toBe('kept')
  }

  it('keeps recently opened per account and clears it on sign-out', async () => {
    await signInAliceWithHistory()
    act(() => screen.getByText('Logout').click())
    expectHistoryGone()
    // Signing out still leaves the one-shot flag that holds back OIDC auto-launch.
    expect(sessionStorage.getItem('grimoire:suppress_oidc_autolaunch')).toBe('1')
  })

  it('clears recently opened when the session expires', async () => {
    await signInAliceWithHistory()
    act(() => window.dispatchEvent(new CustomEvent('grimoire:unauthorized')))
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expectHistoryGone()
  })

  it('shows the next account only its own recently opened list', async () => {
    await signInAliceWithHistory()
    // Alice's session ends without a sign-out here (the tab closed, say), so
    // her list is still stored when bob signs in on the same browser.
    act(() => screen.getByText('Login Bob').click())
    expect(screen.getByTestId('user').textContent).toBe('bob')
    expect(getRecentBooks()).toEqual([])
    saveRecentBook({ ...BOOK, id: 'b2', title: 'Bob Book' })
    expect(localStorage.getItem('grimoire:recently-opened:2')).toContain('Bob Book')
    expect(localStorage.getItem('grimoire:recently-opened:1')).toContain('Secret Tome')
  })

  it('starts in loading state before fetch resolves', () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) // never resolves
    renderAuth()
    expect(screen.getByTestId('status').textContent).toBe('loading')
  })

  it('transitions to uninitialized when no users exist on the server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initialized: false }),
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('uninitialized'))
  })

  it('transitions to unauthenticated when server is initialized but no token is stored', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initialized: true }),
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
  })

  it('transitions to authenticated when stored token validates successfully', async () => {
    setAccessToken('valid-token')
    globalThis.fetch = vi
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
    setAccessToken('bad-token')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ initialized: true }) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve(null) })

    renderAuth()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
    expect(getAccessToken()).toBeNull()
  })

  it('transitions to unauthenticated on grimoire:unauthorized event', async () => {
    setAccessToken('tok')
    globalThis.fetch = vi
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
    expect(getAccessToken()).toBeNull()
  })

  it('login() stores token and sets authenticated state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ initialized: true }),
    })
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))

    act(() => screen.getByText('Login').click())

    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(screen.getByTestId('user').textContent).toBe('alice')
    expect(getAccessToken()).toBe('tok')
  })

  it('logout() clears token and sets unauthenticated state', async () => {
    setAccessToken('tok')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ initialized: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '1', username: 'alice', role: 'admin' }),
      })
      // logout POSTs to /api/auth/logout to clear the server session cookie
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })

    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    act(() => screen.getByText('Logout').click())

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(getAccessToken()).toBeNull()
    // The server-side cookie clear was requested.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('becomes unauthenticated when fetch throws a network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
  })
})
