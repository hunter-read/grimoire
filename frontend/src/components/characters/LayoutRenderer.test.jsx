import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LayoutRenderer from './LayoutRenderer'

// The AST these tests feed in is what the server produces from `layout_html`
// (backend/services/characters/layout_html.py). The tests at the bottom matter
// most: they assert that even an AST carrying things the server would have
// rejected cannot execute or escape, because this renderer re-applies the
// allowlist rather than trusting its input.

const DOCUMENT = {
  fields: {
    strength: { type: 'number', label: 'Strength' },
    hero_name: { type: 'text', label: 'Name' },
  },
  computed: { str_mod: { label: 'STR Mod' } },
}

const renderLayout = (ast, props = {}) =>
  render(
    <LayoutRenderer
      ast={ast}
      document={DOCUMENT}
      data={{ strength: 16, hero_name: 'Vex' }}
      computed={{ str_mod: 3 }}
      {...props}
    />
  )

describe('LayoutRenderer', () => {
  it('renders structural markup', () => {
    renderLayout([
      {
        tag: 'div',
        attrs: { class: 'sheet' },
        children: [{ tag: 'h2', children: [{ text: 'Hero' }] }],
      },
    ])
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument()
  })

  it('renders a g-field as a real editable control', () => {
    renderLayout([{ tag: 'g-field', attrs: { name: 'strength' }, children: [] }])
    expect(screen.getByLabelText('Strength')).toHaveValue(16)
  })

  it('renders a g-computed as read-only text', () => {
    renderLayout([{ tag: 'g-computed', attrs: { name: 'str_mod' }, children: [] }])
    expect(screen.getByText('3')).toBeInTheDocument()
    // Read-only means text, not a disabled input you can still focus.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders g-value and g-label', () => {
    renderLayout([
      { tag: 'g-value', attrs: { name: 'hero_name' }, children: [] },
      { tag: 'g-label', attrs: { name: 'strength' }, children: [] },
    ])
    expect(screen.getByText('Vex')).toBeInTheDocument()
    expect(screen.getByText('Strength')).toBeInTheDocument()
  })

  it('shows a g-if subtree only when its test passes', () => {
    const ast = (test) => [
      { tag: 'g-if', attrs: { test }, children: [{ tag: 'p', children: [{ text: 'Caster' }] }] },
    ]
    const { unmount } = renderLayout(ast('strength > 10'))
    expect(screen.getByText('Caster')).toBeInTheDocument()
    unmount()

    renderLayout(ast('strength > 99'))
    expect(screen.queryByText('Caster')).not.toBeInTheDocument()
  })

  it('reports edits through onChange', async () => {
    const onChange = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    renderLayout([{ tag: 'g-field', attrs: { name: 'hero_name' }, children: [] }], { onChange })

    await userEvent.type(screen.getByLabelText('Name'), '!')
    expect(onChange).toHaveBeenCalledWith('hero_name', 'Vex!')
  })

  it('renders nothing for a field the schema does not declare', () => {
    const { container } = renderLayout([
      { tag: 'g-field', attrs: { name: 'nonexistent' }, children: [] },
    ])
    expect(container.querySelector('input')).toBeNull()
  })

  it('renders an unknown tag as its children rather than dropping the subtree', () => {
    renderLayout([
      { tag: 'marquee', attrs: {}, children: [{ tag: 'p', children: [{ text: 'kept' }] }] },
    ])
    expect(screen.getByText('kept')).toBeInTheDocument()
  })

  describe('no schema-supplied markup can execute', () => {
    it('never uses innerHTML — text is rendered as text', () => {
      const { container } = renderLayout([
        { tag: 'p', children: [{ text: '<script>alert(1)</script>' }] },
      ])
      // Rendered as visible text, not parsed into an element.
      expect(container.querySelector('script')).toBeNull()
      expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    })

    it('strips event-handler attributes even if one reaches the AST', () => {
      const onclick = vi.fn()
      const { container } = renderLayout([
        { tag: 'div', attrs: { onclick: 'window.__pwned = true', class: 'x' }, children: [] },
      ])
      const div = container.querySelector('div.x')
      expect(div).not.toBeNull()
      expect(div.getAttribute('onclick')).toBeNull()
      expect(onclick).not.toHaveBeenCalled()
    })

    it('strips a style attribute even if one reaches the AST', () => {
      const { container } = renderLayout([
        { tag: 'div', attrs: { style: 'position:fixed;inset:0', class: 'y' }, children: [] },
      ])
      expect(container.querySelector('div.y').getAttribute('style')).toBeNull()
    })

    it('does not render a script tag carried in the AST', () => {
      const { container } = renderLayout([
        { tag: 'script', attrs: {}, children: [{ text: 'window.__pwned = true' }] },
      ])
      expect(container.querySelector('script')).toBeNull()
      expect(window.__pwned).toBeUndefined()
    })

    it('does not render an iframe carried in the AST', () => {
      const { container } = renderLayout([
        { tag: 'iframe', attrs: { src: 'https://evil.example' }, children: [] },
      ])
      expect(container.querySelector('iframe')).toBeNull()
    })
  })

  it('scopes a schema stylesheet to the sheet and removes it on unmount', () => {
    const { unmount } = render(
      <LayoutRenderer
        ast={[{ tag: 'div', attrs: {}, children: [] }]}
        document={{ ...DOCUMENT, styles_css: '.gc-sheet .a { color: red }' }}
        data={{}}
        computed={{}}
      />
    )
    const style = document.head.querySelector('style[data-character-sheet]')
    expect(style.textContent).toContain('.gc-sheet .a')

    unmount()
    expect(document.head.querySelector('style[data-character-sheet]')).toBeNull()
  })

  it('renders nothing when there is no AST', () => {
    const { container } = render(<LayoutRenderer ast={null} document={DOCUMENT} data={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

// --- Phase 2: repeats over list fields, and visible_if ----------------------

describe('LayoutRenderer — Phase 2', () => {
  const DOC = {
    fields: {
      is_caster: { type: 'checkbox', label: 'Caster' },
      spell_dc: { type: 'number', label: 'Spell DC' },
      equipment: {
        type: 'list',
        columns: [
          { key: 'name', type: 'text', label: 'Name' },
          { key: 'qty', type: 'number', label: 'Qty' },
        ],
      },
    },
    computed: {},
  }

  const rows = [
    { name: 'Sword', qty: 1 },
    { name: 'Rope', qty: 2 },
  ]

  const renderDoc = (ast, props = {}) =>
    render(
      <LayoutRenderer
        ast={ast}
        document={DOC}
        data={{ equipment: rows, is_caster: false }}
        computed={{}}
        {...props}
      />
    )

  it('repeats its contents once per row', () => {
    renderDoc([
      {
        tag: 'g-repeat',
        attrs: { over: 'equipment' },
        children: [{ tag: 'g-field', attrs: { name: 'name' }, children: [] }],
      },
    ])
    expect(screen.getByDisplayValue('Sword')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Rope')).toBeInTheDocument()
  })

  it('edits the row a field sits in, not a top-level field', async () => {
    const onChange = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    renderDoc(
      [
        {
          tag: 'g-repeat',
          attrs: { over: 'equipment' },
          children: [{ tag: 'g-field', attrs: { name: 'name' }, children: [] }],
        },
      ],
      { onChange }
    )
    await userEvent.type(screen.getByDisplayValue('Rope'), '!')
    expect(onChange).toHaveBeenCalledWith('equipment', [
      { name: 'Sword', qty: 1 },
      { name: 'Rope!', qty: 2 },
    ])
  })

  it('renders nothing for a repeat over a field that is not a list', () => {
    const { container } = renderDoc([
      { tag: 'g-repeat', attrs: { over: 'spell_dc' }, children: [] },
    ])
    expect(container.querySelector('input')).toBeNull()
  })

  it('honours visible_if on a directive', () => {
    renderDoc([
      { tag: 'g-field', attrs: { name: 'spell_dc', visible_if: 'is_caster' }, children: [] },
    ])
    expect(screen.queryByLabelText('Spell DC')).not.toBeInTheDocument()
  })

  it('honours a field’s own visible_if wherever it is drawn', () => {
    render(
      <LayoutRenderer
        ast={[{ tag: 'g-field', attrs: { name: 'spell_dc' }, children: [] }]}
        document={{
          ...DOC,
          fields: { ...DOC.fields, spell_dc: { type: 'number', visible_if: 'is_caster' } },
        }}
        data={{ is_caster: false }}
        computed={{}}
      />
    )
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('shows a conditional section when its test passes', () => {
    renderDoc([
      {
        tag: 'g-section',
        attrs: { title: 'Spells', visible_if: 'is_caster' },
        children: [{ tag: 'p', children: [{ text: 'magic' }] }],
      },
    ])
    expect(screen.queryByText('magic')).not.toBeInTheDocument()
  })
})

describe('LayoutRenderer — any value can be set', () => {
  const value = (name) => [{ tag: 'g-value', attrs: { name }, children: [] }]
  const computedNode = [{ tag: 'g-computed', attrs: { name: 'str_mod' }, children: [] }]

  it('lets a calculated g-value be overridden', async () => {
    const onOverride = vi.fn()
    renderLayout(value('str_mod'), { onOverride })
    await userEvent.click(screen.getByLabelText('Set STR Mod'))
    const input = screen.getByLabelText('Set STR Mod')
    await userEvent.clear(input)
    await userEvent.type(input, '5{Enter}')
    expect(onOverride).toHaveBeenCalledWith('str_mod', 5)
  })

  it('marks a g-value the player has overridden', () => {
    renderLayout(value('str_mod'), {
      onOverride: vi.fn(),
      data: { strength: 16, _overrides: { str_mod: 5 } },
      computed: { str_mod: 5 },
    })
    expect(screen.getByLabelText(/STR Mod: 5, set by you/)).toBeInTheDocument()
  })

  it('lets a g-computed be overridden', async () => {
    const onOverride = vi.fn()
    renderLayout(computedNode, { onOverride })
    await userEvent.click(screen.getByLabelText('Set STR Mod'))
    await userEvent.keyboard('{Control>}a{/Control}7{Enter}')
    expect(onOverride).toHaveBeenCalled()
  })

  it('edits a plain field shown as a g-value in place', async () => {
    const onChange = vi.fn()
    renderLayout(value('strength'), { onChange })
    await userEvent.click(screen.getByLabelText('Set Strength'))
    const input = screen.getByLabelText('Set Strength')
    await userEvent.clear(input)
    await userEvent.type(input, '18{Enter}')
    expect(onChange).toHaveBeenCalledWith('strength', 18)
  })

  it('clearing a plain field empties it', async () => {
    const onChange = vi.fn()
    renderLayout(value('hero_name'), { onChange })
    await userEvent.click(screen.getByLabelText('Set Name'))
    await userEvent.clear(screen.getByLabelText('Set Name'))
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('hero_name', null)
  })

  it('clearing a derived field hands it back to its default', async () => {
    const onReset = vi.fn()
    renderLayout(value('speed'), {
      document: {
        ...DOCUMENT,
        fields: {
          ...DOCUMENT.fields,
          speed: { type: 'number', label: 'Speed', default_from: '30' },
        },
      },
      data: { speed: 40 },
      onChange: vi.fn(),
      onReset,
    })
    await userEvent.click(screen.getByLabelText(/Speed: 40, set by you/))
    await userEvent.clear(screen.getByLabelText('Set Speed'))
    await userEvent.keyboard('{Enter}')
    expect(onReset).toHaveBeenCalledWith('speed')
  })

  it('offers nothing when read-only', () => {
    renderLayout(value('str_mod'), { onOverride: vi.fn(), readOnly: true })
    expect(screen.queryByLabelText('Set STR Mod')).not.toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

describe('LayoutRenderer — pages', () => {
  const pages = [
    {
      tag: 'g-tabs',
      attrs: {},
      children: [
        {
          tag: 'g-tab',
          attrs: { title: 'Character' },
          children: [{ tag: 'p', children: [{ text: 'Page one' }] }],
        },
        {
          tag: 'g-tab',
          attrs: { title: 'Spells' },
          children: [{ tag: 'p', children: [{ text: 'Page two' }] }],
        },
        { tag: 'g-tab', attrs: { title: 'Hidden', visible_if: 'strength > 99' }, children: [] },
      ],
    },
  ]

  it('draws only the chosen page', async () => {
    renderLayout(pages)
    expect(screen.getByText('Page one')).toBeInTheDocument()
    expect(screen.queryByText('Page two')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Spells' }))
    expect(screen.getByText('Page two')).toBeInTheDocument()
    expect(screen.queryByText('Page one')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Spells' })).toHaveAttribute('aria-selected', 'true')
  })

  it('leaves out a page whose condition fails', () => {
    renderLayout(pages)
    expect(screen.queryByRole('tab', { name: 'Hidden' })).not.toBeInTheDocument()
  })

  it('draws a stray page outside tabs as its contents', () => {
    renderLayout([{ tag: 'g-tab', attrs: { title: 'Alone' }, children: [{ text: 'Just this' }] }])
    expect(screen.getByText('Just this')).toBeInTheDocument()
  })
})

describe('LayoutRenderer — one box per option', () => {
  const doc = {
    ...DOCUMENT,
    fields: {
      ...DOCUMENT.fields,
      skills: { type: 'multiselect', options: ['Arcana', 'Athletics', 'Stealth'] },
    },
  }
  const option = (value) => [
    {
      tag: 'g-option',
      attrs: { field: 'skills', value, label: `${value} proficiency` },
      children: [],
    },
  ]

  it('is ticked when the list holds that option', () => {
    renderLayout(option('Stealth'), { document: doc, data: { skills: ['Stealth'] } })
    expect(screen.getByLabelText('Stealth proficiency')).toBeChecked()
  })

  it('adds the option in the field’s own order', async () => {
    const onChange = vi.fn()
    renderLayout(option('Arcana'), { document: doc, data: { skills: ['Stealth'] }, onChange })
    await userEvent.click(screen.getByLabelText('Arcana proficiency'))
    expect(onChange).toHaveBeenCalledWith('skills', ['Arcana', 'Stealth'])
  })

  it('removes it again', async () => {
    const onChange = vi.fn()
    renderLayout(option('Stealth'), { document: doc, data: { skills: ['Stealth'] }, onChange })
    await userEvent.click(screen.getByLabelText('Stealth proficiency'))
    expect(onChange).toHaveBeenCalledWith('skills', [])
  })

  it('cannot be changed read-only', () => {
    renderLayout(option('Stealth'), { document: doc, data: {}, onChange: vi.fn(), readOnly: true })
    expect(screen.getByLabelText('Stealth proficiency')).toBeDisabled()
  })

  it('draws nothing for a field that is not a multiselect', () => {
    const { container } = renderLayout(
      [{ tag: 'g-option', attrs: { field: 'strength', value: '1' }, children: [] }],
      { onChange: vi.fn() }
    )
    expect(container.querySelector('input')).toBeNull()
  })
})

describe('LayoutRenderer — collapsible sections', () => {
  const section = (attrs = {}) => [
    {
      tag: 'details',
      attrs,
      children: [
        { tag: 'summary', children: [{ text: 'Other details' }] },
        { tag: 'p', children: [{ text: 'Folded away' }] },
      ],
    },
  ]

  it('draws a real details element, closed by default', () => {
    // It used to be unwrapped into its children: drawn open, with no way to
    // fold it, because the browser list lacked the tag the server allowed.
    const { container } = renderLayout(section())
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
    expect(container.querySelector('summary')).toHaveTextContent('Other details')
  })

  it('honours open as a boolean attribute', () => {
    const { container } = renderLayout(section({ open: '' }))
    expect(container.querySelector('details').open).toBe(true)
  })
})

describe('LayoutRenderer — field variants', () => {
  it('passes a variant through to the field', () => {
    renderLayout(
      [{ tag: 'g-field', attrs: { name: 'strength', variant: 'compact' }, children: [] }],
      {
        onChange: vi.fn(),
      }
    )
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('16')).toHaveAttribute('inputmode', 'numeric')
  })

  it('gives an option box the author’s class and the app’s colour', () => {
    const { container } = renderLayout(
      [
        {
          tag: 'g-option',
          attrs: { field: 'skills', value: 'Arcana', class: 'expertise' },
          children: [],
        },
      ],
      {
        document: {
          ...DOCUMENT,
          fields: { ...DOCUMENT.fields, skills: { type: 'multiselect', options: ['Arcana'] } },
        },
        onChange: vi.fn(),
      }
    )
    const box = container.querySelector('input.gc-option')
    expect(box).toHaveClass('expertise')
    expect(box.style.accentColor).toBe('var(--gold)')
  })
})

describe("LayoutRenderer — a skill's proficiency as one dropdown", () => {
  const doc = {
    ...DOCUMENT,
    fields: {
      ...DOCUMENT.fields,
      profs: { type: 'multiselect', options: ['Arcana', 'Stealth'] },
      expertise: { type: 'multiselect', options: ['Arcana', 'Stealth'] },
    },
  }
  const tier = [
    {
      tag: 'g-tier',
      attrs: {
        value: 'Stealth',
        fields: 'profs expertise',
        labels: '—|Prof|Exp',
        titles: 'Not proficient|Proficient|Expertise',
        label: 'Stealth',
      },
      children: [],
    },
  ]

  it('shows the short label while closed and the full names in the list', () => {
    renderLayout(tier, { document: doc, data: { profs: ['Stealth'] }, onChange: vi.fn() })
    expect(screen.getByText('Prof')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Proficient' })).toBeInTheDocument()
    expect(screen.getByLabelText('Stealth')).toHaveValue('1')
  })

  it('reads expertise alone as expertise', () => {
    renderLayout(tier, { document: doc, data: { expertise: ['Stealth'] }, onChange: vi.fn() })
    expect(screen.getByLabelText('Stealth')).toHaveValue('2')
  })

  it('choosing expertise records proficiency too', async () => {
    const onChange = vi.fn()
    renderLayout(tier, { document: doc, data: {}, onChange })
    await userEvent.selectOptions(screen.getByLabelText('Stealth'), '2')
    expect(onChange).toHaveBeenCalledWith('profs', ['Stealth'])
    expect(onChange).toHaveBeenCalledWith('expertise', ['Stealth'])
  })

  it('dropping to none clears both', async () => {
    const onChange = vi.fn()
    renderLayout(tier, {
      document: doc,
      data: { profs: ['Arcana', 'Stealth'], expertise: ['Stealth'] },
      onChange,
    })
    await userEvent.selectOptions(screen.getByLabelText('Stealth'), '0')
    expect(onChange).toHaveBeenCalledWith('profs', ['Arcana'])
    expect(onChange).toHaveBeenCalledWith('expertise', [])
  })

  it('cannot be changed read-only', () => {
    renderLayout(tier, { document: doc, data: {}, onChange: vi.fn(), readOnly: true })
    expect(screen.getByLabelText('Stealth')).toBeDisabled()
  })
})

describe('LayoutRenderer — boxes to tick off', () => {
  const doc = {
    ...DOCUMENT,
    fields: { ...DOCUMENT.fields, used: { type: 'number', default: 0 } },
    computed: { ...DOCUMENT.computed, total: { formula: '4' } },
  }
  const pips = (count = 'total') => [
    { tag: 'g-pips', attrs: { count, value: 'used', label: 'Slot' }, children: [] },
  ]

  it('draws one box per slot, with the used ones ticked', () => {
    renderLayout(pips(), {
      document: doc,
      data: { used: 1 },
      computed: { str_mod: 3, total: 4 },
      onChange: vi.fn(),
    })
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(4)
    expect(boxes.filter((box) => box.checked)).toHaveLength(1)
  })

  it('ticking a box casts - everything up to it is used', async () => {
    const onChange = vi.fn()
    renderLayout(pips('3'), { document: doc, data: { used: 0 }, onChange })
    await userEvent.click(screen.getByLabelText('Slot 2'))
    expect(onChange).toHaveBeenCalledWith('used', 2)
  })

  it('unticking frees that slot and those after it', async () => {
    const onChange = vi.fn()
    renderLayout(pips('3'), { document: doc, data: { used: 3 }, onChange })
    await userEvent.click(screen.getByLabelText('Slot 2'))
    expect(onChange).toHaveBeenCalledWith('used', 1)
  })

  it('shows a dash when there are none', () => {
    renderLayout(pips('0'), { document: doc, data: {}, onChange: vi.fn() })
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
