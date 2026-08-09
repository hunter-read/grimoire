import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem()} onClick={vi.fn()} />)
    expect(screen.getByTestId('audio-player')).toHaveTextContent('a1')
    expect(screen.getByText('tavern.mp3')).toBeInTheDocument()
  })

  it('renders an audio player with Play Next in list mode', () => {
    render(<MediaCard config={MEDIA_CONFIGS.audio} item={audioItem()} onClick={vi.fn()} list />)
    expect(screen.getByTestId('audio-player')).toHaveTextContent('a1:next')
  })

  it('hides the player for a missing audio file', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.audio}
        item={audioItem({ is_missing: true })}
        onClick={vi.fn()}
      />
    )
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument()
  })

  it('hides the player for an audio archive', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.audio}
        item={audioItem({ filename: 'ambience.zip', is_archive: true })}
        onClick={vi.fn()}
      />
    )
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument()
  })

  it('shows artwork when has_artwork is set', () => {
    const { container } = render(
      <MediaCard
        config={MEDIA_CONFIGS.audio}
        item={audioItem({ has_artwork: true })}
        onClick={vi.fn()}
      />
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('/audio/a1/artwork')
  })
})

describe('MediaCard — map (no audio controls)', () => {
  it('renders no audio player for a map', () => {
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} onClick={vi.fn()} />)
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument()
  })

  it('fires onClick when activated', async () => {
    const onClick = vi.fn()
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} onClick={onClick} />)
    await userEvent.click(screen.getByText('cave.png'))
    expect(onClick).toHaveBeenCalled()
  })

  it('toggles selection in bulk mode instead of opening', async () => {
    const onClick = vi.fn()
    const onToggle = vi.fn()
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem()}
        onClick={onClick}
        bulkMode
        selected={false}
        onToggle={onToggle}
      />
    )
    await userEvent.click(screen.getByText('cave.png'))
    expect(onToggle).toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders in list mode with a thumbnail', () => {
    const { container } = render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ has_thumbnail: true })}
        onClick={vi.fn()}
        list
      />
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/maps/m1/thumbnail')
  })

  it('shows the missing badge for a missing item', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ is_missing: true })}
        onClick={vi.fn()}
      />
    )
    expect(screen.getByText(/missing/i)).toBeInTheDocument()
  })

  it('shows the archive badge for an archive item', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ filename: 'pack.zip', is_archive: true })}
        onClick={vi.fn()}
      />
    )
    expect(screen.getByText(/archive/i)).toBeInTheDocument()
  })

  it('hides the top-left archive badge in bulk mode (checkbox takes the corner)', () => {
    render(
      <MediaCard
        config={MEDIA_CONFIGS.map}
        item={mapItem({ filename: 'pack.zip', is_archive: true })}
        onClick={vi.fn()}
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
        onClick={vi.fn()}
        list
      />
    )
    expect(screen.getByText(/archive/i)).toBeInTheDocument()
  })

  it('opens on Enter key', async () => {
    const onClick = vi.fn()
    render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} onClick={onClick} />)
    // The focusable card is the role=button element labelled by the filename.
    screen.getByRole('button', { name: 'cave.png' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalled()
  })

  // Issue #313 — the card is a <div>, so new-tab behaviour is wired by hand.
  describe('opening in a new tab', () => {
    let open

    beforeEach(() => {
      open = vi.spyOn(window, 'open').mockImplementation(() => null)
    })

    afterEach(() => open.mockRestore())

    it.each([
      ['map', 'map', mapItem, '/maps/m1'],
      ['audio', 'audio', audioItem, '/audio/a1'],
    ])('middle click opens a %s in a new tab', async (_label, key, makeItem, href) => {
      const onClick = vi.fn()
      render(<MediaCard config={MEDIA_CONFIGS[key]} item={makeItem()} onClick={onClick} />)

      await userEvent.pointer({ target: screen.getAllByRole('button')[0], keys: '[MouseMiddle]' })

      expect(open).toHaveBeenCalledWith(href, '_blank', 'noopener,noreferrer')
      expect(onClick).not.toHaveBeenCalled()
    })

    it('opens in a new tab from the list layout too', async () => {
      render(<MediaCard config={MEDIA_CONFIGS.map} item={mapItem()} onClick={vi.fn()} list />)

      await userEvent.pointer({
        target: screen.getByRole('button', { name: 'cave.png' }),
        keys: '[MouseMiddle]',
      })

      expect(open).toHaveBeenCalledWith('/maps/m1', '_blank', 'noopener,noreferrer')
    })

    it('selects instead of opening a tab in bulk mode', async () => {
      const onToggle = vi.fn()
      render(
        <MediaCard
          config={MEDIA_CONFIGS.map}
          item={mapItem()}
          onClick={vi.fn()}
          bulkMode
          onToggle={onToggle}
        />
      )

      await userEvent.pointer({
        target: screen.getByRole('button', { name: 'cave.png' }),
        keys: '[MouseMiddle]',
      })

      expect(open).not.toHaveBeenCalled()
    })
  })
})
