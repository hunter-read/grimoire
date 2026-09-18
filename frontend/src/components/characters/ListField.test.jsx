import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ListField from './ListField'

const DEFINITION = {
  type: 'list',
  label: 'Equipment',
  columns: [
    { key: 'name', type: 'text', label: 'Name', flex: 3 },
    { key: 'qty', type: 'number', label: 'Qty', default: 1 },
    { key: 'equipped', type: 'checkbox', label: 'Eq.' },
  ],
}

const ROWS = [
  { name: 'Sword', qty: 1, equipped: true },
  { name: 'Rope', qty: 2, equipped: false },
]

const renderList = (props = {}) =>
  render(<ListField name="equipment" definition={DEFINITION} value={ROWS} {...props} />)

describe('ListField', () => {
  it('renders a row per entry with its cells', () => {
    renderList()
    expect(screen.getByDisplayValue('Sword')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Rope')).toBeInTheDocument()
  })

  it('shows column headings once rather than per row', () => {
    renderList()
    // Two rows, but one "Name" heading — a label above every cell would make
    // the table unreadable.
    expect(screen.getAllByText('Name')).toHaveLength(1)
  })

  it('shows an empty state when there are no rows', () => {
    renderList({ value: [] })
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument()
  })

  it('adds a row seeded from the column defaults', async () => {
    const onChange = vi.fn()
    renderList({ value: [], onChange })
    await userEvent.click(screen.getByText(/Add row/i))
    expect(onChange).toHaveBeenCalledWith([{ name: '', qty: 1, equipped: false }])
  })

  it('edits a cell without disturbing the others', async () => {
    const onChange = vi.fn()
    renderList({ onChange })
    await userEvent.type(screen.getByDisplayValue('Sword'), '!')
    expect(onChange).toHaveBeenCalledWith([
      { name: 'Sword!', qty: 1, equipped: true },
      { name: 'Rope', qty: 2, equipped: false },
    ])
  })

  it('removes a row', async () => {
    const onChange = vi.fn()
    renderList({ onChange })
    await userEvent.click(screen.getAllByLabelText(/Remove row/i)[0])
    expect(onChange).toHaveBeenCalledWith([{ name: 'Rope', qty: 2, equipped: false }])
  })

  it('reorders rows', async () => {
    const onChange = vi.fn()
    renderList({ onChange })
    await userEvent.click(screen.getAllByLabelText(/Move row down/i)[0])
    expect(onChange).toHaveBeenCalledWith([
      { name: 'Rope', qty: 2, equipped: false },
      { name: 'Sword', qty: 1, equipped: true },
    ])
  })

  it('cannot move the first row up or the last row down', () => {
    renderList()
    expect(screen.getAllByLabelText(/Move row up/i)[0]).toBeDisabled()
    const downs = screen.getAllByLabelText(/Move row down/i)
    expect(downs[downs.length - 1]).toBeDisabled()
  })

  it('offers no editing affordances when read-only', () => {
    renderList({ readOnly: true })
    expect(screen.queryByText(/Add row/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Remove row/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('treats a non-list value as empty rather than failing', () => {
    expect(() => renderList({ value: 'nonsense' })).not.toThrow()
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument()
  })

  it('uses a schema-supplied add label and empty text', () => {
    renderList({
      value: [],
      definition: { ...DEFINITION, add_label: 'Add gear', empty_text: 'Travelling light.' },
    })
    expect(screen.getByText('Add gear')).toBeInTheDocument()
    expect(screen.getByText('Travelling light.')).toBeInTheDocument()
  })
})
