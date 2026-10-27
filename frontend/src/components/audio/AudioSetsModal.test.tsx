import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AudioSetsModal from './AudioSetsModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts?.name && opts?.count !== undefined) return `${key}:${opts.name}:${opts.count}`
      if (opts?.name) return `${key}:${opts.name}`
      if (opts?.count !== undefined) return `${key}:${opts.count}`
      return key
    },
  }),
}))

// The hook is mocked rather than the api module: this suite is about how the
// modal drives the player and the board, and useAudioSets is covered on its own.
const hook = {
  sets: [],
  loading: false,
  error: null,
  refresh: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  rename: vi.fn(() => Promise.resolve({})),
  remove: vi.fn(() => Promise.resolve()),
}
vi.mock('../../hooks/useAudioSets', () => ({ default: () => hook }))

const player = { queue: [], playQueue: vi.fn(), addToQueue: vi.fn() }
vi.mock('../../context/AudioPlayerContext', () => ({ useAudioPlayer: () => player }))

const board = {
  pads: [],
  replacePads: vi.fn(),
  updateLayout: vi.fn(),
}
vi.mock('../../context/SoundboardContext', () => ({ useSoundboard: () => board }))

const PLAYLIST = { id: 'p1', kind: 'playlist', name: 'Storm', count: 2, layout: null }
const BOARD = {
  id: 'b1',
  kind: 'soundboard',
  name: 'Tavern',
  count: 2,
  layout: { cols: 3, rows: 5 },
}

const entry = (id, extra = {}) => ({
  audio_id: id,
  loop: false,
  title: `Title ${id}`,
  artist: '',
  has_artwork: false,
  ...extra,
})

const setup = (onClose = vi.fn()) => {
  const user = userEvent.setup()
  render(<AudioSetsModal onClose={onClose} />)
  return { user, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  hook.sets = []
  hook.loading = false
  hook.error = null
  player.queue = []
  board.pads = []
})

describe('AudioSetsModal', () => {
  it('shows a spinner while listing', () => {
    hook.loading = true
    setup()
    expect(screen.queryByText('audioSets.empty')).toBeNull()
  })

  it('shows an empty state with nothing saved', () => {
    setup()
    expect(screen.getByText('audioSets.empty')).toBeInTheDocument()
  })

  it('lists both kinds with their counts', () => {
    hook.sets = [PLAYLIST, BOARD]
    setup()
    expect(screen.getByText('Storm')).toBeInTheDocument()
    expect(screen.getByText('audioSets.trackCount:2')).toBeInTheDocument()
    expect(screen.getByText('Tavern')).toBeInTheDocument()
    expect(screen.getByText('audioSets.padCount:2')).toBeInTheDocument()
  })

  it('surfaces a list error', () => {
    hook.error = 'boom'
    setup()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('loads a playlist straight into an empty queue and closes', async () => {
    hook.sets = [PLAYLIST]
    hook.load.mockResolvedValue({ entries: [entry('x'), entry('y')], missing: 0 })
    const { user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Storm' }))

    await waitFor(() => expect(player.playQueue).toHaveBeenCalled())
    expect(player.playQueue).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'x', title: 'Title x', _hydrated: true }),
      expect.objectContaining({ id: 'y' }),
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('confirms before replacing a queue that has content', async () => {
    hook.sets = [PLAYLIST]
    player.queue = [{ id: 'live' }]
    hook.load.mockResolvedValue({ entries: [entry('x')], missing: 0 })
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Storm' }))
    expect(player.playQueue).not.toHaveBeenCalled()
    expect(screen.getByText('audioSets.confirmReplaceQueue')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'audioSets.replace' }))
    await waitFor(() => expect(player.playQueue).toHaveBeenCalled())
  })

  it('backs out of a confirm without loading', async () => {
    hook.sets = [PLAYLIST]
    player.queue = [{ id: 'live' }]
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Storm' }))
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(screen.queryByText('audioSets.confirmReplaceQueue')).toBeNull()
    expect(hook.load).not.toHaveBeenCalled()
    expect(player.playQueue).not.toHaveBeenCalled()
  })

  it('appends to a live queue without confirming', async () => {
    hook.sets = [PLAYLIST]
    player.queue = [{ id: 'live' }]
    hook.load.mockResolvedValue({ entries: [entry('x'), entry('y')], missing: 0 })
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.append:Storm' }))

    await waitFor(() => expect(player.addToQueue).toHaveBeenCalledTimes(2))
    expect(player.playQueue).not.toHaveBeenCalled()
    expect(screen.queryByText('audioSets.confirmReplaceQueue')).toBeNull()
  })

  it('offers no append for a soundboard', () => {
    hook.sets = [BOARD]
    setup()
    expect(screen.queryByRole('button', { name: 'audioSets.append:Tavern' })).toBeNull()
  })

  it('loads a soundboard: sizes the grid and replaces the pads with their loops', async () => {
    hook.sets = [BOARD]
    hook.load.mockResolvedValue({
      entries: [entry('x', { loop: true }), entry('y')],
      missing: 0,
      layout: { cols: 3, rows: 5 },
    })
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Tavern' }))

    await waitFor(() => expect(board.replacePads).toHaveBeenCalled())
    expect(board.updateLayout).toHaveBeenCalledWith({ cols: 3, rows: 5 })
    // One replace, not a clear plus an add — the two would drop any pad the
    // outgoing board shared with this one.
    expect(board.replacePads).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'x', loop: true }),
      expect.objectContaining({ id: 'y', loop: false }),
    ])
  })

  it('confirms before replacing a board that has pads', async () => {
    hook.sets = [BOARD]
    board.pads = [{ id: 'live' }]
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'audioSets.load:Tavern' }))
    expect(screen.getByText('audioSets.confirmReplaceBoard')).toBeInTheDocument()
    expect(board.replacePads).not.toHaveBeenCalled()
  })

  it('loads a board with no saved layout without touching the grid', async () => {
    hook.sets = [BOARD]
    hook.load.mockResolvedValue({ entries: [entry('x')], missing: 0, layout: null })
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'audioSets.load:Tavern' }))
    await waitFor(() => expect(board.replacePads).toHaveBeenCalled())
    expect(board.updateLayout).not.toHaveBeenCalled()
  })

  it('loads what remains and says how many tracks were skipped', async () => {
    hook.sets = [PLAYLIST]
    hook.load.mockResolvedValue({ entries: [entry('x')], missing: 1 })
    const { user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Storm' }))

    expect(await screen.findByText('audioSets.someMissing:Storm:1')).toBeInTheDocument()
    expect(player.playQueue).toHaveBeenCalled()
    // The notice needs reading, so the modal stays open.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so when every track in a set is gone', async () => {
    hook.sets = [PLAYLIST]
    hook.load.mockResolvedValue({ entries: [], missing: 0 })
    const { user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Storm' }))

    expect(await screen.findByText('audioSets.allMissing:Storm')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves the live queue alone when the load itself fails', async () => {
    hook.sets = [PLAYLIST]
    hook.load.mockRejectedValue(new Error('server down'))
    const { user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.load:Storm' }))

    expect(await screen.findByText('server down')).toBeInTheDocument()
    expect(player.playQueue).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renames from the list', async () => {
    hook.sets = [PLAYLIST]
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.rename:Storm' }))
    const input = screen.getByLabelText('audioSets.renameLabel:Storm')
    await user.clear(input)
    await user.type(input, 'Tempest{Enter}')

    await waitFor(() => expect(hook.rename).toHaveBeenCalledWith('p1', 'Tempest'))
  })

  it('abandons a rename on Escape', async () => {
    hook.sets = [PLAYLIST]
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'audioSets.rename:Storm' }))
    await user.type(screen.getByLabelText('audioSets.renameLabel:Storm'), '{Escape}')

    expect(hook.rename).not.toHaveBeenCalled()
    expect(screen.getByText('Storm')).toBeInTheDocument()
  })

  it('does not call rename when the name is unchanged', async () => {
    hook.sets = [PLAYLIST]
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'audioSets.rename:Storm' }))
    await user.type(screen.getByLabelText('audioSets.renameLabel:Storm'), '{Enter}')
    expect(hook.rename).not.toHaveBeenCalled()
  })

  it('deletes from the list', async () => {
    hook.sets = [PLAYLIST]
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'audioSets.delete:Storm' }))
    expect(hook.remove).toHaveBeenCalledWith('p1')
  })

  it('closes from the close button and the backdrop', async () => {
    const { user, onClose } = setup()
    await user.click(screen.getByRole('button', { name: 'common.close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
