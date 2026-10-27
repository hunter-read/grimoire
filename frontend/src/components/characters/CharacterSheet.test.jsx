import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// --- a phone-specific layout ------------------------------------------------

describe('CharacterSheet — phone layout', () => {
  // A controllable matchMedia: `set` flips the match and fires 'change', as a
  // rotation across the breakpoint would.
  function installMatchMedia(initial) {
    let matches = initial
    const listeners = new Set()
    const queries = []
    window.matchMedia = vi.fn((query) => {
      queries.push(query)
      return {
        get matches() {
          return matches
        },
        media: query,
        addEventListener: (_type, cb) => listeners.add(cb),
        removeEventListener: (_type, cb) => listeners.delete(cb),
      }
    })
    return {
      queries,
      set: (next) => {
        matches = next
        listeners.forEach((cb) => cb({ matches }))
      },
    }
  }

  const originalMatchMedia = window.matchMedia
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  const heading = (text) => ({
    tag: 'h2',
    children: [{ text }],
  })

  const PHONE = {
    ...BASE,
    layout_ast: [{ tag: 'section', children: [heading('Desktop Sheet')] }],
    styles_css: '.gc-sheet .desk { color: red }',
    mobile_layout_ast: [{ tag: 'section', children: [heading('Phone Sheet')] }],
    mobile_styles_css: '.gc-sheet .phone { color: blue }',
  }

  const injected = () =>
    [...window.document.head.querySelectorAll('style[data-character-sheet]')].map(
      (el) => el.textContent
    )

  it('draws the phone layout and only its stylesheet on a phone', () => {
    const media = installMatchMedia(true)
    render(<CharacterSheet document={PHONE} data={{}} />)
    expect(media.queries).toContain('(max-width: 640px)')
    expect(screen.getByRole('heading', { name: 'Phone Sheet' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Desktop Sheet' })).not.toBeInTheDocument()
    expect(injected()).toEqual(['.gc-sheet .phone { color: blue }'])
  })

  it('draws the desktop layout and stylesheet on a wider screen', () => {
    installMatchMedia(false)
    render(<CharacterSheet document={PHONE} data={{}} />)
    expect(screen.getByRole('heading', { name: 'Desktop Sheet' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Phone Sheet' })).not.toBeInTheDocument()
    expect(injected()).toEqual(['.gc-sheet .desk { color: red }'])
  })

  it('switches layout and stylesheet when the viewport crosses the breakpoint', () => {
    const media = installMatchMedia(false)
    render(<CharacterSheet document={PHONE} data={{}} />)
    expect(screen.getByRole('heading', { name: 'Desktop Sheet' })).toBeInTheDocument()

    act(() => media.set(true))
    expect(screen.getByRole('heading', { name: 'Phone Sheet' })).toBeInTheDocument()
    expect(injected()).toEqual(['.gc-sheet .phone { color: blue }'])

    act(() => media.set(false))
    expect(screen.getByRole('heading', { name: 'Desktop Sheet' })).toBeInTheDocument()
    expect(injected()).toEqual(['.gc-sheet .desk { color: red }'])
  })

  it('keeps the desktop layout on a phone when the sheet has no phone layout', () => {
    installMatchMedia(true)
    const { mobile_layout_ast: _a, mobile_styles_css: _c, ...desktopOnly } = PHONE
    render(<CharacterSheet document={desktopOnly} data={{}} />)
    expect(screen.getByRole('heading', { name: 'Desktop Sheet' })).toBeInTheDocument()
    expect(injected()).toEqual(['.gc-sheet .desk { color: red }'])
  })

  it('treats an empty phone layout as none', () => {
    installMatchMedia(true)
    render(<CharacterSheet document={{ ...PHONE, mobile_layout_ast: [] }} data={{}} />)
    expect(screen.getByRole('heading', { name: 'Desktop Sheet' })).toBeInTheDocument()
  })

  // jsdom does not load index.css, so the phone defaults are checked as a
  // class contract plus the rules themselves.
  it('draws tabs and pips inside the .gc-sheet scope the phone defaults target', () => {
    installMatchMedia(true)
    const tabbed = {
      ...BASE,
      fields: { ...BASE.fields, slots: { type: 'number', label: 'Slots' } },
      mobile_layout_ast: [
        {
          tag: 'g-tabs',
          children: [
            { tag: 'g-tab', attrs: { title: 'One' }, children: [] },
            { tag: 'g-tab', attrs: { title: 'Two' }, children: [] },
          ],
        },
        { tag: 'g-pips', attrs: { value: 'slots', count: '3' }, children: [] },
      ],
    }
    const { container } = render(<CharacterSheet document={tabbed} data={{}} />)
    const tablist = container.querySelector('.gc-sheet .gc-tablist')
    expect(tablist).toBeTruthy()
    expect(tablist.querySelectorAll(':scope > [role="tab"]')).toHaveLength(2)
    expect(container.querySelectorAll('.gc-sheet input[type="checkbox"]')).toHaveLength(3)
  })

  it('gives phone sheets scrolling tabs, 24px ticks and 16px inputs', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const start = css.indexOf('.gc-tablist {')
    const block = css.slice(css.lastIndexOf('@media (max-width: 640px)', start), start + 1200)
    expect(block.startsWith('@media (max-width: 640px)')).toBe(true)
    expect(block).toMatch(/\.gc-tablist\s*{[^}]*overflow-x:\s*auto/)
    expect(block).toMatch(/\[role='tab'\]\s*{[^}]*flex-shrink:\s*0/)
    expect(block).toMatch(
      /\.gc-sheet input\[type='checkbox'\]\s*{[^}]*min-width:\s*24px;[^}]*min-height:\s*24px/
    )
    expect(block).toMatch(/\.gc-sheet textarea\s*{[^}]*font-size:\s*16px/)
  })

  it('draws a phone layout for a sheet whose desktop layout is JSON', () => {
    installMatchMedia(true)
    const jsonSheet = {
      ...BASE,
      layout: [{ title: 'Basics', fields: ['hero_name'] }],
      mobile_layout_ast: PHONE.mobile_layout_ast,
    }
    render(<CharacterSheet document={jsonSheet} data={{}} />)
    expect(screen.getByRole('heading', { name: 'Phone Sheet' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Basics' })).not.toBeInTheDocument()
    // No phone stylesheet, and the desktop one is never borrowed.
    expect(injected()).toEqual([])
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

describe('CharacterSheet — derived defaults', () => {
  const DERIVED = {
    id: 'derived',
    fields: {
      species: { type: 'content_ref', content_type: 'species', label: 'Species' },
      speed: {
        type: 'number',
        label: 'Speed',
        default: 30,
        default_from: "ref(species, 'speed')",
      },
      is_caster: { type: 'checkbox', label: 'Caster', default_from: "ref(species, 'speed') > 20" },
    },
    content_types: { species: { identity_field: 'name', fields: { name: { type: 'text' } } } },
    layout: [{ title: 'Basics', fields: ['speed'] }],
  }
  const ENTRIES = { dwarf: { name: 'Dwarf', speed: 25 } }

  it('shows the derived value, marked as automatic', () => {
    render(
      <CharacterSheet
        document={DERIVED}
        data={{ species: { _ref: 'dwarf' } }}
        entries={ENTRIES}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Speed')).toHaveValue(25)
    // A quiet icon rather than a word, named for assistive technology.
    expect(screen.getByRole('img', { name: /Set from your choices/ })).toBeInTheDocument()
  })

  it("shows the player's own value with a way back", async () => {
    const onReset = vi.fn()
    render(
      <CharacterSheet
        document={DERIVED}
        data={{ species: { _ref: 'dwarf' }, speed: 40 }}
        entries={ENTRIES}
        onChange={vi.fn()}
        onReset={onReset}
      />
    )
    expect(screen.getByLabelText('Speed')).toHaveValue(40)
    await userEvent.click(screen.getByLabelText('Use the automatic value'))
    expect(onReset).toHaveBeenCalledWith('speed')
  })

  it('lets a layout condition see a derived value', () => {
    // The bug this guards: layouts built their context from raw data, so a
    // Spellcasting panel gated on a class-derived flag never appeared.
    render(
      <CharacterSheet
        document={{
          ...DERIVED,
          layout_ast: [
            {
              tag: 'g-if',
              attrs: { test: 'is_caster' },
              children: [{ tag: 'p', children: [{ text: 'Spellcasting' }] }],
            },
          ],
        }}
        data={{ species: { _ref: 'dwarf' } }}
        entries={ENTRIES}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText('Spellcasting')).toBeInTheDocument()
  })
})

describe('CharacterSheet — defaults', () => {
  it("shows a field's default rather than an empty box", () => {
    // Formulas used the default already, so a score read as 10 in every
    // modifier while its own box sat empty.
    render(
      <CharacterSheet
        document={{
          id: 'd',
          fields: { strength: { type: 'number', label: 'Strength', default: 10 } },
          layout: [{ title: 'A', fields: ['strength'] }],
        }}
        data={{}}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Strength')).toHaveValue(10)
  })
})
