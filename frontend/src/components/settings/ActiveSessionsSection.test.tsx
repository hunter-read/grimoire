import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActiveSessionsSection from './ActiveSessionsSection'
import { auth } from '../../api'

vi.mock('../../api', () => ({
  auth: {
    sessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
}))

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const FIREFOX_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'

const session = (overrides = {}) => ({
  id: 'sess-1',
  origin: 'password',
  user_agent: CHROME_MAC,
  ip_address: '10.0.0.4',
  created_at: '2026-08-01T10:00:00',
  last_used_at: '2026-08-01T10:00:00',
  expires_at: '2026-09-01T10:00:00',
  current: false,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ActiveSessionsSection', () => {
  it('lists the current session and labels it as this device', async () => {
    auth.sessions.mockResolvedValue([session({ current: true })])
    render(<ActiveSessionsSection />)

    expect(await screen.findByText('This device')).toBeInTheDocument()
    expect(screen.getByText(/Chrome on macOS/)).toBeInTheDocument()
  })

  it('does not offer to revoke the current session', async () => {
    auth.sessions.mockResolvedValue([session({ current: true })])
    render(<ActiveSessionsSection />)

    await screen.findByText('This device')
    expect(screen.queryByText('Revoke')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign out all other devices')).not.toBeInTheDocument()
  })

  it('revokes a single session and drops it from the list', async () => {
    auth.sessions.mockResolvedValue([
      session({ id: 'sess-1', current: true }),
      session({ id: 'sess-2', user_agent: FIREFOX_WIN }),
    ])
    auth.revokeSession.mockResolvedValue({ ok: true })
    render(<ActiveSessionsSection />)

    fireEvent.click(await screen.findByText('Revoke'))

    await waitFor(() => expect(auth.revokeSession).toHaveBeenCalledWith('sess-2'))
    await waitFor(() => expect(screen.queryByText(/Firefox on Windows/)).not.toBeInTheDocument())
  })

  it('signs out all other devices, keeping the current one', async () => {
    auth.sessions.mockResolvedValue([
      session({ id: 'sess-1', current: true }),
      session({ id: 'sess-2', user_agent: FIREFOX_WIN }),
    ])
    auth.revokeOtherSessions.mockResolvedValue({ ok: true, revoked: 1 })
    render(<ActiveSessionsSection />)

    fireEvent.click(await screen.findByText('Sign out all other devices'))

    await waitFor(() => expect(auth.revokeOtherSessions).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Firefox on Windows/)).not.toBeInTheDocument())
    expect(screen.getByText('This device')).toBeInTheDocument()
  })

  it('shows the sign-in method for an SSO session', async () => {
    auth.sessions.mockResolvedValue([session({ origin: 'oidc', current: true })])
    render(<ActiveSessionsSection />)

    expect(await screen.findByText(/Single sign-on/)).toBeInTheDocument()
  })

  it('falls back to a placeholder when the user agent is unknown', async () => {
    auth.sessions.mockResolvedValue([session({ user_agent: null, current: true })])
    render(<ActiveSessionsSection />)

    expect(await screen.findByText('Unknown device')).toBeInTheDocument()
  })

  it('shows an empty state when there are no sessions', async () => {
    auth.sessions.mockResolvedValue([])
    render(<ActiveSessionsSection />)

    expect(await screen.findByText('No active sessions.')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    auth.sessions.mockRejectedValue(new Error('nope'))
    render(<ActiveSessionsSection />)

    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('surfaces a revoke failure and keeps the session listed', async () => {
    auth.sessions.mockResolvedValue([
      session({ id: 'sess-1', current: true }),
      session({ id: 'sess-2', user_agent: FIREFOX_WIN }),
    ])
    auth.revokeSession.mockRejectedValue(new Error('revoke exploded'))
    render(<ActiveSessionsSection />)

    fireEvent.click(await screen.findByText('Revoke'))

    expect(await screen.findByText('revoke exploded')).toBeInTheDocument()
    expect(screen.getByText(/Firefox on Windows/)).toBeInTheDocument()
  })
})
