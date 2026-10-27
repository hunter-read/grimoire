import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { useReducer } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SystemBulkEditFields from './SystemBulkEditFields'
import type { SystemBulkEditFieldsProps, SystemDraft } from './SystemBulkEditFields'
import type { CoverPickerBook } from './coverPickerUtils'

const get: Mock = vi.fn((path?: string) => {
  if (path?.includes('genres')) return Promise.resolve({ genres: [] })
  if (path?.includes('system-families')) return Promise.resolve({ families: [] })
  return Promise.resolve({ books: [] })
})
vi.mock('../../api', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: vi.fn(() => Promise.resolve({})) },
  tags: { list: () => Promise.resolve({ tags: [] }) },
  mediaUrl: (p: string) => p,
}))

// The access-level picker renders for admins only; null (no provider) is how
// every other test here runs.
let currentAuth: { user: { role: string } } | null = null
vi.mock('../../context/AuthContext', () => ({ useAuth: () => currentAuth }))

// Renders the fields with a controllable draft: setField mutates the draft in
// place and forces a re-render so chip/publisher edits are observable.
function Harness({
  system,
  initialDraft,
}: {
  system: SystemBulkEditFieldsProps['system'] & { name?: string }
  initialDraft: SystemDraft
}) {
  const draft = initialDraft
  const [, force] = useReducer((n: number) => n + 1, 0)
  const setField = (field: string, value: unknown) => {
    ;(draft as Record<string, unknown>)[field] = value
    force()
  }
  return <SystemBulkEditFields system={system} draft={draft} setField={setField} />
}

const withBooks = (books: CoverPickerBook[]) => ({ id: 's1', name: 'Alpha', books })

beforeEach(() => {
  currentAuth = null
  get.mockClear()
  get.mockResolvedValue({ books: [] })
})

describe('SystemBulkEditFields', () => {
  it('adds and removes a tag chip', () => {
    const draft: SystemDraft = { tags: [], publishers: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)

    const tagInput = screen.getByPlaceholderText('Add tag…')
    fireEvent.change(tagInput, { target: { value: 'osr' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(draft.tags).toEqual(['osr'])
    const chip = screen.getByText('osr')
    expect(chip).toBeInTheDocument()

    // The chip's own remove button (scoped to the chip, not other remove btns).
    fireEvent.click(chip.querySelector('button')!)
    expect(draft.tags).toEqual([])
  })

  it('adds and edits a publisher row', () => {
    const draft: SystemDraft = { tags: [], publishers: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)

    fireEvent.click(screen.getByText('Add Publisher'))
    expect(draft.publishers).toHaveLength(1)

    fireEvent.change(screen.getByPlaceholderText('Publisher name'), {
      target: { value: 'Acme' },
    })
    expect(draft.publishers![0].name).toBe('Acme')
  })

  it("edits a publisher's URL and removes the row", () => {
    const draft: SystemDraft = {
      tags: [],
      publishers: [
        { name: 'Acme', url: '' },
        { name: 'Other', url: '' },
      ],
    }
    render(<Harness system={withBooks([])} initialDraft={draft} />)

    fireEvent.change(screen.getAllByPlaceholderText('URL (optional)')[0], {
      target: { value: 'https://acme.test' },
    })
    expect(draft.publishers![0]).toEqual({ name: 'Acme', url: 'https://acme.test' })

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(draft.publishers).toEqual([{ name: 'Other', url: '' }])
  })

  it('edits a character builder link, the access level and the explicit flag', () => {
    currentAuth = { user: { role: 'admin' } }
    const draft: SystemDraft = { tags: [], publishers: [], character_builder_urls: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)

    fireEvent.change(document.getElementById('sys-bulk-cb-url-url-0')!, {
      target: { value: 'https://builder.test' },
    })
    expect(draft.character_builder_urls![0].url).toBe('https://builder.test')

    fireEvent.change(document.getElementById('sys-bulk-access-level')!, {
      target: { value: 'gm' },
    })
    expect(draft.access_level).toBe('gm')

    fireEvent.click(screen.getByLabelText('Mark system as explicit (18+)'))
    expect(draft.is_explicit).toBe(true)
  })

  it('renders a cover picker and selects a book', () => {
    const books = [{ id: 'b1', title: 'Core', has_thumbnail: true }]
    const draft: SystemDraft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={withBooks(books)} initialDraft={draft} />)

    const coverBtn = screen.getByRole('button', { name: 'Core' })
    fireEvent.click(coverBtn)
    expect(draft.cover_book_id).toBe('b1')

    // Clicking the selected cover again clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Core' }))
    expect(draft.cover_book_id).toBeNull()
  })

  // Rendering every thumbnail at once made the modal's footer buttons shift as
  // covers streamed in, so bulk edit pages exactly like the single-system
  // editor does.
  it('pages covers at eight rather than rendering the whole library', () => {
    const books = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      title: `Book ${i}`,
      has_thumbnail: true,
    }))
    const draft: SystemDraft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={withBooks(books)} initialDraft={draft} />)

    expect(screen.getAllByRole('button', { name: /^Book \d+$/ })).toHaveLength(8)
    expect(screen.getByText('Show 12 more')).toBeInTheDocument()
  })

  it('edits the system family via the combobox', () => {
    const draft: SystemDraft = { tags: [], publishers: [], system_family: '' }
    render(<Harness system={withBooks([])} initialDraft={draft} />)
    fireEvent.change(document.getElementById('sys-bulk-family')!, {
      target: { value: 'Fate' },
    })
    expect(draft.system_family).toBe('Fate')
  })

  it('adds a dice/material via the picker (default option)', () => {
    const draft: SystemDraft = { tags: [], publishers: [], dice_materials: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)
    const diceInput = screen.getByRole('combobox', { name: /add dice\/material/i })
    fireEvent.focus(diceInput)
    fireEvent.change(diceInput, { target: { value: 'D20' } })
    fireEvent.keyDown(diceInput, { key: 'Enter' })
    expect(draft.dice_materials).toEqual(['D20'])
  })

  it('edits a generic link row', () => {
    const draft: SystemDraft = { tags: [], publishers: [], urls: [] }
    render(<Harness system={withBooks([])} initialDraft={draft} />)
    fireEvent.change(document.getElementById('sys-bulk-url-url-0')!, {
      target: { value: 'http://x' },
    })
    expect(draft.urls![0].url).toBe('http://x')
  })

  it('lazy-fetches books when the system has none and shows their covers', async () => {
    get.mockResolvedValue({ books: [{ id: 'b9', title: 'Fetched', has_thumbnail: true }] })
    const draft: SystemDraft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={{ id: 's1', name: 'Alpha' }} initialDraft={draft} />)

    await waitFor(() => expect(get).toHaveBeenCalledWith('/systems/s1'))
    await screen.findByRole('button', { name: 'Fetched' })
  })

  // A system whose books fail to load still has to be editable — the cover
  // picker just has nothing to offer.
  it('degrades to no covers when the book lookup fails', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/systems/s1') return Promise.reject(new Error('nope'))
      if (path?.includes('genres')) return Promise.resolve({ genres: [] })
      return Promise.resolve({ families: [] })
    })
    const draft: SystemDraft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={{ id: 's1', name: 'Alpha' }} initialDraft={draft} />)

    await waitFor(() => expect(get).toHaveBeenCalledWith('/systems/s1'))
    expect(screen.queryByText('Cover image')).toBeNull()
  })

  it('reuses books already carried on the system without refetching', async () => {
    const books = [{ id: 'b1', title: 'Core', has_thumbnail: true }]
    const draft: SystemDraft = { tags: [], publishers: [], cover_book_id: null }
    render(<Harness system={withBooks(books)} initialDraft={draft} />)

    await screen.findByRole('button', { name: 'Core' })
    expect(get).not.toHaveBeenCalledWith('/systems/s1')
  })
})
