import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenrePicker from './GenrePicker'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${o.name}` : k) }),
}))
vi.mock('../../api', () => ({ default: { post: vi.fn(() => Promise.resolve({ id: 'new' })) } }))

const tree = [
  { id: 'sci', name: 'Science Fiction', parent_id: null, sort_order: 1 },
  { id: 'cyber', name: 'Cyberpunk', parent_id: 'sci', sort_order: 1 },
]

function Harness({ initial = [], inheritGenres = null }) {
  const [selected, setSelected] = useState(initial)
  return (
    <GenrePicker
      genreTree={tree}
      selected={selected}
      onChange={setSelected}
      onGenreCreated={vi.fn()}
      inheritGenres={inheritGenres}
    />
  )
}

beforeEach(() => vi.clearAllMocks())

describe('GenrePicker', () => {
  it('shows the empty placeholder', () => {
    render(<Harness />)
    expect(screen.getByText('metadata.noGenres')).toBeInTheDocument()
  })

  it('opens a filtered list on focus and adds a genre by clicking', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox'))
    // Clicking an option adds it as a chip.
    await userEvent.click(screen.getByRole('option', { name: /Cyberpunk/ }))
    expect(screen.getByText('Cyberpunk')).toBeInTheDocument()
  })

  it('filters the list as you type', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'cyber')
    // Science Fiction is filtered out; Cyberpunk matches (plus a create row).
    expect(screen.getByRole('option', { name: /Cyberpunk/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Science Fiction/ })).not.toBeInTheDocument()
  })

  it('indents child options in the list', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox'))
    const cyber = screen.getByRole('option', { name: /Cyberpunk/ })
    expect(cyber.textContent).toContain('└')
  })

  it('offers a create row and persists a custom genre via the API', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'Solarpunk')
    // The create row appears (label uses createGenre:{{name}}).
    await userEvent.click(screen.getByRole('option', { name: /createGenre:Solarpunk/ }))
    expect(screen.getByText('Solarpunk')).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/genres', { name: 'Solarpunk' })
  })

  it('does not offer create for an existing genre name', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'Cyberpunk')
    expect(screen.queryByRole('option', { name: /createGenre/ })).not.toBeInTheDocument()
  })

  it('adds the active option on Enter', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('combobox'), 'science{Enter}')
    expect(screen.getByText('Science Fiction')).toBeInTheDocument()
  })

  it('removes a selected genre via its chip button', async () => {
    render(<Harness initial={['Fantasy']} />)
    await userEvent.click(screen.getByLabelText('Remove Fantasy'))
    expect(screen.queryByText('Fantasy')).not.toBeInTheDocument()
  })

  it('removes the last chip on Backspace when the input is empty', async () => {
    render(<Harness initial={['Fantasy', 'Horror']} />)
    const input = screen.getByRole('combobox')
    input.focus()
    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByText('Horror')).not.toBeInTheDocument()
    expect(screen.getByText('Fantasy')).toBeInTheDocument()
  })

  it('does not show the inherit button when inheritGenres is null', () => {
    render(<Harness />)
    expect(screen.queryByText('metadata.inheritFromSystem')).not.toBeInTheDocument()
  })

  it('merges system genres on inherit, keeping extras and avoiding duplicates', async () => {
    // Book already has "Horror" (an extra) and "Fantasy" (also on the system).
    render(<Harness initial={['Horror', 'Fantasy']} inheritGenres={['Fantasy', 'Sci-Fi']} />)
    await userEvent.click(screen.getByText('metadata.inheritFromSystem'))
    // Fantasy not duplicated; Horror kept; Sci-Fi added.
    expect(screen.getAllByText('Fantasy')).toHaveLength(1)
    expect(screen.getByText('Horror')).toBeInTheDocument()
    expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
  })

  it('disables the inherit button when nothing new to add', () => {
    render(<Harness initial={['Fantasy']} inheritGenres={['Fantasy']} />)
    expect(screen.getByText('metadata.inheritFromSystem')).toBeDisabled()
  })
})
