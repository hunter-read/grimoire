import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageSourceBrowser, { TOKEN_SOURCE_TYPES } from './ImageSourceBrowser'
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

  it('offers all four source types by default', async () => {
    render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    for (const type of ['map', 'token', 'book', 'audio']) {
      expect(screen.getByRole('button', { name: `imagePicker.tab.${type}` })).toBeInTheDocument()
    }
  })

  it('offers only the types a caller asks for', async () => {
    render(<ImageSourceBrowser types={['map', 'book']} value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'imagePicker.tab.map' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'imagePicker.tab.book' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'imagePicker.tab.token' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'imagePicker.tab.audio' })).not.toBeInTheDocument()
  })

  it('narrows to the token library alone for the token editor', async () => {
    render(<ImageSourceBrowser types={TOKEN_SOURCE_TYPES} value={null} onChange={vi.fn()} />)
    await waitFor(() =>
      expect(imageSources.search).toHaveBeenCalledWith('', 'token', expect.any(Number))
    )

    // The lone tab is hidden (see the tab-row test below); what matters here is
    // that no *other* source is offered.
    for (const type of ['map', 'book', 'audio', 'token']) {
      expect(
        screen.queryByRole('button', { name: `imagePicker.tab.${type}` })
      ).not.toBeInTheDocument()
    }
  })

  it('opens on the first allowed type when the default one is excluded', async () => {
    render(<ImageSourceBrowser types={['token']} value={null} onChange={vi.fn()} />)
    // Never searches 'map', which this caller does not offer.
    await waitFor(() =>
      expect(imageSources.search).toHaveBeenCalledWith('', 'token', expect.any(Number))
    )
  })

  it('keeps the tab order stable regardless of how types are ordered', async () => {
    render(<ImageSourceBrowser types={['audio', 'map']} value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent.trim())
      .filter((text) => text.startsWith('imagePicker.tab.'))
    expect(labels).toEqual(['imagePicker.tab.map', 'imagePicker.tab.audio'])
  })

  it('hides the tab row entirely when only one source is offered', async () => {
    // One permanently-selected pill above its own results is a chooser with
    // nothing to choose.
    render(<ImageSourceBrowser types={TOKEN_SOURCE_TYPES} value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'imagePicker.tab.token' })).not.toBeInTheDocument()
    // The results and the search box are still there.
    expect(screen.getByLabelText('imagePicker.searchPlaceholder')).toBeInTheDocument()
  })

  it('groups results under the folder each item came from', async () => {
    // A library files its tokens into folders; a flat grid throws that away.
    imageSources.search.mockResolvedValue([
      row({ resource_id: 't1', name: 'orc.png', subtitle: 'Monsters' }),
      row({ resource_id: 't2', name: 'hero.png', subtitle: 'Party' }),
    ])
    render(<ImageSourceBrowser types={TOKEN_SOURCE_TYPES} value={null} onChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /Monsters/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Party/ })).toBeInTheDocument()
  })

  it('collapses a folder, hiding only its own items', async () => {
    imageSources.search.mockResolvedValue([
      row({ resource_id: 't1', name: 'orc.png', subtitle: 'Monsters' }),
      row({ resource_id: 't2', name: 'hero.png', subtitle: 'Party' }),
    ])
    render(<ImageSourceBrowser types={TOKEN_SOURCE_TYPES} value={null} onChange={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: /Monsters/ }))

    expect(screen.queryByText('orc.png')).not.toBeInTheDocument()
    expect(screen.getByText('hero.png')).toBeInTheDocument()
  })

  it('files items with no folder under a loose-files heading, last', async () => {
    imageSources.search.mockResolvedValue([
      row({ resource_id: 't1', name: 'loose.png', subtitle: '' }),
      row({ resource_id: 't2', name: 'orc.png', subtitle: 'Monsters' }),
    ])
    render(<ImageSourceBrowser types={TOKEN_SOURCE_TYPES} value={null} onChange={vi.fn()} />)

    // Only the folder headings, in render order: a named folder is more useful
    // to land on than the loose bucket, so it leads.
    const headings = (await screen.findAllByRole('button'))
      .filter((b) => b.hasAttribute('aria-expanded'))
      .map((b) => b.textContent)
    expect(headings).toHaveLength(2)
    expect(headings[0]).toMatch(/Monsters/)
    expect(headings[1]).toMatch(/imagePicker.ungrouped/)
  })

  it('drops the folder headings while searching', async () => {
    // Matches spanning many folders read better as one result list.
    imageSources.search.mockResolvedValue([
      row({ resource_id: 't1', name: 'orc.png', subtitle: 'Monsters' }),
    ])
    render(<ImageSourceBrowser types={TOKEN_SOURCE_TYPES} value={null} onChange={vi.fn()} />)
    await screen.findByRole('button', { name: /Monsters/ })

    await userEvent.type(screen.getByLabelText('imagePicker.searchPlaceholder'), 'orc')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Monsters/ })).not.toBeInTheDocument()
    )
    expect(screen.getByText('orc.png')).toBeInTheDocument()
  })

  it('caps the results box by default, for a short dialog', async () => {
    const { container } = render(<ImageSourceBrowser value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    const box = [...container.querySelectorAll('div')].find((el) => el.style.overflowY === 'auto')
    expect(box.style.maxHeight).toBe('300px')
  })

  it('fills the height it is given when asked to', async () => {
    // The token editor hands this a full-height column; a fixed 300px box there
    // would waste most of the screen.
    const { container } = render(<ImageSourceBrowser fill value={null} onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())

    const box = [...container.querySelectorAll('div')].find((el) => el.style.overflowY === 'auto')
    expect(box.style.maxHeight).toBe('')
    expect(box.style.flex).toBe('1 1 0%')
  })
})
