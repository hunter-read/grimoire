import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import App from './App'

type WithChildren = { children: ReactNode }

let status = 'authenticated'
let pathname = '/'
let search = ''
let user: { id: string } | null = { id: 'u1' }
vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({ status, user, login: vi.fn() }),
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname, search }),
}))
// vi.mock is hoisted, so each factory carries its own pass-through provider.
vi.mock('./context/FavoritesContext', () => ({
  FavoritesProvider: ({ children }: WithChildren) => children,
}))
vi.mock('./context/AudioPlayerContext', () => ({
  AudioPlayerProvider: ({ children }: WithChildren) => children,
}))
vi.mock('./context/SoundboardContext', () => ({
  SoundboardProvider: ({ children }: WithChildren) => children,
}))
vi.mock('./context/ThemeContext', () => ({
  ThemeProvider: ({ children }: WithChildren) => children,
}))
vi.mock('./views/SetupView', () => ({ default: () => <div>setup</div> }))
vi.mock('./views/LoginView', () => ({ default: () => <div>login</div> }))
vi.mock('./views/ShareView', () => ({
  default: ({ token }: { token: string | null }) => <div>{`share:${String(token)}`}</div>,
}))
vi.mock('./views/McpConsentView', () => ({
  default: ({ requestId }: { requestId: string | null }) => (
    <div>{`consent:${String(requestId)}`}</div>
  ),
}))
vi.mock('./components/LoadingScreen', () => ({ default: () => <div>loading</div> }))
let shellMounts = 0
vi.mock('./components/AppShell', async () => {
  const { useEffect } = await import('react')
  return {
    default: function Shell() {
      useEffect(() => {
        shellMounts += 1
      }, [])
      return <div>shell</div>
    },
  }
})

beforeEach(() => {
  status = 'authenticated'
  pathname = '/'
  search = ''
  user = { id: 'u1' }
  shellMounts = 0
})

describe('App', () => {
  it.each([
    ['loading', 'loading'],
    ['uninitialized', 'setup'],
    ['unauthenticated', 'login'],
    ['authenticated', 'shell'],
  ])('renders the %s state', (s, text) => {
    status = s
    render(<App />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  // Issue #541: a share link's page is public, so it renders before any login.
  it('renders a share page for anyone, signed in or not', () => {
    status = 'unauthenticated'
    pathname = '/share/abc%2Ddef/'
    render(<App />)
    expect(screen.getByText('share:abc-def')).toBeInTheDocument()
  })

  it('gives a token with a malformed escape the not-found page instead of crashing', () => {
    pathname = '/share/%E0%A4%A'
    render(<App />)
    expect(screen.getByText('share:null')).toBeInTheDocument()
  })

  it('starts the signed-in tree over when a different account signs in', () => {
    const { rerender } = render(<App />)
    expect(shellMounts).toBe(1)
    rerender(<App />)
    expect(shellMounts).toBe(1)
    user = { id: 'u2' }
    rerender(<App />)
    expect(shellMounts).toBe(2)
  })

  // Issue #906: an MCP client's sign-in is answered on a page of its own.
  it('renders the consent page alone, with the request id', () => {
    pathname = '/oauth/consent'
    search = '?request=abc123'
    render(<App />)
    expect(screen.getByText('consent:abc123')).toBeInTheDocument()
    expect(screen.queryByText('shell')).toBeNull()
  })

  it('asks for a sign-in first at the same address', () => {
    status = 'unauthenticated'
    pathname = '/oauth/consent'
    search = '?request=abc123'
    render(<App />)
    expect(screen.getByText('login')).toBeInTheDocument()
  })

  it('does not treat a deeper path as a share page', () => {
    pathname = '/share/abc/extra'
    render(<App />)
    expect(screen.getByText('shell')).toBeInTheDocument()
  })
})
