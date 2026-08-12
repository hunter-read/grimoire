import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderMoreMenu from './ReaderMoreMenu'

const uiSettings = { hide_campaigns: false }
vi.mock('../../context/UISettingsContext', () => ({
  useUISettings: () => uiSettings,
}))

vi.mock('../AddToCampaignModal', () => ({
  default: ({ onClose }) => (
    <div>
      <span>campaign-modal</span>
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}))

function renderMenu(overrides = {}) {
  const props = {
    bookId: 'book-1',
    mode: 'page',
    onModeChange: vi.fn(),
    spreadOffset: 0,
    onSpreadOffsetChange: vi.fn(),
    isMobilePhone: false,
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    onShowDetails: vi.fn(),
    onToggleShortcuts: vi.fn(),
    ...overrides,
  }
  return { ...render(<ReaderMoreMenu {...props} />), props }
}

const openMenu = () => userEvent.click(screen.getByLabelText('More actions'))

describe('ReaderMoreMenu', () => {
  beforeEach(() => {
    uiSettings.hide_campaigns = false
  })

  it('keeps the menu closed until the trigger is clicked', async () => {
    renderMenu()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('lists the actions in the agreed order', async () => {
    renderMenu()
    await openMenu()
    // Both plain items and the mode radios, in DOM order.
    const labels = [...screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')].map((el) =>
      el.textContent.trim()
    )
    expect(labels).toEqual([
      'Add to Campaign',
      'View details',
      'Add to favorites',
      'Page',
      'Spread',
      'PDF',
      'Download',
      'Keyboard Shortcuts',
    ])
  })

  it('hides Add to campaign when campaigns are hidden in UI settings', async () => {
    uiSettings.hide_campaigns = true
    renderMenu()
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Add to Campaign' })).not.toBeInTheDocument()
  })

  it('opens the add-to-campaign modal, which survives the menu closing', async () => {
    renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to Campaign' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByText('campaign-modal')).toBeInTheDocument()

    await userEvent.click(screen.getByText('close-modal'))
    expect(screen.queryByText('campaign-modal')).not.toBeInTheDocument()
  })

  it('closes the menu after an item is chosen', async () => {
    const { props } = renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'View details' }))
    expect(props.onShowDetails).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderMenu()
    await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes when clicking outside the menu', async () => {
    renderMenu()
    await openMenu()
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('marks the current mode and switches on click', async () => {
    const { props } = renderMenu({ mode: 'spread' })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /Spread/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('menuitemradio', { name: /PDF/ }))
    expect(props.onModeChange).toHaveBeenCalledWith('pdf')
  })

  it('offers cover pairing only in spread mode, nested under it', async () => {
    renderMenu({ mode: 'page' })
    await openMenu()
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument()

    cleanup()
    renderMenu({ mode: 'spread' })
    await openMenu()
    const items = [...screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')].map((el) =>
      el.textContent.trim()
    )
    // Directly after Spread, the mode it belongs to.
    expect(items.indexOf('Pair cover with page 2')).toBe(items.indexOf('Spread') + 1)
  })

  it('reflects the spread offset as the cover-pairing checked state', async () => {
    renderMenu({ mode: 'spread', spreadOffset: 0 })
    await openMenu()
    expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'false')
  })

  it('toggles cover pairing without closing the menu, so the result is visible', async () => {
    const { props } = renderMenu({ mode: 'spread', spreadOffset: 1 })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitemcheckbox'))

    expect(props.onSpreadOffsetChange).toHaveBeenCalledWith(0)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('drops the mode items on phones', async () => {
    renderMenu({ isMobilePhone: true })
    await openMenu()
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
    // The rest of the menu is still available.
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument()
  })

  it('points the download at the book file', async () => {
    renderMenu()
    await openMenu()
    const link = screen.getByRole('menuitem', { name: 'Download' })
    expect(link).toHaveAttribute('download')
    expect(link.getAttribute('href')).toContain('/books/book-1/file')
  })

  it('offers to un-favorite a book already favorited', async () => {
    const { props } = renderMenu({ isFavorite: true })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from favorites' }))
    expect(props.onToggleFavorite).toHaveBeenCalledOnce()
  })

  it('toggles the shortcut overlay', async () => {
    const { props } = renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Keyboard Shortcuts' }))
    expect(props.onToggleShortcuts).toHaveBeenCalledOnce()
  })
})
