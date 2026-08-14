import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VisibilityEditor from './VisibilityEditor'

const campaign = {
  id: 'c1',
  members: [
    { user_id: 'u1', is_owner: true, username: 'gm' },
    { user_id: 'u2', is_owner: false, username: 'alice' },
    { user_id: 'u3', is_owner: false, character_name: 'Bob the Bold', username: 'bob' },
  ],
}

const page = (over = {}) => ({
  id: 'p1',
  visibility: 'gm',
  // The GM authors these fixtures, so they're excluded from their own share
  // list — sharing is with everyone *else* in the campaign.
  created_by_id: 'u1',
  shared_user_ids: [],
  shared_write_user_ids: [],
  ...over,
})

const setup = (over = {}) => {
  const onSetVisibility = vi.fn()
  const onSetShares = vi.fn()
  render(
    <VisibilityEditor
      campaign={campaign}
      isOwner
      page={page()}
      onSetVisibility={onSetVisibility}
      onSetShares={onSetShares}
      {...over}
    />
  )
  return { onSetVisibility, onSetShares }
}

const openMenu = async (user) => {
  await user.click(screen.getByRole('button', { name: 'Change visibility' }))
  return screen.getByRole('menu')
}

describe('VisibilityEditor', () => {
  it('shows the current level on the badge', () => {
    setup({ page: page({ visibility: 'members' }) })
    expect(screen.getByRole('button', { name: 'Change visibility' })).toHaveTextContent('Private')
  })

  it('falls back to the GM level for an unknown visibility', () => {
    setup({ page: page({ visibility: 'nonsense' }) })
    expect(screen.getByRole('button', { name: 'Change visibility' })).toHaveTextContent('GM only')
  })

  it('opens the menu and reports a level change', async () => {
    const user = userEvent.setup()
    const { onSetVisibility } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitemradio', { name: /public/i }))
    expect(onSetVisibility).toHaveBeenCalledWith('group')
  })

  it('does not re-report the level already selected', async () => {
    const user = userEvent.setup()
    const { onSetVisibility } = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitemradio', { name: /gm only/i }))
    expect(onSetVisibility).not.toHaveBeenCalled()
  })

  // Every level belongs to whoever authored the page; a player gets the same
  // three, with the author-only one worded for them (issue #232).
  it('offers every level regardless of campaign ownership', async () => {
    const user = userEvent.setup()
    setup({ isOwner: false })
    await openMenu(user)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.getByRole('menuitemradio', { name: /self only/i })).toBeInTheDocument()
  })

  it('toggles the menu closed from the trigger', async () => {
    const user = userEvent.setup()
    setup()
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Change visibility' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes when clicking outside, but not inside the popover', async () => {
    const user = userEvent.setup()
    setup()
    const menu = await openMenu(user)
    fireEvent.mouseDown(menu)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('highlights a menu item on hover and restores the selected one on leave', async () => {
    const user = userEvent.setup()
    setup()
    await openMenu(user)
    const other = screen.getByRole('menuitemradio', { name: /public/i })
    const current = screen.getByRole('menuitemradio', { name: /gm only/i })

    await user.hover(other)
    expect(other.style.background).toBe('var(--bg-card-hover)')
    await user.unhover(other)
    expect(other.style.background).toBe('transparent')

    // The current level restores to its own highlight, not to transparent.
    await user.hover(current)
    expect(current.style.background).toBe('var(--bg-card-hover)')
    await user.unhover(current)
    expect(current.style.background).toBe('var(--bg-card)')
  })

  describe('member sharing (Private pages)', () => {
    const privatePage = (over = {}) => page({ visibility: 'members', ...over })

    // A row per member with a Read and a Write checkbox.
    it('lists members with their own read and write boxes', async () => {
      const user = userEvent.setup()
      const { onSetShares } = setup({ page: privatePage() })
      await openMenu(user)
      expect(screen.getByRole('checkbox', { name: 'Read access for alice' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Write access for alice' })).toBeInTheDocument()
      // A member with a character name is listed by that name.
      expect(
        screen.getByRole('checkbox', { name: 'Read access for Bob the Bold' })
      ).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Read access for alice' }))
      expect(onSetShares).toHaveBeenCalledWith(['u2'], [])
    })

    // Write implies read, so ticking Write grants both at once.
    it('grants read alongside write when the write box is ticked', async () => {
      const user = userEvent.setup()
      const { onSetShares } = setup({ page: privatePage() })
      await openMenu(user)
      await user.click(screen.getByRole('checkbox', { name: 'Write access for alice' }))
      expect(onSetShares).toHaveBeenCalledWith(['u2'], ['u2'])
    })

    // The implication is shown in the control rather than left as a rule to
    // know: a writer's Read box is ticked and cannot be unticked.
    it('locks the read box for a member who can write', async () => {
      const user = userEvent.setup()
      setup({
        page: privatePage({ shared_user_ids: ['u2'], shared_write_user_ids: ['u2'] }),
      })
      await openMenu(user)
      const read = screen.getByRole('checkbox', { name: 'Read access for alice' })
      expect(read).toBeChecked()
      expect(read).toBeDisabled()
      // The other member's row is unaffected.
      expect(screen.getByRole('checkbox', { name: 'Read access for Bob the Bold' })).toBeEnabled()
    })

    it('releases the read box again when write is unticked', async () => {
      const user = userEvent.setup()
      const { onSetShares } = setup({
        page: privatePage({ shared_user_ids: ['u2'], shared_write_user_ids: ['u2'] }),
      })
      await openMenu(user)
      await user.click(screen.getByRole('checkbox', { name: 'Write access for alice' }))
      // Read survives on its own — unticking write is a downgrade, not a revoke.
      expect(onSetShares).toHaveBeenCalledWith(['u2'], [])
    })

    it('revokes access entirely when read is unticked', async () => {
      const user = userEvent.setup()
      const { onSetShares } = setup({ page: privatePage({ shared_user_ids: ['u2', 'u3'] }) })
      await openMenu(user)
      await user.click(screen.getByRole('checkbox', { name: 'Read access for alice' }))
      expect(onSetShares).toHaveBeenCalledWith(['u3'], [])
    })

    it('shows an empty state when the campaign has no other members', async () => {
      const user = userEvent.setup()
      setup({
        // Only the author is in the campaign, so there is nobody to share with.
        campaign: { id: 'c1', members: [{ user_id: 'u1', is_owner: true, username: 'gm' }] },
        page: privatePage(),
      })
      await openMenu(user)
      expect(screen.getByText('No members to share with.')).toBeInTheDocument()
    })

    it('hides the share list for non-Private pages', async () => {
      const user = userEvent.setup()
      setup({ page: page({ visibility: 'group' }) })
      await openMenu(user)
      expect(screen.queryByRole('checkbox')).toBeNull()
    })

    // The share list follows the page, not campaign ownership: a player's own
    // private page shows them the same picker.
    it('shows the share list to a non-owner author', async () => {
      const user = userEvent.setup()
      setup({ isOwner: false, page: privatePage({ created_by_id: 'u2' }) })
      await openMenu(user)
      expect(screen.getByRole('checkbox', { name: 'Read access for gm' })).toBeInTheDocument()
      // ...and the author is not offered access to their own page.
      expect(screen.queryByRole('checkbox', { name: 'Read access for alice' })).toBeNull()
    })
  })
})
