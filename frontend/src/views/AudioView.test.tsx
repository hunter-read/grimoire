import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AudioView from './AudioView'
import { SoundboardProvider, useSoundboard } from '../context/SoundboardContext'
import api from '../api'
import { fakeMediaGet } from '../test/fakeBrowseApi'

type Fixture = Record<string, unknown>

const mockGet = vi.mocked(api.get) as unknown as Mock

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  mediaUrl: (path: string) => `http://localhost${path}`,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../hooks/useUserPrefs', () => ({
  getUserPrefs: () => ({ cardSize: 'comfortable', librarySort: 'az' }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
}))

const mockIsFavorite = vi.fn<(type: string, id: string) => boolean>(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: vi.fn() }),
}))

vi.mock('../components/DownloadArchiveModal', () => ({
  default: () => null,
}))

// jsdom has no layout, so the real VirtualGrid measures zero rows; render all.
vi.mock('../components/media/VirtualGrid', () => ({
  default: ({
    items,
    renderItem,
  }: {
    items: unknown[]
    renderItem: (item: unknown, index: number) => ReactNode
  }) => <div>{items.map(renderItem)}</div>,
}))

// Keep every folder expanded so filenames are immediately visible: the
// collapsed-set key is pinned to an empty Set and ignores writes, which is what
// the old all-mocked version achieved for every key at once.
//
// Everything else — notably the session-backed sort/filter state — gets real
// state, since a no-op setter there would silently swallow the filter changes
// these tests make.
vi.mock('../hooks/useSessionState', () => ({
  default: (_key: string, init: unknown) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [val, setVal] = useState(init)
    return init instanceof Set ? [new Set(), () => {}] : [val, setVal]
  },
}))

function makeTrack(overrides: Fixture = {}): Fixture & { id: string } {
  const id = (overrides.id as string | undefined) ?? `audio-${Math.random().toString(36).slice(2)}`
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

function renderView() {
  return render(
    <MemoryRouter>
      <AudioView />
    </MemoryRouter>
  )
}

// A probe published alongside the view, so a test can read the board the view
// wrote to without reaching into the context module.
let board: ReturnType<typeof useSoundboard>
function BoardProbe() {
  board = useSoundboard()
  return null
}

function renderViewWithSoundboard() {
  return render(
    <MemoryRouter>
      <SoundboardProvider>
        <AudioView />
        <BoardProbe />
      </SoundboardProvider>
    </MemoryRouter>
  )
}

// Favorites is now a checkbox inside the Filters modal (no toolbar button).
async function toggleFavoritesFilter() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  await userEvent.click(screen.getByRole('checkbox', { name: /favorites/i }))
  await userEvent.click(screen.getByRole('button', { name: /done/i }))
}

describe('AudioView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  // The server filters, groups and pages now (issue #221); the fake answers
  // those endpoints over `audio`, with favourites from the mocked context.
  function setupAudio(audio: Fixture[]) {
    mockGet.mockImplementation(
      fakeMediaGet({
        listUrl: '/audio',
        collection: 'audio',
        foldersUrl: '/audio-folders',
        items: audio,
        isFavorite: (id: string) => mockIsFavorite('audio', id),
      } as unknown as Parameters<typeof fakeMediaGet>[0])
    )
  }

  it('renders untitled tracks by filename, without the extension', async () => {
    setupAudio([makeTrack({ filename: 'tavern.mp3', relative_path: 'audio/tavern.mp3' })])
    renderView()
    await waitFor(() => expect(screen.getByText('tavern')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders play controls (card + folder) for tracks', async () => {
    setupAudio([makeTrack({ filename: 'battle.mp3', relative_path: 'audio/battle.mp3' })])
    renderView()
    await waitFor(() => expect(screen.getByText('battle')).toBeInTheDocument())
    // Both the per-track card play button and the folder "Play" button render.
    expect(screen.getAllByRole('button', { name: /play/i }).length).toBeGreaterThanOrEqual(2)
  })

  it('adds every selected track to the soundboard in one go', async () => {
    localStorage.clear()
    setupAudio([
      makeTrack({ id: 'a1', filename: 'thunder.mp3', relative_path: 'audio/thunder.mp3' }),
      makeTrack({ id: 'a2', filename: 'door.mp3', relative_path: 'audio/door.mp3' }),
    ])
    renderViewWithSoundboard()
    await waitFor(() => expect(screen.getByText('thunder')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /multi-select|select/i }))
    await userEvent.click(screen.getByText('thunder'))
    await userEvent.click(screen.getByText('door'))

    await userEvent.click(screen.getByRole('button', { name: /add to soundboard/i }))

    // In display order: the server sorts by name, so door.mp3 comes first.
    await waitFor(() => expect(board.pads.map((p) => p.id)).toEqual(['a2', 'a1']))
    // The bulk action finishes by leaving select mode, like the other actions.
    expect(screen.queryByRole('button', { name: /add to soundboard/i })).toBeNull()
  })

  it('favorites filter hides non-favorite tracks', async () => {
    const fav = makeTrack({ id: 'fav', filename: 'fav.mp3', relative_path: 'audio/fav.mp3' })
    const other = makeTrack({
      id: 'other',
      filename: 'other.mp3',
      relative_path: 'audio/other.mp3',
    })
    setupAudio([fav, other])
    mockIsFavorite.mockImplementation(
      (type: string, id: string) => type === 'audio' && id === 'fav'
    )

    renderView()
    await waitFor(() => expect(screen.getByText('fav')).toBeInTheDocument())

    await toggleFavoritesFilter()

    expect(screen.getByText('fav')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
  })
})
