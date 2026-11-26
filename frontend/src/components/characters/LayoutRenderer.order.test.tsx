import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import LayoutRenderer from './LayoutRenderer'
import type { LayoutNode } from './LayoutRenderer'
import {
  MAX_HIDDEN_KEYS,
  mergeOrder,
  moveKey,
  renameInOrder,
  sortBlocks,
  storedOrder,
  withUniqueKeys,
} from './sheetOrder'

vi.mock('../../api', () => ({
  characters: { portraitUrl: () => '', imageUrl: () => '' },
}))

// A <g-order> draws its blocks in the order the player keeps in a text field,
// one key per line, and writes the new order when a block is moved.

const DOCUMENT = {
  fields: {
    attack_order: { type: 'textarea', label: 'Order' },
    level: { type: 'number', label: 'Level' },
    attacks: {
      type: 'list',
      columns: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'bonus', type: 'number', label: 'Bonus' },
      ],
    },
    gear: { type: 'content_list', content_type: 'item' },
  },
  computed: {},
}

const text = (value: string): LayoutNode => ({ text: value })
const item = (key: string, label: string): LayoutNode => ({
  tag: 'g-order-item',
  attrs: { key },
  children: [{ tag: 'p', children: [text(label)] }],
})

const ORDER: LayoutNode[] = [
  {
    tag: 'g-order',
    attrs: { field: 'attack_order', class: 'attacks' },
    children: [
      {
        tag: 'g-repeat',
        attrs: { over: 'attacks' },
        children: [{ tag: 'g-value', attrs: { name: 'name' }, children: [] }],
      },
      item('unarmed', 'Unarmed strike'),
      { tag: 'g-if', attrs: { test: 'level > 4' }, children: [item('spell', 'Spell attack')] },
      { tag: 'g-if', attrs: { test: 'level > 10' }, children: [item('epic', 'Epic')] },
    ],
  },
]

const ROWS = [
  { name: 'Sword', bonus: 5 },
  { name: 'Dagger', bonus: 4 },
]

const order = (container: HTMLElement) =>
  [...container.querySelectorAll('.gc-order-block')].map((el) => el.getAttribute('data-order-key'))

function Controlled({
  initial,
  onChange,
  readOnly = false,
  ast = ORDER,
}: {
  initial: Record<string, unknown>
  onChange?: (name: string, value: unknown) => void
  readOnly?: boolean
  ast?: LayoutNode[]
}) {
  const [data, setData] = useState(initial)
  return (
    <LayoutRenderer
      ast={ast}
      document={DOCUMENT}
      data={data}
      computed={{}}
      readOnly={readOnly}
      onChange={(name, value) => {
        onChange?.(name, value)
        setData((prev) => ({ ...prev, [name]: value }))
      }}
    />
  )
}

describe('<g-order>', () => {
  it('draws the stored order, with blocks it does not know first, and lends a holding g-if', () => {
    const { container } = render(
      <Controlled
        initial={{ attacks: ROWS, level: 5, attack_order: 'unarmed\nattacks:Dagger\nold:gone' }}
      />
    )
    expect(order(container)).toEqual(['attacks:Sword', 'spell', 'unarmed', 'attacks:Dagger'])
    expect(container.querySelector('.gc-order')).toHaveClass('attacks')
    expect(screen.queryByText('Epic')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Move item/ })).toHaveLength(4)
  })

  it('tells two copies of one entry apart', () => {
    const { container } = render(
      <Controlled
        initial={{
          attacks: [...ROWS, { name: 'Dagger', bonus: 1 }],
          level: 1,
          attack_order: 'attacks:Dagger#2\nattacks:Dagger',
        }}
      />
    )
    expect(order(container)).toEqual([
      'attacks:Sword',
      'unarmed',
      'attacks:Dagger#2',
      'attacks:Dagger',
    ])
  })

  it('moves a block with the arrow keys, writing every key, and keeps the focus on it', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <Controlled initial={{ attacks: ROWS, level: 1, attack_order: '' }} onChange={onChange} />
    )
    const handle = screen.getByRole('button', { name: 'Move item 1 of 3' })
    handle.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(
      'attack_order',
      'attacks:Dagger\nattacks:Sword\nunarmed'
    )
    expect(order(container)).toEqual(['attacks:Dagger', 'attacks:Sword', 'unarmed'])
    expect(document.activeElement).toBe(
      container.querySelector('[data-order-key="attacks:Sword"] .gc-order-handle')
    )
    // Not past either end, and other keys do nothing.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(order(container)).toEqual(['attacks:Dagger', 'unarmed', 'attacks:Sword'])
    expect(onChange).toHaveBeenCalledTimes(2)
    const first = screen.getByRole('button', { name: 'Move item 1 of 3' })
    first.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('drags a block with a pointer to where it is let go', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Controlled initial={{ attacks: ROWS, level: 1, attack_order: '' }} onChange={onChange} />
    )
    // Three blocks, 20px tall, stacked from the top.
    container.querySelectorAll<HTMLElement>('.gc-order-block').forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 20, height: 20 }) as DOMRect
    })
    const handle = container.querySelector('[data-order-key="attacks:Sword"] .gc-order-handle')!
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
    expect(container.querySelector('.gc-order-dragging')).toHaveAttribute(
      'data-order-key',
      'attacks:Sword'
    )
    // Another pointer is ignored; then below the last block's middle.
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 2, clientY: 5 }))
      window.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientY: 55 }))
    })
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientY: 55 }))
    })
    expect(onChange).toHaveBeenCalledWith('attack_order', 'attacks:Dagger\nunarmed\nattacks:Sword')
    expect(container.querySelector('.gc-order-dragging')).toBeNull()
  })

  it('writes nothing for a drag let go where it began, or cancelled', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Controlled initial={{ attacks: ROWS, level: 1, attack_order: '' }} onChange={onChange} />
    )
    container.querySelectorAll<HTMLElement>('.gc-order-block').forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 20, height: 20 }) as DOMRect
    })
    const handle = container.querySelector('[data-order-key="attacks:Dagger"] .gc-order-handle')!
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientY: 35 }))
    })
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1 })
    expect(container.querySelector('.gc-order-dragging')).toBeNull()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
    act(() => {
      window.dispatchEvent(new Event('pointercancel'))
    })
    expect(container.querySelector('.gc-order-dragging')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps the focus and the row's place while its first column is typed in", async () => {
    const onChange = vi.fn()
    const ast: LayoutNode[] = [
      {
        tag: 'g-order',
        attrs: { field: 'attack_order' },
        children: [
          {
            tag: 'g-repeat',
            attrs: { over: 'attacks' },
            children: [{ tag: 'g-field', attrs: { name: 'name' }, children: [] }],
          },
          item('unarmed', 'Unarmed strike'),
        ],
      },
    ]
    const { container } = render(
      <Controlled
        ast={ast}
        onChange={onChange}
        initial={{
          attacks: [{ name: 'Sword' }, { name: 'Bow' }],
          attack_order: 'unarmed\nattacks:Sword\nattacks:Bow',
        }}
      />
    )
    const input = screen.getByDisplayValue('Bow')
    await userEvent.click(input)
    await userEvent.keyboard('XY')
    expect(screen.getByDisplayValue('BowXY')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(order(container)).toEqual(['unarmed', 'attacks:Sword', 'attacks:BowXY'])
    // The new key is kept, so the row is known the next time the sheet opens.
    expect(onChange).toHaveBeenLastCalledWith(
      'attack_order',
      'unarmed\nattacks:Sword\nattacks:BowXY'
    )
  })

  it('keeps a renamed row in place on a read-only order too', () => {
    const ast: LayoutNode[] = [
      {
        tag: 'g-order',
        attrs: { field: 'attack_order' },
        children: [
          { tag: 'g-repeat', attrs: { over: 'attacks' }, children: [text('row')] },
          item('unarmed', 'Unarmed strike'),
        ],
      },
    ]
    const stored = 'unarmed\nattacks:Sword\nattacks:Bow'
    const props = { ast, document: DOCUMENT, computed: {}, readOnly: true }
    const { container, rerender } = render(
      <LayoutRenderer
        {...props}
        data={{ attacks: ROWS.slice(0, 1).concat({ name: 'Bow', bonus: 1 }), attack_order: stored }}
      />
    )
    rerender(
      <LayoutRenderer
        {...props}
        data={{ attacks: [ROWS[0], { name: 'Bowl', bonus: 1 }], attack_order: stored }}
      />
    )
    rerender(
      <LayoutRenderer
        {...props}
        data={{ attacks: [ROWS[0], { name: 'Bowls', bonus: 1 }], attack_order: stored }}
      />
    )
    expect(order(container)).toEqual(['unarmed', 'attacks:Sword', 'attacks:Bowls'])
  })

  it("keeps a hidden block's place when another is moved", async () => {
    const onChange = vi.fn()
    const { container, rerender } = render(
      <Controlled
        onChange={onChange}
        initial={{
          attacks: ROWS,
          level: 5,
          attack_order: 'spell\nattacks:Sword\nunarmed\nattacks:Dagger',
        }}
      />
    )
    expect(order(container)).toEqual(['spell', 'attacks:Sword', 'unarmed', 'attacks:Dagger'])
    // The spell attack goes out of reach, and Dagger is moved up meanwhile.
    rerender(
      <LayoutRenderer
        ast={ORDER}
        document={DOCUMENT}
        computed={{}}
        data={{
          attacks: ROWS,
          level: 1,
          attack_order: 'spell\nattacks:Sword\nunarmed\nattacks:Dagger',
        }}
        onChange={onChange}
      />
    )
    expect(order(container)).toEqual(['attacks:Sword', 'unarmed', 'attacks:Dagger'])
    screen.getByRole('button', { name: 'Move item 3 of 3' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    const written = onChange.mock.lastCall![1] as string
    expect(written).toBe('spell\nattacks:Sword\nattacks:Dagger\nunarmed')
    // Back in reach, it is where it was.
    rerender(
      <LayoutRenderer
        ast={ORDER}
        document={DOCUMENT}
        computed={{}}
        data={{ attacks: ROWS, level: 5, attack_order: written }}
        onChange={onChange}
      />
    )
    expect(order(container)).toEqual(['spell', 'attacks:Sword', 'attacks:Dagger', 'unarmed'])
  })

  it('shows the order without handles on a read-only sheet', () => {
    const { container } = render(
      <Controlled
        readOnly
        initial={{ attacks: ROWS, level: 1, attack_order: 'attacks:Dagger\nunarmed' }}
      />
    )
    expect(order(container)).toEqual(['attacks:Sword', 'attacks:Dagger', 'unarmed'])
    expect(container.querySelector('.gc-order-handle')).toBeNull()
  })

  it('keys a catalog row by its id', () => {
    const ast: LayoutNode[] = [
      {
        tag: 'g-order',
        attrs: { field: 'attack_order' },
        children: [{ tag: 'g-repeat', attrs: { over: 'gear' }, children: [text('row')] }],
      },
    ]
    const { container } = render(
      <Controlled
        ast={ast}
        initial={{ gear: [{ _ref: 'mace' }, { _inline: true, name: ' Big\n stick ' }, null] }}
      />
    )
    expect(order(container)).toEqual(['gear:ref:mace', 'gear:Big stick', 'gear:'])
  })

  it('draws its contents as they are when the field is unknown', () => {
    const ast: LayoutNode[] = [
      { tag: 'g-order', attrs: { field: 'nope' }, children: [item('a', 'Alone')] },
      item('b', 'Outside'),
    ]
    const { container } = render(<Controlled ast={ast} initial={{}} />)
    expect(screen.getByText('Alone')).toBeInTheDocument()
    expect(screen.getByText('Outside')).toBeInTheDocument()
    expect(container.querySelector('.gc-order')).toBeNull()
  })

  it('draws a stray child as a block of its own rather than losing it', () => {
    const ast: LayoutNode[] = [
      {
        tag: 'g-order',
        attrs: { field: 'attack_order' },
        children: [{ tag: 'p', children: [text('Stray')] }, item('a', 'A')],
      },
    ]
    const { container } = render(<Controlled ast={ast} initial={{}} />)
    expect(screen.getByText('Stray')).toBeInTheDocument()
    expect(order(container)).toEqual(['#node:0', 'a'])
  })
})

describe('sheetOrder', () => {
  const block = (key: string, identity = key) => ({ key, id: identity, identity, content: null })

  it('reads a stored order once per key, ignoring blank lines', () => {
    expect(storedOrder(' a \n\nb\na\n')).toEqual(['a', 'b'])
    expect(storedOrder(7)).toEqual([])
  })

  it('sorts, numbers and moves', () => {
    const blocks = withUniqueKeys(['x', 'y', 'x'].map((key) => block(key))).map((b) => b.key)
    expect(blocks).toEqual(['x', 'y', 'x#2'])
    const sorted = sortBlocks(
      blocks.map((key) => block(key)),
      ['x#2', 'x']
    ).map((b) => b.key)
    expect(sorted).toEqual(['y', 'x#2', 'x'])
    expect(moveKey(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveKey(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })

  it('keeps the keys not drawn after the key each followed', () => {
    expect(mergeOrder(['c', 'a'], ['h0', 'a', 'h1', 'h2', 'b', 'c', 'h3'])).toEqual([
      'h0',
      'c',
      'h3',
      'a',
      'h1',
      'h2',
      'b',
    ])
    expect(mergeOrder(['a'], ['a', 'a'])).toEqual(['a'])
  })

  it('keeps at most so many keys not drawn, the first listed', () => {
    const gone = Array.from({ length: MAX_HIDDEN_KEYS + 5 }, (_, i) => `gone${i}`)
    const merged = mergeOrder(['a'], ['a', ...gone])
    expect(merged).toHaveLength(MAX_HIDDEN_KEYS + 1)
    expect(merged.at(-1)).toBe(`gone${MAX_HIDDEN_KEYS - 1}`)
  })

  it("puts a renamed block in its old key's place, only while no block draws that key", () => {
    const aliases = new Map([['row0', 'r:Bow']])
    const result = renameInOrder([block('r:BowX', 'row0')], ['u', 'r:Bow'], aliases)
    expect(result).toEqual({
      order: ['u', 'r:BowX'],
      aliases: new Map([['row0', 'r:Bow']]),
      renamed: true,
    })
    // The old key drawn by another block is that block's.
    const taken = renameInOrder(
      [block('r:BowX', 'row0'), block('r:Bow', 'row1')],
      ['r:Bow'],
      aliases
    )
    expect(taken.renamed).toBe(false)
    expect(taken.order).toEqual(['r:Bow'])
  })
})
