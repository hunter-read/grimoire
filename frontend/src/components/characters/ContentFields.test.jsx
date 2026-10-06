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
    // The box itself opens the picker now, rather than a button beside it.
    await userEvent.click(screen.getByRole('button', { name: /^Choose / }))
    await userEvent.click(await screen.findByLabelText(/Add to sheet/i))
    expect(onChange).toHaveBeenCalledWith(
      { _ref: 'fireball', _source: 'srd' },
      { entry: expect.objectContaining({ name: 'Fireball' }) }
    )
  })

  it('clears a choice', async () => {
    const onChange = vi.fn()
    renderRef({ value: { _ref: 'fireball' }, onChange })
    await userEvent.click(screen.getByLabelText(/Clear/i))
    // Cleared with an explicit empty entry, so the grants of the previous pick
    // are taken back without a lookup.
    expect(onChange).toHaveBeenCalledWith(null, { entry: null })
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
    // It reads like any other row until opened, then edits in place.
    await userEvent.click(screen.getByRole('button', { name: 'Show My' }))
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

describe('ContentListField — rows you can open', () => {
  const FEAT_TYPE = {
    identity_field: 'name',
    compact_display: '{category}',
    fields: {
      name: { type: 'text', label: 'Name' },
      category: { type: 'text', label: 'Category' },
      description: { type: 'textarea', label: 'Description' },
    },
  }
  const ENTRIES = {
    alert: {
      name: 'Alert',
      category: 'Origin',
      description: 'Add your proficiency to initiative.',
    },
  }
  const renderList = (props = {}) =>
    render(
      <ContentListField
        name="feats"
        definition={{ label: 'Feats', content_type: 'feat' }}
        value={[{ _ref: 'alert' }]}
        entries={ENTRIES}
        typeDefinition={FEAT_TYPE}
        onChange={vi.fn()}
        {...props}
      />
    )

  it("opens to show the entry's description", async () => {
    // There was no way to read what a feat did once it was on the sheet.
    renderList()
    expect(screen.queryByText('Add your proficiency to initiative.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show Alert' }))
    expect(screen.getByText('Add your proficiency to initiative.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide Alert' }))
    expect(screen.queryByText('Add your proficiency to initiative.')).not.toBeInTheDocument()
  })

  it('hides its own heading when the layout draws one', () => {
    // "Feats" above "FEATS": the panel's title and the field's label both.
    renderList({ hideLabel: true })
    expect(screen.queryByText('Feats')).not.toBeInTheDocument()
  })

  it('draws a table of the properties it is asked for', () => {
    renderList({
      definition: { label: 'Feats', content_type: 'feat', display_columns: ['category'] },
    })
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Origin' })).toBeInTheDocument()
  })

  it('shows a dash for a column the entry lacks', () => {
    renderList({
      definition: {
        label: 'Feats',
        content_type: 'feat',
        display_columns: [{ key: 'prerequisite', label: 'Prereq' }],
      },
    })
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument()
  })
})

describe('ContentListField — freeform entries read like catalog ones', () => {
  const TRAIT_TYPE = {
    identity_field: 'name',
    compact_display: '{species}',
    fields: {
      name: { type: 'text', label: 'Name' },
      species: { type: 'text', label: 'Species' },
      description: { type: 'textarea', label: 'Description' },
    },
  }
  const renderTraits = (props = {}) =>
    render(
      <ContentListField
        name="species_traits"
        definition={{ label: 'Species Traits', content_type: 'trait', allow_freeform: true }}
        value={[{ _inline: true, name: 'Darkvision', species: 'Dwarf' }]}
        typeDefinition={TRAIT_TYPE}
        onChange={vi.fn()}
        {...props}
      />
    )

  it('shows its name with its source underneath', () => {
    renderTraits()
    expect(screen.getByText('Darkvision')).toBeInTheDocument()
    expect(screen.getByText('Dwarf')).toBeInTheDocument()
  })

  it("opens to the content type's fields, so it can be given a description", async () => {
    const onChange = vi.fn()
    renderTraits({ onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Show Darkvision' }))
    await userEvent.type(screen.getByLabelText('Description'), 'S')
    expect(onChange).toHaveBeenLastCalledWith([
      { _inline: true, name: 'Darkvision', species: 'Dwarf', description: 'S' },
    ])
  })

  it('opens a new custom entry straight away', async () => {
    const onChange = vi.fn()
    const { rerender } = renderTraits({ value: [], onChange })
    await userEvent.click(screen.getByText('Add custom'))
    expect(onChange).toHaveBeenCalledWith([{ _inline: true, name: '' }])
    rerender(
      <ContentListField
        name="species_traits"
        definition={{ label: 'Species Traits', content_type: 'trait', allow_freeform: true }}
        value={[{ _inline: true, name: '' }]}
        typeDefinition={TRAIT_TYPE}
        onChange={onChange}
      />
    )
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('is read-only on a read-only sheet', async () => {
    renderTraits({ readOnly: true })
    await userEvent.click(screen.getByRole('button', { name: 'Show Darkvision' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
