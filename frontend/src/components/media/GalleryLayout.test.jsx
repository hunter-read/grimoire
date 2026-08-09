import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import GalleryLayout from './GalleryLayout'
import { MEDIA_CONFIGS } from './mediaConfig'

// The toolbar has its own coverage; stub it so this test focuses on layout.
vi.mock('./GalleryToolbar', () => ({
  default: () => <div data-testid="toolbar" />,
}))
vi.mock('./MediaFolderGroup', () => ({
  default: ({ folder }) => <div data-testid="folder-group">{folder}</div>,
}))
vi.mock('./MediaCard', () => ({
  default: ({ item, onToggle }) => (
    <button data-testid="flat-card" onDoubleClick={() => onToggle({})}>
      {item.filename}
    </button>
  ),
}))
vi.mock('../LazyGrid', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../BulkActionBar', () => ({ default: () => <div data-testid="bulk-bar" /> }))

const makeGallery = (over = {}) => ({
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
  folderEntries: [['Dungeons', {}]],
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
})

const baseProps = (over = {}) => ({
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
  it('renders title, subtitle, toolbar, and folder groups when grouped', () => {
    render(<GalleryLayout {...baseProps()} />)
    expect(screen.getByRole('heading', { name: 'Maps' })).toBeInTheDocument()
    expect(screen.getByText('Battle maps')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('folder-group')).toHaveTextContent('Dungeons')
    expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument()
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
    const gallery = makeGallery({ noFolders: true, folderEntries: [] })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    expect(screen.getByText(/No maps found/i)).toBeInTheDocument()
  })

  it('shows a filtered empty message when a filter is active', () => {
    const gallery = makeGallery({ noFolders: true, folderEntries: [], filter: 'goblin' })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    expect(screen.getByText(/No maps match your filter/i)).toBeInTheDocument()
  })

  it('shows the no-favourites message when favOnly is on and nothing matches', () => {
    const gallery = makeGallery({ noFolders: true, folderEntries: [], favOnly: true })
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
})
