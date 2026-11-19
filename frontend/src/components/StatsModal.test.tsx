import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatsModal from './StatsModal'
import type { Schema } from '../api'

const STATS: Schema<'StatsResponse'> = {
  game_systems: 7,
  ttrpg_systems: 5,
  wargame_systems: 2,
  books: 1300,
  ttrpg_books: 1200,
  wargame_books: 100,
  armory_books: 100,
  total_pages: 45000,
  ttrpg_pages: 40000,
  wargame_pages: 5000,
  indexed_books: 1250,
  maps: 12145,
  tokens: 300,
  audio: 12,
  models: 9,
  book_variants: 40,
  map_variants: 12000,
  token_variants: 0,
  model_variants: 3,
  audio_variants: 1,
  total_size_mb: 3072,
  ttrpg_size_mb: 2048,
  wargame_size_mb: 1024,
  maps_size_mb: 512,
  tokens_size_mb: 20,
  models_size_mb: 100,
  audio_size_mb: 300,
  library_size_mb: 4004,
}

function renderModal() {
  const onClose = vi.fn()
  render(<StatsModal stats={STATS} onClose={onClose} />)
  return onClose
}

const n = (value: number) => value.toLocaleString()
const cells = (row: HTMLElement) =>
  within(row)
    .queryAllByRole('cell')
    .map((c) => c.textContent)

describe('StatsModal', () => {
  it('tables systems, books and pages by game type, with a total row', () => {
    renderModal()
    const table = screen.getByRole('table', { name: 'Systems, books and pages' })
    const rows = within(table).getAllByRole('row')
    expect(rows.map(cells)).toEqual([
      [''],
      [n(5), n(1200), n(40000)],
      [n(2), n(100), n(5000)],
      [n(7), n(1300), n(45000)],
    ])
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('TTRPG')
    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('Wargaming')
    expect(within(rows[3]).getByRole('rowheader')).toHaveTextContent('Total')
  })

  it('tables the size of each collection, ending with the whole library', () => {
    renderModal()
    const table = screen.getByRole('table', { name: 'Size on disk' })
    expect(
      within(table)
        .getAllByRole('row')
        .map((row) => row.textContent)
    ).toEqual([
      'TTRPG Books2.00 GB',
      'Wargame Books1.00 GB',
      'Maps512 MB',
      'Tokens20 MB',
      'Models100 MB',
      'Audio300 MB',
      'Library Size3.91 GB',
    ])
  })

  it('counts each collection with its variants beside it', () => {
    renderModal()
    const table = screen.getByRole('table', { name: 'Items and variants' })
    const maps = within(table).getByRole('row', { name: /^Maps/ })
    expect(cells(maps)).toEqual([n(12145), n(12000), n(24145)])
    const books = within(table).getByRole('row', { name: /^Books/ })
    expect(cells(books)).toEqual([n(1300), n(40), n(1340)])
    expect(screen.getByText('Indexed Books').parentElement).toHaveTextContent(n(1250))
  })

  it('closes on Escape, the close button, and a click outside', async () => {
    const onClose = renderModal()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
