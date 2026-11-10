import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { GmScreenContext, type GmScreenContextValue } from '../gmScreenContext'
import type { Panel, PartyOverview } from '../types'
import ClocksPanel from './ClocksPanel'
import CounterPanel from './CounterPanel'
import InitiativePanel from './InitiativePanel'
import NotePanel from './NotePanel'
import PartyPanel from './PartyPanel'
import PoolsPanel from './PoolsPanel'
import ScratchPanel from './ScratchPanel'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../../api', () => ({
  campaigns: { getWikiPage: vi.fn(), wikiTitles: vi.fn() },
  characters: { portraitUrl: (id: string) => `/portrait/${id}` },
}))
vi.mock('../../campaigns/WikiMarkdown', () => ({
  default: ({
    body,
    onOpenPage,
  }: {
    body: string
    onOpenPage: (page: { id: string; title: string } | null) => void
  }) => (
    <div data-testid="markdown">
      {body}
      <button type="button" onClick={() => onOpenPage({ id: 'p2', title: 'Other' })}>
        follow link
      </button>
    </div>
  ),
}))

import { campaigns } from '../../../api'
const mockCampaigns = campaigns as unknown as Record<'getWikiPage' | 'wikiTitles', Mock>

const panel = (kind: string, config = {}, state = {}, title = ''): Panel => ({
  id: 'p1',
  kind,
  title,
  x: 0,
  y: 0,
  w: 4,
  h: 4,
  config,
  state,
})

const party: PartyOverview = {
  characters: [
    {
      id: 'c1',
      name: 'Rook',
      user_id: 'u1',
      owner_name: 'Ana',
      status: 'active',
      editable: true,
      schema_ref: 'demo',
      schema_name: 'Demo',
      portrait_path: 'rook.png',
      portrait_version: 1,
      portrait_crop: null,
      values: { hp_marked: 2, hp_max: 6, evasion: 11, hope: 3 },
    },
    {
      id: 'c2',
      name: 'Mire',
      user_id: 'u2',
      owner_name: 'Ben',
      status: 'active',
      editable: false,
      schema_ref: 'demo',
      schema_name: 'Demo',
      values: { hp_marked: 1, hp_max: 5, evasion: 9 },
    },
    {
      id: 'c3',
      name: 'Old Hand',
      user_id: 'u2',
      owner_name: 'Ben',
      status: 'retired',
      editable: false,
      schema_ref: 'demo',
      schema_name: 'Demo',
      values: {},
    },
  ],
  fields: [
    { name: 'hp_marked', label: 'HP marked', type: 'number', source: 'field' },
    { name: 'hp_max', label: 'HP', type: 'number', source: 'field' },
    { name: 'hope', label: 'Hope', type: 'number', source: 'field' },
    { name: 'evasion', label: 'Evasion', type: 'number', source: 'computed' },
  ],
}

function renderWith(node: ReactNode, value: Partial<GmScreenContextValue> = {}) {
  const context: GmScreenContextValue = {
    campaignId: 'camp',
    party,
    setCharacterValue: vi.fn(),
    ...value,
  }
  return {
    context,
    ...render(
      <MemoryRouter>
        <GmScreenContext.Provider value={context}>{node}</GmScreenContext.Provider>
      </MemoryRouter>
    ),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCampaigns.wikiTitles.mockResolvedValue([])
})

describe('CounterPanel', () => {
  it('steps a number within its range', () => {
    const onState = vi.fn()
    render(
      <CounterPanel
        panel={panel('counter', { min: 0, max: 12 }, { value: 12 }, 'Fear')}
        onState={onState}
      />
    )
    expect(screen.getByLabelText('Fear')).toHaveTextContent('12')
    expect(screen.getByRole('button', { name: 'Increase Fear' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Fear' }))
    expect(onState).toHaveBeenCalledWith({ value: 11 })
    expect(screen.getByText('0 to 12')).toBeInTheDocument()
  })

  it('draws boxes when asked to, offset from its lowest value', () => {
    const onState = vi.fn()
    render(
      <CounterPanel
        panel={panel('counter', { min: 1, max: 5, style: 'pips' }, { value: 3 }, 'Doom')}
        onState={onState}
      />
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getByText('3 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Doom 4' }))
    expect(onState).toHaveBeenCalledWith({ value: 5 })
  })

  it('starts at its starting value with no state yet', () => {
    render(<CounterPanel panel={panel('counter', { start: 2 })} onState={vi.fn()} />)
    expect(screen.getByLabelText('Counter')).toHaveTextContent('2')
  })
})

describe('ClocksPanel', () => {
  const clock = {
    id: 'k1',
    name: 'Ritual',
    size: 4,
    ticks: 1,
    note: '',
    resets: '',
    loops: false,
  }

  it('adds, ticks and removes a countdown', () => {
    const onState = vi.fn()
    const { rerender } = render(<ClocksPanel panel={panel('clocks')} onState={onState} />)
    expect(screen.getByText('No countdowns yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name a new one'), { target: { value: 'Collapse' } })
    fireEvent.change(screen.getByLabelText('Boxes'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add countdown' }))
    expect(onState.mock.calls[0][0].items[0]).toMatchObject({ name: 'Collapse', size: 6, ticks: 0 })

    rerender(<ClocksPanel panel={panel('clocks', {}, { items: [clock] })} onState={onState} />)
    expect(screen.getByText('3 left')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ritual 3' }))
    expect(onState).toHaveBeenLastCalledWith({ items: [{ ...clock, ticks: 3 }] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ritual' }))
    expect(onState).toHaveBeenLastCalledWith({ items: [] })
  })

  it('shows a full clock as triggered and lets a looping one start again', () => {
    const onState = vi.fn()
    render(
      <ClocksPanel
        panel={panel('clocks', { mode: 'clock' }, { items: [{ ...clock, ticks: 4, loops: true }] })}
        onState={onState}
      />
    )
    expect(screen.getByText('Triggered')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start Ritual again' }))
    expect(onState.mock.calls[0][0].items[0].ticks).toBe(0)
  })

  it('counts filled boxes in clock mode and edits options', () => {
    const onState = vi.fn()
    render(
      <ClocksPanel
        panel={panel('clocks', { mode: 'clock' }, { items: [clock] })}
        onState={onState}
      />
    )
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add clock' })).toBeInTheDocument()
    const row = screen.getByRole('listitem')
    fireEvent.change(within(row).getByLabelText('Clears'), { target: { value: 'rest' } })
    expect(onState.mock.calls[0][0].items[0].resets).toBe('rest')
    fireEvent.click(within(row).getByLabelText('Starts again when it triggers'))
    expect(onState.mock.calls[1][0].items[0].loops).toBe(true)
    fireEvent.change(within(row).getByLabelText('Boxes'), { target: { value: '99' } })
    expect(onState.mock.calls[2][0].items[0].size).toBe(30)
    const note = within(row).getByLabelText('What happens when it triggers')
    fireEvent.change(note, { target: { value: 'The roof falls' } })
    fireEvent.blur(note)
    expect(onState.mock.calls[3][0].items[0].note).toBe('The roof falls')
    const name = within(row).getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Rite' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(onState.mock.calls[4][0].items[0].name).toBe('Rite')
  })
})

describe('PoolsPanel', () => {
  it('adds a pool, steps its tokens and removes it', () => {
    const onState = vi.fn()
    const pool = { id: 'a', name: 'Swarm', tokens: 0, note: '' }
    const { rerender } = render(<PoolsPanel panel={panel('pools')} onState={onState} />)
    expect(screen.getByText('No pools yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name a new pool'), { target: { value: 'Swarm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pool' }))
    expect(onState.mock.calls[0][0].items[0]).toMatchObject({ name: 'Swarm', tokens: 0 })

    rerender(<PoolsPanel panel={panel('pools', {}, { items: [pool] })} onState={onState} />)
    expect(screen.getByRole('button', { name: 'Decrease Swarm' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Increase Swarm' }))
    expect(onState).toHaveBeenLastCalledWith({ items: [{ ...pool, tokens: 1 }] })
    const note = screen.getByLabelText('What the tokens do')
    fireEvent.change(note, { target: { value: 'Spend 2 to swarm' } })
    fireEvent.blur(note)
    expect(onState.mock.lastCall![0].items[0].note).toBe('Spend 2 to swarm')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Swarm' }))
    expect(onState).toHaveBeenLastCalledWith({ items: [] })
  })

  it('puts a name back when editing is abandoned', () => {
    const onState = vi.fn()
    render(
      <PoolsPanel
        panel={panel('pools', {}, { items: [{ id: 'a', name: 'Swarm', tokens: 0, note: '' }] })}
        onState={onState}
      />
    )
    const name = screen.getByLabelText('Pool name')
    fireEvent.change(name, { target: { value: 'Other' } })
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(name).toHaveValue('Swarm')
    fireEvent.blur(name)
    expect(onState).not.toHaveBeenCalled()
  })
})

describe('ScratchPanel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves a moment after typing stops, and on leaving the box', () => {
    const onState = vi.fn()
    render(<ScratchPanel panel={panel('scratch', {}, { text: 'old' })} onState={onState} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'new name: Vex' } })
    expect(onState).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(onState).toHaveBeenCalledWith({ text: 'new name: Vex' })
    fireEvent.change(box, { target: { value: 'again' } })
    fireEvent.blur(box)
    expect(onState).toHaveBeenLastCalledWith({ text: 'again' })
    expect(onState).toHaveBeenCalledTimes(2)
  })

  it('follows a change from elsewhere', () => {
    const { rerender } = render(
      <ScratchPanel panel={panel('scratch', {}, { text: 'a' })} onState={vi.fn()} />
    )
    rerender(<ScratchPanel panel={panel('scratch', {}, { text: 'b' })} onState={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('b')
  })
})

describe('InitiativePanel', () => {
  const entry = (id: string, extra = {}) => ({
    id,
    name: id,
    score: null,
    side: 'heroes',
    acted: false,
    note: '',
    character_id: null,
    ...extra,
  })

  it('adds foes and the party, then walks the turns', () => {
    const onState = vi.fn()
    const { rerender } = renderWith(
      <InitiativePanel panel={panel('initiative')} onState={onState} />
    )
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByText('No one is in the turn order yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ogre' } })
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onState.mock.calls[0][0].entries[0]).toMatchObject({ name: 'Ogre', score: 14 })

    // Only the active characters are offered.
    fireEvent.click(screen.getByRole('button', { name: 'Add the party (2)' }))
    const added = onState.mock.calls[1][0].entries
    expect(added.map((e: { name: string }) => e.name)).toEqual(['Rook', 'Mire'])

    const state = {
      round: 1,
      turn: 0,
      side: 'heroes',
      first: 'heroes',
      entries: [entry('a', { score: 3 }), entry('b', { score: 18 })],
    }
    rerender(
      <MemoryRouter>
        <GmScreenContext.Provider value={{ campaignId: 'camp', party, setCharacterValue: vi.fn() }}>
          <InitiativePanel panel={panel('initiative', {}, state)} onState={onState} />
        </GmScreenContext.Provider>
      </MemoryRouter>
    )
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: /Next turn/ }))
    expect(onState.mock.lastCall![0].turn).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(onState.mock.lastCall![0]).toMatchObject({ turn: 0, round: 1 })
    fireEvent.click(screen.getByRole('button', { name: /Sort by score/ }))
    expect(onState.mock.lastCall![0].entries.map((e: { id: string }) => e.id)).toEqual(['b', 'a'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }))
    expect(onState.mock.lastCall![0].entries).toHaveLength(1)
  })

  it('has the sides take turns and clears the marks at the next round', () => {
    const onState = vi.fn()
    const config = {
      mode: 'sides',
      sides: [
        { key: 'heroes', label: 'Heroes' },
        { key: 'director', label: 'Director' },
      ],
    }
    const state = {
      round: 2,
      turn: 0,
      side: 'heroes',
      first: 'heroes',
      entries: [entry('Rook'), entry('Goblin', { side: 'director' })],
    }
    renderWith(<InitiativePanel panel={panel('initiative', config, state)} onState={onState} />)
    expect(screen.getByRole('status')).toHaveTextContent('Heroes to act')
    fireEvent.click(screen.getByRole('button', { name: 'Rook has acted' }))
    expect(onState.mock.lastCall![0]).toMatchObject({ side: 'director' })
    fireEvent.click(screen.getByRole('button', { name: 'Goes first' }))
    expect(onState.mock.lastCall![0]).toMatchObject({ first: 'director', side: 'director' })
    fireEvent.click(screen.getByRole('button', { name: /Next round/ }))
    expect(onState.mock.lastCall![0]).toMatchObject({ round: 3 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Goblin' }))
    expect(onState.mock.lastCall![0].entries).toHaveLength(1)

    // A foe added here joins the side chosen for it.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wolf' } })
    fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'director' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onState.mock.lastCall![0].entries.at(-1)).toMatchObject({
      name: 'Wolf',
      side: 'director',
    })
  })

  it('says when the whole round has acted', () => {
    const state = {
      round: 1,
      turn: 0,
      side: 'heroes',
      first: 'heroes',
      entries: [entry('Rook', { acted: true })],
    }
    renderWith(
      <InitiativePanel panel={panel('initiative', { mode: 'sides' }, state)} onState={vi.fn()} />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Everyone has acted this round.')
  })
})

describe('PartyPanel', () => {
  const stats = [
    { label: 'HP', value: 'hp_marked', max: 'hp_max', style: 'pips' },
    { label: 'Hope', value: 'hope', max: 6, style: 'number' },
    { label: 'Evasion', value: 'evasion', max: null, style: 'number' },
  ]

  it('shows each active character with the chosen stats, editable where allowed', () => {
    const setCharacterValue = vi.fn()
    renderWith(<PartyPanel panel={panel('party', { stats })} onState={vi.fn()} />, {
      setCharacterValue,
    })
    expect(screen.getByRole('link', { name: 'Rook' })).toHaveAttribute('href', '/characters/c1')
    expect(screen.queryByText('Old Hand')).not.toBeInTheDocument()

    // Rook's player lets the GM edit: the boxes tick, and Hope steps.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rook: HP 3' }))
    expect(setCharacterValue).toHaveBeenCalledWith('c1', 'hp_marked', 3)
    fireEvent.click(screen.getByRole('button', { name: 'Increase Rook: Hope' }))
    expect(setCharacterValue).toHaveBeenCalledWith('c1', 'hope', 4)
    // A computed value only reads.
    expect(screen.queryByRole('button', { name: 'Increase Rook: Evasion' })).not.toBeInTheDocument()
    // Mire's sheet is not the GM's to edit.
    expect(screen.getByRole('checkbox', { name: 'Mire: HP 1' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Increase Mire: Hope' })).not.toBeInTheDocument()
  })

  it('shows retired characters when asked, and a hint with no stats chosen', () => {
    renderWith(<PartyPanel panel={panel('party', { include_inactive: true })} onState={vi.fn()} />)
    expect(screen.getByText('Old Hand')).toBeInTheDocument()
    expect(screen.getByText(/Choose which stats to show/)).toBeInTheDocument()
  })

  it('says when the campaign has no characters', () => {
    renderWith(<PartyPanel panel={panel('party')} onState={vi.fn()} />, {
      party: { characters: [], fields: [] },
    })
    expect(screen.getByText('No characters are in this campaign yet.')).toBeInTheDocument()
  })
})

describe('NotePanel', () => {
  it('asks for a note when none is pinned', () => {
    renderWith(<NotePanel panel={panel('note')} onState={vi.fn()} />)
    expect(screen.getByText(/Choose a note to pin/)).toBeInTheDocument()
  })

  it('shows the pinned note and follows its links into the notes', async () => {
    mockCampaigns.getWikiPage.mockResolvedValue({
      id: 'p1',
      title: 'Session Zero',
      body: 'Lines and veils',
    })
    renderWith(<NotePanel panel={panel('note', { page_id: 'p1' })} onState={vi.fn()} />)
    expect(await screen.findByText(/Lines and veils/)).toBeInTheDocument()
    expect(mockCampaigns.getWikiPage).toHaveBeenCalledWith('camp', 'p1')
    expect(screen.getByRole('link', { name: /Open Session Zero/ })).toHaveAttribute(
      'href',
      '/campaigns/camp/notes?note=p1'
    )
    fireEvent.click(screen.getByRole('button', { name: 'follow link' }))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns/camp/notes?note=p2')
  })

  it('says so when the note is gone', async () => {
    mockCampaigns.getWikiPage.mockRejectedValue(new Error('404'))
    renderWith(<NotePanel panel={panel('note', { page_id: 'gone' })} onState={vi.fn()} />)
    expect(await screen.findByText(/The pinned note is gone/)).toBeInTheDocument()
  })
})
