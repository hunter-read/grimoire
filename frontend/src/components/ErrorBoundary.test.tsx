import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'

const mockNavigate = vi.fn()
let useMockNavigate = false
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: (...args: Parameters<typeof actual.useNavigate>) =>
      useMockNavigate ? mockNavigate : actual.useNavigate(...args),
  }
})

function Boom(): never {
  throw new Error('render failed')
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>go {to}</button>
}

// Mirrors AppShell: the boundary sits around the routes and resets on location.
function Shell() {
  const location = useLocation()
  return (
    <>
      <GoTo to="/fine" />
      <ErrorBoundary resetKey={location.key}>
        <Routes>
          <Route path="/broken" element={<Boom />} />
          <Route path="/fine" element={<p>fine view</p>} />
        </Routes>
      </ErrorBoundary>
    </>
  )
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell />
    </MemoryRouter>
  )

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useMockNavigate = false
  mockNavigate.mockReset()
  // React reports every error a boundary catches; keep the test output clean.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  window.history.replaceState(null, '')
})

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    renderAt('/fine')
    expect(screen.getByText('fine view')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the fallback panel instead of a blank page when a view throws', () => {
    renderAt('/broken')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    // Whatever sits outside the boundary - the nav - is still there and usable.
    expect(screen.getByRole('button', { name: 'go /fine' })).toBeInTheDocument()
  })

  it('recovers when the location changes', async () => {
    renderAt('/broken')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'go /fine' }))
    expect(await screen.findByText('fine view')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reloads the page from the Reload button', async () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    })
    try {
      renderAt('/broken')
      await userEvent.click(screen.getByRole('button', { name: /reload/i }))
      expect(reload).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('goes back when there is an earlier entry in the app', async () => {
    useMockNavigate = true
    window.history.replaceState({ idx: 2 }, '')
    renderAt('/broken')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('goes home when the broken page was the first one opened', async () => {
    useMockNavigate = true
    renderAt('/broken')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})
