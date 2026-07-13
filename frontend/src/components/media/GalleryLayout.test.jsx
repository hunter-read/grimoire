import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GalleryLayout from './GalleryLayout'
import { MEDIA_CONFIGS } from './mediaConfig'

// Fire the inline arrow handlers GalleryLayout passes down so they're covered.
vi.mock('./GalleryToolbar', () => ({
  default: ({ onCollapseAll, onExpandAll, onToggleFavOnly, onToggleBulk }) => (
    <div data-testid="toolbar">
      <button data-testid="tb-collapse" onClick={onCollapseAll} />
      <button data-testid="tb-expand" onClick={onExpandAll} />
      <button data-testid="tb-fav" onClick={onToggleFavOnly} />
      <button data-testid="tb-bulk" onClick={onToggleBulk} />
    </div>
  ),
}))
vi.mock('./TagFilterBar', () => ({ default: () => <div data-testid="tag-filter" /> }))
vi.mock('./MediaFolderGroup', () => ({
  default: ({ folder }) => <div data-testid="folder-group">{folder}</div>,
}))
vi.mock('../BulkActionBar', () => ({ default: () => <div data-testid="bulk-bar" /> }))

const makeGallery = (over = {}) => ({
  filter: '',
  setFilter: vi.fn(),
  bulk: { bulkMode: false, enter: vi.fn(), exit: vi.fn(), toggleFolder: vi.fn() },
  noFolders: false,
  allCollapsed: false,
  allExpanded: false,
  allKeys: new Set(),
  setCollapsed: vi.fn(),
  viewMode: 'grid',
  cycleViewMode: vi.fn(),
  favOnly: false,
  setFavOnly: vi.fn(),
  allTags: [],
  selectedTags: new Set(),
  toggleTag: vi.fn(),
  clearTags: vi.fn(),
  folderEntries: [['Dungeons', {}]],
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
  onSelectItem: vi.fn(),
  onDownload: vi.fn(),
  onAddToCampaign: vi.fn(),
  onBulkEdit: vi.fn(),
  ...over,
})

describe('GalleryLayout', () => {
  it('renders title, subtitle, toolbar, tag filter, and folder groups', () => {
    render(<GalleryLayout {...baseProps()} />)
    expect(screen.getByRole('heading', { name: 'Maps' })).toBeInTheDocument()
    expect(screen.getByText('Battle maps')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
    expect(screen.getByTestId('folder-group')).toHaveTextContent('Dungeons')
    expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument()
  })

  it('wires the toolbar collapse/expand/favorite/bulk callbacks through', () => {
    const gallery = makeGallery()
    render(<GalleryLayout {...baseProps({ gallery })} />)
    fireEvent.click(screen.getByTestId('tb-collapse'))
    expect(gallery.setCollapsed).toHaveBeenCalledWith(gallery.allKeys)
    fireEvent.click(screen.getByTestId('tb-expand'))
    expect(gallery.setCollapsed).toHaveBeenCalledWith(expect.any(Set))
    fireEvent.click(screen.getByTestId('tb-fav'))
    expect(gallery.setFavOnly).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('tb-bulk'))
    expect(gallery.bulk.enter).toHaveBeenCalled()
  })

  it('shows the bulk hint and bulk action bar in bulk mode (hiding the tag filter)', () => {
    const gallery = makeGallery({
      bulk: { bulkMode: true, enter: vi.fn(), exit: vi.fn(), toggleFolder: vi.fn() },
    })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.getByTestId('bulk-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('tag-filter')).not.toBeInTheDocument()
  })

  it('renders the empty state when there are no folders', () => {
    const gallery = makeGallery({ noFolders: true, folderEntries: [] })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    // Empty message text comes from the maps config i18n keys (maps.noMaps).
    expect(screen.getByText(/No maps found/i)).toBeInTheDocument()
  })

  it('shows a filtered empty message when a filter is active', () => {
    const gallery = makeGallery({ noFolders: true, folderEntries: [], filter: 'goblin' })
    render(<GalleryLayout {...baseProps({ gallery })} />)
    expect(screen.queryByTestId('folder-group')).not.toBeInTheDocument()
    expect(screen.getByText(/No maps match your filter/i)).toBeInTheDocument()
  })

  it('renders in player mode without crashing', () => {
    render(<GalleryLayout {...baseProps({ isPlayer: true })} />)
    expect(screen.getByTestId('folder-group')).toBeInTheDocument()
  })
})
