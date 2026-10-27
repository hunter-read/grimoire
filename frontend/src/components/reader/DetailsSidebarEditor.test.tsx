import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetailsSidebarEditor from './DetailsSidebarEditor'
import { clearMetadataSourcesCache } from '../system/useMetadataSources'

// The real dialog is covered by its own tests; this stand-in applies a fixed
// result so the editor's handling of applied fields can be checked here.
vi.mock('../system/MetadataFetchDialog', () => ({
  default: ({ onApply, onClose }) => (
    <div role="dialog">
      <button
        onClick={() => {
          onApply({
            publisher: 'Fetched Press',
            authors: ['A. Writer', 'B. Writer'],
            year: 2020,
            tags: ['osr'],
            codex_id: 'bk_phb',
          })
          onClose()
        }}
      >
        apply fetched
      </button>
    </div>
  ),
}))

const mockPatch = vi.fn(() => Promise.resolve({}))
const mockGet = vi.fn((path) =>
  Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
)
vi.mock('../../api', () => ({
  default: {
    patch: (...args) => mockPatch(...args),
    // useLookups loads the genre tree and licence list on mount.
    get: (...args) => mockGet(...args),
    post: () => Promise.resolve({}),
  },
  // TagPicker loads the tag catalog.
  tags: { list: () => Promise.resolve({ tags: [] }) },
}))

function makeBook(overrides = {}) {
  return {
    id: 'book-1',
    title: "Player's Handbook",
    description: '',
    authors: ['Jeremy Crawford'],
    artists: [],
    publisher: 'Wizards',
    year: 2014,
    category: 'core',
    genres: [],
    is_explicit: false,
    tags: [],
    urls: [],
    ...overrides,
  }
}

function renderEditor(props = {}) {
  const onSaved = props.onSaved || vi.fn()
  const onCancel = props.onCancel || vi.fn()
  const onApplied = props.onApplied || vi.fn()
  return {
    ...render(
      <DetailsSidebarEditor
        book={makeBook(props.book)}
        onSaved={onSaved}
        onCancel={onCancel}
        onApplied={onApplied}
      />
    ),
    onSaved,
    onCancel,
    onApplied,
  }
}

describe('DetailsSidebarEditor', () => {
  beforeEach(() => {
    clearMetadataSourcesCache()
    mockPatch.mockReset()
    mockPatch.mockResolvedValue({})
    mockGet.mockReset()
    mockGet.mockImplementation((path) =>
      Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
    )
  })

  it('pre-fills the fields from the book', () => {
    renderEditor()
    expect(screen.getByLabelText('Title')).toHaveValue("Player's Handbook")
    expect(screen.getByLabelText('Authors (comma-separated)')).toHaveValue('Jeremy Crawford')
    expect(screen.getByLabelText('Publisher')).toHaveValue('Wizards')
    expect(screen.getByLabelText('Year')).toHaveValue('2014')
  })

  it('PATCHes the edited metadata and reports the merged book back', async () => {
    const { onSaved } = renderEditor()

    const title = screen.getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Revised PHB')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledOnce())
    const [path, payload] = mockPatch.mock.calls[0]
    expect(path).toBe('/books/book-1')
    expect(payload.title).toBe('Revised PHB')
    // Comma-separated text fields are split back into arrays for the API.
    expect(payload.authors).toEqual(['Jeremy Crawford'])
    expect(payload.year).toBe(2014)

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revised PHB' }))
    )
  })

  it('splits comma-separated authors and artists into arrays', async () => {
    renderEditor()
    const artists = screen.getByLabelText('Artists (comma-separated)')
    await userEvent.type(artists, 'Ana Lopez,  Bo Chen ,')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledOnce())
    expect(mockPatch.mock.calls[0][1].artists).toEqual(['Ana Lopez', 'Bo Chen'])
  })

  it('sends a null year when the field is cleared', async () => {
    renderEditor()
    await userEvent.clear(screen.getByLabelText('Year'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledOnce())
    expect(mockPatch.mock.calls[0][1].year).toBeNull()
  })

  it('toggles the explicit flag', async () => {
    renderEditor()
    await userEvent.click(screen.getByLabelText('Mark as explicit content'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPatch).toHaveBeenCalledOnce())
    expect(mockPatch.mock.calls[0][1].is_explicit).toBe(true)
  })

  it('surfaces a failed save and does not report it as saved', async () => {
    mockPatch.mockRejectedValue(new Error('nope'))
    const { onSaved } = renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Failed to save.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    // The button returns to its idle label so the save can be retried.
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it('calls onCancel without saving when Cancel is clicked', async () => {
    const { onCancel } = renderEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('offers no Fetch metadata button when no source is available', async () => {
    renderEditor()
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/books/book-1/metadata-sources'))
    expect(screen.queryByRole('button', { name: /fetch metadata/i })).not.toBeInTheDocument()
  })

  it('fills the form from a fetched source and reports what was applied', async () => {
    mockGet.mockImplementation((path) => {
      if (path.endsWith('/metadata-sources'))
        return Promise.resolve({ sources: [{ id: 'grimoire-codex', name: 'Grimoire Codex DB' }] })
      return Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
    })
    const { onApplied } = renderEditor()

    await userEvent.click(await screen.findByRole('button', { name: /fetch metadata/i }))
    await userEvent.click(screen.getByRole('button', { name: 'apply fetched' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Publisher')).toHaveValue('Fetched Press')
    expect(screen.getByLabelText(/^Authors/)).toHaveValue('A. Writer, B. Writer')
    expect(screen.getByLabelText('Year')).toHaveValue('2020')
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ codex_id: 'bk_phb' }))

    // A later Save carries the fetched tags; the link stays out of the payload.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    const [, payload] = mockPatch.mock.calls[0]
    expect(payload.tags).toEqual(['osr'])
    expect(payload).not.toHaveProperty('codex_id')
  })
})
