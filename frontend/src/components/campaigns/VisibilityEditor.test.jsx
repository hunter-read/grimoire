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
  shared_user_ids: [],
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

  it('offers only Public to non-owners', async () => {
    const user = userEvent.setup()
    setup({ isOwner: false })
    await openMenu(user)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1)
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

    it('lists non-owner members and toggles one on', async () => {
      const user = userEvent.setup()
      const { onSetShares } = setup({ page: privatePage() })
      await openMenu(user)
      expect(screen.getByRole('menuitemcheckbox', { name: 'alice' })).toBeInTheDocument()
      // A member with a character name is listed by that name.
      expect(screen.getByRole('menuitemcheckbox', { name: 'Bob the Bold' })).toBeInTheDocument()

      await user.click(screen.getByRole('menuitemcheckbox', { name: 'alice' }))
      expect(onSetShares).toHaveBeenCalledWith(['u2'])
    })

    it('toggles an already-shared member off', async () => {
      const user = userEvent.setup()
      const { onSetShares } = setup({ page: privatePage({ shared_user_ids: ['u2', 'u3'] }) })
      await openMenu(user)
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'alice' }))
      expect(onSetShares).toHaveBeenCalledWith(['u3'])
    })

    it('highlights a member row on hover', async () => {
      const user = userEvent.setup()
      setup({ page: privatePage() })
      await openMenu(user)
      const row = screen.getByRole('menuitemcheckbox', { name: 'alice' })
      await user.hover(row)
      expect(row.style.background).toBe('var(--bg-card-hover)')
      await user.unhover(row)
      expect(row.style.background).toBe('transparent')
    })

    it('shows an empty state when the campaign has no other members', async () => {
      const user = userEvent.setup()
      setup({
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
      expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    })

    it('hides the share list from non-owners', async () => {
      const user = userEvent.setup()
      setup({ isOwner: false, page: privatePage() })
      await openMenu(user)
      expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    })
  })
})
