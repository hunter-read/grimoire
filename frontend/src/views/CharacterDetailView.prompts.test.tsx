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
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ characterId: 'c1' }) }
})

const ELF = { name: 'Elf', lineages: ['Drow', 'High Elf', 'Wood Elf'] }

function StubSheet({
  onChange,
}: {
  onChange: (field: string, value: unknown, pick?: { entry: unknown }) => void
}) {
  const open = useContext(PromptLauncher)
  return (
    <div>
      <button onClick={() => onChange('species', { _ref: 'elf' }, { entry: ELF })}>pick elf</button>
      <button onClick={() => open?.({ prompt: 'feat_up' })}>gain a feat</button>
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
  },
  prompts: {
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
  },
}

let stored: Record<string, unknown>
beforeEach(() => {
  vi.clearAllMocks()
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

const renderView = async () => {
  render(
    <MemoryRouter>
      <CharacterDetailView />
    </MemoryRouter>
  )
  await screen.findByText('pick elf')
}

const lastSaved = () => mockUpdate.mock.calls.at(-1)![1]

describe('CharacterDetailView — prompts', () => {
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
})
