import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { GmScreenContext } from '../gmScreenContext'
import type { PartyOverview } from '../types'
import ClocksSettings from './ClocksSettings'
import CounterSettings from './CounterSettings'
import InitiativeSettings from './InitiativeSettings'
import NoteSettings from './NoteSettings'
import PartySettings from './PartySettings'
import PoolsSettings from './PoolsSettings'

vi.mock('../../../api', () => ({ campaigns: { wikiTitles: vi.fn() } }))
import { campaigns } from '../../../api'
const mockTitles = (campaigns as unknown as { wikiTitles: Mock }).wikiTitles

const party: PartyOverview = {
  characters: [],
  fields: [
    { name: 'hp_marked', label: 'HP marked', type: 'number', source: 'field' },
    { name: 'hp_max', label: 'HP', type: 'number', source: 'field' },
    { name: 'evasion', label: 'Evasion', type: 'number', source: 'computed' },
    { name: 'ancestry', label: 'Ancestry', type: 'text', source: 'field' },
  ],
}

const withParty = (node: ReactNode, value = party) => (
  <GmScreenContext.Provider
    value={{ campaignId: 'camp', party: value, setCharacterValue: vi.fn() }}
  >
    {node}
  </GmScreenContext.Provider>
)

beforeEach(() => vi.clearAllMocks())

describe('CounterSettings', () => {
  it('edits range, start, style and reset', () => {
    const onChange = vi.fn()
    render(<CounterSettings config={{ min: 0, max: 12 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Highest'), { target: { value: '' } })
    expect(onChange.mock.lastCall![0].max).toBeNull()
    fireEvent.change(screen.getByLabelText('Lowest'), { target: { value: '2' } })
    expect(onChange.mock.lastCall![0].min).toBe(2)
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '' } })
    expect(onChange.mock.lastCall![0].start).toBe(0)
    fireEvent.change(screen.getByLabelText('Show as'), { target: { value: 'pips' } })
    expect(onChange.mock.lastCall![0].style).toBe('pips')
    fireEvent.change(screen.getByLabelText('Clears'), { target: { value: 'session' } })
    expect(onChange.mock.lastCall![0].resets).toBe('session')
  })
})

describe('ClocksSettings and PoolsSettings', () => {
  it('switch counting direction and when pools empty', () => {
    const onChange = vi.fn()
    render(<ClocksSettings config={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: 'clock' } })
    expect(onChange).toHaveBeenCalledWith({ mode: 'clock' })
    render(<PoolsSettings config={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Empty the pools'), { target: { value: 'scene' } })
    expect(onChange).toHaveBeenLastCalledWith({ resets: 'scene' })
  })
})

describe('InitiativeSettings', () => {
  it('switches to sides and edits them', () => {
    const onChange = vi.fn()
    const { rerender } = render(<InitiativeSettings config={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Turns'), { target: { value: 'sides' } })
    const sides = { ...onChange.mock.lastCall![0] }
    expect(sides.mode).toBe('sides')

    rerender(<InitiativeSettings config={sides} onChange={onChange} />)
    // Two sides is the least a turn can pass between.
    expect(screen.getByRole('button', { name: 'Remove Heroes' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Side 2'), { target: { value: 'Director' } })
    expect(onChange.mock.lastCall![0].sides[1]).toEqual({ key: 'foes', label: 'Director' })
    fireEvent.click(screen.getByRole('button', { name: /Add side/ }))
    const added = onChange.mock.lastCall![0]
    expect(added.sides[2]).toEqual({ key: 'new-side', label: 'New side' })

    rerender(<InitiativeSettings config={added} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Add side/ }))
    expect(onChange.mock.lastCall![0].sides[3].key).toBe('new-side-2')
    fireEvent.click(screen.getByRole('button', { name: 'Remove New side' }))
    expect(onChange.mock.lastCall![0].sides).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Clear the turn order'), { target: { value: 'scene' } })
    expect(onChange.mock.lastCall![0].resets).toBe('scene')
  })
})

describe('NoteSettings', () => {
  it('picks one of the campaign’s notes', async () => {
    mockTitles.mockResolvedValue([
      { id: 'p1', title: 'Session Zero', slug: 'session-zero', ambiguous: false, headings: [] },
      {
        id: 'p2',
        title: 'Vault',
        slug: 'vault',
        parent_title: 'Places',
        ambiguous: false,
        headings: [],
      },
    ])
    const onChange = vi.fn()
    render(withParty(<NoteSettings config={{ page_id: null }} onChange={onChange} />))
    expect(await screen.findByRole('option', { name: 'Places › Vault' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'p1' } })
    expect(onChange).toHaveBeenCalledWith({ page_id: 'p1', page_slug: 'session-zero' })
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ page_id: null, page_slug: '' })
  })

  it('offers nothing when the titles cannot be read', async () => {
    mockTitles.mockRejectedValue(new Error('offline'))
    render(withParty(<NoteSettings config={{}} onChange={vi.fn()} />))
    await waitFor(() => expect(mockTitles).toHaveBeenCalled())
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })
})

describe('PartySettings', () => {
  it('adds, styles, orders and removes stats', () => {
    const onChange = vi.fn()
    const { rerender } = render(withParty(<PartySettings config={{}} onChange={onChange} />))
    // Computed values are offered, and marked as such.
    expect(screen.getByRole('option', { name: 'Evasion (worked out)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Add$/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Add a stat'), { target: { value: 'hp_marked' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    const one = onChange.mock.lastCall![0]
    expect(one.stats).toEqual([
      { label: 'HP marked', value: 'hp_marked', max: null, style: 'number' },
    ])

    const two = {
      ...one,
      stats: [...one.stats, { label: 'Evasion', value: 'evasion', max: null, style: 'number' }],
    }
    rerender(withParty(<PartySettings config={two} onChange={onChange} />))
    const first = screen.getAllByRole('listitem')[0]
    // Only number fields can be how many boxes, and not the stat itself.
    const style = within(first).getByLabelText('Show as')
    expect(within(style).queryByRole('option', { name: /HP marked/ })).not.toBeInTheDocument()
    fireEvent.change(style, { target: { value: 'pips:hp_max' } })
    expect(onChange.mock.lastCall![0].stats[0]).toMatchObject({ style: 'pips', max: 'hp_max' })
    fireEvent.change(within(first).getByLabelText('Label'), { target: { value: 'Hit Points' } })
    expect(onChange.mock.lastCall![0].stats[0].label).toBe('Hit Points')
    fireEvent.click(screen.getByRole('button', { name: 'Move HP marked down' }))
    expect(onChange.mock.lastCall![0].stats.map((s: { value: string }) => s.value)).toEqual([
      'evasion',
      'hp_marked',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Move Evasion up' }))
    expect(onChange.mock.lastCall![0].stats[0].value).toBe('evasion')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Evasion' }))
    expect(onChange.mock.lastCall![0].stats).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Show retired and dead characters too'))
    expect(onChange.mock.lastCall![0].include_inactive).toBe(true)
  })

  it('explains when no sheet has stats yet', () => {
    render(
      withParty(<PartySettings config={{}} onChange={vi.fn()} />, { characters: [], fields: [] })
    )
    expect(screen.getByText(/None of this campaign's characters/)).toBeInTheDocument()
  })
})
