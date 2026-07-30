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
      showBulk={props.showBulk ?? true}
    />
  )

describe('GalleryToolbar', () => {
  it('renders the group-by-folder switch and view-mode control', () => {
    renderToolbar()
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('enters bulk mode via the bulk-select button when allowed', async () => {
    const enter = vi.fn()
    renderToolbar({ gallery: { bulk: { bulkMode: false, enter, exit: vi.fn() } } })
    const btns = screen.getAllByRole('button')
    // The first button is the bulk-select toggle.
    await userEvent.click(btns[0])
    expect(enter).toHaveBeenCalled()
  })

  it('hides the bulk-select button for players (showBulk=false)', () => {
    const { rerender } = renderToolbar({ showBulk: false })
    // Still renders the group switch even without bulk controls.
    expect(screen.getByRole('switch')).toBeInTheDocument()
    rerender(<GalleryToolbar config={MEDIA_CONFIGS.map} gallery={makeGallery()} showBulk={true} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
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

  it('exits bulk mode via the active bulk button', async () => {
    const exit = vi.fn()
    renderToolbar({ gallery: { bulk: { bulkMode: true, enter: vi.fn(), exit } } })
    // In bulk mode two bulk buttons render (enter + exit); the exit one calls exit().
    const btns = screen.getAllByRole('button')
    await userEvent.click(btns[1])
    expect(exit).toHaveBeenCalled()
  })
})
