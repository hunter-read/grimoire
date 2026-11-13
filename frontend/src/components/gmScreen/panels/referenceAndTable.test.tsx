import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Panel } from '../types'
import { tableConfig, tableRolls } from '../types'
import ReferenceSettings from '../settings/ReferenceSettings'
import TableSettings from '../settings/TableSettings'
import ReferenceMarkdown from './ReferenceMarkdown'
import ReferencePanel from './ReferencePanel'
import TablePanel, { rollDie } from './TablePanel'

const panel = (kind: string, config = {}, state = {}): Panel => ({
  id: 'p1',
  kind,
  title: '',
  x: 0,
  y: 0,
  w: 4,
  h: 8,
  config,
  state,
})

afterEach(() => vi.restoreAllMocks())

describe('ReferencePanel', () => {
  const sections = [
    { id: 'blinded', title: 'Blinded', text: "* Can't see.\n* Attacks against it have advantage." },
    {
      id: 'cover',
      title: 'Cover',
      text: '| Cover | AC |\n| --- | --- |\n| Half | +2 |\n\n![a map](https://x.test/m.png) [SRD](https://srd.test)\n\n<b>raw</b>',
    },
    { id: 'blank', title: '', text: 'Untitled body' },
  ]

  it('shows the first section and switches between them', () => {
    render(<ReferencePanel panel={panel('reference', { sections })} onState={vi.fn()} />)
    expect(screen.getByText("Can't see.")).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Sections' })
    expect(within(group).getByRole('button', { name: 'Blinded' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(within(group).getByRole('button', { name: 'Cover' }))
    expect(screen.getByRole('columnheader', { name: 'AC' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '+2' })).toBeInTheDocument()
    // An image is its description, never fetched; a link opens without a referrer.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('a map')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SRD' })).toHaveAttribute('rel', 'noopener noreferrer')
    // Raw HTML is not rendered as markup.
    expect(document.querySelector('b')).toBeNull()

    fireEvent.click(within(group).getByRole('button', { name: 'Section 3' }))
    expect(screen.getByText('Untitled body')).toBeInTheDocument()
  })

  it('shows a lone section under its title without buttons, and says when there is none', () => {
    const { rerender } = render(
      <ReferencePanel panel={panel('reference', { sections: [sections[0]] })} onState={vi.fn()} />
    )
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Blinded' })).toBeInTheDocument()
    rerender(<ReferencePanel panel={panel('reference', {})} onState={vi.fn()} />)
    expect(screen.getByText(/No rules here yet/)).toBeInTheDocument()
  })
})

describe('ReferenceMarkdown', () => {
  it('keeps headings inside the panel and numbers ordered lists', () => {
    render(
      <ReferenceMarkdown text={'# One\n## Two\n### Three\n#### Four\n\n1. First\n2. Second'} />
    )
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'One',
      'Two',
    ])
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Three',
      'Four',
    ])
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('TablePanel', () => {
  const weather = { columns: [{ id: 'w', label: 'Weather', entries: ['Rain', 'Fog', 'Sun'] }] }

  it('rolls on its die and marks the result', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      ;(array as Uint32Array)[0] = 1
      return array
    })
    const onState = vi.fn()
    const { rerender } = render(<TablePanel panel={panel('table', weather)} onState={onState} />)
    expect(screen.getByRole('columnheader', { name: 'd3' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Roll d3' }))
    expect(onState).toHaveBeenCalledWith({ rolls: [2] })

    rerender(<TablePanel panel={panel('table', weather, { rolls: [2] })} onState={onState} />)
    expect(screen.getByTestId('table-result')).toHaveTextContent('Fog (2)')
    expect(screen.getByRole('cell', { name: 'Fog' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onState).toHaveBeenLastCalledWith({ rolls: [] })
  })

  it('lists each column of a multi-column roll, or runs them into one word', () => {
    const names = {
      columns: [
        { id: 'a', label: 'Start', entries: ['Ar', 'Bel'] },
        { id: 'b', label: 'End', entries: ['wyn', 'dor', 'ith'] },
      ],
    }
    const { rerender } = render(
      <TablePanel panel={panel('table', names, { rolls: [2, 1] })} onState={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Roll d2 + d3' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'End (d3)' })).toBeInTheDocument()
    const result = screen.getByTestId('table-result')
    expect(result).toHaveTextContent('Start:Bel (2)')
    expect(result).toHaveTextContent('End:wyn (1)')

    rerender(
      <TablePanel
        panel={panel('table', { ...names, mode: 'join' }, { rolls: [2, 1] })}
        onState={vi.fn()}
      />
    )
    expect(screen.getByTestId('table-result')).toHaveTextContent('Belwyn (2, 1)')
  })

  it('ignores a roll that no longer fits, and says when there are no entries', () => {
    const { rerender } = render(
      <TablePanel panel={panel('table', weather, { rolls: [7] })} onState={vi.fn()} />
    )
    expect(screen.getByTestId('table-result')).toBeEmptyDOMElement()
    rerender(<TablePanel panel={panel('table', {})} onState={vi.fn()} />)
    expect(screen.getByText(/No entries yet/)).toBeInTheDocument()
  })
})

describe('rollDie', () => {
  it('stays on the die and rerolls the values that would bias it', () => {
    const values = [0xffffffff, 5]
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      ;(array as Uint32Array)[0] = values.shift() ?? 0
      return array
    })
    expect(rollDie(20)).toBe(6)
    vi.restoreAllMocks()
    for (let i = 0; i < 200; i += 1) {
      const roll = rollDie(6)
      expect(roll).toBeGreaterThanOrEqual(1)
      expect(roll).toBeLessThanOrEqual(6)
    }
  })
})

describe('table readers', () => {
  it('drops columns without entries and checks a roll against them', () => {
    const config = tableConfig({
      mode: 'other',
      columns: [{ id: 'a', label: '', entries: ['x'] }, {}],
    })
    expect(config).toEqual({ mode: 'list', columns: [{ id: 'a', label: '', entries: ['x'] }] })
    expect(tableRolls({ rolls: [1] }, config)).toEqual([1])
    expect(tableRolls({ rolls: [2] }, config)).toEqual([])
    expect(tableRolls({ rolls: 'x' }, config)).toEqual([])
    expect(tableConfig({}).columns).toEqual([])
  })
})

describe('ReferenceSettings', () => {
  it('adds, edits and removes sections', () => {
    const onChange = vi.fn()
    const config = { sections: [{ id: 's1', title: 'Cover', text: 'Half' }] }
    render(<ReferenceSettings config={config} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 title' }), {
      target: { value: 'Cover rules' },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      sections: [{ id: 's1', title: 'Cover rules', text: 'Half' }],
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 text' }), {
      target: { value: '**Half**: +2' },
    })
    expect(onChange.mock.lastCall?.[0].sections[0].text).toBe('**Half**: +2')
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    expect(onChange.mock.lastCall?.[0].sections).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 1' }))
    expect(onChange).toHaveBeenLastCalledWith({ sections: [] })
  })
})

describe('TableSettings', () => {
  it('starts a new table with one column to fill in', () => {
    const onChange = vi.fn()
    render(<TableSettings config={{}} onChange={onChange} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Column 1 entries' }), {
      target: { value: 'Rain\nFog\n' },
    })
    const first = onChange.mock.lastCall?.[0]
    expect(first.columns[0].entries).toEqual(['Rain', 'Fog', ''])
    fireEvent.change(screen.getByRole('textbox', { name: 'Column 1 name' }), {
      target: { value: 'Weather' },
    })
    expect(onChange.mock.lastCall?.[0].columns[0]).toMatchObject({
      id: first.columns[0].id,
      label: 'Weather',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(onChange.mock.lastCall?.[0].columns).toHaveLength(2)
  })

  it('edits columns, the way a roll shows, and removes a column', () => {
    const onChange = vi.fn()
    const config = {
      mode: 'list',
      columns: [
        { id: 'a', label: 'Start', entries: ['Ar', 'Bel'] },
        { id: 'b', label: 'End', entries: ['wyn'] },
      ],
    }
    render(<TableSettings config={config} onChange={onChange} />)
    expect(screen.getByText('One entry per line. This column rolls a d2.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Show a roll as' }), {
      target: { value: 'join' },
    })
    expect(onChange.mock.lastCall?.[0].mode).toBe('join')
    fireEvent.change(screen.getByRole('textbox', { name: 'Column 2 entries' }), {
      target: { value: 'wyn\ndor' },
    })
    expect(onChange.mock.lastCall?.[0].columns[1].entries).toEqual(['wyn', 'dor'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Column 1 name' }), {
      target: { value: 'First' },
    })
    expect(onChange.mock.lastCall?.[0].columns[0].label).toBe('First')
    fireEvent.click(screen.getByRole('button', { name: 'Remove column 2' }))
    expect(onChange.mock.lastCall?.[0].columns.map((c: { id: string }) => c.id)).toEqual(['a'])
  })
})
