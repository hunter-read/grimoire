import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from './ThemeContext'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn() } }))

const THEME = {
  id: 'midnight',
  name: 'Midnight',
  mode: 'dark',
  tokens: { text: '#abcdef' },
  is_community: false,
}

function Probe() {
  const { mode, themeId, installed, loaded } = useTheme()
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="theme">{themeId || 'none'}</span>
      <span data-testid="count">{installed.length}</span>
      <span data-testid="loaded">{String(loaded)}</span>
    </div>
  )
}

function Controls() {
  const { setMode, selectTheme } = useTheme()
  return (
    <div>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => selectTheme('midnight')}>pick</button>
      <button onClick={() => selectTheme('')}>clear</button>
    </div>
  )
}

const renderProvider = (extra = null) =>
  render(
    <ThemeProvider>
      <Probe />
      {extra}
    </ThemeProvider>
  )

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.cssText = ''
  api.put.mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeProvider', () => {
  it('adopts the server state on load', async () => {
    api.get.mockResolvedValue({ installed: [THEME], mode: 'light', theme_id: 'midnight' })
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(screen.getByTestId('mode')).toHaveTextContent('light')
    expect(screen.getByTestId('theme')).toHaveTextContent('midnight')
    expect(screen.getByTestId('count')).toHaveTextContent('1')
  })

  it('applies the selected theme tokens to the document', async () => {
    api.get.mockResolvedValue({ installed: [THEME], mode: 'dark', theme_id: 'midnight' })
    renderProvider()

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#abcdef')
    )
  })

  it('falls back to the built-in palette when the selected theme is gone', async () => {
    api.get.mockResolvedValue({ installed: [], mode: 'dark', theme_id: 'vanished' })
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
  })

  it('keeps the locally stored theme when the server is unreachable', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(screen.getByTestId('mode')).toHaveTextContent('dark')
  })

  it('persists a mode change to the server and the document', async () => {
    api.get.mockResolvedValue({ installed: [], mode: 'dark', theme_id: '' })
    renderProvider(<Controls />)
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))

    await userEvent.click(screen.getByText('light'))

    expect(api.put).toHaveBeenCalledWith('/themes/selection', {
      mode: 'light',
      app_mode: 'grimoire',
    })
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('light'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists a theme selection', async () => {
    api.get.mockResolvedValue({ installed: [THEME], mode: 'dark', theme_id: '' })
    renderProvider(<Controls />)
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))

    await userEvent.click(screen.getByText('pick'))

    expect(api.put).toHaveBeenCalledWith('/themes/selection', {
      theme_id: 'midnight',
      app_mode: 'grimoire',
    })
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#abcdef')
    )
  })

  it('clears the tokens when returning to the built-in theme', async () => {
    api.get.mockResolvedValue({ installed: [THEME], mode: 'dark', theme_id: 'midnight' })
    renderProvider(<Controls />)
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#abcdef')
    )

    await userEvent.click(screen.getByText('clear'))

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
    )
  })

  it('keeps a local change when the server rejects it', async () => {
    api.get.mockResolvedValue({ installed: [], mode: 'dark', theme_id: '' })
    api.put.mockRejectedValue(new Error('nope'))
    renderProvider(<Controls />)
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))

    await userEvent.click(screen.getByText('light'))

    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('light'))
  })

  // A theme is untrusted even coming back from our own API: the row could have
  // been written before a validation fix, or edited in the database.
  it('never applies an unsafe token value from the server', async () => {
    api.get.mockResolvedValue({
      installed: [{ ...THEME, tokens: { text: 'red; background: url(https://evil/)' } }],
      mode: 'dark',
      theme_id: 'midnight',
    })
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
  })

  it('gives sensible defaults outside a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('mode')).toHaveTextContent('dark')
    expect(screen.getByTestId('loaded')).toHaveTextContent('false')
  })
})

/**
 * App mode is the second axis: Grimoire (TTRPG) or Codex (wargaming). Codex has
 * no toggle in the UI yet, so these drive the context directly.
 */
describe('app modes', () => {
  const BUILT_IN = [
    { id: '', name: 'Grimoire', app_mode: 'grimoire' },
    { id: 'codex', name: 'Codex', app_mode: 'codex' },
  ]

  function AppModeProbe() {
    const { appMode, switchAppMode, selectTheme } = useTheme()
    return (
      <div>
        <span data-testid="app-mode">{appMode}</span>
        <button onClick={() => switchAppMode('codex')}>to-codex</button>
        <button onClick={() => selectTheme('codex')}>pick-codex</button>
      </div>
    )
  }

  it('defaults to grimoire and stamps it on the document', async () => {
    api.get.mockResolvedValue({ installed: [], built_in: BUILT_IN, mode: 'dark', theme_id: '' })
    render(
      <ThemeProvider>
        <AppModeProbe />
      </ThemeProvider>
    )

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-app-mode')).toBe('grimoire')
    )
    expect(screen.getByTestId('app-mode')).toHaveTextContent('grimoire')
  })

  it('asks the server for the requested app mode', async () => {
    api.get.mockResolvedValue({ installed: [], built_in: BUILT_IN, mode: 'dark', theme_id: '' })
    render(
      <ThemeProvider>
        <AppModeProbe />
      </ThemeProvider>
    )
    await waitFor(() => expect(api.get).toHaveBeenCalled())

    await userEvent.click(screen.getByText('to-codex'))

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/themes?app_mode=codex'))
    expect(document.documentElement.getAttribute('data-app-mode')).toBe('codex')
  })

  // A built-in theme carries no tokens — its colours are stylesheet rules keyed
  // off data-app-mode, so selecting one switches the attribute instead.
  it('selecting the Codex built-in switches the palette without tokens', async () => {
    api.get.mockResolvedValue({ installed: [], built_in: BUILT_IN, mode: 'dark', theme_id: '' })
    render(
      <ThemeProvider>
        <AppModeProbe />
      </ThemeProvider>
    )
    await waitFor(() => expect(api.get).toHaveBeenCalled())

    await userEvent.click(screen.getByText('pick-codex'))

    expect(document.documentElement.getAttribute('data-app-mode')).toBe('codex')
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
    expect(api.put).toHaveBeenCalledWith('/themes/selection', {
      theme_id: 'codex',
      app_mode: 'grimoire',
    })
  })

  it('remembers each app mode’s colour mode separately', async () => {
    localStorage.setItem('grimoire:theme-mode', 'light')
    localStorage.setItem('grimoire:theme-mode:codex', 'dark')
    api.get.mockRejectedValue(new Error('offline'))

    const { getThemeMode } = await import('../utils/theme')
    expect(getThemeMode('grimoire')).toBe('light')
    expect(getThemeMode('codex')).toBe('dark')
  })
})
