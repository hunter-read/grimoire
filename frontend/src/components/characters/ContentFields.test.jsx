import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContentRefField from './ContentRefField'
import ContentListField from './ContentListField'

const mockBrowse = vi.fn()
vi.mock('../../api', () => ({
  content: { browse: (...args) => mockBrowse(...args) },
}))

const TYPE = {
  label: 'Spell',
  compact_display: '{school} {level}',
  fields: { name: { type: 'text' }, level: { type: 'number' }, school: { type: 'text' } },
}

const ENTRIES = {
  fireball: { name: 'Fireball', level: 3, school: 'evocation' },
  shield: { name: 'Shield', level: 1, school: 'abjuration' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowse.mockResolvedValue({
    entries: [
      {
        entry_id: 'fireball',
        source: 'srd',
        name: 'Fireball',
        data: ENTRIES.fireball,
        display: 'evocation 3',
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
    filters_available: {},
  })
})

describe('ContentRefField', () => {
  const renderRef = (props = {}) =>
    render(
      <ContentRefField
        name="signature"
        definition={{ type: 'content_ref', label: 'Signature', content_type: 'spell' }}
        entries={ENTRIES}
        schemaId="demo"
        typeDefinition={TYPE}
        {...props}
      />
    )

  it('shows the resolved entry name, not the raw id', () => {
    renderRef({ value: { _ref: 'fireball', _source: 'srd' } })
    expect(screen.getByText('Fireball')).toBeInTheDocument()
  })

  it('shows a dash when nothing is chosen', () => {
    renderRef({ value: null })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('still shows the id when the entry is not installed', () => {
    // Hiding it would look like data loss; the id is what the player picked.
    renderRef({ value: { _ref: 'not-installed' } })
    expect(screen.getByText('not-installed')).toBeInTheDocument()
    expect(screen.getByText(/not installed/i)).toBeInTheDocument()
  })

  it('stores a reference when one is picked', async () => {
    const onChange = vi.fn()
    renderRef({ value: null, onChange })
    await userEvent.click(screen.getByLabelText(/Browse catalog/i))
    await userEvent.click(await screen.findByLabelText(/Add to sheet/i))
    expect(onChange).toHaveBeenCalledWith({ _ref: 'fireball', _source: 'srd' })
  })

  it('clears a choice', async () => {
    const onChange = vi.fn()
    renderRef({ value: { _ref: 'fireball' }, onChange })
    await userEvent.click(screen.getByLabelText(/Clear/i))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('offers no controls when read-only', () => {
    renderRef({ value: { _ref: 'fireball' }, readOnly: true })
    expect(screen.queryByLabelText(/Browse catalog/i)).not.toBeInTheDocument()
  })
})

describe('ContentListField', () => {
  const DEFINITION = {
    type: 'content_list',
    label: 'Spells',
    content_type: 'spell',
    allow_freeform: true,
    per_entry_fields: { prepared: { type: 'checkbox', label: 'Prep' } },
  }

  const renderList = (props = {}) =>
    render(
      <ContentListField
        name="spells"
        definition={DEFINITION}
        entries={ENTRIES}
        schemaId="demo"
        typeDefinition={TYPE}
        value={[]}
        {...props}
      />
    )

  it('lists referenced entries by their resolved name', () => {
    renderList({ value: [{ _ref: 'fireball' }, { _ref: 'shield' }] })
    expect(screen.getByText('Fireball')).toBeInTheDocument()
    expect(screen.getByText('Shield')).toBeInTheDocument()
  })

  it('shows the compact summary beneath each row', () => {
    renderList({ value: [{ _ref: 'fireball' }] })
    expect(screen.getByText('evocation 3')).toBeInTheDocument()
  })

  it('renders per-entry fields the character owns', async () => {
    const onChange = vi.fn()
    renderList({ value: [{ _ref: 'fireball' }], onChange })
    await userEvent.click(screen.getByLabelText('Prep'))
    expect(onChange).toHaveBeenCalledWith([{ _ref: 'fireball', _per: { prepared: true } }])
  })

  it('adds a reference from the browser', async () => {
    const onChange = vi.fn()
    renderList({ value: [], onChange })
    await userEvent.click(screen.getByText(/Browse catalog/i))
    await userEvent.click(await screen.findByLabelText(/Add to sheet/i))
    expect(onChange).toHaveBeenCalledWith([{ _ref: 'fireball', _source: 'srd' }])
  })

  it('does not add the same entry twice', async () => {
    const onChange = vi.fn()
    renderList({ value: [{ _ref: 'fireball' }], onChange })
    await userEvent.click(screen.getByText(/Browse catalog/i))
    await userEvent.click(await screen.findAllByLabelText(/Already on the sheet/i)[0])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('adds a freeform entry when the schema allows it', async () => {
    const onChange = vi.fn()
    renderList({ value: [], onChange })
    await userEvent.click(screen.getByText(/Add custom/i))
    expect(onChange).toHaveBeenCalledWith([{ _inline: true, name: '' }])
  })

  it('hides the custom button when freeform is not allowed', () => {
    renderList({ definition: { ...DEFINITION, allow_freeform: false } })
    expect(screen.queryByText(/Add custom/i)).not.toBeInTheDocument()
  })

  it('edits a freeform entry in place', async () => {
    const onChange = vi.fn()
    renderList({ value: [{ _inline: true, name: 'My' }], onChange })
    await userEvent.type(screen.getByDisplayValue('My'), '!')
    expect(onChange).toHaveBeenCalledWith([{ _inline: true, name: 'My!' }])
  })

  it('removes an entry', async () => {
    const onChange = vi.fn()
    renderList({ value: [{ _ref: 'fireball' }, { _ref: 'shield' }], onChange })
    await userEvent.click(screen.getAllByLabelText(/^Remove$/i)[0])
    expect(onChange).toHaveBeenCalledWith([{ _ref: 'shield' }])
  })

  it('flags a reference whose entry is not installed', () => {
    renderList({ value: [{ _ref: 'gone' }] })
    expect(screen.getByText(/not installed/i)).toBeInTheDocument()
  })

  it('shows an empty state', () => {
    renderList({ value: [] })
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument()
  })
})
