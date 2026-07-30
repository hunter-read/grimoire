import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useReducer } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import BookBulkEditFields from './BookBulkEditFields'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const get = vi.fn((path) => {
  if (path?.includes('genres')) return Promise.resolve({ genres: [] })
  if (path?.includes('system-families')) return Promise.resolve({ families: [] })
  return Promise.resolve({})
})
vi.mock('../../api', () => ({
  default: { get: (...a) => get(...a), post: vi.fn() },
  tags: { list: () => Promise.resolve({ tags: [] }) },
}))

// setField mutates the draft in place and forces a re-render.
function Harness({ initialDraft, systemGenres = [] }) {
  const draft = initialDraft
  const [, force] = useReducer((n) => n + 1, 0)
  const setField = (field, value) => {
    draft[field] = value
    force()
  }
  return (
    <BookBulkEditFields
      draft={draft}
      setField={setField}
      existingCategories={['screens']}
      systemGenres={systemGenres}
    />
  )
}

beforeEach(() => vi.clearAllMocks())

describe('BookBulkEditFields', () => {
  it('edits the title', () => {
    const draft = { title: 'Old', tags: [], genres: [] }
    render(<Harness initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('bookEditor.titleLabel'), { target: { value: 'New' } })
    expect(draft.title).toBe('New')
  })

  it('adds a tag chip', () => {
    const draft = { tags: [], genres: [] }
    render(<Harness initialDraft={draft} />)
    const input = screen.getByRole('combobox', { name: 'tags.addTag' })
    fireEvent.change(input, { target: { value: 'osr' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(draft.tags).toEqual(['osr'])
  })

  it('parses authors CSV into an array', () => {
    const draft = { tags: [], genres: [], authors: [] }
    render(<Harness initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('bookEditor.authorsLabel'), {
      target: { value: 'Ada, Grace' },
    })
    expect(draft.authors).toEqual(['Ada', 'Grace'])
  })

  it('shows the inherit-from-system control for genres', () => {
    const draft = { tags: [], genres: [] }
    render(<Harness initialDraft={draft} systemGenres={['Fantasy']} />)
    expect(screen.getByText('metadata.inheritFromSystem')).toBeInTheDocument()
  })

  it('toggles the explicit flag', () => {
    const draft = { tags: [], genres: [], is_explicit: false }
    render(<Harness initialDraft={draft} />)
    fireEvent.click(screen.getByLabelText('bookEditor.markExplicit'))
    expect(draft.is_explicit).toBe(true)
  })

  it('edits the description, publisher, isbn, version and language', () => {
    const draft = { tags: [], genres: [] }
    render(<Harness initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('bookEditor.descriptionLabel'), {
      target: { value: 'Desc' },
    })
    fireEvent.change(screen.getByLabelText('bookEditor.publisherLabel'), {
      target: { value: 'WotC' },
    })
    fireEvent.change(screen.getByLabelText('bookEditor.isbnLabel'), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText('bookEditor.versionLabel'), { target: { value: '2e' } })
    fireEvent.change(screen.getByLabelText('bookEditor.languageLabel'), { target: { value: 'en' } })
    expect(draft.description).toBe('Desc')
    expect(draft.publisher).toBe('WotC')
    expect(draft.isbn).toBe('123')
    expect(draft.version).toBe('2e')
    expect(draft.language).toBe('en')
  })

  it('edits the publication date fields', () => {
    const draft = { tags: [], genres: [] }
    render(<Harness initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('bookEditor.yearLabel'), { target: { value: '2019' } })
    fireEvent.change(screen.getByLabelText('bookEditor.monthLabel'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('bookEditor.dayLabel'), { target: { value: '15' } })
    expect(draft.year).toBe('2019')
    expect(draft.month).toBe('6')
    expect(draft.day).toBe('15')
  })

  it('parses artists CSV and edits a link row', () => {
    const draft = { tags: [], genres: [], artists: [], urls: [] }
    render(<Harness initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('bookEditor.artistsLabel'), {
      target: { value: 'Jane, Bob' },
    })
    expect(draft.artists).toEqual(['Jane', 'Bob'])
    fireEvent.change(document.getElementById('book-bulk-url-url-0'), {
      target: { value: 'http://x' },
    })
    expect(draft.urls[0].url).toBe('http://x')
  })

  it('picks a category via the combobox', () => {
    const draft = { tags: [], genres: [], category: 'core' }
    render(<Harness initialDraft={draft} />)
    const combo = screen.getByRole('combobox', { name: 'bookEditor.categoryLabel' })
    fireEvent.focus(combo)
    fireEvent.change(combo, { target: { value: 'screens' } })
    fireEvent.click(screen.getByRole('option', { name: 'screens' }))
    expect(draft.category).toBe('screens')
  })
})
