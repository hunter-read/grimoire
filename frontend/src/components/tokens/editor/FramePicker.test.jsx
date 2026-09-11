import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import FramePicker from './FramePicker'
import { BUILTIN_FRAMES } from './frames'
import * as favoritesContext from '../../../context/FavoritesContext'

const builtins = BUILTIN_FRAMES.map((f) => ({ ...f, group: '' }))
const userFrame = { id: 'abc', name: 'orc ring', group: 'Fantasy', builtin: false }

const HINT =
  'Add your own frames by putting PNG, WebP, or SVG images in a folder that contains a ' +
  '.frames-container marker file, anywhere inside your tokens library.'

/** Pretend the given token ids are favourited, the way the gallery would. */
function mockFavorites(favoritedTokenIds = []) {
  vi.spyOn(favoritesContext, 'useFavorites').mockReturnValue({
    isFavorite: (type, id) => type === 'token' && favoritedTokenIds.includes(id),
    toggleFavorite: vi.fn(),
    items: [],
  })
}

describe('FramePicker', () => {
  // The favourites spy replaces a module export, so it has to come back off
  // between tests or the first mock leaks into every later render.
  afterEach(() => vi.restoreAllMocks())

  it('offers a "no frame" tile that leads the list', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    const none = screen.getByRole('button', { name: 'No frame' })
    expect(none).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders every built-in frame', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Player character' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Non-player character' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Opponent' })).toBeInTheDocument()
  })

  it('marks the selected frame and reports changes', async () => {
    const onChange = vi.fn()
    render(<FramePicker frames={builtins} value="builtin:npc" onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Non-player character' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await userEvent.click(screen.getByRole('button', { name: 'Player character' }))
    expect(onChange).toHaveBeenCalledWith('builtin:pc')
  })

  it('clears the selection through the "no frame" tile', async () => {
    const onChange = vi.fn()
    render(<FramePicker frames={builtins} value="builtin:pc" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'No frame' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('groups user frames under the folder that holds them', () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Fantasy/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'orc ring' })).toBeInTheDocument()
  })

  it('labels ungrouped user frames with a fallback heading', () => {
    render(
      <FramePicker
        frames={[...builtins, { id: 'x', name: 'plain', group: '', builtin: false }]}
        value={null}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Library frames/ })).toBeInTheDocument()
  })

  it('explains how to add custom frames when the library has none', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it('hides that hint once the library supplies frames', () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('withholds the hint while frames are still loading', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} loading />)
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('survives a missing catalogue', () => {
    render(<FramePicker frames={null} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'No frame' })).toBeInTheDocument()
  })

  // --- collapsing ---------------------------------------------------------

  it('starts every group expanded', () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Fantasy/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses a group and hides its frames, without touching the built-ins', async () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /Fantasy/ }))

    expect(screen.getByRole('button', { name: /Fantasy/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByRole('button', { name: 'orc ring' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Player character' })).toBeInTheDocument()
  })

  it('reopens a collapsed group', async () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    const heading = screen.getByRole('button', { name: /Fantasy/ })

    await userEvent.click(heading)
    await userEvent.click(heading)

    expect(screen.getByRole('button', { name: 'orc ring' })).toBeInTheDocument()
  })

  it('collapses groups independently of one another', async () => {
    const scifi = { id: 'def', name: 'chrome ring', group: 'Scifi', builtin: false }
    render(<FramePicker frames={[...builtins, userFrame, scifi]} value={null} onChange={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /Fantasy/ }))

    expect(screen.queryByRole('button', { name: 'orc ring' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chrome ring' })).toBeInTheDocument()
  })

  // --- search -------------------------------------------------------------

  it('offers no search box until the library supplies frames', () => {
    render(<FramePicker frames={builtins} value={null} onChange={vi.fn()} />)
    expect(screen.queryByRole('searchbox', { name: 'Search frames' })).not.toBeInTheDocument()
  })

  it('filters frames by name', async () => {
    const scifi = { id: 'def', name: 'chrome ring', group: 'Scifi', builtin: false }
    render(<FramePicker frames={[...builtins, userFrame, scifi]} value={null} onChange={vi.fn()} />)

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search frames' }), 'chrome')

    expect(screen.getByRole('button', { name: 'chrome ring' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'orc ring' })).not.toBeInTheDocument()
  })

  it('matches the folder name as well as the frame name', async () => {
    const scifi = { id: 'def', name: 'chrome ring', group: 'Scifi', builtin: false }
    render(<FramePicker frames={[...builtins, userFrame, scifi]} value={null} onChange={vi.fn()} />)

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search frames' }), 'fantasy')

    expect(screen.getByRole('button', { name: 'orc ring' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'chrome ring' })).not.toBeInTheDocument()
  })

  it('hides a group left with no matches, and says when nothing matched', async () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search frames' }), 'zzz')

    expect(screen.queryByRole('button', { name: /Fantasy/ })).not.toBeInTheDocument()
    expect(screen.getByText('No frames match “zzz”.')).toBeInTheDocument()
  })

  it('leaves the built-ins searchable at all times', async () => {
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search frames' }), 'zzz')

    expect(screen.getByRole('button', { name: 'Player character' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No frame' })).toBeInTheDocument()
  })

  // --- favourites ---------------------------------------------------------

  it('lifts favourited frames into their own group', () => {
    mockFavorites(['tok-1'])
    const fav = { ...userFrame, token_id: 'tok-1' }
    render(<FramePicker frames={[...builtins, fav]} value={null} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Favourites/ })).toBeInTheDocument()
  })

  it('keeps a favourited frame in its own folder too', () => {
    mockFavorites(['tok-1'])
    const fav = { ...userFrame, token_id: 'tok-1' }
    render(<FramePicker frames={[...builtins, fav]} value={null} onChange={vi.fn()} />)

    // Once under Favourites, once under Fantasy — a user who knows where it
    // lives should still find it there.
    expect(screen.getAllByRole('button', { name: 'orc ring' })).toHaveLength(2)
  })

  it('omits the favourites group when nothing is favourited', () => {
    mockFavorites([])
    render(
      <FramePicker
        frames={[...builtins, { ...userFrame, token_id: 'tok-1' }]}
        value={null}
        onChange={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /Favourites/ })).not.toBeInTheDocument()
  })

  it('ignores a favourited frame the indexer has not reached yet', () => {
    mockFavorites(['tok-1'])
    // No token_id: the file exists on disk but has no Token row to star.
    render(<FramePicker frames={[...builtins, userFrame]} value={null} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Favourites/ })).not.toBeInTheDocument()
  })

  it('collapses the favourites group on its own', async () => {
    mockFavorites(['tok-1'])
    const fav = { ...userFrame, token_id: 'tok-1' }
    render(<FramePicker frames={[...builtins, fav]} value={null} onChange={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /Favourites/ }))

    // The copy under Fantasy survives; only the favourites copy is hidden.
    expect(screen.getAllByRole('button', { name: 'orc ring' })).toHaveLength(1)
  })

  it('selects a frame from the favourites group', async () => {
    mockFavorites(['tok-1'])
    const onChange = vi.fn()
    const fav = { ...userFrame, token_id: 'tok-1' }
    render(<FramePicker frames={[...builtins, fav]} value={null} onChange={onChange} />)

    const favGroup = screen.getByRole('button', { name: /Favourites/ }).parentElement
    await userEvent.click(within(favGroup).getByRole('button', { name: 'orc ring' }))

    expect(onChange).toHaveBeenCalledWith('abc')
  })

  it('renders without a favourites provider', () => {
    render(
      <FramePicker
        frames={[...builtins, { ...userFrame, token_id: 'tok-1' }]}
        value={null}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'orc ring' })).toBeInTheDocument()
  })

  // --- frame colour -------------------------------------------------------

  it('offers a frame colour beside the frames, for a recolourable shape', async () => {
    const onColorChange = vi.fn()
    render(
      <FramePicker
        frames={builtins}
        value="generic:circle"
        onChange={vi.fn()}
        color="gold"
        onColorChange={onColorChange}
      />
    )
    expect(screen.getByText('Frame colour')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Red' }))
    expect(onColorChange).toHaveBeenCalledWith('red')
  })

  it('hides the colour row for a themed or user frame', () => {
    render(
      <FramePicker
        frames={builtins}
        value="builtin:pc"
        onChange={vi.fn()}
        color="gold"
        onColorChange={vi.fn()}
      />
    )
    expect(screen.queryByText('Frame colour')).not.toBeInTheDocument()
  })

  it('reserves the colour row space so the list below does not jump', () => {
    const { container, rerender } = render(
      <FramePicker
        frames={builtins}
        value="builtin:pc"
        onChange={vi.fn()}
        color="gold"
        onColorChange={vi.fn()}
      />
    )
    const slotOf = (root) =>
      Array.from(root.querySelectorAll('div')).find(
        (el) => el.style.minHeight && el.style.minHeight !== '0px'
      )
    const before = slotOf(container)?.style.minHeight

    rerender(
      <FramePicker
        frames={builtins}
        value="generic:circle"
        onChange={vi.fn()}
        color="gold"
        onColorChange={vi.fn()}
      />
    )
    // Same reserved height whether or not the row is showing.
    expect(slotOf(container)?.style.minHeight).toBe(before)
  })

  it('offers a "no colour" swatch, for a shape that crops without a ring', async () => {
    // This replaced the old Shape control: an uncoloured circle or square is
    // how a plain round or square token is made now.
    const onColorChange = vi.fn()
    render(
      <FramePicker
        frames={builtins}
        value="generic:square"
        onChange={vi.fn()}
        color="gold"
        onColorChange={onColorChange}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(onColorChange).toHaveBeenCalledWith('')
  })

  it('keeps the colour row showing once the colour is cleared', () => {
    // It must stay reachable, or there would be no way to colour the shape back.
    render(
      <FramePicker
        frames={builtins}
        value="generic:circle"
        onChange={vi.fn()}
        color=""
        onColorChange={vi.fn()}
      />
    )
    expect(screen.getByText('Frame colour')).toBeInTheDocument()
  })
})
