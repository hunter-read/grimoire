import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import MediaCard from './MediaCard'
import { MEDIA_CONFIGS } from './mediaConfig'

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <span data-testid="fav" /> }))
vi.mock('../DownloadButton', () => ({ default: () => <span data-testid="dl" /> }))
// AudioPlayer controller stub: renders a button when given a track.
vi.mock('../audio/AudioPlayer', () => ({
  default: ({ track, showPlayNext }) => (
    <span data-testid="audio-player">
      {track?.id}
      {showPlayNext ? ':next' : ''}
    </span>
  ),
}))

// MediaCard renders CardLink (<Link>) in non-bulk mode, so a Router is required.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)
let currentId = null
let playingId = null
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    isCurrent: (id) => id === currentId,
    isPlayingId: (id) => id === playingId,
  }),
}))

const audioItem = (over = {}) => ({
  id: 'a1',
  filename: 'tavern.mp3',
  title: 'Tavern Night',
  relative_path: 'audio/Ambient/tavern.mp3',
  has_artwork: false,
  is_missing: false,
  file_size: 1000,
  tags: [],
  ...over,
})

const mapItem = (over = {}) => ({
  id: 'm1',
  filename: 'cave.png',
  relative_path: 'maps/cave.png',
  has_thumbnail: false,
  is_missing: false,
  file_size: 1000,
  tags: [],
  ...over,
})

describe('MediaCard — audio', () => {
  it('renders an audio player in grid mode', () => {
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem()} />)
    expect(screen.getByTestId('audio-player')).toHaveTextContent('a1')
    expect(screen.getByText('tavern.mp3')).toBeInTheDocument()
  })

  it('renders an audio player with Play Next in list mode', () => {
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem()} list />)
    expect(screen.getByTestId('audio-player')).toHaveTextContent('a1:next')
  })

  it('hides the player for a missing audio file', () => {
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem({ is_missing: true })} />)
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument()
  })

  it('hides the player for an audio archive', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.audio}
        item={audioItem({ filename: 'ambience.zip', is_archive: true })}
      />
    )
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument()
  })

  it('shows artwork when has_artwork is set', () => {
    const { container } = render(
      <MediaCard config={MEDIA_CONFIGS.audio} item={audioItem({ has_artwork: true })} />
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('/audio/a1/artwork')
  })

  it('renders a real link to the audio detail page', () => {
    // Non-bulk: CardLink renders an <a> overlay with aria-label = item.filename.
    // Middle/ctrl-click open a new tab natively (no JS needed).
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem()} />)
    const link = screen.getByRole('link', { name: 'tavern.mp3' })
    expect(link).toHaveAttribute('href', '/audio/a1')
  })
})

describe('MediaCard — map (no audio controls)', () => {
  it('renders no audio player for a map', () => {
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} />)
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument()
  })

  it('renders a real link to the map detail page', () => {
    // Non-bulk: CardLink overlay with aria-label = item.filename.
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} />)
    const link = screen.getByRole('link', { name: 'cave.png' })
    expect(link).toHaveAttribute('href', '/maps/m1')
  })

  it('toggles selection in bulk mode instead of linking', async () => {
    const onToggle = vi.fn()
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem()}
        bulkMode
        selected={false}
        onToggle={onToggle}
      />
    )
    await userEvent.click(screen.getByText('cave.png'))
    expect(onToggle).toHaveBeenCalled()
    // No CardLink in bulk mode.
    expect(screen.queryByRole('link', { name: 'cave.png' })).not.toBeInTheDocument()
  })

  it('renders in list mode with a thumbnail', () => {
    const { container } = render(
      <MediaCard config={MEDIA_CONFIGS.map} item={mapItem({ has_thumbnail: true })} list />
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/maps/m1/thumbnail')
  })

  it('shows the missing badge for a missing item', () => {
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem({ is_missing: true })} />)
    expect(screen.getByText(/missing/i)).toBeInTheDocument()
  })

  it('shows the archive badge for an archive item', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ filename: 'pack.zip', is_archive: true })}
      />
    )
    expect(screen.getByText(/archive/i)).toBeInTheDocument()
  })

  it('hides the top-left archive badge in bulk mode (checkbox takes the corner)', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ filename: 'pack.zip', is_archive: true })}
        bulkMode
        selected={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.queryByText(/archive/i)).not.toBeInTheDocument()
  })

  it('shows the archive badge inline in list mode', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ filename: 'pack.zip', is_archive: true })}
        list
      />
    )
    expect(screen.getByText(/archive/i)).toBeInTheDocument()
  })

  it('toggles on Enter key in bulk mode', async () => {
    const onToggle = vi.fn()
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem()}
        bulkMode
        selected={false}
        onToggle={onToggle}
      />
    )
    // In bulk mode the card renders role=button.
    screen.getByRole('button', { name: 'cave.png' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onToggle).toHaveBeenCalled()
  })

  // Issue #313 — cards are now real <a> anchors, so the browser handles new-tab
  // natively. Tests verify the correct href; no window.open assertions needed.
  describe('real link card (issue #313)', () => {
    it.each([
      ['map', 'map', mapItem, '/maps/m1'],
      ['audio', 'audio', audioItem, '/audio/a1'],
    ])(
      'non-bulk %s card has the right href for native new-tab support',
      (_label, key, makeItem, href) => {
        render(<MediaCard config={MEDIA_CONFIGS[key]} item={makeItem()} />)
        const link = screen.getByRole('link', { name: makeItem().filename })
        expect(link).toHaveAttribute('href', href)
      }
    )

    it('list-layout map card has the right href', () => {
      render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} list />)
      const link = screen.getByRole('link', { name: 'cave.png' })
      expect(link).toHaveAttribute('href', '/maps/m1')
    })

    it('bulk mode renders a button, not a link', () => {
      const onToggle = vi.fn()
      render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} bulkMode onToggle={onToggle} />)
      expect(screen.getByRole('button', { name: 'cave.png' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'cave.png' })).not.toBeInTheDocument()
    })
  })
})

describe('MediaCard — now playing (audio list rows)', () => {
  beforeEach(() => {
    currentId = null
    playingId = null
  })

  const renderRow = (over) =>
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem(over)} list />)

  // Outside bulk mode the row is a plain container holding a stretched <a>, so
  // the now-playing state sits on the link's parent rather than on a button.
  const row = () => screen.getByRole('link', { name: 'tavern.mp3' }).parentElement

  it('leaves an unrelated row unmarked', () => {
    currentId = 'other'
    playingId = 'other'
    renderRow()
    expect(row()).not.toHaveAttribute('aria-current')
    expect(screen.queryByText('Now playing')).not.toBeInTheDocument()
  })

  it('marks the active row with aria-current and an accent bar', () => {
    currentId = 'a1'
    playingId = 'a1'
    renderRow()
    expect(row()).toHaveAttribute('aria-current', 'true')
    expect(row().style.borderLeft).toBe('3px solid var(--gold)')
  })

  it('states the playing status as text, not colour alone', () => {
    currentId = 'a1'
    playingId = 'a1'
    renderRow()
    expect(screen.getByText('Now playing')).toBeInTheDocument()
  })

  it('keeps a current-but-paused row marked but reports it as paused', () => {
    currentId = 'a1'
    playingId = null
    renderRow()
    expect(row()).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Current track, paused')).toBeInTheDocument()
    expect(screen.queryByText('Now playing')).not.toBeInTheDocument()
  })

  it('does not mark non-audio rows that share an id with the current track', () => {
    currentId = 'm1'
    playingId = 'm1'
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} list />)
    expect(screen.getByRole('link', { name: 'cave.png' }).parentElement).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('does not mark an audio archive row', () => {
    currentId = 'a1'
    playingId = 'a1'
    renderRow({ is_archive: true })
    expect(row()).not.toHaveAttribute('aria-current')
  })
})
