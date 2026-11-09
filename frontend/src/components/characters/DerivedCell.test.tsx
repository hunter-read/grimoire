import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ListField from './ListField'
import LayoutRenderer from './LayoutRenderer'
import type { LayoutNode } from './LayoutRenderer'
import CharacterSheet from './CharacterSheet'
import { buildContext } from './expressions'

vi.mock('../../api', () => ({
  characters: {
    portraitUrl: (id: string, v: number) => `/api/characters/${id}/portrait?v=${v}`,
    imageUrl: (id: string, field: string, v: number) =>
      `/api/characters/${id}/images/${field}?v=${v}`,
  },
}))

// A family record whose `age` follows `campaign_year - born` (issue #827).
const LIST = {
  type: 'list',
  label: 'Family',
  columns: [
    { key: 'name', type: 'text', label: 'Name' },
    { key: 'born', type: 'number', label: 'Born' },
    {
      key: 'age',
      type: 'number',
      label: 'Age',
      min: 0,
      default: 7,
      default_from: 'born ? campaign_year - born : null',
    },
  ],
}

const DOCUMENT = {
  fields: { campaign_year: { type: 'number', default: 1890 }, family: LIST },
}

type Row = Record<string, unknown>

const derivedFor = (rows: Row[]) =>
  buildContext(DOCUMENT, { family: rows }).family as Record<string, unknown>[]

// Holds the stored rows the way the character view does, and records every
// value written, so a test can see exactly what would be saved.
function Harness({ initial, onSave }: { initial: Row[]; onSave: (rows: Row[]) => void }) {
  const [rows, setRows] = useState(initial)
  return (
    <ListField
      name="family"
      definition={LIST}
      value={rows}
      derivedRows={derivedFor(rows)}
      onChange={(next) => {
        setRows(next)
        onSave(next)
      }}
    />
  )
}

const ageInput = () => screen.getAllByRole('spinbutton')[1] as HTMLInputElement

describe('ListField with a derived column', () => {
  it('shows the worked-out value in an empty cell, marked automatic', () => {
    render(<Harness initial={[{ name: 'Ada', born: 1850, age: null }]} onSave={vi.fn()} />)
    expect(ageInput().value).toBe('40')
    expect(screen.getByRole('img', { name: /set from your choices/i })).toBeInTheDocument()
  })

  it('keeps the stored row when another cell is edited', async () => {
    const onSave = vi.fn()
    render(<Harness initial={[{ name: 'Ada', born: 1850, age: null }]} onSave={onSave} />)
    await userEvent.type(screen.getByDisplayValue('Ada'), '!')
    expect(onSave).toHaveBeenLastCalledWith([{ name: 'Ada!', born: 1850, age: null }])
  })

  it('makes a typed value the players, with a reset that hands it back', async () => {
    const onSave = vi.fn()
    render(<Harness initial={[{ name: 'Ada', born: 1850, age: null }]} onSave={onSave} />)
    await userEvent.clear(ageInput())
    await userEvent.type(ageInput(), '45')
    expect(onSave).toHaveBeenLastCalledWith([{ name: 'Ada', born: 1850, age: 45 }])
    expect(screen.queryByRole('img', { name: /set from your choices/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /use the automatic value/i }))
    expect(onSave).toHaveBeenLastCalledWith([{ name: 'Ada', born: 1850, age: null }])
    expect(ageInput().value).toBe('40')
  })

  it('leaves a cleared cell empty until the player moves on, then follows the formula', async () => {
    render(<Harness initial={[{ name: 'Ada', born: 1850, age: 12 }]} onSave={vi.fn()} />)
    await userEvent.clear(ageInput())
    // Still focused: the 40 does not come back under the cursor.
    expect(ageInput().value).toBe('')
    await userEvent.tab()
    expect(ageInput().value).toBe('40')
  })

  it('brings the value back at once from the reset on a cell just cleared', async () => {
    render(<Harness initial={[{ name: 'Ada', born: 1850, age: 12 }]} onSave={vi.fn()} />)
    await userEvent.clear(ageInput())
    await userEvent.click(screen.getByRole('button', { name: /use the automatic value/i }))
    expect(ageInput().value).toBe('40')
  })

  it('adds a row without storing the derived column default', async () => {
    const onSave = vi.fn()
    render(<Harness initial={[]} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(onSave).toHaveBeenLastCalledWith([{ name: '', born: null, age: null }])
  })

  it('shows the worked-out value read-only, without the marker', () => {
    render(
      <ListField
        name="family"
        definition={LIST}
        value={[{ name: 'Ada', born: 1850, age: null }]}
        derivedRows={derivedFor([{ name: 'Ada', born: 1850, age: null }])}
        readOnly
      />
    )
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /set from your choices/i })).toBeNull()
  })
})

describe('a derived column in a <g-repeat>', () => {
  const ast: LayoutNode[] = [
    {
      tag: 'g-repeat',
      attrs: { over: 'family' },
      children: [
        { tag: 'g-field', attrs: { name: 'age', label: '' } },
        {
          tag: 'g-if',
          attrs: { test: 'age > 30' },
          children: [{ tag: 'span', children: [{ text: 'Elder' }] }],
        },
      ],
    },
  ]

  it('shows the derived cell, and conditions read the same number', () => {
    const data = { family: [{ name: 'Ada', born: 1850, age: null }] }
    render(
      <LayoutRenderer
        ast={ast}
        document={DOCUMENT}
        data={data}
        context={buildContext(DOCUMENT, data)}
        onChange={vi.fn()}
      />
    )
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('40')
    expect(screen.getByText('Elder')).toBeInTheDocument()
  })

  it('writes the stored row back when the cell is typed over', async () => {
    const onChange = vi.fn()
    const data = { family: [{ name: 'Ada', born: 1850, age: null }] }
    render(
      <LayoutRenderer
        ast={ast}
        document={DOCUMENT}
        data={data}
        context={buildContext(DOCUMENT, data)}
        onChange={onChange}
      />
    )
    await userEvent.type(screen.getByRole('spinbutton'), '1')
    // Typing edits the 40 shown, as on any derived field, and the row is written with it.
    expect(onChange).toHaveBeenLastCalledWith('family', [{ name: 'Ada', born: 1850, age: 401 }])
  })
})

describe('a derived column on the sheet', () => {
  it('reaches the list through the plain sectioned layout', () => {
    render(
      <CharacterSheet
        document={{ ...DOCUMENT, layout: [{ title: 'Kin', fields: ['family'] }] }}
        data={{ family: [{ name: 'Ada', born: 1850, age: null }] }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByDisplayValue('40')).toBeInTheDocument()
  })
})
