import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import NamingPreviewTable from './NamingPreviewTable'
import type { PreviewRow } from './namingPreview'
import type { Schema } from '../../api'

const row = (over: Partial<PreviewRow>): PreviewRow => ({
  id: 'b1',
  filename: 'raw.pdf',
  relative_path: 'books/S/raw.pdf',
  title: 'raw',
  read: null,
  title_status: 'no_match',
  proposed: null,
  rename_status: 'unavailable',
  missing: [],
  path_length: 0,
  long_path: false,
  reads_back: true,
  ...over,
})

const preview = (rows: PreviewRow[], over: Partial<Schema<'PreviewResponse'>> = {}) => ({
  path: 'books/S',
  pattern: '{title}',
  renderable: true,
  writable: true,
  total: rows.length,
  truncated: false,
  rows,
  ...over,
})

const ROWS = [
  row({
    id: 'change',
    filename: 'X - Crystallica.pdf',
    title: 'X   Crystallica',
    read: { title: 'Crystallica' },
    title_status: 'change',
    proposed: '[Pub] Crystallica.pdf',
    rename_status: 'ok',
    long_path: true,
    path_length: 300,
    reads_back: false,
  }),
  row({
    id: 'same',
    filename: 'Same.pdf',
    title: 'Same',
    title_status: 'same',
    proposed: 'Same.pdf',
    rename_status: 'same',
  }),
  row({
    id: 'missing',
    filename: 'm.pdf',
    rename_status: 'missing',
    missing: ['publisher', 'year'],
  }),
  row({ id: 'long', filename: 'l.pdf', proposed: 'L.pdf', rename_status: 'too_long' }),
  row({ id: 'clash', filename: 'c.pdf', proposed: 'C.pdf', rename_status: 'conflict' }),
]

function setup(rows = ROWS, over = {}, selected = new Set<string>()) {
  const onToggle = vi.fn()
  const onToggleAll = vi.fn()
  render(
    <NamingPreviewTable
      preview={preview(rows, over)}
      selected={selected}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
    />
  )
  return { onToggle, onToggleAll }
}

describe('NamingPreviewTable', () => {
  it('says so when the folder has no books', () => {
    setup([])
    expect(screen.getByText('No books in this folder yet.')).toBeInTheDocument()
  })

  it('shows each title change and rename outcome', () => {
    setup()
    expect(screen.getByText('5 books this pattern covers.')).toBeInTheDocument()
    expect(screen.getByText('Crystallica')).toBeInTheDocument()
    expect(screen.getByText('[Pub] Crystallica.pdf')).toBeInTheDocument()
    expect(screen.getByText(/longer than Windows/)).toHaveTextContent('300 characters')
    expect(screen.getByText("This name won't read back to the same title.")).toBeInTheDocument()
    expect(screen.getByText('Unchanged')).toBeInTheDocument()
    expect(screen.getByText('Already named')).toBeInTheDocument()
    expect(screen.getByText('Missing {publisher}, {year}')).toBeInTheDocument()
    expect(screen.getByText('Name too long')).toBeInTheDocument()
    expect(screen.getByText('Name already taken')).toBeInTheDocument()
    expect(screen.getAllByText("Doesn't fit the pattern")).toHaveLength(3)
  })

  it('only lets rows an action applies to be selected', () => {
    const { onToggle } = setup()
    const box = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` })
    expect(box('X - Crystallica.pdf')).toBeEnabled()
    expect(box('Same.pdf')).toBeDisabled()
    expect(box('c.pdf')).toBeDisabled()
    fireEvent.click(box('X - Crystallica.pdf'))
    expect(onToggle).toHaveBeenCalledWith('change')
  })

  it('selects all, or clears all once everything is on', () => {
    const first = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(first.onToggleAll).toHaveBeenCalledWith(true)
  })

  it('clears all when every actionable row is already selected', () => {
    const { onToggleAll } = setup(ROWS, {}, new Set(['change']))
    const all = screen.getByRole('checkbox', { name: 'Select all' })
    expect(all).toBeChecked()
    fireEvent.click(all)
    expect(onToggleAll).toHaveBeenCalledWith(false)
  })

  it('hides the filename column for a read-only pattern, and notes truncation', () => {
    setup(ROWS.slice(0, 1), { renderable: false, total: 1500, truncated: true })
    const table = screen.getByRole('table')
    expect(within(table).queryByText('New filename')).toBeNull()
    expect(screen.getByText(/Showing the first 1 of 1500/)).toBeInTheDocument()
  })

  it('cannot select all when nothing is actionable', () => {
    setup([row({ id: 'n' })])
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeDisabled()
  })
})
