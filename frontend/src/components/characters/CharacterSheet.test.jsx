import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CharacterSheet from './CharacterSheet'

// A schema describes its sheet either as a JSON `layout` tree or as HTML
// (`layout_ast`). Both paths are exercised here: the JSON one is what a simple
// system uses, so it has to produce a usable sheet with no design work.

const BASE = {
  fields: {
    hero_name: { type: 'text', label: 'Name' },
    strength: { type: 'number', label: 'Strength', default: 10 },
  },
  computed: { str_mod: { formula: 'floor((strength - 10) / 2)', label: 'STR Mod' } },
}

describe('CharacterSheet', () => {
  describe('JSON layout', () => {
    const document = {
      ...BASE,
      layout: [{ title: 'Basics', fields: ['hero_name', 'strength'] }],
    }

    it('renders each section and its fields', () => {
      render(<CharacterSheet document={document} data={{ strength: 16 }} />)
      expect(screen.getByRole('heading', { name: 'Basics' })).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Strength')).toHaveValue(16)
    })

    it('shows computed values in a derived block when the layout omits them', () => {
      render(<CharacterSheet document={document} data={{ strength: 16 }} />)
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('recomputes as the data changes', () => {
      const { rerender } = render(<CharacterSheet document={document} data={{ strength: 16 }} />)
      expect(screen.getByText('3')).toBeInTheDocument()
      rerender(<CharacterSheet document={document} data={{ strength: 20 }} />)
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('places a computed value inline when the layout names it', () => {
      const inline = {
        ...BASE,
        layout: [{ title: 'Basics', fields: ['strength', 'str_mod'] }],
      }
      render(<CharacterSheet document={inline} data={{ strength: 18 }} />)
      // Named in the layout, so it is not repeated in a derived block.
      expect(screen.getAllByText('4')).toHaveLength(1)
    })

    it('reports edits', async () => {
      const onChange = vi.fn()
      const { default: userEvent } = await import('@testing-library/user-event')
      render(<CharacterSheet document={document} data={{}} onChange={onChange} />)
      await userEvent.type(screen.getByLabelText('Name'), 'K')
      expect(onChange).toHaveBeenCalledWith('hero_name', 'K')
    })

    it('renders read-only without inputs', () => {
      render(<CharacterSheet document={document} data={{ strength: 16 }} readOnly />)
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(screen.getByText('16')).toBeInTheDocument()
    })

    it('ignores a layout entry naming something the schema does not have', () => {
      const stale = { ...BASE, layout: [{ title: 'Basics', fields: ['ghost'] }] }
      expect(() => render(<CharacterSheet document={stale} data={{}} />)).not.toThrow()
    })
  })

  describe('HTML layout', () => {
    it('is preferred when the schema has one', () => {
      const document = {
        ...BASE,
        layout: [{ title: 'Basics', fields: ['hero_name'] }],
        layout_ast: [
          {
            tag: 'section',
            attrs: { class: 'custom' },
            children: [
              { tag: 'h2', children: [{ text: 'Custom Sheet' }] },
              { tag: 'g-field', attrs: { name: 'strength' }, children: [] },
            ],
          },
        ],
      }
      render(<CharacterSheet document={document} data={{ strength: 12 }} />)
      expect(screen.getByRole('heading', { name: 'Custom Sheet' })).toBeInTheDocument()
      // The JSON layout's section is not also drawn.
      expect(screen.queryByRole('heading', { name: 'Basics' })).not.toBeInTheDocument()
    })
  })

  it('renders nothing without a document', () => {
    const { container } = render(<CharacterSheet document={null} data={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

// --- Phase 2: conditional fields, validators, list rendering ----------------

describe('CharacterSheet — Phase 2', () => {
  const PHASE2 = {
    fields: {
      is_caster: { type: 'checkbox', label: 'Caster' },
      spell_dc: { type: 'number', label: 'Spell DC', visible_if: 'is_caster' },
      equipment: {
        type: 'list',
        label: 'Equipment',
        columns: [
          { key: 'name', type: 'text', label: 'Name' },
          { key: 'equipped', type: 'checkbox', label: 'Eq.' },
        ],
      },
    },
    computed: { carried: { formula: "count_where(equipment, 'equipped')", label: 'Carried' } },
    validators: [
      {
        rule: "count_where(equipment, 'equipped') <= 1",
        severity: 'warning',
        message: 'Carrying too much',
      },
    ],
    layout: [
      { title: 'Magic', fields: ['is_caster', 'spell_dc'] },
      { title: 'Gear', fields: ['equipment'] },
    ],
  }

  it('hides a field whose condition is false', () => {
    render(<CharacterSheet document={PHASE2} data={{ is_caster: false }} />)
    expect(screen.queryByLabelText('Spell DC')).not.toBeInTheDocument()
  })

  it('shows it once the condition becomes true', () => {
    const { rerender } = render(<CharacterSheet document={PHASE2} data={{ is_caster: false }} />)
    expect(screen.queryByLabelText('Spell DC')).not.toBeInTheDocument()
    rerender(<CharacterSheet document={PHASE2} data={{ is_caster: true }} />)
    expect(screen.getByLabelText('Spell DC')).toBeInTheDocument()
  })

  it('hides a whole section whose condition is false', () => {
    const sectioned = {
      ...PHASE2,
      layout: [{ title: 'Magic', visible_if: 'is_caster', fields: ['spell_dc'] }],
    }
    const { rerender } = render(<CharacterSheet document={sectioned} data={{ is_caster: false }} />)
    expect(screen.queryByRole('heading', { name: 'Magic' })).not.toBeInTheDocument()
    rerender(<CharacterSheet document={sectioned} data={{ is_caster: true }} />)
    expect(screen.getByRole('heading', { name: 'Magic' })).toBeInTheDocument()
  })

  it('renders a list field as an editable table', () => {
    render(
      <CharacterSheet document={PHASE2} data={{ equipment: [{ name: 'Sword', equipped: true }] }} />
    )
    expect(screen.getByDisplayValue('Sword')).toBeInTheDocument()
  })

  it('surfaces a firing validator', () => {
    render(
      <CharacterSheet
        document={PHASE2}
        data={{ equipment: [{ equipped: true }, { equipped: true }] }}
      />
    )
    expect(screen.getByText('Carrying too much')).toBeInTheDocument()
  })

  it('drops the message once the sheet satisfies the rule', () => {
    const { rerender } = render(
      <CharacterSheet
        document={PHASE2}
        data={{ equipment: [{ equipped: true }, { equipped: true }] }}
      />
    )
    expect(screen.getByText('Carrying too much')).toBeInTheDocument()
    rerender(<CharacterSheet document={PHASE2} data={{ equipment: [{ equipped: true }] }} />)
    expect(screen.queryByText('Carrying too much')).not.toBeInTheDocument()
  })

  it('computes across list rows', () => {
    render(
      <CharacterSheet
        document={PHASE2}
        data={{ equipment: [{ equipped: true }, { equipped: false }] }}
      />
    )
    // One equipped item, shown in the derived block.
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
