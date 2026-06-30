import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

let authStatus = 'loading'
vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({ status: authStatus, login: vi.fn() }),
}))
vi.mock('./context/FavoritesContext', () => ({ FavoritesProvider: ({ children }) => children }))
vi.mock('./context/AudioPlayerContext', () => ({ AudioPlayerProvider: ({ children }) => children }))
vi.mock('./views/SetupView', () => ({ default: () => <div>setup</div> }))
vi.mock('./views/LoginView', () => ({ default: () => <div>login</div> }))
vi.mock('./components/LoadingScreen', () => ({ default: () => <div>loading</div> }))
vi.mock('./components/AppShell', () => ({ default: () => <div>shell</div> }))

describe('App auth gating', () => {
  it('shows the loading screen while auth is resolving', () => {
    authStatus = 'loading'
    render(<App />)
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('shows setup when uninitialized', () => {
    authStatus = 'uninitialized'
    render(<App />)
    expect(screen.getByText('setup')).toBeInTheDocument()
  })

  it('shows login when unauthenticated', () => {
    authStatus = 'unauthenticated'
    render(<App />)
    expect(screen.getByText('login')).toBeInTheDocument()
  })

  it('renders the app shell (wrapped in providers) when authenticated', () => {
    authStatus = 'authenticated'
    render(<App />)
    expect(screen.getByText('shell')).toBeInTheDocument()
  })
})
