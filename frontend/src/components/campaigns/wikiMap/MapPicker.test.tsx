import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MapPicker from './MapPicker'

vi.mock('../../../api', () => ({
  campaigns: {
    listResources: vi.fn(),
    listCategories: vi.fn(() => Promise.resolve([])),
    searchResources: vi.fn(),
    addResource: vi.fn(),
    uploadImage: vi.fn(),
    fileUrl: (cid: string, id: string) => `/api/campaigns/${cid}/files/${id}`,
  },
  imageSources: { thumbUrl: (type: string, id: string) => `/api/${type}s/${id}/thumbnail` },
  mediaUrl: (path: string, params: Record<string, unknown> = {}) =>
    `/api${path}?${new URLSearchParams(params as Record<string, string>)}`,
}))

import { campaigns } from '../../../api'

const api = campaigns as unknown as Record<keyof typeof campaigns, Mock>

const linked = [
  {
    id: 'r1',
    resource_type: 'map',
    resource_id: 'm1',
    name: 'coast.png',
    is_image: false,
    has_thumbnail: true,
  },
  { id: 'r2', resource_type: 'map', resource_id: 'm2', name: 'atlas.pdf', is_image: false },
  { id: 'r3', resource_type: 'file', resource_id: 'f1', name: 'sketch.webp', is_image: true },
  { id: 'r4', resource_type: 'file', resource_id: 'f2', name: 'notes.txt', is_image: false },
  { id: 'r5', resource_type: 'book', resource_id: 'b1', name: 'Atlas.png', is_image: false },
]

function mount(isOwner = true, pageVisibility = 'group') {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(
    <MapPicker
      campaignId="c1"
      isOwner={isOwner}
      pageVisibility={pageVisibility}
      onPick={onPick}
      onClose={onClose}
    />
  )
  return { onPick, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listResources.mockResolvedValue(linked)
})

describe('MapPicker', () => {
  it('lists only the image maps and images linked to the campaign', async () => {
    const { onPick } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'coast.png' }))
    expect(onPick).toHaveBeenCalledWith({ map_id: 'm1' }, 'coast.png')
    fireEvent.click(screen.getByRole('button', { name: 'sketch.webp' }))
    expect(onPick).toHaveBeenCalledWith({ map_file_id: 'f1' }, 'sketch.webp')
    for (const name of ['atlas.pdf', 'notes.txt', 'Atlas.png']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it("shows each choice's picture", async () => {
    api.searchResources.mockResolvedValue([
      { resource_type: 'map', resource_id: 'm9', name: 'harbour.jpg', subtitle: 'Ports' },
    ])
    mount()
    const coast = await screen.findByRole('button', { name: 'coast.png' })
    expect(coast.querySelector('img')).toHaveAttribute('src', '/api/maps/m1/thumbnail')
    const sketch = screen.getByRole('button', { name: 'sketch.webp' })
    expect(sketch.querySelector('img')).toHaveAttribute('src', '/api/campaigns/c1/files/f1')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'harbour' } })
    // No thumbnail made yet: a small render of the map stands in.
    const hit = await screen.findByRole('button', { name: /harbour\.jpg/ })
    expect(hit.querySelector('img')).toHaveAttribute('src', '/api/maps/m9/page/1?width=480')
  })

  it('falls back to an icon when a picture fails to load', async () => {
    mount()
    const coast = await screen.findByRole('button', { name: 'coast.png' })
    fireEvent.error(coast.querySelector('img')!)
    expect(coast.querySelector('img')).toBeNull()
    expect(coast.querySelector('svg')).not.toBeNull()
  })

  it('links a library map to the campaign before using it', async () => {
    api.searchResources.mockResolvedValue([
      { resource_type: 'map', resource_id: 'm9', name: 'harbour.jpg', subtitle: 'Ports' },
      { resource_type: 'map', resource_id: 'm8', name: 'harbour.webm', subtitle: '' },
    ])
    api.addResource.mockResolvedValue({})
    const { onPick } = mount(true, 'group')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search library maps' }), {
      target: { value: 'harbour' },
    })
    const hit = await screen.findByRole('button', { name: /harbour\.jpg/ })
    // Video maps can't be a map page's picture.
    expect(screen.queryByRole('button', { name: /harbour\.webm/ })).not.toBeInTheDocument()
    fireEvent.click(hit)
    await waitFor(() =>
      expect(api.addResource).toHaveBeenCalledWith('c1', {
        resource_type: 'map',
        resource_id: 'm9',
        visibility: 'public',
      })
    )
    expect(onPick).toHaveBeenCalledWith({ map_id: 'm9' }, 'harbour.jpg')
  })

  it("doesn't link a map twice, and keeps a private page's map GM-only", async () => {
    api.searchResources.mockResolvedValue([
      { resource_type: 'map', resource_id: 'm1', name: 'coast.png', subtitle: '' },
    ])
    const { onPick } = mount(true, 'gm')
    await screen.findByRole('button', { name: 'coast.png' })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'coast' } })
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /coast\.png/ })).toHaveLength(2)
    )
    fireEvent.click(screen.getAllByRole('button', { name: /coast\.png/ })[1])
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ map_id: 'm1' }, 'coast.png'))
    expect(api.addResource).not.toHaveBeenCalled()
  })

  it('says so when linking fails', async () => {
    api.searchResources.mockResolvedValue([
      { resource_type: 'map', resource_id: 'm9', name: 'harbour.jpg', subtitle: '' },
    ])
    api.addResource.mockRejectedValue(new Error('Campaign is archived'))
    const { onPick } = mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'harbour' } })
    fireEvent.click(await screen.findByRole('button', { name: /harbour\.jpg/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Campaign is archived')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('offers players only what the campaign shares', async () => {
    api.listResources.mockResolvedValue([])
    mount(false)
    expect(
      await screen.findByText('No image maps or images are linked to this campaign yet.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload an image' })).not.toBeInTheDocument()
  })

  it('opens the image upload for the GM', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Upload an image' }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('closes from its close button', () => {
    const { onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
