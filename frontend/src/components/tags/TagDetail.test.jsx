import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagDetail from './TagDetail'

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

// The cards pull in media contexts; the detail pane's own layout is what
// matters here, so stub them to plain output. Each factory is inlined because
// vi.mock is hoisted above any local helper it might otherwise share.
vi.mock('../favorites/BookFavorite', () => ({
  default: ({ item }) => <div data-testid="book-card">{item.item_id}</div>,
}))
vi.mock('../favorites/MapFavorite', () => ({
  default: ({ item }) => <div data-testid="map-card">{item.item_id}</div>,
}))
vi.mock('../favorites/TokenFavorite', () => ({
  default: ({ item }) => <div data-testid="token-card">{item.item_id}</div>,
}))
vi.mock('../favorites/AudioFavorite', () => ({
  default: ({ item }) => <div data-testid="audio-card">{item.item_id}</div>,
}))
vi.mock('../favorites/ModelFavorite', () => ({
  default: ({ item }) => <div data-testid="model-card">{item.item_id}</div>,
}))
vi.mock('../favorites/SystemFavorite', () => ({
  default: ({ item }) => <div data-testid="system-card">{item.item_id}</div>,
}))

beforeEach(() => {
  prefs = {}
})

const detailWith = (over = {}) => ({
  internal: 'spooky',
  display: 'Spooky',
  category: 'shared',
  items: [{ item_type: 'book', item_id: 'b1' }],
  folders: [],
  ...over,
})

function renderDetail(over = {}, props = {}) {
  const detail = detailWith(over)
  const byType = (type) => detail.items.filter((i) => i.item_type === type)
  return render(
    <TagDetail
      detail={detail}
      isEditor={false}
      renaming={false}
      renameValue=""
      setRenameValue={() => {}}
      setRenaming={() => {}}
      saveRename={() => {}}
      deleteTag={() => {}}
      favorited={false}
      onToggleFavorite={() => {}}
      byType={byType}
      {...props}
    />
  )
}

describe('TagDetail', () => {
  it('shows the tag display name and total count', () => {
    renderDetail({
      items: [{ item_type: 'book', item_id: 'b1' }],
      folders: [{ resource_type: 'map', path: 'woods', items: [{ item_id: 'mf1' }] }],
    })
    expect(screen.getByText('Spooky')).toBeInTheDocument()
    // One direct item plus one folder item.
    expect(screen.getByText('2 tagged')).toBeInTheDocument()
  })

  it('shows an empty message when the tag has nothing', () => {
    renderDetail({ items: [], folders: [] })
    expect(screen.getByText(/nothing tagged/i)).toBeInTheDocument()
  })
})

describe('TagDetail download (issue #401)', () => {
  it('requests an archive of the whole tag', async () => {
    const onDownload = vi.fn()
    renderDetail({}, { onDownload })
    await userEvent.click(screen.getByLabelText('Download everything tagged Spooky'))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'tag', tag: 'spooky' } })
    )
  })

  it('offers a download when only a tagged folder holds items', () => {
    renderDetail(
      {
        items: [],
        folders: [{ resource_type: 'map', path: 'woods', items: [{ item_id: 'mf1' }] }],
      },
      { onDownload: vi.fn() }
    )
    expect(screen.getByLabelText('Download everything tagged Spooky')).toBeInTheDocument()
  })

  it('offers no download for a tag used only on game systems', () => {
    // Systems are excluded from tag archives, so such a tag has no files at all
    // and the button would produce an empty archive.
    renderDetail(
      { items: [{ item_type: 'system', item_id: 's1' }], folders: [] },
      { onDownload: vi.fn() }
    )
    expect(screen.queryByLabelText('Download everything tagged Spooky')).not.toBeInTheDocument()
  })

  it('offers no download when an empty folder group is the only match', () => {
    renderDetail(
      { items: [], folders: [{ resource_type: 'map', path: 'woods', items: [] }] },
      { onDownload: vi.fn() }
    )
    expect(screen.queryByLabelText('Download everything tagged Spooky')).not.toBeInTheDocument()
  })

  it('offers no download without a handler', () => {
    renderDetail()
    expect(screen.queryByLabelText('Download everything tagged Spooky')).not.toBeInTheDocument()
  })

  it('still shows the editor controls alongside the download button', () => {
    renderDetail({}, { onDownload: vi.fn(), isEditor: true })
    expect(screen.getByLabelText('Download everything tagged Spooky')).toBeInTheDocument()
    expect(screen.getByLabelText('Rename')).toBeInTheDocument()
    expect(screen.getByLabelText('Delete tag')).toBeInTheDocument()
  })
})
