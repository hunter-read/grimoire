import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
