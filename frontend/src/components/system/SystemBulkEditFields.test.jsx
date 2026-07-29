import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useReducer } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SystemBulkEditFields from './SystemBulkEditFields'

const get = vi.fn((path) => {
  if (path?.includes('genres')) return Promise.resolve({ genres: [] })
  if (path?.includes('system-families')) return Promise.resolve({ families: [] })
  return Promise.resolve({ books: [] })
})
vi.mock('../../api', () => ({
  default: { get: (...a) => get(...a), post: vi.fn(() => Promise.resolve({})) },
  tags: { list: () => Promise.resolve({ tags: [] }) },
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
    const chip = screen.getByText('osr')
    expect(chip).toBeInTheDocument()

    // The chip's own remove button (scoped to the chip, not other remove btns).
    fireEvent.click(chip.querySelector('button'))
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

  it('edits the system family via the combobox', () => {
    const draft = { tags: [], publishers: [], system_family: '' }
    render(<Harness system={withBooks([])} initialDraft={draft} />)
    fireEvent.change(document.getElementById('sys-bulk-family'), {
      target: { value: 'Fate' },
    })
    expect(draft.system_family).toBe('Fate')
  })

  it('adds a dice/material via the picker (default option)', () => {
    const draft = { tags: [], publishers: [], dice_materials: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)
    const diceInput = screen.getByRole('combobox', { name: /add dice\/material/i })
    fireEvent.focus(diceInput)
    fireEvent.change(diceInput, { target: { value: 'D20' } })
    fireEvent.keyDown(diceInput, { key: 'Enter' })
    expect(draft.dice_materials).toEqual(['D20'])
  })

  it('edits a generic link row', () => {
    const draft = { tags: [], publishers: [], urls: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)
    fireEvent.change(document.getElementById('sys-bulk-url-url-0'), {
      target: { value: 'http://x' },
    })
    expect(draft.urls[0].url).toBe('http://x')
  })

  it('lazy-fetches books when the system has none and shows their covers', async () => {
    get.mockResolvedValue({ books: [{ id: 'b9', title: 'Fetched', has_thumbnail: true }] })
    const draft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={{ id: 's1', name: 'Alpha' }} initialDraft={draft} />)

    await waitFor(() => expect(get).toHaveBeenCalledWith('/systems/s1'))
    await screen.findByRole('button', { name: 'Fetched' })
  })
})
