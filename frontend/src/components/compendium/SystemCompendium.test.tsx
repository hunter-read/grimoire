import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SystemCompendium from './SystemCompendium'
import { CONDITION_TYPE, SPELL_TYPE, entry, summary } from '../../test/compendiumFixtures'

const mockSearch = vi.fn()
const mockBrowse = vi.fn()
const mockEntry = vi.fn()
vi.mock('../../api', () => ({
  compendium: {
    searchSystem: (...a: unknown[]) => mockSearch(...a),
    browse: (...a: unknown[]) => mockBrowse(...a),
    entry: (...a: unknown[]) => mockEntry(...a),
  },
}))

type Props = Partial<Parameters<typeof SystemCompendium>[0]>

const renderIt = (props: Props = {}) =>
  render(
    <MemoryRouter>
      <SystemCompendium systemId="s1" gameType="ttrpg" summary={summary()} {...props} />
    </MemoryRouter>
  )

beforeEach(() => {
  mockSearch.mockReset()
  mockBrowse.mockReset()
  mockEntry.mockReset()
  sessionStorage.clear()
})

describe('SystemCompendium', () => {
  it('lists each content type with its count, linked to its page', () => {
    renderIt()
    const nav = screen.getByRole('navigation', { name: 'Content types' })
    const spells = screen.getByRole('link', { name: /Spells/ })
    expect(nav).toContainElement(spells)
    expect(spells).toHaveAttribute('href', '/library/system/s1/compendium/spell')
    expect(spells).toHaveTextContent('2')
    expect(screen.getByText(/Pick a content type/)).toBeInTheDocument()
  })

  it('shows the packs’ credits', () => {
    renderIt()
    expect(screen.getByText('This work includes material from the Demo SRD.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CC-BY-4.0/ })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/'
    )
  })

  it('marks the open type and shows its list', async () => {
    mockBrowse.mockResolvedValue({
      content_type: SPELL_TYPE,
      entries: [entry()],
      total: 1,
      page: 1,
      page_size: 50,
      filters_available: {},
    })
    renderIt({ contentType: 'spell' })
    expect(screen.getByRole('link', { name: /Spells/ })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('link', { name: /Fireball/ })).toBeInTheDocument()
  })

  it('opens an entry on its own URL', async () => {
    mockEntry.mockResolvedValue({ ...entry(), type_definition: SPELL_TYPE })
    renderIt({ contentType: 'spell', entryId: 'fireball', origin: 'demo-srd' })
    expect(await screen.findByRole('heading', { name: 'Fireball' })).toBeInTheDocument()
    expect(mockEntry).toHaveBeenCalledWith('s1', 'spell', 'fireball', 'demo-srd')
  })

  it('searches every type at once', async () => {
    mockSearch.mockResolvedValue({
      results: [
        {
          ...entry({ entry_id: 'prone', name: 'Prone', content_type: 'condition' }),
          type_label: 'Condition',
          systems: [{ id: 's1', name: 'Demo' }],
        },
      ],
    })
    renderIt()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the compendium' }), 'pro')
    expect(await screen.findByRole('link', { name: /Prone/ })).toHaveAttribute(
      'href',
      '/library/system/s1/compendium/condition/prone?origin=demo-srd'
    )
    expect(screen.getByRole('status')).toHaveTextContent('1 result')
    expect(mockSearch).toHaveBeenCalledWith('s1', 'pro')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Prone/ })).toBeNull())
  })

  it('says a failed search found nothing', async () => {
    mockSearch.mockRejectedValue(new Error('offline'))
    renderIt()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the compendium' }), 'xy')
    expect(await screen.findByText('0 results')).toBeInTheDocument()
  })

  it('tells an editor how to fill an empty compendium', () => {
    renderIt({ summary: summary({ content_types: [], packs: [], can_edit: true }) })
    expect(screen.getByText(/Link a content pack to it from Edit/)).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('tells a reader it is empty', () => {
    renderIt({ summary: summary({ content_types: [], packs: [] }) })
    expect(screen.getByText("Nothing is in this system's compendium yet.")).toBeInTheDocument()
  })

  it('links a type in the armory under the armory', () => {
    renderIt({ gameType: 'wargame', summary: summary({ content_types: [CONDITION_TYPE] }) })
    expect(screen.getByRole('link', { name: /Conditions/ })).toHaveAttribute(
      'href',
      '/armory/system/s1/compendium/condition'
    )
  })
})
