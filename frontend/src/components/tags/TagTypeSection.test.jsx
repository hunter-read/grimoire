import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagTypeSection from './TagTypeSection'

// User-prefs persistence is exercised; keep it in-memory and simple.
let prefs = {}
vi.mock('../../hooks/useUserPrefs', () => ({
  getUserPrefs: () => prefs,
  saveUserPref: (key, value) => {
    prefs[key] = value
  },
}))
vi.mock('../../hooks/useViewMode', () => ({
  getDefaultViewMode: () => 'card',
}))

beforeEach(() => {
  prefs = {}
})

const renderItem = (item) => (
  <div key={item.item_id} data-testid="item">
    {item.item_id}
  </div>
)

describe('TagTypeSection', () => {
  it('renders directly-tagged items under the section title', () => {
    render(
      <TagTypeSection
        type="map"
        title="Maps"
        items={[{ item_id: 'm1' }]}
        folders={[]}
        renderItem={renderItem}
      />
    )
    expect(screen.getByText('Maps')).toBeInTheDocument()
    expect(screen.getByTestId('item')).toHaveTextContent('m1')
  })

  it('nests folder groups beneath the type, title-casing the folder path', () => {
    render(
      <TagTypeSection
        type="map"
        title="Maps"
        items={[]}
        folders={[{ resource_type: 'map', path: 'deep/woods', items: [{ item_id: 'mf1' }] }]}
        renderItem={renderItem}
      />
    )
    // Each path segment is Title-Cased and joined with " / ".
    expect(screen.getByText('Deep / Woods')).toBeInTheDocument()
    expect(screen.getByTestId('item')).toHaveTextContent('mf1')
  })

  it('collapses and expands, persisting the collapse state', async () => {
    render(
      <TagTypeSection
        type="map"
        title="Maps"
        items={[{ item_id: 'm1' }]}
        folders={[]}
        renderItem={renderItem}
      />
    )
    expect(screen.getByTestId('item')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /maps/i }))
    expect(screen.queryByTestId('item')).not.toBeInTheDocument()
    expect(prefs.tagsSectionCollapsed.map).toBe(true)
  })
})

describe('TagTypeSection download (issue #401)', () => {
  const props = {
    type: 'map',
    title: 'Maps',
    items: [{ item_id: 'm1' }],
    folders: [],
    renderItem,
    tag: 'spooky',
  }

  it('requests an archive scoped to this type', async () => {
    const onDownload = vi.fn()
    render(<TagTypeSection {...props} onDownload={onDownload} />)
    await userEvent.click(screen.getByTitle('Download all Maps tagged spooky'))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { type: 'tag_type', tag: 'spooky', resource_type: 'map' },
      })
    )
  })

  it('does not collapse the section when the download button is clicked', async () => {
    render(<TagTypeSection {...props} onDownload={vi.fn()} />)
    await userEvent.click(screen.getByTitle('Download all Maps tagged spooky'))
    expect(screen.getByTestId('item')).toBeInTheDocument()
  })

  it('offers a download when only a tagged folder holds items', () => {
    render(
      <TagTypeSection
        {...props}
        items={[]}
        folders={[{ resource_type: 'map', path: 'woods', items: [{ item_id: 'mf1' }] }]}
        onDownload={vi.fn()}
      />
    )
    expect(screen.getByTitle('Download all Maps tagged spooky')).toBeInTheDocument()
  })

  it('offers no download when the section is empty', () => {
    render(<TagTypeSection {...props} items={[]} folders={[]} onDownload={vi.fn()} />)
    expect(screen.queryByTitle('Download all Maps tagged spooky')).not.toBeInTheDocument()
  })

  it('offers no download for a systems section', () => {
    // A tagged system is a whole shelf, not a file; it is excluded from tag
    // archives and downloaded from its own page instead.
    render(
      <TagTypeSection
        {...props}
        type="system"
        title="Systems"
        items={[{ item_id: 's1' }]}
        onDownload={vi.fn()}
      />
    )
    expect(screen.queryByTitle('Download all Systems tagged spooky')).not.toBeInTheDocument()
  })

  it('passes the tag down to its folder groups', async () => {
    const onDownload = vi.fn()
    render(
      <TagTypeSection
        {...props}
        items={[]}
        folders={[{ resource_type: 'map', path: 'woods', items: [{ item_id: 'mf1' }] }]}
        onDownload={onDownload}
      />
    )
    await userEvent.click(screen.getByTitle('Download Woods'))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ type: 'tag_folder', folder: 'woods' }),
      })
    )
  })
})
