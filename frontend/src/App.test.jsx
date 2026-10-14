import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

let status = 'authenticated'
let pathname = '/'
vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({ status, login: vi.fn() }),
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname }),
}))
// vi.mock is hoisted, so each factory carries its own pass-through provider.
vi.mock('./context/FavoritesContext', () => ({ FavoritesProvider: ({ children }) => children }))
vi.mock('./context/AudioPlayerContext', () => ({
  AudioPlayerProvider: ({ children }) => children,
}))
vi.mock('./context/SoundboardContext', () => ({ SoundboardProvider: ({ children }) => children }))
vi.mock('./context/ThemeContext', () => ({ ThemeProvider: ({ children }) => children }))
vi.mock('./views/SetupView', () => ({ default: () => <div>setup</div> }))
vi.mock('./views/LoginView', () => ({ default: () => <div>login</div> }))
vi.mock('./views/ShareView', () => ({ default: ({ token }) => <div>{`share:${token}`}</div> }))
vi.mock('./components/LoadingScreen', () => ({ default: () => <div>loading</div> }))
vi.mock('./components/AppShell', () => ({ default: () => <div>shell</div> }))

beforeEach(() => {
  status = 'authenticated'
  pathname = '/'
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

  it('does not treat a deeper path as a share page', () => {
    pathname = '/share/abc/extra'
    render(<App />)
    expect(screen.getByText('shell')).toBeInTheDocument()
  })
})
