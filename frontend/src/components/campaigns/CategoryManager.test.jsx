import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryManager from './CategoryManager'

vi.mock('../../api', () => ({
  campaigns: {
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    renameCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    reorderCategories: vi.fn(),
    setResourceGroupOrder: vi.fn(),
  },
}))

import { campaigns } from '../../api'

const cat = (over = {}) => ({
  id: 'c1',
  name: 'Handouts',
  kind: 'resource',
  icon: null,
  icon_color: null,
  sort_order: 0,
  ...over,
})

const renderManager = (props = {}) =>
  render(
    <CategoryManager
      campaignId="camp1"
      kind="resource"
      onClose={vi.fn()}
      onChanged={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.listCategories.mockResolvedValue([cat()])
  campaigns.createCategory.mockResolvedValue({})
  campaigns.renameCategory.mockResolvedValue({})
  campaigns.updateCategory.mockResolvedValue({})
  campaigns.deleteCategory.mockResolvedValue({})
  campaigns.reorderCategories.mockResolvedValue({})
  campaigns.setResourceGroupOrder.mockResolvedValue({})
})

describe('CategoryManager', () => {
  it('lists the campaign categories', async () => {
    renderManager()
    expect(await screen.findByText('Handouts')).toBeInTheDocument()
    expect(campaigns.listCategories).toHaveBeenCalledWith('camp1', 'resource')
  })

  it('shows an empty-state message when there are none', async () => {
    campaigns.listCategories.mockResolvedValue([])
    renderManager()
    expect(await screen.findByText('No categories yet.')).toBeInTheDocument()
  })

  it('creates a category from the input', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Handouts')
    await user.type(screen.getByPlaceholderText('New category name…'), 'Maps')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(campaigns.createCategory).toHaveBeenCalledWith('camp1', 'Maps', 'resource')
    )
  })

  it('renames a category', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Handouts')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const input = screen.getByDisplayValue('Handouts')
    await user.clear(input)
    await user.type(input, 'Player Handouts{Enter}')
    await waitFor(() =>
      expect(campaigns.renameCategory).toHaveBeenCalledWith('camp1', 'c1', 'Player Handouts')
    )
  })

  it('abandons a rename on Escape', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Handouts')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByDisplayValue('Handouts'), '{Escape}')
    expect(campaigns.renameCategory).not.toHaveBeenCalled()
    expect(screen.getByText('Handouts')).toBeInTheDocument()
  })

  it('saves an icon chosen from the picker', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Handouts')
    await user.click(screen.getByRole('button', { name: 'Icon' }))
    const dialog = screen.getByRole('dialog', { name: 'Icon' })
    await user.click(within(dialog).getByRole('button', { name: 'castle' }))
    await waitFor(() =>
      expect(campaigns.updateCategory).toHaveBeenCalledWith('camp1', 'c1', { icon: 'castle' })
    )
  })

  it('saves an icon colour chosen from the picker', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Handouts')
    await user.click(screen.getByRole('button', { name: 'Icon' }))
    const dialog = screen.getByRole('dialog', { name: 'Icon' })
    await user.click(within(dialog).getByRole('button', { name: 'Teal' }))
    await waitFor(() =>
      expect(campaigns.updateCategory).toHaveBeenCalledWith('camp1', 'c1', { icon_color: 'teal' })
    )
  })

  it('asks how to handle contents before deleting', async () => {
    const user = userEvent.setup()
    renderManager()
    await screen.findByText('Handouts')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete "Handouts"?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Leave items uncategorized' }))
    await waitFor(() =>
      expect(campaigns.deleteCategory).toHaveBeenCalledWith('camp1', 'c1', 'uncategorize')
    )
  })

  it('reorders categories with the arrow buttons', async () => {
    const user = userEvent.setup()
    campaigns.listCategories.mockResolvedValue([
      cat({ id: 'a', name: 'Alpha', sort_order: 0 }),
      cat({ id: 'b', name: 'Beta', sort_order: 1 }),
    ])
    renderManager()
    await screen.findByText('Alpha')
    // Move the second row up.
    await user.click(screen.getAllByRole('button', { name: 'Move up' })[1])
    await waitFor(() =>
      expect(campaigns.reorderCategories).toHaveBeenCalledWith('camp1', ['b', 'a'])
    )
  })

  it('closes via the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderManager({ onClose })
    await screen.findByText('Handouts')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  describe('with built-in type groups', () => {
    const typeGroups = [
      { key: 'type:book', label: 'Books' },
      { key: 'type:map', label: 'Maps' },
    ]

    it('interleaves type groups with categories and marks them built-in', async () => {
      renderManager({ typeGroups, groupOrder: ['type:book', 'cat:c1', 'type:map'] })
      await screen.findByText('Handouts')
      expect(screen.getByText('Books')).toBeInTheDocument()
      expect(screen.getAllByText('Built-in')).toHaveLength(2)
    })

    it('persists a reordered unified list as the group order', async () => {
      const user = userEvent.setup()
      renderManager({ typeGroups, groupOrder: ['type:book', 'cat:c1', 'type:map'] })
      await screen.findByText('Handouts')
      await user.click(screen.getAllByRole('button', { name: 'Move up' })[1])
      await waitFor(() =>
        expect(campaigns.setResourceGroupOrder).toHaveBeenCalledWith('camp1', [
          'cat:c1',
          'type:book',
          'type:map',
        ])
      )
    })
  })
})
