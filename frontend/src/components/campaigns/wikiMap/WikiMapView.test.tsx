import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiMapView from './WikiMapView'

vi.mock('../../../api', () => ({
  mediaUrl: (path: string) => `http://localhost/api${path}`,
  campaigns: {
    createWikiPin: vi.fn(),
    updateWikiPin: vi.fn(),
    deleteWikiPin: vi.fn(),
    updateWikiPage: vi.fn(),
    listResources: vi.fn(() => Promise.resolve([])),
    listCategories: vi.fn(() => Promise.resolve([])),
    searchResources: vi.fn(() => Promise.resolve([])),
    addResource: vi.fn(),
    fileUrl: (cid: string, id: string) => `http://localhost/api/campaigns/${cid}/files/${id}`,
  },
}))

import { campaigns, type Schema } from '../../../api'

const api = campaigns as unknown as Record<keyof typeof campaigns, Mock>

type Page = Schema<'WikiPageDetailOut'>
type Pin = Schema<'WikiMapPinOut'>

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: 'pin1',
  x: 0.25,
  y: 0.5,
  label: 'City gate',
  target_page_id: 'town',
  target_title: 'Waterdeep',
  visibility: 'page',
  sort_order: 0,
  can_edit: true,
  ...over,
})

const mapPage = (over: Partial<Page> = {}): Page =>
  ({
    id: 'map1',
    campaign_id: 'c1',
    title: 'Sword Coast',
    slug: 'sword-coast',
    page_type: 'map',
    visibility: 'group',
    can_edit: true,
    can_delete: true,
    is_mine: true,
    is_hidden: false,
    shared_user_ids: [],
    shared_write_user_ids: [],
    backlinks: [],
    map: { source: 'library', id: 'm1', name: 'coast.png', has_thumbnail: false },
    pins: [pin()],
    ...over,
  }) as Page

const pages = [
  { id: 'map1', title: 'Sword Coast' },
  { id: 'town', title: 'Waterdeep' },
  { id: 'port', title: 'Baldur' },
]

function mount(page: Page = mapPage(), props: { isGm?: boolean } = {}) {
  const onPageChanged = vi.fn()
  const onPagesChanged = vi.fn()
  render(
    <MemoryRouter>
      <WikiMapView
        campaignId="c1"
        page={page}
        pages={pages}
        isGm={props.isGm ?? true}
        noteHref={(id) => `/campaigns/c1/notes?note=${id}`}
        onPageChanged={onPageChanged}
        onPagesChanged={onPagesChanged}
      />
    </MemoryRouter>
  )
  // The pins draw once the picture has loaded.
  const img = screen.queryByRole('img', { name: 'coast.png' })
  if (img) fireEvent.load(img)
  return { onPageChanged, onPagesChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WikiMapView', () => {
  it('draws the map with its pins, which link to their pages', () => {
    mount()
    expect(screen.getByRole('img', { name: 'coast.png' })).toHaveAttribute(
      'src',
      'http://localhost/api/maps/m1/page/1'
    )
    const marker = screen.getByRole('link', { name: 'City gate - Waterdeep' })
    expect(marker).toHaveAttribute('href', '/campaigns/c1/notes?note=town')
    // The list under the map reaches the same page without the canvas.
    const list = screen.getByRole('list')
    expect(within(list).getByRole('link', { name: 'City gate' })).toHaveAttribute(
      'href',
      '/campaigns/c1/notes?note=town'
    )
  })

  it('shows a campaign copy of the map', () => {
    mount(mapPage({ map: { source: 'file', id: 'f1', name: 'coast.png', has_thumbnail: true } }))
    expect(screen.getByRole('img', { name: 'coast.png' })).toHaveAttribute(
      'src',
      'http://localhost/api/campaigns/c1/files/f1'
    )
  })

  it('marks unlinked and GM-only pins in words, not colour alone', () => {
    mount(
      mapPage({
        pins: [
          pin({ id: 'a', label: 'Cave', target_page_id: null, target_title: null }),
          pin({ id: 'b', label: 'Lair', visibility: 'gm' }),
        ],
      })
    )
    expect(screen.getByRole('button', { name: 'Cave - not linked' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lair - Waterdeep - GM only' })).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('GM only')).toBeInTheDocument()
    expect(within(list).getByText('(not linked)')).toBeInTheDocument()
  })

  it('shows a placeholder that keeps the pins when the map is gone', async () => {
    const { onPageChanged } = mount(mapPage({ map: { source: 'missing', has_thumbnail: false } }))
    expect(screen.getByText('This map is no longer in the library.')).toBeInTheDocument()
    expect(screen.getByText(/Its 1 pin is kept/)).toBeInTheDocument()

    api.listResources.mockResolvedValueOnce([
      { id: 'r1', resource_type: 'map', resource_id: 'm2', name: 'coast-v2.png', is_image: false },
    ])
    api.updateWikiPage.mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('button', { name: 'Replace map' }))
    fireEvent.click(await screen.findByRole('button', { name: 'coast-v2.png' }))
    await waitFor(() =>
      expect(api.updateWikiPage).toHaveBeenCalledWith('c1', 'map1', { map_id: 'm2' })
    )
    await waitFor(() => expect(onPageChanged).toHaveBeenCalled())
  })

  it('asks for a map on a page that has none yet', () => {
    mount(mapPage({ map: { source: 'none', has_thumbnail: false }, pins: [] }))
    expect(screen.getByText('No map has been chosen for this page yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose map' })).toBeInTheDocument()
  })

  it('offers no editing to a reader', () => {
    mount(mapPage({ can_edit: false }))
    expect(screen.queryByRole('button', { name: 'Edit pins' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replace map' })).not.toBeInTheDocument()
  })

  it('adds a pin linked to a new page', async () => {
    const { onPagesChanged } = mount(mapPage({ pins: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), {
      target: { value: 'Harbour' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Links to page' }), {
      target: { value: 'Neverwinter' },
    })
    expect(screen.getByText('Creates a new page: Neverwinter.')).toBeInTheDocument()
    api.createWikiPin.mockResolvedValueOnce(
      pin({ id: 'new', label: 'Harbour', target_page_id: 'nw', target_title: 'Neverwinter' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.createWikiPin).toHaveBeenCalledWith('c1', 'map1', {
        label: 'Harbour',
        icon: '',
        icon_color: '',
        target_title: 'Neverwinter',
        visibility: 'page',
        x: 0.5,
        y: 0.5,
      })
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Added Harbour')
    expect(onPagesChanged).toHaveBeenCalled()
  })

  it('edits and deletes a pin from the list', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit pin: City gate' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Links to page' }), {
      target: { value: 'Baldur' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'GM only - hidden from players' }))
    api.updateWikiPin.mockResolvedValueOnce(
      pin({ target_page_id: 'port', target_title: 'Baldur', visibility: 'gm' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateWikiPin).toHaveBeenCalledWith('c1', 'map1', 'pin1', {
        label: 'City gate',
        icon: '',
        icon_color: '',
        target_page_id: 'port',
        visibility: 'gm',
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit pin: City gate' }))
    api.deleteWikiPin.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Delete pin' }))
    await waitFor(() => expect(api.deleteWikiPin).toHaveBeenCalledWith('c1', 'map1', 'pin1'))
    await waitFor(() => expect(screen.queryByRole('list')).not.toBeInTheDocument())
  })

  it('moves a pin from the keyboard', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }))
    const marker = screen.getByRole('button', { name: 'City gate - Waterdeep' })
    marker.focus()
    fireEvent.keyDown(marker, { key: 'ArrowRight', shiftKey: true })
    api.updateWikiPin.mockResolvedValueOnce(pin({ x: 0.3 }))
    fireEvent.blur(marker)
    await waitFor(() =>
      expect(api.updateWikiPin).toHaveBeenCalledWith('c1', 'map1', 'pin1', { x: 0.3, y: 0.5 })
    )
  })

  it('puts a pin back when its move fails', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }))
    const marker = screen.getByRole('button', { name: 'City gate - Waterdeep' })
    fireEvent.keyDown(marker, { key: 'ArrowDown' })
    api.updateWikiPin.mockRejectedValueOnce(new Error('Archived'))
    fireEvent.blur(marker)
    expect(await screen.findByRole('alert')).toHaveTextContent('Archived')
    expect(screen.getByRole('button', { name: 'City gate - Waterdeep' }).style.top).toBe('50%')
  })

  it('places a pin where the map is clicked while editing', () => {
    mount(mapPage({ pins: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }))
    const canvas = screen.getByTestId('wiki-map-canvas')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 10, clientY: 10 })
    expect(screen.getByRole('heading', { name: 'New pin' })).toBeInTheDocument()
  })

  it('hides the GM-only toggle from players', () => {
    mount(mapPage({ pins: [] }), { isGm: false })
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
