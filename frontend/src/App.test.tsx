import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import App from './App'

type WithChildren = { children: ReactNode }

let status = 'authenticated'
let pathname = '/'
let user: { id: string } | null = { id: 'u1' }
vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({ status, user, login: vi.fn() }),
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname }),
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
  default: ({ token }: { token: string }) => <div>{`share:${token}`}</div>,
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

  it('starts the signed-in tree over when a different account signs in', () => {
    const { rerender } = render(<App />)
    expect(shellMounts).toBe(1)
    rerender(<App />)
    expect(shellMounts).toBe(1)
    user = { id: 'u2' }
    rerender(<App />)
    expect(shellMounts).toBe(2)
  })

  it('does not treat a deeper path as a share page', () => {
    pathname = '/share/abc/extra'
    render(<App />)
    expect(screen.getByText('shell')).toBeInTheDocument()
  })
})
