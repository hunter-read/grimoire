import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GrimoireEmbedPicker from './GrimoireEmbedPicker'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  campaigns: { listResources: vi.fn(), fileUrl: (cid, id) => `http://localhost/c/${cid}/f/${id}` },
  mediaUrl: (p) => `http://localhost${p}`,
}))
vi.mock('./ImageUploadPanel', () => ({ default: () => <div>upload-panel</div> }))

beforeEach(() => vi.clearAllMocks())

const resources = [
  { id: 'r1', resource_type: 'audio', resource_id: 'a1', name: 'Tavern', has_thumbnail: true },
  { id: 'r2', resource_type: 'map', resource_id: 'm1', name: 'Cave', has_thumbnail: false },
  { id: 'r3', resource_type: 'book', resource_id: 'b1', name: 'PHB', has_thumbnail: false },
]

describe('GrimoireEmbedPicker', () => {
  it('lists linked resources', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    render(<GrimoireEmbedPicker campaignId="c1" onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Tavern')).toBeInTheDocument())
    expect(screen.getByText('Cave')).toBeInTheDocument()
    expect(screen.getByText('PHB')).toBeInTheDocument()
  })

  it('inserts an [[audio:ID]] token when an audio resource is picked', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    const onInsert = vi.fn()
    render(<GrimoireEmbedPicker campaignId="c1" onInsert={onInsert} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Tavern'))
    // Resources render in order, so the first Insert button is the audio row's.
    const insertButtons = screen.getAllByRole('button', { name: /insert/i })
    await userEvent.click(insertButtons[0])
    expect(onInsert).toHaveBeenCalledWith('[[audio:a1]]')
  })

  it('filters resources by the search query', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    render(<GrimoireEmbedPicker campaignId="c1" onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Tavern'))
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'cave')
    expect(screen.queryByText('Tavern')).not.toBeInTheDocument()
    expect(screen.getByText('Cave')).toBeInTheDocument()
  })

  it('shows an empty state when no resources are linked', async () => {
    campaigns.listResources.mockResolvedValue([])
    render(<GrimoireEmbedPicker campaignId="c1" onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/no.*resources|link/i)).toBeInTheDocument())
  })

  it('inserts a book embed with a page number', async () => {
    campaigns.listResources.mockResolvedValue([
      { id: 'r3', resource_type: 'book', resource_id: 'b1', name: 'PHB', has_thumbnail: false },
    ])
    const onInsert = vi.fn()
    render(<GrimoireEmbedPicker campaignId="c1" onInsert={onInsert} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('PHB'))
    // Book rows offer an "At page…" affordance.
    await userEvent.click(screen.getByRole('button', { name: /at page/i }))
    await userEvent.type(screen.getByPlaceholderText(/page/i), '42')
    await userEvent.click(screen.getByRole('button', { name: /^insert$/i }))
    expect(onInsert).toHaveBeenCalledWith('[[book:b1:42]]')
  })

  it('opens the image upload panel', async () => {
    campaigns.listResources.mockResolvedValue([])
    render(<GrimoireEmbedPicker campaignId="c1" onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => screen.getByPlaceholderText(/search/i))
    await userEvent.click(screen.getByTitle(/upload image/i))
    expect(screen.getByText('upload-panel')).toBeInTheDocument()
  })

  it('closes when the backdrop is clicked', async () => {
    campaigns.listResources.mockResolvedValue([])
    const onClose = vi.fn()
    const { container } = render(
      <GrimoireEmbedPicker campaignId="c1" onInsert={vi.fn()} onClose={onClose} />
    )
    await waitFor(() => screen.getByPlaceholderText(/search/i))
    await userEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })
})
