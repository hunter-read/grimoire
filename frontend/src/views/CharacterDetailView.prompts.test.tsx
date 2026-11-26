// The detail view's side of prompts: opened by a pick or by the sheet, put
// off and opened again, and confirmed into a save - a pick a prompt makes
// followed up like one by hand. The sheet is stubbed; the planner and the
// dialog have their own tests.
import { useContext } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CharacterDetailView from './CharacterDetailView'
import { PromptLauncher } from '../components/characters/sheetPrompts'

const mockGet = vi.fn()
const mockGetSchema = vi.fn()
const mockUpdate = vi.fn()
const mockResolve = vi.fn()
const mockBrowse = vi.fn()
// The character the route names; a test may move to another.
const route = vi.hoisted(() => ({ id: 'c1' }))

vi.mock('../api', () => ({
  campaigns: { list: () => Promise.resolve([]) },
  characters: {
    get: (...a: unknown[]) => mockGet(...a),
    getSchema: (...a: unknown[]) => mockGetSchema(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    portraitUrl: (id: string) => `/api/characters/${id}/portrait`,
  },
  content: {
    resolve: (...a: unknown[]) => mockResolve(...a),
    browse: (...a: unknown[]) => mockBrowse(...a),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ characterId: route.id }) }
})

const ELF = { name: 'Elf', lineages: ['Drow', 'High Elf', 'Wood Elf'] }

function StubSheet({
  onChange,
}: {
  onChange: (field: string, value: unknown, meta?: { entry?: unknown; written?: boolean }) => void
}) {
  const open = useContext(PromptLauncher)
  return (
    <div>
      <button onClick={() => onChange('species', { _ref: 'elf' }, { entry: ELF })}>pick elf</button>
      <button onClick={() => open?.({ prompt: 'feat_up' })}>gain a feat</button>
      <button onClick={() => open?.({ prompt: 'level_gain' })}>gain a level</button>
      <button onClick={() => open?.({ prompt: 'bonus_feat' })}>gain a bonus feat</button>
      <button onClick={() => open?.({ prompt: 'origin_up' })}>take an origin</button>
      <button onClick={() => open?.({ prompt: 'swap_feat' })}>swap a feat</button>
      <button onClick={() => onChange('features', [{ _inline: true, name: 'Hand' }])}>
        add a feature by hand
      </button>
      <button onClick={() => onChange('focused', true)}>focus</button>
      <button onClick={() => onChange('hp', 0)}>drop to 0</button>
      <button onClick={() => onChange('focused', true, { written: true })}>action focus</button>
      <input aria-label="Gold" onChange={(e) => onChange('gold', Number(e.target.value))} />
      <input aria-label="Hit points" onChange={(e) => onChange('hp', Number(e.target.value))} />
    </div>
  )
}

vi.mock('../components/characters/CharacterSheet', () => ({ default: StubSheet }))

const DOCUMENT = {
  id: 'demo',
  fields: {
    species: {
      type: 'content_ref',
      content_type: 'species',
      label: 'Species',
      on_pick: [{ prompt: 'lineage' }],
    },
    lineage: { type: 'select', options: ['Drow', 'High Elf', 'Wood Elf'] },
    feats: {
      type: 'content_list',
      content_type: 'feat',
      per_entry_fields: { from_level: { type: 'number' } },
    },
    origin_feat: {
      type: 'content_ref',
      content_type: 'feat',
      on_pick: [{ grant: 'skills', from: 'skills' }],
    },
    skills: { type: 'multiselect', options: ['Perception', 'Stealth'] },
    level: { type: 'number', default: 4 },
    features: { type: 'content_list', content_type: 'feature' },
    focused: {
      type: 'checkbox',
      on_change: [{ set: 'focus_on', to: "focused ? focus_on : ''" }, { prompt: 'focus' }],
    },
    focus_on: { type: 'text' },
    gold: { type: 'number', on_change: [{ prompt: 'spend' }] },
    hp: {
      type: 'number',
      on_change: [{ set: 'focused', to: 'hp > 0 and focused' }],
    },
  },
  prompts: {
    spend: {
      label: 'Spend',
      steps: [{ key: 'on', type: 'select', options: ['Rope', 'Torch'] }],
      apply: [],
    },
    focus: {
      label: 'Focus',
      steps: [{ key: 'what', type: 'select', options: ['Bless', 'Hex'], visible_if: 'focused' }],
      apply: [{ set: 'focus_on', to: 'answer.what' }],
      on_skip: [{ set: 'focused', to: 'false' }],
    },
    lineage: {
      label: 'Lineage',
      steps: [{ key: 'pick', type: 'select', options: 'row.lineages' }],
      apply: [{ set: 'lineage', to: 'answer.pick' }],
    },
    feat_up: {
      label: 'New feat',
      steps: [{ key: 'feat', type: 'entry', content_type: 'feat' }],
      apply: [
        { pick: 'feats', entry: 'answer.feat', values: { from_level: 'level' } },
        { pick: 'origin_feat', entry: 'answer.feat' },
      ],
    },
    level_gain: {
      label: 'Level gained',
      steps: [{ key: 'sure', type: 'select', options: ['yes'] }],
      apply: [
        {
          grant: 'features',
          from: "'action-surge, tactical-mind'",
          names: "'Action Surge, Tactical Mind'",
          source: 'origin_feat',
        },
      ],
    },
    bonus_feat: {
      label: 'Bonus feat',
      steps: [{ key: 'feat', type: 'entry', content_type: 'feat' }],
      apply: [
        { grant: 'feats', from: "'bonus'", names: "'Bonus Feat'" },
        { pick: 'feats', entry: 'answer.feat' },
      ],
    },
    origin_up: {
      label: 'Origin',
      steps: [{ key: 'feat', type: 'entry', content_type: 'feat' }],
      apply: [
        { pick: 'origin_feat', entry: 'answer.feat' },
        { grant: 'features', from: "'x'", names: "'X'", source: 'origin_feat' },
      ],
    },
    swap_feat: {
      label: 'Swap a feat',
      steps: [{ key: 'feat', type: 'entry', content_type: 'feat' }],
      apply: [
        { unpick: 'feats', entry: 'answer.feat' },
        { grant: 'feats', from: "'lucky'", names: "'Lucky'" },
      ],
    },
  },
}

let stored: Record<string, unknown>
beforeEach(() => {
  vi.clearAllMocks()
  route.id = 'c1'
  stored = {}
  mockGet.mockImplementation(async () => ({
    id: 'c1',
    name: 'Vex',
    schema_ref: 'demo',
    data: stored,
  }))
  mockGetSchema.mockResolvedValue({ document: DOCUMENT })
  mockResolve.mockImplementation(async (schema, ids) => ({
    entries: Object.fromEntries(
      ids.map((id: string) => [id, { entry_id: id, name: 'Elf', data: ELF, missing: false }])
    ),
  }))
  mockBrowse.mockResolvedValue({
    entries: [
      { entry_id: 'alert', source: 'xphb', name: 'Alert', data: { skills: ['Perception'] } },
    ],
    total: 1,
  })
  mockUpdate.mockImplementation(async (id, body) => {
    stored = { ...stored, ...(body.data || {}) }
    return { id: 'c1', name: 'Vex', schema_ref: 'demo', data: stored }
  })
})

const view = () => (
  <MemoryRouter>
    <CharacterDetailView />
  </MemoryRouter>
)
const renderView = async () => {
  const result = render(view())
  await screen.findByText('pick elf')
  return result
}

// The start prompt, had it opened, would be first in the queue: another
// prompt showing proves the effect ran and left it shut.
const expectNoStartPrompt = async () => {
  await userEvent.click(screen.getByText('gain a feat'))
  expect(await screen.findByRole('dialog', { name: 'New feat' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Level gained' })).not.toBeInTheDocument()
}

const START = { ...DOCUMENT, start_prompt: { prompt: 'level_gain', when: 'len(feats) == 0' } }

const lastSaved = () => mockUpdate.mock.calls.at(-1)![1]

describe('CharacterDetailView — prompts', () => {
  it("opens the sheet's start prompt by itself while its condition holds", async () => {
    mockGetSchema.mockResolvedValue({
      document: { ...DOCUMENT, start_prompt: { prompt: 'level_gain', when: 'len(feats) == 0' } },
    })
    await renderView()
    expect(await screen.findByRole('dialog', { name: 'Level gained' })).toBeInTheDocument()
  })

  it('leaves the start prompt shut once its condition fails', async () => {
    mockGetSchema.mockResolvedValue({ document: START })
    stored = { feats: [{ _ref: 'alert' }] }
    await renderView()
    await expectNoStartPrompt()
  })

  it('leaves the start prompt shut for a GM let into the sheet', async () => {
    mockGetSchema.mockResolvedValue({ document: START })
    mockGet.mockImplementation(async () => ({
      id: 'c1',
      name: 'Vex',
      schema_ref: 'demo',
      data: stored,
      owned: false,
      editable: true,
    }))
    await renderView()
    await expectNoStartPrompt()
  })

  it("does not open one character's start prompt on the next one's data", async () => {
    mockGetSchema.mockResolvedValue({ document: START })
    stored = { feats: [{ _ref: 'alert' }] }
    const first = mockGet.getMockImplementation()!
    mockGet.mockImplementation(async (id: string) =>
      id === 'c2'
        ? { id: 'c2', name: 'Wren', schema_ref: 'gone', schema_missing: true, data: {} }
        : first(id)
    )
    const { rerender } = await renderView()
    route.id = 'c2'
    rerender(view())
    expect(await screen.findByDisplayValue('Wren')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('pick elf')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the prompt a pick names, reading the picked entry', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick elf'))
    expect(await screen.findByRole('dialog', { name: 'Lineage' })).toBeInTheDocument()
    expect(screen.getByText('From Species')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Wood Elf'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data.lineage).toBe('Wood Elf'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps a prompt put off, and opens it again with its entry', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick elf'))
    await userEvent.click(await screen.findByText('Choose later'))
    await waitFor(() =>
      expect(lastSaved().data._pending_prompts).toEqual([
        { prompt: 'lineage', source: 'species', ref: 'elf' },
      ])
    )
    expect(screen.getByText('Choices to make:')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Lineage' }))
    expect(await screen.findByRole('dialog', { name: 'Lineage' })).toBeInTheDocument()
    expect(mockResolve).toHaveBeenCalledWith('demo', ['elf'])
    await userEvent.click(screen.getByLabelText('Drow'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data._pending_prompts).toEqual([]))
    expect(lastSaved().data.lineage).toBe('Drow')
    expect(screen.queryByText('Choices to make:')).not.toBeInTheDocument()
  })

  it('lets a prompt put off be dismissed', async () => {
    await renderView()
    await userEvent.click(screen.getByText('pick elf'))
    await userEvent.click(await screen.findByText('Choose later'))
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Lineage' }))
    await waitFor(() => expect(lastSaved().data._pending_prompts).toEqual([]))
  })

  it('lets go of a prompt a button opened when it is put off', async () => {
    await renderView()
    await userEvent.click(screen.getByText('gain a feat'))
    await userEvent.click(await screen.findByText('Choose later'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Choices to make:')).not.toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('makes the picks a prompt answers, following each up as a pick by hand', async () => {
    await renderView()
    await userEvent.click(screen.getByText('gain a feat'))
    await userEvent.click(await screen.findByLabelText('Alert'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data.skills).toEqual(['Perception']))
    const saved = lastSaved().data
    expect(saved.feats).toEqual([{ _ref: 'alert', _source: 'xphb', _per: { from_level: 4 } }])
    expect(saved.origin_feat).toEqual({ _ref: 'alert', _source: 'xphb' })
    expect(saved._granted.origin_feat.skills).toEqual(['Perception'])
    expect(mockBrowse).toHaveBeenCalledWith('demo', 'feat', {
      filters: {},
      page: 1,
      page_size: 200,
    })
  })

  it('grants what a prompt names, as references the catalog has, under the source given', async () => {
    mockResolve.mockImplementation(async () => ({
      entries: {
        'action-surge': { entry_id: 'action-surge', content_type: 'feature', source: 'xphb' },
      },
    }))
    await renderView()
    await userEvent.click(screen.getByText('gain a level'))
    await userEvent.click(await screen.findByLabelText('yes'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data.features).toHaveLength(2))
    const saved = lastSaved().data
    expect(saved.features).toEqual([
      { _ref: 'action-surge', _source: 'xphb' },
      { _inline: true, name: 'Tactical Mind' },
    ])
    expect(saved._granted).toEqual({
      origin_feat: { features: ['action-surge', 'Tactical Mind'] },
    })
    expect(mockResolve).toHaveBeenCalledWith('demo', ['action-surge', 'tactical-mind'])
  })

  it('keeps a grant into the list the same prompt picks into', async () => {
    await renderView()
    await userEvent.click(screen.getByText('gain a bonus feat'))
    await userEvent.click(await screen.findByLabelText('Alert'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data.feats).toHaveLength(2))
    expect(lastSaved().data.feats).toEqual([
      { _ref: 'alert', _source: 'xphb' },
      { _inline: true, name: 'Bonus Feat' },
    ])
  })

  it('keeps a grant recorded under the field the same prompt picks', async () => {
    await renderView()
    await userEvent.click(screen.getByText('take an origin'))
    await userEvent.click(await screen.findByLabelText('Alert'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data.features).toHaveLength(1))
    const saved = lastSaved().data
    expect(saved.origin_feat).toEqual({ _ref: 'alert', _source: 'xphb' })
    expect(saved.features).toEqual([{ _inline: true, name: 'X' }])
    expect(saved._granted.origin_feat).toEqual({ skills: ['Perception'], features: ['X'] })
  })

  it('keeps a change made while a grant waits on the catalog', async () => {
    let answer: (value: unknown) => void = () => {}
    mockResolve.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    await renderView()
    await userEvent.click(screen.getByText('gain a level'))
    await userEvent.click(await screen.findByLabelText('yes'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockResolve).toHaveBeenCalled())
    await userEvent.click(screen.getByText('add a feature by hand'))
    answer({ entries: {} })
    await waitFor(() => expect(lastSaved().data.features).toHaveLength(3))
    expect(lastSaved().data.features).toEqual([
      { _inline: true, name: 'Hand' },
      { _inline: true, name: 'Action Surge' },
      { _inline: true, name: 'Tactical Mind' },
    ])
  })

  describe('unpick', () => {
    const swapTough = async () => {
      mockBrowse.mockResolvedValue({
        entries: [{ entry_id: 'tough', source: 'xphb', name: 'Tough', data: {} }],
        total: 1,
      })
      await renderView()
      await userEvent.click(screen.getByText('swap a feat'))
      await userEvent.click(await screen.findByLabelText('Tough'))
      await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      await waitFor(() =>
        expect(lastSaved().data.feats).toEqual([{ _inline: true, name: 'Lucky' }])
      )
      return lastSaved().data
    }

    it('takes the row out and keeps a grant into the same list', async () => {
      stored = { feats: [{ _ref: 'tough', _source: 'xphb' }] }
      await swapTough()
    })

    it('drops the row from the records of an earlier pick', async () => {
      stored = {
        feats: [{ _ref: 'tough', _source: 'xphb' }],
        _granted: { origin_feat: { feats: ['tough'], skills: ['Perception'] } },
      }
      const saved = await swapTough()
      expect(saved._granted).toEqual({ origin_feat: { feats: [], skills: ['Perception'] } })
    })

    it('finds a freeform row by its name', async () => {
      stored = { feats: [{ _inline: true, name: 'Tough' }] }
      await swapTough()
    })

    it('matches the row and its record in any case', async () => {
      stored = {
        feats: [{ _ref: 'Tough' }],
        _granted: { origin_feat: { feats: ['TOUGH'] } },
      }
      const saved = await swapTough()
      expect(saved._granted).toEqual({ origin_feat: { feats: [] } })
    })
  })

  it("follows a change by hand with the field's on_change: a box ticked opens its prompt", async () => {
    await renderView()
    await userEvent.click(screen.getByText('focus'))
    expect(await screen.findByRole('dialog', { name: 'Focus' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Hex'))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(lastSaved().data.focus_on).toBe('Hex'))
    expect(lastSaved().data.focused).toBe(true)

    // Hit points at 0 untick it; that write opens nothing of its own.
    await userEvent.click(screen.getByText('drop to 0'))
    await waitFor(() => expect(lastSaved().data.focused).toBe(false), { timeout: 2000 })
    expect(screen.queryByRole('dialog', { name: 'Focus' })).not.toBeInTheDocument()
  })

  it("leaves on_change alone for a write the sheet makes, such as an action's", async () => {
    await renderView()
    await userEvent.click(screen.getByText('action focus'))
    await waitFor(() => expect(lastSaved().data).toEqual({ focused: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("runs a typed field's on_change once the typing stops, not once per key", async () => {
    await renderView()
    await userEvent.type(screen.getByLabelText('Gold'), '125')
    expect(await screen.findByRole('dialog', { name: 'Spend' })).toBeInTheDocument()
    await userEvent.click(screen.getByText('Choose later'))
    // Nothing else was queued behind it.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(lastSaved().data.gold).toBe(125))
  })

  it("saves a typed field's on_change writes still waiting when the view goes", async () => {
    stored = { focused: true }
    const { unmount } = render(
      <MemoryRouter>
        <CharacterDetailView />
      </MemoryRouter>
    )
    await screen.findByText('pick elf')
    await userEvent.type(screen.getByLabelText('Hit points'), '0')
    unmount()
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(lastSaved().data).toEqual({ hp: 0, focused: false })
  })

  it("makes a prompt's on_skip writes when it is put aside, rather than keeping it for later", async () => {
    await renderView()
    await userEvent.click(screen.getByText('focus'))
    await userEvent.click(await screen.findByText('Choose later'))
    await waitFor(() => expect(lastSaved().data.focused).toBe(false))
    expect(lastSaved().data._pending_prompts).toBeUndefined()
    expect(screen.queryByText('Choices to make:')).not.toBeInTheDocument()
  })
})
