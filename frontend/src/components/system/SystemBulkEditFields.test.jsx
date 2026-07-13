import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useReducer } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SystemBulkEditFields from './SystemBulkEditFields'

const get = vi.fn(() => Promise.resolve({ books: [] }))
vi.mock('../../api', () => ({
  default: { get: (...a) => get(...a) },
  mediaUrl: (p) => p,
}))

// Renders the fields with a controllable draft: setField mutates the draft in
// place and forces a re-render so chip/publisher edits are observable.
function Harness({ system, initialDraft }) {
  const draft = initialDraft
  const [, force] = useReducer((n) => n + 1, 0)
  const setField = (field, value) => {
    draft[field] = value
    force()
  }
  return <SystemBulkEditFields system={system} draft={draft} setField={setField} />
}

const withBooks = (books) => ({ id: 's1', name: 'Alpha', books })

beforeEach(() => {
  get.mockClear()
  get.mockResolvedValue({ books: [] })
})

describe('SystemBulkEditFields', () => {
  it('adds and removes a tag chip', () => {
    const draft = { tags: [], publishers: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)

    const tagInput = screen.getByPlaceholderText('Add tag…')
    fireEvent.change(tagInput, { target: { value: 'osr' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(draft.tags).toEqual(['osr'])
    expect(screen.getByText('osr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(draft.tags).toEqual([])
  })

  it('adds and edits a publisher row', () => {
    const draft = { tags: [], publishers: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)

    fireEvent.click(screen.getByText('Add Publisher'))
    expect(draft.publishers).toHaveLength(1)

    fireEvent.change(screen.getByPlaceholderText('Publisher name'), {
      target: { value: 'Acme' },
    })
    expect(draft.publishers[0].name).toBe('Acme')
  })

  it('renders a cover picker and selects a book', () => {
    const books = [{ id: 'b1', title: 'Core', has_thumbnail: true }]
    const draft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={withBooks(books)} initialDraft={draft} />)

    const coverBtn = screen.getByRole('button', { name: 'Core' })
    fireEvent.click(coverBtn)
    expect(draft.cover_book_id).toBe('b1')

    // Clicking the selected cover again clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Core' }))
    expect(draft.cover_book_id).toBeNull()
  })

  it('lazy-fetches books when the system has none and shows their covers', async () => {
    get.mockResolvedValue({ books: [{ id: 'b9', title: 'Fetched', has_thumbnail: true }] })
    const draft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={{ id: 's1', name: 'Alpha' }} initialDraft={draft} />)

    await waitFor(() => expect(get).toHaveBeenCalledWith('/systems/s1'))
    await screen.findByRole('button', { name: 'Fetched' })
  })
})
