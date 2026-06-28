import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BulkEditModal from './BulkEditModal'

const patch = vi.fn(() => Promise.resolve({}))
vi.mock('../api', () => ({
  default: { patch: (...args) => patch(...args) },
}))

const items = [
  { id: 'm1', filename: 'alpha.png', tags: ['old'], description: 'first' },
  { id: 'm2', filename: 'beta.png', tags: [], description: '' },
]

function renderModal(props = {}) {
  return render(
    <BulkEditModal type="map" items={items} onClose={vi.fn()} onSaved={vi.fn()} {...props} />
  )
}

describe('BulkEditModal', () => {
  beforeEach(() => patch.mockClear())

  it('shows the first item and a position indicator', () => {
    renderModal()
    expect(screen.getByText('alpha.png')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('navigates through the carousel', () => {
    renderModal()
    fireEvent.click(screen.getByLabelText('Next'))
    expect(screen.getByText('beta.png')).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('only PATCHes items whose fields changed', async () => {
    const onSaved = vi.fn()
    renderModal({ onSaved })

    // Edit the tags field of the first (currently shown) item.
    const tagsInput = screen.getByPlaceholderText('Comma-separated tags')
    fireEvent.change(tagsInput, { target: { value: 'old, new' } })

    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // Only m1 changed → one PATCH.
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith('/maps/m1', { tags: ['old', 'new'] })
    expect(onSaved).toHaveBeenCalledWith({ m1: { tags: ['old', 'new'] } })
  })

  it('edits game systems via the /systems endpoint', async () => {
    const onSaved = vi.fn()
    const systems = [{ id: 's1', name: 'Alpha', tags: ['osr'], genre: '', is_explicit: false }]
    render(<BulkEditModal type="system" items={systems} onClose={vi.fn()} onSaved={onSaved} />)

    // System name is shown in the carousel header.
    expect(screen.getByText('Alpha')).toBeInTheDocument()

    // Fields render in config order (genre, character builder url, tags); genre
    // is the first text input. Labels aren't `for`-associated, so select by order.
    const genreInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(genreInput, { target: { value: 'Fantasy' } })
    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(patch).toHaveBeenCalledWith('/systems/s1', { genre: 'Fantasy' })
    expect(onSaved).toHaveBeenCalledWith({ s1: { genre: 'Fantasy' } })
  })
})
