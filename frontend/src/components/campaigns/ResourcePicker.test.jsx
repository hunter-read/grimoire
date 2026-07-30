import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResourcePicker from './ResourcePicker'
import { campaigns, tags } from '../../api'

vi.mock('../../api', () => ({
  campaigns: { searchResources: vi.fn() },
  tags: {
    list: vi.fn(() => Promise.resolve({ tags: [] })),
    items: vi.fn(() => Promise.resolve({ items: [] })),
  },
}))

// searchResources is called once per type (book, map, token, audio). Resolve
// each call from a per-type fixture so the folder tree has real structure.
// Book subtitles lead with the game system, then nested category folders.
const byType = {
  book: [
    {
      resource_type: 'book',
      resource_id: 'b1',
      name: "Player's Handbook",
      subtitle: 'D&D 5e/core',
    },
    {
      resource_type: 'book',
      resource_id: 'b2',
      name: 'Curse of Strahd',
      subtitle: 'D&D 5e/adventures/ravenloft',
    },
    {
      resource_type: 'book',
      resource_id: 'b3',
      name: 'Pathfinder Core',
      subtitle: 'Pathfinder/core',
    },
  ],
  map: [{ resource_type: 'map', resource_id: 'm1', name: 'Tavern', subtitle: 'dungeons' }],
  token: [],
  audio: [{ resource_type: 'audio', resource_id: 'a1', name: 'Battle Theme', subtitle: '' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.searchResources.mockImplementation((_q, type) => Promise.resolve(byType[type] || []))
})

// Controlled wrapper so tests can drive and inspect the selection state.
function Harness(props) {
  const [selected, setSelected] = useState(props.initial || [])
  return <ResourcePicker selected={selected} setSelected={setSelected} {...props} />
}

describe('ResourcePicker', () => {
  it('loads all four resource types on mount', async () => {
    render(<Harness />)
    await waitFor(() =>
      expect(campaigns.searchResources).toHaveBeenCalledWith('', 'book', '', 1000)
    )
    for (const type of ['book', 'map', 'token', 'audio']) {
      expect(campaigns.searchResources).toHaveBeenCalledWith('', type, '', 1000)
    }
  })

  it('offers book/map/token/audio tabs and no "all" tab', async () => {
    render(<Harness />)
    await screen.findByRole('button', { name: 'Books' })
    expect(screen.getByRole('button', { name: 'Maps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tokens' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })

  it('groups books by system then nested folders, revealing items on expand', async () => {
    render(<Harness />)
    // Top level is the game systems, collapsed by default.
    const system = await screen.findByText('D&D 5e')
    expect(screen.getByText('Pathfinder')).toBeInTheDocument()
    // Nested folders and items are hidden until expanded.
    expect(screen.queryByText('adventures')).not.toBeInTheDocument()
    await userEvent.click(system)
    await userEvent.click(screen.getByText('adventures'))
    await userEvent.click(screen.getByText('ravenloft'))
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
  })

  it('selecting a row adds it to the controlled selection', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByText('D&D 5e'))
    await userEvent.click(screen.getByText('core'))
    await userEvent.click(screen.getByText("Player's Handbook"))
    // Appears in the selected summary with a visibility select.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('pins the campaign system to the top of the book tree', async () => {
    render(<Harness pinSystem="Pathfinder" />)
    await screen.findByText('Pathfinder')
    // The pinned system's folder header comes before the other system's.
    const headers = screen.getAllByText(/D&D 5e|Pathfinder/)
    expect(headers[0]).toHaveTextContent('Pathfinder')
  })

  it('switches to the audio tab and groups ungrouped items under "Other"', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByRole('button', { name: 'Audio' }))
    // Audio item has an empty subtitle → bucketed under the ungrouped label.
    const other = await screen.findByText('Other')
    await userEvent.click(other)
    expect(screen.getByText('Battle Theme')).toBeInTheDocument()
  })

  it('pre-selects core books when preselectCore and a system are set', async () => {
    render(<Harness systemId="sys1" preselectCore />)
    // Both core books (subtitle ends in "/core") land in the selection summary,
    // each with its own visibility select.
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2))
  })

  it('excludes already-linked resources from the browser', async () => {
    render(<Harness excludeKeys={new Set(['book:b1'])} />)
    // b1 was the only book under D&D 5e/core, so that leaf folder drops out; the
    // adventures folder under the same system remains.
    await userEvent.click(await screen.findByText('D&D 5e'))
    expect(screen.getByText('adventures')).toBeInTheDocument()
    expect(screen.queryByText('core')).not.toBeInTheDocument()
    expect(screen.queryByText("Player's Handbook")).not.toBeInTheDocument()
  })

  // --- Add by tag (issue #235.8) ---

  describe('add by tag', () => {
    beforeEach(() => {
      tags.list.mockResolvedValue({
        tags: [{ internal: 'strahd', display: 'Strahd', count: 2 }],
      })
    })

    it('shows the tag picker only when tags exist', async () => {
      tags.list.mockResolvedValueOnce({ tags: [] })
      render(<Harness />)
      await screen.findByRole('button', { name: 'Books' })
      expect(screen.queryByLabelText(/add all with tag/i)).not.toBeInTheDocument()
    })

    it('adds every campaign-addable resource carrying the chosen tag', async () => {
      tags.items.mockResolvedValue({
        internal: 'strahd',
        display: 'Strahd',
        items: [
          { item_type: 'book', item_id: 'b2' },
          { item_type: 'map', item_id: 'm1' },
          // A system is not a campaign resource and must be skipped.
          { item_type: 'system', item_id: 's9' },
        ],
      })
      render(<Harness />)
      const select = await screen.findByLabelText(/add all with tag/i)
      await userEvent.selectOptions(select, 'strahd')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      // Two addable resources land in the selection (the system is skipped).
      expect(await screen.findByText('Selected (2)')).toBeInTheDocument()
      expect(tags.items).toHaveBeenCalledWith('strahd')
      // The book's real name is enriched from the loaded resource set.
      expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    })

    it('does not duplicate a resource already selected', async () => {
      tags.items.mockResolvedValue({
        internal: 'strahd',
        display: 'Strahd',
        items: [{ item_type: 'map', item_id: 'm1' }],
      })
      render(
        <Harness
          initial={[
            { resource_type: 'map', resource_id: 'm1', name: 'Tavern', visibility: 'public' },
          ]}
        />
      )
      expect(await screen.findByText('Selected (1)')).toBeInTheDocument()
      const select = await screen.findByLabelText(/add all with tag/i)
      await userEvent.selectOptions(select, 'strahd')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      // Still exactly one selected map (no duplicate).
      await waitFor(() => expect(tags.items).toHaveBeenCalled())
      expect(screen.getByText('Selected (1)')).toBeInTheDocument()
    })
  })
})
