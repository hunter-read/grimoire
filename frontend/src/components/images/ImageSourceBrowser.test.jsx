import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageSourceBrowser from './ImageSourceBrowser'
import { imageSources } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

vi.mock('../../api', () => ({
  imageSources: {
    search: vi.fn(),
    thumbUrl: (type, id) => `/api/${type}s/${id}/thumbnail`,
  },
}))

const row = (over = {}) => ({
  resource_type: 'map',
  resource_id: 'm1',
  name: 'ruins.png',
  subtitle: 'Dungeons',
  has_thumbnail: true,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  imageSources.search.mockResolvedValue([row()])
})

describe('ImageSourceBrowser', () => {
  it('lists searchable library images', async () => {
    render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())
    // Maps lead when there is no campaign context.
    expect(imageSources.search).toHaveBeenCalledWith('', 'map', expect.any(Number))
  })

  it('drops items that cannot produce an image', async () => {
    imageSources.search.mockResolvedValue([
      row(),
      row({ resource_id: 'm2', name: 'no-thumb.png', has_thumbnail: false }),
    ])
    render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())
    // Choosing a thumbnail-less item would only 404 server-side.
    expect(screen.queryByText('no-thumb.png')).not.toBeInTheDocument()
  })

  it('reports the chosen image to the parent', async () => {
    const onChange = vi.fn()
    render(<ImageSourceBrowser value={null} onChange={onChange} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    await userEvent.click(screen.getByText('ruins.png'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ source_type: 'map', source_id: 'm1', name: 'ruins.png' })
    )
  })

  it('deselects when the chosen image is clicked again', async () => {
    const onChange = vi.fn()
    render(
      <ImageSourceBrowser value={{ source_type: 'map', source_id: 'm1' }} onChange={onChange} />
    )
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    await userEvent.click(screen.getByText('ruins.png'))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('searches the selected type when the tab changes', async () => {
    render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(imageSources.search).toHaveBeenCalled())

    await userEvent.click(screen.getByText('imagePicker.tab.token'))

    await waitFor(() =>
      expect(imageSources.search).toHaveBeenCalledWith('', 'token', expect.any(Number))
    )
  })

  it('leads with the campaign tab and filters it locally', async () => {
    render(
      <ImageSourceBrowser
        campaignImages={[
          { id: 'f1', name: 'party-art.png', url: '/files/f1' },
          { id: 'f2', name: 'map-scan.png', url: '/files/f2' },
        ]}
        value={null}
        onChange={vi.fn()}
      />
    )

    // Campaign images are already in hand, so no search is issued for them.
    expect(screen.getByText('party-art.png')).toBeInTheDocument()
    expect(screen.getByText('map-scan.png')).toBeInTheDocument()
    expect(imageSources.search).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', async () => {
    imageSources.search.mockResolvedValue([])
    render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('imagePicker.noResults')).toBeInTheDocument())
  })

  it('surfaces a failed search', async () => {
    imageSources.search.mockRejectedValue(new Error('offline'))
    render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('offline'))
  })
})
