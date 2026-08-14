import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RowVisibilityControl from './RowVisibilityControl'

const setup = (over = {}) => {
  const onSetVisibility = vi.fn()
  const props = {
    visibility: 'gm',
    isMine: true,
    authorIsGm: true,
    rowHovered: false,
    onSetVisibility,
    ...over,
  }
  render(<RowVisibilityControl {...props} />)
  return { onSetVisibility }
}

describe('RowVisibilityControl', () => {
  it('always shows the glyph for restricted pages, even unhovered', () => {
    for (const visibility of ['gm', 'members']) {
      const { unmount } = render(
        <RowVisibilityControl
          visibility={visibility}
          isMine
          authorIsGm
          rowHovered={false}
          onSetVisibility={vi.fn()}
        />
      )
      expect(screen.getByRole('button').style.opacity).toBe('1')
      unmount()
    }
  })

  // "Public" is the unremarkable default, so its glyph stays hidden until the
  // row is hovered — that's what keeps the resting list uncluttered.
  it('hides the glyph for public pages until the row is hovered', () => {
    const { unmount } = render(
      <RowVisibilityControl
        visibility="group"
        isMine
        authorIsGm
        rowHovered={false}
        onSetVisibility={vi.fn()}
      />
    )
    expect(screen.getByRole('button').style.opacity).toBe('0')
    unmount()

    render(
      <RowVisibilityControl
        visibility="group"
        isMine
        authorIsGm
        rowHovered
        onSetVisibility={vi.fn()}
      />
    )
    expect(screen.getByRole('button').style.opacity).toBe('1')
  })

  it('reveals a public page’s glyph on keyboard focus, so it is reachable without a mouse', async () => {
    const user = userEvent.setup()
    setup({ visibility: 'group', rowHovered: false })
    const btn = screen.getByRole('button')
    expect(btn.style.opacity).toBe('0')
    await user.tab()
    expect(btn).toHaveFocus()
    expect(btn.style.opacity).toBe('1')
  })

  it('opens the level menu and reports a change', async () => {
    const user = userEvent.setup()
    const { onSetVisibility } = setup({ visibility: 'gm' })
    await user.click(screen.getByRole('button'))
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: /public/i }))
    expect(onSetVisibility).toHaveBeenCalledWith('group')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks the current level as checked and does not re-report it', async () => {
    const user = userEvent.setup()
    const { onSetVisibility } = setup({ visibility: 'gm' })
    await user.click(screen.getByRole('button'))
    const current = screen.getByRole('menuitemradio', { name: /gm only/i })
    expect(current).toHaveAttribute('aria-checked', 'true')
    await user.click(current)
    expect(onSetVisibility).not.toHaveBeenCalled()
  })

  // Every level is available to whoever authored the page — a player keeps
  // self-only and private notes of their own (issue #232).
  it('offers every level to the author, whoever they are', async () => {
    const user = userEvent.setup()
    setup({ visibility: 'group', authorIsGm: false })
    await user.click(screen.getByRole('button'))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.getByRole('menuitemradio', { name: /public/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /private/i })).toBeInTheDocument()
    // The author-only level reads as "Self only" for a player.
    expect(screen.getByRole('menuitemradio', { name: /self only/i })).toBeInTheDocument()
  })

  it('labels the author-only level "GM only" on the GM\'s own page', async () => {
    const user = userEvent.setup()
    setup({ visibility: 'group', authorIsGm: true })
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitemradio', { name: /gm only/i })).toBeInTheDocument()
  })

  it('highlights a menu item on hover and restores it on leave', async () => {
    const user = userEvent.setup()
    setup({ visibility: 'gm' })
    await user.click(screen.getByRole('button'))
    const option = screen.getByRole('menuitemradio', { name: /public/i })
    expect(option.style.background).toBe('transparent')

    await user.hover(option)
    expect(option.style.background).toBe('var(--bg-card-hover)')

    await user.unhover(option)
    expect(option.style.background).toBe('transparent')
  })

  // Leaving the current level must not strip the highlight that marks it as
  // selected — it restores to its own resting background, not to transparent.
  it('keeps the selected item highlighted after hovering away from it', async () => {
    const user = userEvent.setup()
    setup({ visibility: 'gm' })
    await user.click(screen.getByRole('button'))
    const current = screen.getByRole('menuitemradio', { name: /gm only/i })
    expect(current.style.background).toBe('var(--bg-card)')

    await user.hover(current)
    expect(current.style.background).toBe('var(--bg-card-hover)')

    await user.unhover(current)
    expect(current.style.background).toBe('var(--bg-card)')
  })

  it('highlights a menu item on keyboard focus', async () => {
    const user = userEvent.setup()
    setup({ visibility: 'gm' })
    await user.click(screen.getByRole('button'))
    const option = screen.getByRole('menuitemradio', { name: /public/i })
    option.focus()
    expect(option.style.background).toBe('var(--bg-card-hover)')
    await user.tab()
    expect(option.style.background).toBe('transparent')
  })

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // Only the author may reclassify a page, even where others may edit its text.
  it("renders a non-interactive glyph on someone else's page", () => {
    setup({ isMine: false })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('img', { name: /visibility/i })).toBeInTheDocument()
  })

  it('falls back to the GM level for an unknown visibility', () => {
    setup({ visibility: 'nonsense' })
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Visibility: GM only')
  })
})
