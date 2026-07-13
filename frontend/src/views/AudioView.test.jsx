import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AudioView from './AudioView'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  mediaUrl: (path) => `http://localhost${path}`,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../hooks/useUserPrefs', () => ({
  getUserPrefs: () => ({ cardSize: 'comfortable', librarySort: 'az' }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
}))

const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: vi.fn() }),
}))

vi.mock('../components/DownloadArchiveModal', () => ({
  default: () => null,
}))

vi.mock('../components/LazyGrid', () => ({
  default: ({ children }) => <>{children}</>,
}))

vi.mock('../hooks/useSessionState', () => ({
  default: (_key, _init) => [new Set(), vi.fn()],
}))

function makeTrack(overrides = {}) {
  const id = overrides.id ?? `audio-${Math.random().toString(36).slice(2)}`
  const filename = overrides.filename ?? `track-${id}.mp3`
  return {
    id,
    filename,
    relative_path: overrides.relative_path ?? `audio/${filename}`,
    tags: overrides.tags ?? [],
    duration: 120,
    title: overrides.title ?? '',
    artist: '',
    album: '',
    has_artwork: false,
    is_missing: false,
    file_size: 1000,
    ...overrides,
  }
}

function makeResponse(audio = []) {
  return { audio, total: audio.length }
}

function renderView() {
  return render(
    <MemoryRouter>
      <AudioView />
    </MemoryRouter>
  )
}

describe('AudioView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  function setupAudio(audio) {
    api.get.mockImplementation((url) => {
      if (url === '/audio') return Promise.resolve(makeResponse(audio))
      if (url === '/audio-folders') return Promise.resolve({ folders: [] })
      return Promise.resolve({})
    })
  }

  it('renders track filenames after loading', async () => {
    setupAudio([makeTrack({ filename: 'tavern.mp3', relative_path: 'audio/tavern.mp3' })])
    renderView()
    await waitFor(() => expect(screen.getByText('tavern.mp3')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders play controls (card + folder) for tracks', async () => {
    setupAudio([makeTrack({ filename: 'battle.mp3', relative_path: 'audio/battle.mp3' })])
    renderView()
    await waitFor(() => expect(screen.getByText('battle.mp3')).toBeInTheDocument())
    // Both the per-track card play button and the folder "Play" button render.
    expect(screen.getAllByRole('button', { name: /play/i }).length).toBeGreaterThanOrEqual(2)
  })

  it('favorites filter hides non-favorite tracks', async () => {
    const fav = makeTrack({ id: 'fav', filename: 'fav.mp3', relative_path: 'audio/fav.mp3' })
    const other = makeTrack({
      id: 'other',
      filename: 'other.mp3',
      relative_path: 'audio/other.mp3',
    })
    setupAudio([fav, other])
    mockIsFavorite.mockImplementation((type, id) => type === 'audio' && id === 'fav')

    renderView()
    await waitFor(() => expect(screen.getByText('fav.mp3')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))

    expect(screen.getByText('fav.mp3')).toBeInTheDocument()
    expect(screen.queryByText('other.mp3')).not.toBeInTheDocument()
  })
})
