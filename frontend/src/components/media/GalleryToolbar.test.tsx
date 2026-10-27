import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GalleryToolbar from './GalleryToolbar'
import { MEDIA_CONFIGS } from './mediaConfig'

const makeGallery = (over = {}) => ({
  bulk: { bulkMode: false, enter: vi.fn(), exit: vi.fn() },
  viewMode: 'grid',
  cycleViewMode: vi.fn(),
  grouped: true,
  setGrouped: vi.fn(),
  setCollapsed: vi.fn(),
  allKeys: new Set(['a']),
  noFolders: false,
  allCollapsed: false,
  allExpanded: false,
  ...over,
})

const renderToolbar = (props = {}) =>
  render(
    <GalleryToolbar
      config={MEDIA_CONFIGS.map}
      gallery={makeGallery(props.gallery)}
      leading={props.leading}
    />
  )

describe('GalleryToolbar', () => {
  it('renders a leading control ahead of the grouping switch', () => {
    renderToolbar({ leading: <button type="button">Saved sets</button> })
    const first = screen.getByRole('button', { name: 'Saved sets' })
    // It must come first in the row so it takes the slack on the left.
    expect(first.parentElement.firstElementChild).toBe(first)
    // …and the grouping switch follows it in that same row.
    expect(first.parentElement).toContainElement(screen.getByRole('switch'))
  })

  it('renders no leading slot when none is given', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: 'Saved sets' })).toBeNull()
  })

  it('renders the group-by-folder switch', () => {
    renderToolbar()
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  // Bulk-select and view-mode moved into the sticky SortFilterBar row (#255),
  // so this toolbar only holds the grouping switch and collapse/expand.
  it('renders no bulk-select or view-mode control', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: /select|cancel/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /view|grid|list|compact/i })
    ).not.toBeInTheDocument()
    // Only the collapse/expand pair remains.
    expect(screen.getByRole('button', { name: /collapse all/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /expand all/i })).toBeInTheDocument()
  })

  it('toggles the folder grouping switch', async () => {
    const setGrouped = vi.fn()
    renderToolbar({ gallery: { setGrouped } })
    await userEvent.click(screen.getByRole('switch'))
    expect(setGrouped).toHaveBeenCalled()
  })

  it('collapses all folders (setCollapsed with every key)', async () => {
    const setCollapsed = vi.fn()
    renderToolbar({ gallery: { setCollapsed, allKeys: new Set(['a', 'b']) } })
    await userEvent.click(screen.getByRole('button', { name: /collapse all/i }))
    expect(setCollapsed).toHaveBeenCalledWith(new Set(['a', 'b']))
  })

  it('expands all folders (setCollapsed with an empty set)', async () => {
    const setCollapsed = vi.fn()
    renderToolbar({ gallery: { setCollapsed, allCollapsed: true } })
    await userEvent.click(screen.getByRole('button', { name: /expand all/i }))
    expect(setCollapsed).toHaveBeenCalledWith(new Set())
  })
})
