import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResourcePicker from './ResourcePicker'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  mediaUrl: (p) => `http://localhost${p}`,
  campaigns: {
    searchResources: vi.fn(),
    addResource: vi.fn(),
  },
}))

const results = [
  { resource_type: 'book', resource_id: 'b1', name: "Player's Handbook", has_thumbnail: true },
  { resource_type: 'map', resource_id: 'm1', name: 'Tavern Map', has_thumbnail: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.searchResources.mockResolvedValue(results)
  campaigns.addResource.mockResolvedValue({})
})

describe('ResourcePicker', () => {
  it('searches on mount and lists the results', async () => {
    render(
      <ResourcePicker campaignId="c1" linkedIds={new Set()} onAdd={vi.fn()} onClose={vi.fn()} />
    )
    expect(campaigns.searchResources).toHaveBeenCalledWith('', '')
    expect(await screen.findByText("Player's Handbook")).toBeInTheDocument()
    expect(screen.getByText('Tavern Map')).toBeInTheDocument()
  })

  it('renders a lazy thumbnail for a result that has one', async () => {
    const { container } = render(
      <ResourcePicker campaignId="c1" linkedIds={new Set()} onAdd={vi.fn()} onClose={vi.fn()} />
    )
    await screen.findByText("Player's Handbook")
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('/books/b1/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('adds a resource and calls onAdd', async () => {
    const onAdd = vi.fn()
    render(<ResourcePicker campaignId="c1" linkedIds={new Set()} onAdd={onAdd} onClose={vi.fn()} />)
    await screen.findByText("Player's Handbook")
    const addButtons = screen.getAllByRole('button', { name: /add/i })
    await userEvent.click(addButtons[0])
    await waitFor(() =>
      expect(campaigns.addResource).toHaveBeenCalledWith('c1', {
        resource_type: 'book',
        resource_id: 'b1',
        visibility: 'public',
      })
    )
    expect(onAdd).toHaveBeenCalled()
  })

  it('disables the button and skips adding for an already-linked resource', async () => {
    render(
      <ResourcePicker
        campaignId="c1"
        linkedIds={new Set(['book:b1'])}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(await screen.findByText('Linked')).toBeInTheDocument()
  })

  it('re-searches when a type tab is selected', async () => {
    render(
      <ResourcePicker campaignId="c1" linkedIds={new Set()} onAdd={vi.fn()} onClose={vi.fn()} />
    )
    await screen.findByText("Player's Handbook")
    await userEvent.click(screen.getByRole('button', { name: 'Maps' }))
    expect(campaigns.searchResources).toHaveBeenCalledWith('', 'map')
  })

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(
      <ResourcePicker campaignId="c1" linkedIds={new Set()} onAdd={vi.fn()} onClose={onClose} />
    )
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
