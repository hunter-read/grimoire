import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GalleryLayout from './GalleryLayout'
import type { ComponentProps, ReactNode } from 'react'
import { MEDIA_CONFIGS } from './mediaConfig'
import type { MediaItem } from './mediaConfig'
import type useMediaGallery from '../../hooks/useMediaGallery'

type Gallery = ReturnType<typeof useMediaGallery<MediaItem>>

// The toolbar has its own coverage; stub it so this test focuses on layout.
// It renders `leading` so the headerActions pass-through stays covered.
vi.mock('./GalleryToolbar', () => ({
  default: ({ leading }: { leading?: ReactNode }) => <div data-testid="toolbar">{leading}</div>,
}))
vi.mock('./MediaFolderGroup', () => ({
  default: ({ folder, label }: { folder: string; label?: string }) => (
    <div data-testid="folder-group" data-label={label}>
      {folder}
    </div>
  ),
}))
vi.mock('./MediaCard', () => ({
  default: ({ item, onToggle }: { item: MediaItem; onToggle: (mods: object) => void }) => (
    <button data-testid="flat-card" onDoubleClick={() => onToggle({})}>
      {item.filename}
    </button>
  ),
}))
vi.mock('./VirtualGrid', () => ({
  default: ({
    items,
    renderItem,
  }: {
    items: MediaItem[]
    renderItem: (item: MediaItem) => ReactNode
  }) => <div>{items.map(renderItem)}</div>,
}))
vi.mock('../BulkActionBar', () => ({ default: () => <div data-testid="bulk-bar" /> }))
const pinState = vi.hoisted(() => ({
  pins: [] as { id: string; collection: string; target: string }[],
  toggle: vi.fn(),
}))
vi.mock('../../hooks/usePins', () => ({
  default: () => ({
    pins: pinState.pins,
    isPinned: (t: string) => pinState.pins.some((p) => p.target === t),
    toggle: pinState.toggle,
  }),
}))

// The layout reads and writes the address (the open folder), so it renders in
// a router.
const render = (ui: ReactNode, url = '/maps') =>
  rtlRender(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>)

const makeGallery = (over: Record<string, unknown> = {}) =>
  ({
    filter: '',
    setFilter: vi.fn(),
    sortFilter: { sort: 'name', order: 'asc', filters: {} },
    setSortFilter: vi.fn(),
    savedFilters: { saved: [], save: vi.fn(), setDefault: vi.fn(), remove: vi.fn(), loaded: true },
    grouped: true,
    setGrouped: vi.fn(),
    bulk: { bulkMode: false, enter: vi.fn(), exit: vi.fn(), toggleFolder: vi.fn() },
    noFolders: false,
    allCollapsed: false,
    allExpanded: false,
    allKeys: new Set(),
    setCollapsed: vi.fn(),
    viewMode: 'grid',
    cycleViewMode: vi.fn(),
    favOnly: false,
    allTags: [],
    selectedTags: new Set(),
    toggleTag: vi.fn(),
    clearTags: vi.fn(),
    folderEntries: [['Dungeons', {}, 'Dungeons']],
    folder: null,
    ownFolder: null,
    allFolders: ['Dungeons'],
    flatIndex: [],
    flatStart: 0,
    flatTotal: null,
    flatHasEarlier: false,
    jumpFlat: vi.fn(),
    loadEarlierFlat: vi.fn(),
    flatItems: [],
    cardSize: 'comfortable',
    list: false,
    collapsed: new Set(),
    toggleCollapse: vi.fn(),
    folderTags: {},
    editingFolder: null,
    setEditingFolder: vi.fn(),
    saveFolderTags: vi.fn(),
    selectedIds: new Set(),
    selectedFolderPaths: new Set(),
    toggleSelect: vi.fn(),
    totalSelected: 0,
    bulkApplying: false,
    applyBulkTags: vi.fn(),
    ...over,
  }) as unknown as Gallery

const baseProps = (over: Partial<ComponentProps<typeof GalleryLayout>> = {}) => ({
  config: MEDIA_CONFIGS.map,
  gallery: makeGallery(),
  isPlayer: false,
  title: 'Maps',
  subtitle: 'Battle maps',
  onDownload: vi.fn(),
  onAddToCampaign: vi.fn(),
  onBulkEdit: vi.fn(),
  ...over,
})

describe('GalleryLayout', () => {
  it('names the page with an h1 and the tab title, and reads out the count', () => {
    render(<GalleryLayout {...baseProps()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Maps' })).toBeInTheDocument()
    expect(document.title).toBe('Maps - Grimoire')
    expect(screen.getByText('Battle maps')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders title, subtitle, toolbar, and folder groups when grouped', () => {
    render(<GalleryLayout {...baseProps()} />)
    expect(screen.getByRole('heading', { name: 'Maps' })).toBeInTheDocument()
    expect(screen.getByText('Battle maps')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('folder-group')).toHaveTextContent('Dungeons')
    expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument()
  })

  it('passes headerActions to the toolbar as its leading control', () => {
    render(
      <GalleryLayout {...baseProps({ headerActions: <button type="button">Saved sets</button> })} />
    )
    const toolbar = screen.getByTestId('toolbar')
    expect(within(toolbar).getByRole('button', { name: 'Saved sets' })).toBeInTheDocument()
  })

  it('renders no leading control when headerActions is omitted', () => {
    render(<GalleryLayout {...baseProps()} />)
    expect(screen.queryByRole('button', { name: 'Saved sets' })).toBeNull()
  })

  it('renders a flat card grid (no folder groups) when grouping is off', () => {
    const gallery = makeGallery({
      grouped: false,
      flatItems: [
        { id: 'a', filename: 'goblin.png' },
        { id: 'b', filename: 'dragon.png' },
      ],
    })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    const cards = screen.getAllByTestId('flat-card')
    expect(cards.map((n) => n.textContent)).toEqual(['goblin.png', 'dragon.png'])
    // onSelectItem is removed; navigation is handled by real CardLink anchors.
    // Exercise the onToggle wiring (still used for bulk selection).
    fireEvent.doubleClick(cards[1])
    expect(gallery.toggleSelect).toHaveBeenCalledWith('b', {})
  })

  it('shows the bulk hint and bulk action bar in bulk mode', () => {
    const gallery = makeGallery({
      bulk: { bulkMode: true, enter: vi.fn(), exit: vi.fn(), toggleFolder: vi.fn() },
    })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.getByTestId('bulk-bar')).toBeInTheDocument()
  })

  it('renders the empty state when there are no folders', () => {
    const gallery = makeGallery({ noFolders: true, noItems: true, folderEntries: [] })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    expect(screen.getByText(/No maps found/i)).toBeInTheDocument()
  })

  it('shows a filtered empty message when a filter is active', () => {
    const gallery = makeGallery({
      noFolders: true,
      noItems: true,
      folderEntries: [],
      filter: 'goblin',
    })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    expect(screen.getByText(/No maps match your filter/i)).toBeInTheDocument()
  })

  it('shows the no-favourites message when favOnly is on and nothing matches', () => {
    const gallery = makeGallery({
      noFolders: true,
      noItems: true,
      folderEntries: [],
      favOnly: true,
    })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  // #255: multi-select and view-mode live in the sticky sort/filter row.
  it('renders the select button inside the sticky sort/filter row', () => {
    render(<GalleryLayout {...baseProps()} />)
    const bar = screen.getByTestId('sort-filter-bar')
    expect(bar).toHaveStyle({ position: 'sticky', top: '0px' })
    expect(within(bar).getByRole('button', { name: /select/i })).toBeInTheDocument()
  })

  it('offers a date-added sort that picks newest first', () => {
    const gallery = makeGallery()
    render(<GalleryLayout {...baseProps({ gallery })} />)
    const select = screen.getByRole('combobox', { name: 'Sort' })
    expect(within(select).getByRole('option', { name: 'Date added' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'added_at' } })
    expect(gallery.setSortFilter).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'added_at', order: 'desc' })
    )
  })

  it('offers a recently-added filter', () => {
    const gallery = makeGallery()
    render(<GalleryLayout {...baseProps({ gallery })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByLabelText('Recently added (last 7 days)'))
    expect(gallery.setSortFilter).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ recent: true }) })
    )
  })

  it('enters bulk mode from the toolbar select button', () => {
    const gallery = makeGallery()
    render(<GalleryLayout {...baseProps({ gallery })} />)
    fireEvent.click(screen.getByRole('button', { name: /select/i }))
    expect(gallery.bulk.enter).toHaveBeenCalled()
  })

  // Regression: bulk mode used to render both an "enter" and an "exit" bulk
  // button, so two Cancel buttons appeared side by side.
  it('shows exactly one Cancel button in bulk mode and it exits', () => {
    const exit = vi.fn()
    const gallery = makeGallery({
      bulk: { bulkMode: true, enter: vi.fn(), exit, toggleFolder: vi.fn() },
    })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    const cancels = screen.getAllByRole('button', { name: /cancel/i })
    expect(cancels).toHaveLength(1)
    fireEvent.click(cancels[0])
    expect(exit).toHaveBeenCalled()
  })

  it('hides the select button for players but keeps view-mode', () => {
    render(<GalleryLayout {...baseProps({ isPlayer: true })} />)
    expect(screen.queryByRole('button', { name: /select|cancel/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('sort-filter-bar')).toBeInTheDocument()
  })

  it('renders folder groups in player mode', () => {
    render(<GalleryLayout {...baseProps({ isPlayer: true })} />)
    expect(screen.getByTestId('folder-group')).toBeInTheDocument()
  })

  describe('large libraries', () => {
    beforeEach(() => {
      pinState.pins = []
      pinState.toggle.mockReset()
      Element.prototype.scrollIntoView = vi.fn()
    })

    const manyFolders = Array.from({ length: 40 }, (_, i) => {
      const name = `${'ABCDEFGH'[i % 8]}folder ${String(i).padStart(2, '0')}`
      return [name, { '': { path: name, count: 2, items: [], hasMore: true } }, name]
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))

    it('letters a long run of folders and indexes them', () => {
      render(
        <GalleryLayout {...baseProps({ gallery: makeGallery({ folderEntries: manyFolders }) })} />
      )
      expect(
        screen.getByRole('navigation', { name: 'Jump to folders by letter' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 2, name: 'A5 folders · 10 maps' })
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('link', { name: 'C, 5 folders · 10 maps' }))
      expect(document.activeElement).toHaveTextContent('C5 folders')
    })

    it('opens at a folder with its path, its own name, and what it holds', () => {
      const own = [
        'Tom Cartos/Caverns',
        { '': { path: 'Tom Cartos/Caverns', count: 3, items: [] } },
        'Caverns',
      ]
      const child = [
        'Tom Cartos/Caverns/Lava',
        { '': { path: 'Tom Cartos/Caverns/Lava', count: 4, items: [] } },
        'Lava',
      ]
      render(
        <GalleryLayout
          {...baseProps({
            gallery: makeGallery({
              folder: 'Tom Cartos/Caverns',
              ownFolder: own,
              folderEntries: [child],
              allFolders: ['Tom Cartos', 'Tom Cartos/Caverns', 'Tom Cartos/Caverns/Lava'],
            }),
          })}
        />,
        '/maps?folder=Tom+Cartos%2FCaverns'
      )
      expect(screen.getByRole('heading', { level: 1, name: 'Caverns' })).toBeInTheDocument()
      const path = screen.getByRole('navigation', { name: 'Folder path' })
      expect(within(path).getByRole('link', { name: 'Maps' })).toHaveAttribute('href', '/maps')
      expect(within(path).getByRole('link', { name: 'Tom Cartos' })).toHaveAttribute(
        'href',
        '/maps?folder=Tom+Cartos'
      )
      expect(screen.getByText('7 maps')).toBeInTheDocument()
      const groups = screen.getAllByTestId('folder-group')
      expect(groups[0]).toHaveAttribute('data-label', 'Directly in Caverns')
      expect(groups[1]).toHaveTextContent('Tom Cartos/Caverns/Lava')
      fireEvent.click(screen.getByRole('button', { name: 'Pin Caverns' }))
      expect(pinState.toggle).toHaveBeenCalledWith('Tom Cartos/Caverns')
    })

    it('moves focus to the heading when another folder opens', () => {
      const props = baseProps({ gallery: makeGallery({ folder: null }) })
      const { rerender } = render(<GalleryLayout {...props} />)
      rerender(
        <MemoryRouter>
          <GalleryLayout
            {...props}
            gallery={makeGallery({ folder: 'Caves', allFolders: ['Caves'] })}
          />
        </MemoryRouter>
      )
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Caves' }))
    })

    it('shows the pinned folders, each linking to its page', () => {
      pinState.pins = [{ id: 'p1', collection: 'maps', target: 'Czepeku/Night' }]
      render(<GalleryLayout {...baseProps()} />)
      const strip = screen.getByRole('navigation', { name: 'Pinned folders in Maps' })
      expect(within(strip).getByRole('link', { name: /Night/ })).toHaveAttribute(
        'href',
        '/maps?folder=Czepeku%2FNight'
      )
      fireEvent.click(within(strip).getByRole('button', { name: 'Unpin Night' }))
      expect(pinState.toggle).toHaveBeenCalledWith('Czepeku/Night')
    })

    const flatItems = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`,
      filename: `token ${i}.png`,
    }))
    const flatGallery = (over: Record<string, unknown> = {}) =>
      makeGallery({
        grouped: false,
        flatItems,
        flatTotal: 400,
        flatStart: 0,
        flatIndex: [
          { key: 'A', label: 'A', count: 30, offset: 0, preview: [] },
          { key: 'O', label: 'O', count: 300, offset: 30, preview: [] },
          { key: 'W', label: 'W', count: 70, offset: 330, preview: [] },
        ],
        jumpFlat: vi.fn(),
        loadEarlierFlat: vi.fn(),
        ...over,
      })

    it('indexes the flat list from the server, jumping in place when loaded', () => {
      const gallery = flatGallery()
      render(<GalleryLayout {...baseProps({ gallery })} />)
      const rail = screen.getByRole('navigation', { name: 'Jump through Maps' })
      expect(within(rail).getByRole('link', { name: 'A, 30 maps' })).toHaveAttribute(
        'aria-current',
        'location'
      )
      fireEvent.click(within(rail).getByRole('link', { name: 'O, 300 maps' }))
      expect(gallery.jumpFlat).not.toHaveBeenCalled()
      fireEvent.click(within(rail).getByRole('link', { name: 'W, 70 maps' }))
      expect(gallery.jumpFlat).toHaveBeenCalledWith(330)
    })

    it('reads added-month landmarks as months', () => {
      const gallery = flatGallery({
        sortFilter: { sort: 'added_at', order: 'desc', filters: {} },
        flatIndex: [
          { key: '2026-11', label: '2026-11', count: 200, offset: 0, preview: [] },
          { key: '', label: '', count: 200, offset: 200, preview: [] },
        ],
      })
      render(<GalleryLayout {...baseProps({ gallery })} />)
      expect(screen.getByRole('link', { name: /^Nov \W?26, 200 maps/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Undated, 200 maps' })).toBeInTheDocument()
    })

    it('offers the rows before a list opened part-way', () => {
      const gallery = flatGallery({ flatStart: 330, flatHasEarlier: true })
      render(<GalleryLayout {...baseProps({ gallery })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Show earlier items (330 above)' }))
      expect(gallery.loadEarlierFlat).toHaveBeenCalled()
    })

    it('lands on the jumped-to item once the reopened list arrives', async () => {
      const gallery = flatGallery()
      const props = baseProps({ gallery })
      const { rerender } = render(<GalleryLayout {...props} />)
      fireEvent.click(screen.getByRole('link', { name: 'W, 70 maps' }))
      const reopened = flatGallery({ flatStart: 330, flatHasEarlier: true })
      rerender(
        <MemoryRouter>
          <GalleryLayout {...props} gallery={reopened} />
        </MemoryRouter>
      )
      // Earlier rows arriving above keep the reader where they were.
      rerender(
        <MemoryRouter>
          <GalleryLayout
            {...props}
            gallery={flatGallery({ flatStart: 130, flatHasEarlier: true })}
          />
        </MemoryRouter>
      )
      expect(
        await screen.findByRole('button', { name: 'Show earlier items (130 above)' })
      ).toBeInTheDocument()
    })

    it('has no rail on a short flat list', () => {
      render(<GalleryLayout {...baseProps({ gallery: flatGallery({ flatTotal: 12 }) })} />)
      expect(
        screen.queryByRole('navigation', { name: 'Jump through Maps' })
      ).not.toBeInTheDocument()
    })
  })
})
