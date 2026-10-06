// The detail view's side of picks: following up on_pick rules, asking for
// choices, and resetting a derived value. The sheet is stubbed so these test
// the wiring rather than the picker; the planner has its own tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CharacterDetailView from './CharacterDetailView'

const mockGet = vi.fn()
const mockGetSchema = vi.fn()
const mockUpdate = vi.fn()
const mockResolve = vi.fn()

vi.mock('../api', () => ({
  characters: {
    get: (...a) => mockGet(...a),
    getSchema: (...a) => mockGetSchema(...a),
    update: (...a) => mockUpdate(...a),
    portraitUrl: (id) => `/api/characters/${id}/portrait`,
  },
  content: { resolve: (...a) => mockResolve(...a) },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ characterId: 'c1' }) }
})

const ACOLYTE = {
  name: 'Acolyte',
  skill_proficiencies: ['Insight'],
  feat_id: 'magic-initiate',
  feat: 'Magic Initiate (Cleric)',
}
const WIZARD = { name: 'Wizard', skill_choices: 1, skill_options: ['Arcana', 'History'] }

// A stand-in sheet: buttons that make the calls the real one would.
vi.mock('../components/characters/CharacterSheet', () => ({
  default: ({ data, onChange, onReset, onOverride, entries, readOnly }) => (
    <div>
      <span data-testid="read-only">{String(!!readOnly)}</span>
      <button onClick={() => onOverride('armor_class', 19)}>override ac</button>
      <button onClick={() => onOverride('armor_class', undefined)}>reset ac</button>
      <span data-testid="skills">{(data.skills || []).join(',')}</span>
      <span data-testid="entries">{Object.keys(entries).join(',')}</span>
      <button onClick={() => onChange('background', { _ref: 'acolyte' }, { entry: ACOLYTE })}>
        pick acolyte
      </button>
      <button onClick={() => onChange('background', null, { entry: null })}>
        clear background
      </button>
      <button onClick={() => onChange('background', { _ref: 'acolyte' })}>
        pick without entry
      </button>
      <button onClick={() => onChange('klass', { _ref: 'wizard' }, { entry: WIZARD })}>
        pick wizard
      </button>
      <button onClick={() => onChange('speed', 40)}>type speed</button>
      <button onClick={() => onReset('speed')}>reset speed</button>
    </div>
  ),
}))

const DOCUMENT = {
  id: 'demo',
  fields: {
    klass: {
      type: 'content_ref',
      content_type: 'class',
      label: 'Class',
      on_pick: [{ choose: 'skills', count: 'skill_choices', from: 'skill_options' }],
    },
    background: {
      type: 'content_ref',
      content_type: 'background',
      on_pick: [
        { grant: 'skills', from: 'skill_proficiencies' },
        { grant: 'feats', ref: 'feat_id', name: 'feat' },
      ],
    },
    skills: { type: 'multiselect', options: ['Arcana', 'History', 'Insight'] },
    feats: { type: 'content_list', content_type: 'feat' },
    speed: { type: 'number', default: 30, default_from: "ref(species, 'speed')" },
  },
}

let stored
beforeEach(() => {
  vi.clearAllMocks()
  stored = { speed: 35 }
  mockGet.mockResolvedValue({ id: 'c1', name: 'Vex', schema_ref: 'demo', data: stored })
  mockGetSchema.mockResolvedValue({ document: DOCUMENT })
  mockResolve.mockImplementation(async (schema, ids) => ({
    entries: Object.fromEntries(
      ids.map((id) => [
        id,
        id === 'acolyte'
          ? { entry_id: id, name: 'Acolyte', data: ACOLYTE, missing: false }
          : { entry_id: id, content_type: 'feat', source: 'srd', missing: false },
      ])
    ),
  }))
  // The server merges and removes, as the real one does.
  mockUpdate.mockImplementation(async (id, body) => {
    stored = { ...stored, ...(body.data || {}) }
    for (const name of body.unset || []) delete stored[name]
    return { id: 'c1', name: 'Vex', schema_ref: 'demo', data: stored }
  })
})

const renderView = async () => {
  render(
    <MemoryRouter>
      <CharacterDetailView />
    </MemoryRouter>
  )
  await screen.findByText('pick acolyte')
}

const lastSaved = () => mockUpdate.mock.calls.at(-1)[1]

describe('CharacterDetailView — picks', () => {
  it('saves what a pick grants alongside the pick', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick acolyte'))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const body = lastSaved()
    expect(body.data.background).toEqual({ _ref: 'acolyte' })
    expect(body.data.skills).toEqual(['Insight'])
    // In the catalog, so granted as a reference.
    expect(body.data.feats).toEqual([{ _ref: 'magic-initiate', _source: 'srd' }])
    expect(body.data._granted.background.skills).toEqual(['Insight'])
  })

  it('shows the picked entry straight away, before the save returns', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick acolyte'))
    expect(screen.getByTestId('entries')).toHaveTextContent('acolyte')
  })

  it('takes the grants back when the pick is cleared', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick acolyte'))
    await waitFor(() => expect(screen.getByTestId('skills')).toHaveTextContent('Insight'))
    await userEvent.click(screen.getByText('clear background'))
    await waitFor(() => expect(lastSaved().data.skills).toEqual([]))
  })

  it('looks the entry up when the picker did not hand it over', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick without entry'))
    await waitFor(() => expect(lastSaved().data.skills).toEqual(['Insight']))
    expect(mockResolve).toHaveBeenCalledWith('demo', ['acolyte'])
  })

  it('asks for a choice the pick offers, and records the answer', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick wizard'))
    expect(await screen.findByRole('dialog', { name: 'Choose 1' })).toBeInTheDocument()
    expect(screen.getByText('From Class')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Arcana'))
    await userEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(lastSaved().data.skills).toEqual(['Arcana']))
    expect(lastSaved().data._granted.klass.skills).toEqual(['Arcana'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lets a choice be put off', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick wizard'))
    await userEvent.click(await screen.findByText('Choose later'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('CharacterDetailView — resetting a derived value', () => {
  it('asks the server to forget the value', async () => {
    await renderView()
    await userEvent.click(screen.getByText('reset speed'))
    await waitFor(() => expect(lastSaved().unset).toEqual(['speed']))
    expect(stored.speed).toBeUndefined()
  })

  it('a later edit cancels a reset still waiting to be saved', async () => {
    await renderView()
    await userEvent.click(screen.getByText('reset speed'))
    await userEvent.click(screen.getByText('type speed'))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    const body = lastSaved()
    expect(body.data.speed).toBe(40)
    expect(body.unset).toBeUndefined()
  })
})

describe('CharacterDetailView — overrides and read-only', () => {
  it('saves an override of a calculated value as a whole map', async () => {
    await renderView()
    await userEvent.click(screen.getByText('override ac'))
    await waitFor(() => expect(lastSaved().data._overrides).toEqual({ armor_class: 19 }))
  })

  it('removes an override to reset it', async () => {
    stored = { _overrides: { armor_class: 19, initiative: 3 } }
    mockGet.mockResolvedValue({ id: 'c1', name: 'Vex', schema_ref: 'demo', data: stored })
    await renderView()
    await userEvent.click(screen.getByText('reset ac'))
    await waitFor(() => expect(lastSaved().data._overrides).toEqual({ initiative: 3 }))
  })

  it("draws a party member's sheet read-only", async () => {
    mockGet.mockResolvedValue({ id: 'c1', name: 'Vex', schema_ref: 'demo', data: {}, owned: false })
    await renderView()
    expect(screen.getByTestId('read-only')).toHaveTextContent('true')
  })

  it('opens every value in one place', async () => {
    await renderView()
    await userEvent.click(screen.getByLabelText('All values'))
    expect(screen.getByRole('dialog', { name: 'All values' })).toBeInTheDocument()
  })
})
