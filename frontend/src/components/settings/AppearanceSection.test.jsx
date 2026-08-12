import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppearanceSection from './AppearanceSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const setMode = vi.fn()
const selectTheme = vi.fn()
const reload = vi.fn()
let themeState

vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => themeState,
}))

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const THEME = {
  id: 'midnight',
  name: 'Midnight',
  mode: 'dark',
  modes: ['dark'],
  variants: { dark: { text: '#abcdef' } },
  tokens: { text: '#abcdef' },
  is_community: true,
}

const PAIRED = {
  id: 'duo',
  name: 'Duo',
  mode: 'dark',
  modes: ['light', 'dark'],
  variants: { light: { text: '#000000' }, dark: { text: '#ffffff' } },
  tokens: { text: '#ffffff' },
  is_community: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  themeState = {
    mode: 'dark',
    themeId: '',
    installed: [THEME],
    builtIn: [
      { id: '', name: 'Grimoire', app_mode: 'grimoire' },
      { id: 'codex', name: 'Codex', app_mode: 'codex' },
    ],
    loaded: true,
    setMode,
    selectTheme,
    reload,
  }
  api.get.mockResolvedValue({ downloads_enabled: true })
})

describe('AppearanceSection', () => {
  it('renders the three colour modes', async () => {
    render(<AppearanceSection />)

    expect(await screen.findByText('appearance.modes.light')).toBeInTheDocument()
    expect(screen.getByText('appearance.modes.dark')).toBeInTheDocument()
    expect(screen.getByText('appearance.modes.system')).toBeInTheDocument()
  })

  it('changes the mode when one is picked', async () => {
    render(<AppearanceSection />)

    await userEvent.click(screen.getByRole('radio', { name: /light/i }))

    expect(setMode).toHaveBeenCalledWith('light')
  })

  it('lists installed themes alongside the built-in ones', async () => {
    render(<AppearanceSection />)

    expect(await screen.findByText('Grimoire')).toBeInTheDocument()
    expect(screen.getByText('Midnight')).toBeInTheDocument()
  })

  // Codex is a bundled theme rather than something to install, so it is offered
  // in the picker even though its app mode has no toggle yet.
  // A paired theme is one row that says so, rather than two entries the user
  // has to switch between by hand.
  it('shows a paired theme once, marked as covering both modes', async () => {
    themeState.installed = [PAIRED]
    render(<AppearanceSection />)

    expect(await screen.findByText('Duo')).toBeInTheDocument()
    expect(screen.getAllByText(/Duo/)).toHaveLength(1)
    expect(screen.getByText(/appearance\.bothModes/)).toBeInTheDocument()
  })

  it('labels a single-mode theme with just that mode', async () => {
    render(<AppearanceSection />)

    // Scoped to the theme's own row: the colour-mode radios use the same keys.
    const row = (await screen.findByText('Midnight')).closest('label')
    expect(row).toHaveTextContent('appearance.modes.dark')
    expect(row).not.toHaveTextContent('appearance.bothModes')
  })

  it('offers the Codex built-in theme', async () => {
    render(<AppearanceSection />)

    expect(await screen.findByText('Codex')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Codex/ }))
    expect(selectTheme).toHaveBeenCalledWith('codex')
  })

  it('selects an installed theme', async () => {
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByRole('radio', { name: /Midnight/ }))

    expect(selectTheme).toHaveBeenCalledWith('midnight')
  })

  it('removes a theme', async () => {
    api.delete.mockResolvedValue({})
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'appearance.remove' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/themes/midnight'))
  })

  it('browses the catalogue and installs from it', async () => {
    api.get.mockImplementation((url) =>
      url === '/themes/browse'
        ? Promise.resolve({
            themes: [{ id: 'parchment', name: 'Parchment', description: 'Warm', installed: false }],
            is_custom_url: false,
          })
        : Promise.resolve({ downloads_enabled: true })
    )
    api.post.mockResolvedValue({})
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.browse'))
    expect(await screen.findByText('Parchment')).toBeInTheDocument()

    await userEvent.click(screen.getByText('appearance.install'))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/themes/install/parchment'))
  })

  it('marks a catalogue theme the user already has', async () => {
    api.get.mockImplementation((url) =>
      url === '/themes/browse'
        ? Promise.resolve({ themes: [{ id: 'midnight', name: 'Midnight', installed: true }] })
        : Promise.resolve({ downloads_enabled: true })
    )
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.browse'))

    expect(await screen.findByText('appearance.alreadyInstalled')).toBeInTheDocument()
  })

  it('reports a catalogue that cannot be reached', async () => {
    api.get.mockImplementation((url) =>
      url === '/themes/browse'
        ? Promise.reject(new Error('upstream is down'))
        : Promise.resolve({ downloads_enabled: true })
    )
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.browse'))

    expect(await screen.findByRole('alert')).toHaveTextContent('upstream is down')
  })

  it('shows an empty catalogue plainly', async () => {
    api.get.mockImplementation((url) =>
      url === '/themes/browse'
        ? Promise.resolve({ themes: [] })
        : Promise.resolve({ downloads_enabled: true })
    )
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.browse'))

    expect(await screen.findByText('appearance.empty')).toBeInTheDocument()
  })

  it('imports a pasted theme', async () => {
    api.post.mockResolvedValue({})
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.import'))
    // fireEvent rather than userEvent.type: the payload is JSON, and
    // userEvent treats `{` as the start of a special-key sequence.
    fireEvent.change(screen.getByLabelText('appearance.pasteLabel'), {
      target: { value: '{"id":"x","tokens":{"text":"#fff"}}' },
    })
    await userEvent.click(screen.getByText('appearance.importAction'))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(api.post.mock.calls[0][0]).toBe('/themes')
    expect(api.post.mock.calls[0][1]).toEqual({ id: 'x', tokens: { text: '#fff' } })
  })

  it('rejects paste that is not JSON without calling the API', async () => {
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.import'))
    fireEvent.change(screen.getByLabelText('appearance.pasteLabel'), {
      target: { value: 'not json at all' },
    })
    await userEvent.click(screen.getByText('appearance.importAction'))

    expect(await screen.findByRole('alert')).toHaveTextContent('appearance.notJson')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('keeps the pasted text when the server rejects the theme', async () => {
    api.post.mockRejectedValue(new Error('sets no colours Grimoire recognises'))
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.import'))
    const box = screen.getByLabelText('appearance.pasteLabel')
    fireEvent.change(box, { target: { value: '{"id":"x","tokens":{"nope":"#fff"}}' } })
    await userEvent.click(screen.getByText('appearance.importAction'))

    expect(await screen.findByRole('alert')).toHaveTextContent('sets no colours')
    expect(box).toHaveValue('{"id":"x","tokens":{"nope":"#fff"}}')
  })

  it('hides browsing and explains why when downloads are disabled', async () => {
    api.get.mockResolvedValue({ downloads_enabled: false })
    render(<AppearanceSection />)

    expect(await screen.findByText('appearance.downloadsDisabled')).toBeInTheDocument()
    expect(screen.queryByText('appearance.browse')).not.toBeInTheDocument()
    // Import stays available: that is the air-gapped escape hatch.
    expect(screen.getByText('appearance.import')).toBeInTheDocument()
  })

  it('surfaces a failed install', async () => {
    api.get.mockImplementation((url) =>
      url === '/themes/browse'
        ? Promise.resolve({ themes: [{ id: 'bad', name: 'Bad', installed: false }] })
        : Promise.resolve({ downloads_enabled: true })
    )
    api.post.mockRejectedValue(new Error('integrity check failed'))
    render(<AppearanceSection />)

    await userEvent.click(await screen.findByText('appearance.browse'))
    await userEvent.click(await screen.findByText('appearance.install'))

    expect(await screen.findByRole('alert')).toHaveTextContent('integrity check failed')
  })
})
