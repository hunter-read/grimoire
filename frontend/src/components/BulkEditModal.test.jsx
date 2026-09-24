import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import BulkEditModal from './BulkEditModal'
import { clearMetadataSourcesCache } from './system/useMetadataSources'

const patch = vi.fn(() => Promise.resolve({}))
const defaultPost = () => Promise.resolve({ id: 'g1', name: 'Fantasy' })
const post = vi.fn(defaultPost)
// useLookups fetches /genres and /system-families; return empty lookup lists.
const defaultGet = (path) => {
  if (path?.includes('metadata-sources')) return Promise.resolve({ sources: [] })
  if (path?.includes('genres')) return Promise.resolve({ genres: [] })
  if (path?.includes('system-families')) return Promise.resolve({ families: [] })
  return Promise.resolve({ books: [] })
}
const get = vi.fn(defaultGet)
// "Save all" sends the whole batch through the bulk endpoint (issue #270).
const bulkUpdate = vi.fn(() => Promise.resolve({ updated: [], errors: [] }))
vi.mock('../api', () => ({
  default: {
    patch: (...args) => patch(...args),
    get: (...args) => get(...args),
    post: (...args) => post(...args),
  },
  bulk: {
    update: (...args) => bulkUpdate(...args),
    addTags: vi.fn(() => Promise.resolve({ updated: [], errors: [], tags: {} })),
    setFolderTags: vi.fn(() => Promise.resolve({ folders: [] })),
  },
  tags: { list: () => Promise.resolve({ tags: [] }) },
  mediaUrl: (p) => p,
}))

const items = [
  { id: 'm1', filename: 'alpha.png', tags: ['old'], description: 'first' },
  { id: 'm2', filename: 'beta.png', tags: [], description: '' },
]

const books = [
  { id: 'b1', title: 'Alpha', category: 'core', tags: [], genres: [], urls: [] },
  { id: 'b2', title: 'Beta', category: 'core', tags: [], genres: [], urls: [] },
  { id: 'b3', title: 'Gamma', category: 'core', tags: [], genres: [], urls: [] },
]

function renderModal(props = {}) {
  return render(
    <BulkEditModal type="map" items={items} onClose={vi.fn()} onSaved={vi.fn()} {...props} />
  )
}

describe('BulkEditModal', () => {
  beforeEach(() => {
    patch.mockClear()
    get.mockClear()
    // Sources are cached per kind for the session; without this, the first
    // test's mocked list would answer for every later one.
    clearMetadataSourcesCache()
    bulkUpdate.mockClear()
    bulkUpdate.mockResolvedValue({ updated: [], errors: [] })
    get.mockImplementation(defaultGet)
    post.mockClear()
    post.mockImplementation(defaultPost)
  })

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
    // Only m1 changed → it alone is sent, in a single bulk request (issue #270).
    expect(bulkUpdate).toHaveBeenCalledTimes(1)
    expect(bulkUpdate).toHaveBeenCalledWith('map', [{ id: 'm1', tags: ['old', 'new'] }])
    expect(patch).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith({ m1: { tags: ['old', 'new'] } })
  })

  // Issue #270: a failed save left the button stuck on "Applying" forever
  // because `saving` was never reset on the error path.
  it('re-enables the save button after a failed save', async () => {
    bulkUpdate.mockRejectedValueOnce(new Error('Internal Server Error'))
    const onSaved = vi.fn()
    renderModal({ onSaved })

    fireEvent.change(screen.getByPlaceholderText('Comma-separated tags'), {
      target: { value: 'old, new' },
    })
    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(screen.getByText('Internal Server Error')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
    // Back to "Save all" rather than stuck on the applying label.
    expect(screen.getByText('Save all')).toBeInTheDocument()
  })

  it('reports per-item errors and omits those items from onSaved', async () => {
    bulkUpdate.mockResolvedValueOnce({
      updated: [],
      errors: [{ id: 'm1', detail: 'Map not found' }],
    })
    const onSaved = vi.fn()
    renderModal({ onSaved })

    fireEvent.change(screen.getByPlaceholderText('Comma-separated tags'), {
      target: { value: 'old, new' },
    })
    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(screen.getByText('Map not found')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('edits system genres via the genre combobox', async () => {
    const onSaved = vi.fn()
    // Seed `books` so the cover picker doesn't lazy-fetch.
    const systems = [
      { id: 's1', name: 'Alpha', tags: ['osr'], genres: [], is_explicit: false, books: [] },
    ]
    render(<BulkEditModal type="system" items={systems} onClose={vi.fn()} onSaved={onSaved} />)

    expect(screen.getByText('Alpha')).toBeInTheDocument()

    // Genres use the shared GenrePicker combobox (aria-label "Add genre"): type
    // then pick the create row.
    const combo = screen.getByRole('combobox', { name: /add genre/i })
    fireEvent.change(combo, { target: { value: 'Fantasy' } })
    fireEvent.click(await screen.findByRole('option', { name: /Fantasy/ }))

    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(bulkUpdate).toHaveBeenCalledWith('system', [{ id: 's1', genres: ['Fantasy'] }])
    expect(onSaved).toHaveBeenCalledWith({ s1: { genres: ['Fantasy'] } })
  })

  it('edits system description, publishers, and explicit flag', async () => {
    const onSaved = vi.fn()
    const systems = [
      {
        id: 's1',
        name: 'Alpha',
        description: '',
        tags: [],
        publishers: [],
        genre: '',
        is_explicit: false,
        books: [],
      },
    ]
    render(<BulkEditModal type="system" items={systems} onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A dark realm' } })

    // Add a publisher row and fill in its name.
    fireEvent.click(screen.getByText('Add Publisher'))
    fireEvent.change(screen.getByPlaceholderText('Publisher name'), {
      target: { value: 'Acme' },
    })

    fireEvent.click(screen.getByLabelText(/mark system as explicit/i))

    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(bulkUpdate).toHaveBeenCalledWith('system', [
      {
        id: 's1',
        description: 'A dark realm',
        publishers: [{ name: 'Acme', url: '' }],
        is_explicit: true,
      },
    ])
  })

  it('lazy-fetches books for the cover picker when absent', async () => {
    const systems = [{ id: 's1', name: 'Alpha', tags: [], genre: '', is_explicit: false }]
    render(<BulkEditModal type="system" items={systems} onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(get).toHaveBeenCalledWith('/systems/s1'))
  })

  // Issue #260: the carousel only ever edited the item on screen, so changing a
  // book's category moved one book instead of the whole selection.
  describe('apply to all', () => {
    const openDialog = () =>
      fireEvent.click(screen.getByRole('button', { name: /^Apply to all \d+$/ }))

    it('copies the ticked category onto every selected book', async () => {
      const onSaved = vi.fn()
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={onSaved} />)

      // Change the first book's category, then push it to the rest.
      const combo = screen.getByRole('combobox', { name: /category/i })
      fireEvent.focus(combo)
      fireEvent.change(combo, { target: { value: 'Adventures' } })
      fireEvent.click(await screen.findByRole('option', { name: 'Adventures & Modules' }))

      openDialog()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Category' }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }))

      fireEvent.click(screen.getByText('Save all'))

      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      // All three books ride in a single request rather than three PATCHes.
      expect(bulkUpdate).toHaveBeenCalledTimes(1)
      expect(bulkUpdate).toHaveBeenCalledWith('book', [
        { id: 'b1', category: 'adventure' },
        { id: 'b2', category: 'adventure' },
        { id: 'b3', category: 'adventure' },
      ])
      expect(onSaved).toHaveBeenCalledWith({
        b1: { category: 'adventure' },
        b2: { category: 'adventure' },
        b3: { category: 'adventure' },
      })
    })

    it('copies only the ticked fields, leaving the rest per-item', async () => {
      const onSaved = vi.fn()
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={onSaved} />)

      // Edit two fields on the first book but tick only one of them.
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Shared Title' } })
      fireEvent.change(screen.getByLabelText('Publisher'), { target: { value: 'Acme' } })

      openDialog()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Publisher' }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }))

      fireEvent.click(screen.getByText('Save all'))
      await waitFor(() => expect(onSaved).toHaveBeenCalled())

      const saved = onSaved.mock.calls[0][0]
      // Publisher was ticked, so it spread; the title stayed on book one.
      expect(saved.b2).toEqual({ publisher: 'Acme' })
      expect(saved.b3).toEqual({ publisher: 'Acme' })
      expect(saved.b1).toEqual({ title: 'Shared Title', publisher: 'Acme' })
    })

    // The bulk-edit body renders its own checkboxes behind the dialog, so the
    // checklist is queried within the dialog rather than the whole screen.
    const dialogBoxes = () =>
      within(screen.getByRole('dialog', { name: /^Apply to all/ })).getAllByRole('checkbox')

    it('starts with every field unchecked', () => {
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)
      openDialog()

      for (const box of dialogBoxes()) expect(box).not.toBeChecked()
      // Nothing ticked → nothing to apply.
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    })

    it('ticks and unticks everything via select all', () => {
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)
      openDialog()

      fireEvent.click(screen.getByText('Select all'))
      for (const box of dialogBoxes()) expect(box).toBeChecked()

      fireEvent.click(screen.getByText('Select none'))
      for (const box of dialogBoxes()) expect(box).not.toBeChecked()
    })

    it('shows the copied value on the other items in the carousel', () => {
      render(<BulkEditModal type="map" items={items} onClose={vi.fn()} onSaved={vi.fn()} />)

      const tagsInput = screen.getByPlaceholderText('Comma-separated tags')
      fireEvent.change(tagsInput, { target: { value: 'shared' } })

      openDialog()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Tags' }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }))

      // Step to the second map — it now carries the copied tags.
      fireEvent.click(screen.getByLabelText('Next'))
      expect(screen.getByPlaceholderText('Comma-separated tags')).toHaveValue('shared')
    })

    it('gives each item its own copy of a structured value', async () => {
      const onSaved = vi.fn()
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={onSaved} />)

      // Add a genre to the first book, then push it to the rest.
      const combo = screen.getByRole('combobox', { name: /add genre/i })
      fireEvent.change(combo, { target: { value: 'Horror' } })
      fireEvent.click(await screen.findByRole('option', { name: /Horror/ }))

      openDialog()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Genres' }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }))

      fireEvent.click(screen.getByText('Save all'))
      await waitFor(() => expect(onSaved).toHaveBeenCalled())

      const saved = onSaved.mock.calls[0][0]
      expect(saved.b1.genres).toEqual(['Horror'])
      expect(saved.b2.genres).toEqual(['Horror'])
      // Cloned, not shared by reference.
      expect(saved.b2.genres).not.toBe(saved.b1.genres)
    })

    it('omits fields that are meaningless to copy', () => {
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)
      openDialog()
      // An ISBN identifies one specific book, so it is never offered.
      expect(screen.queryByRole('checkbox', { name: 'ISBN' })).toBeNull()
      expect(screen.queryByRole('checkbox', { name: 'Product code' })).toBeNull()
      expect(screen.getByRole('checkbox', { name: 'Category' })).toBeInTheDocument()
    })

    it('is not offered for a single-item selection', () => {
      render(<BulkEditModal type="map" items={[items[0]]} onClose={vi.fn()} onSaved={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /apply to all/i })).toBeNull()
    })
  })

  describe('metadata fetch', () => {
    it('offers the fetch button when the current book has a source', async () => {
      get.mockImplementation((path) => {
        if (path?.includes('metadata-sources')) {
          return Promise.resolve({ sources: [{ id: 'wiki', name: 'TTRPG Wiki' }] })
        }
        if (path?.includes('genres')) return Promise.resolve({ genres: [] })
        return Promise.resolve({ books: [] })
      })

      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)

      await waitFor(() => expect(get).toHaveBeenCalledWith('/books/b1/metadata-sources'))
      expect(await screen.findByText('Fetch metadata')).toBeInTheDocument()
    })

    it('hides the fetch button when no source is available', async () => {
      get.mockImplementation((path) => {
        if (path?.includes('metadata-sources')) return Promise.resolve({ sources: [] })
        if (path?.includes('genres')) return Promise.resolve({ genres: [] })
        return Promise.resolve({ books: [] })
      })

      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => expect(get).toHaveBeenCalledWith('/books/b1/metadata-sources'))
      expect(screen.queryByText('Fetch metadata')).toBeNull()
    })

    it('does not look for sources for types add-ons do not serve', async () => {
      render(<BulkEditModal type="map" items={items} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => expect(screen.getByText('alpha.png')).toBeInTheDocument())
      expect(get).not.toHaveBeenCalledWith(expect.stringContaining('metadata-sources'))
    })
  })

  // Issue #256: dismissing threw the drafts away silently, which is punishing
  // after editing a large selection, so a dirty modal confirms first.
  describe('unsaved-changes guard', () => {
    const dirty = () =>
      fireEvent.change(screen.getByPlaceholderText('Comma-separated tags'), {
        target: { value: 'old, new' },
      })

    it('closes straight away when nothing was edited', () => {
      const onClose = vi.fn()
      renderModal({ onClose })

      fireEvent.click(screen.getByText('Cancel'))

      expect(onClose).toHaveBeenCalled()
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
    })

    it('asks before discarding edits instead of closing', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      dirty()

      fireEvent.click(screen.getByText('Cancel'))

      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
    })

    it('keeps the edits when the user backs out of the confirmation', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      dirty()
      fireEvent.click(screen.getByText('Cancel'))

      fireEvent.click(screen.getByText('Keep editing'))

      expect(onClose).not.toHaveBeenCalled()
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
      // The draft survived the round trip through the confirmation.
      expect(screen.getByPlaceholderText('Comma-separated tags')).toHaveValue('old, new')
    })

    it('closes once the discard is confirmed', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      dirty()
      fireEvent.click(screen.getByText('Cancel'))

      fireEvent.click(screen.getByText('Discard changes'))

      expect(onClose).toHaveBeenCalled()
    })

    it('guards the X button too', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      dirty()

      fireEvent.click(screen.getByLabelText('Close'))

      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
    })
  })

  // Issue #466: working metadata through a large selection took a scroll, three
  // clicks in the fetch dialog and a trip back to the carousel per item. The
  // fetch now sits beside the item and runs as a loop across the selection.
  describe('batch metadata fetch (issue #466)', () => {
    const FETCHED = { authors: ['Ann', 'Bo'], year: 2001 }
    const withSources = () => {
      get.mockImplementation((path) => {
        if (path?.includes('metadata-sources')) {
          return Promise.resolve({ sources: [{ id: 'wiki', name: 'TTRPG Wiki' }] })
        }
        return defaultGet(path)
      })
      post.mockImplementation((url, body) =>
        Promise.resolve(
          url.endsWith('metadata-search')
            ? { results: [{ identity: 'hit', label: `Match for ${body.query}` }] }
            : {
                fields: [
                  {
                    field: 'authors',
                    current: [],
                    incoming: FETCHED.authors,
                    status: 'only_incoming',
                  },
                  { field: 'year', current: null, incoming: FETCHED.year, status: 'only_incoming' },
                ],
              }
        )
      )
    }
    const renderBooks = (props = {}) =>
      render(
        <BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} {...props} />
      )
    const fetchDialog = () => within(screen.getByRole('dialog', { name: 'Fetch metadata' }))
    // The dialog carries the bulk editor's own navigation bar: name and position.
    const expectDialogOn = (name, position) => {
      expect(fetchDialog().getByText(name)).toBeInTheDocument()
      expect(fetchDialog().getByText(position)).toBeInTheDocument()
    }
    const openFetch = async () =>
      fireEvent.click(await screen.findByRole('button', { name: 'Fetch metadata' }))
    const pickMatch = async (title) => {
      fireEvent.click(await screen.findByRole('button', { name: `Match for ${title}` }))
      return screen.findByRole('button', { name: 'Apply 2 fields & next' })
    }

    beforeEach(withSources)

    it('opens from the item header and searches straight away', async () => {
      renderBooks()
      await openFetch()
      expect(await screen.findByRole('button', { name: 'Match for Alpha' })).toBeInTheDocument()
      expect(post).toHaveBeenCalledWith('/books/b1/metadata-search', {
        source_id: 'wiki',
        query: 'Alpha',
      })
      expectDialogOn('Alpha', '1 of 3')
    })

    it('applies and moves the whole run on to the next item', async () => {
      renderBooks()
      await openFetch()
      fireEvent.click(await pickMatch('Alpha'))

      // The dialog stays open, now searching for the second book.
      expect(await screen.findByRole('button', { name: 'Match for Beta' })).toBeInTheDocument()
      expect(patch).toHaveBeenCalledWith('/books/b1', FETCHED)
      expectDialogOn('Beta', '2 of 3')
    })

    it('skips an item without writing to it', async () => {
      renderBooks()
      await openFetch()
      await screen.findByRole('button', { name: 'Match for Alpha' })
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

      expect(await screen.findByRole('button', { name: 'Match for Beta' })).toBeInTheDocument()
      expect(patch).not.toHaveBeenCalled()
    })

    it('reuses the chosen source for the next item', async () => {
      get.mockImplementation((path) => {
        if (path?.includes('metadata-sources')) {
          return Promise.resolve({
            sources: [
              { id: 'wiki', name: 'TTRPG Wiki' },
              { id: 'geek', name: 'RPGGeek' },
            ],
          })
        }
        return defaultGet(path)
      })
      renderBooks()
      await openFetch()
      await screen.findByRole('button', { name: 'Match for Alpha' })
      fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'geek' } })
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

      await screen.findByRole('button', { name: 'Match for Beta' })
      expect(post).toHaveBeenLastCalledWith('/books/b2/metadata-search', {
        source_id: 'geek',
        query: 'Beta',
      })
    })

    it('goes back to an item and shows its matches without searching again', async () => {
      renderBooks()
      await openFetch()
      await screen.findByRole('button', { name: 'Match for Alpha' })
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
      await screen.findByRole('button', { name: 'Match for Beta' })

      fireEvent.click(fetchDialog().getByRole('button', { name: 'Previous' }))
      expect(await screen.findByRole('button', { name: 'Match for Alpha' })).toBeInTheDocument()
      expectDialogOn('Alpha', '1 of 3')
      const searches = post.mock.calls.filter(([url]) => url === '/books/b1/metadata-search')
      expect(searches).toHaveLength(1)
    })

    // The look-alike case: the wrong match was applied, so coming back should
    // show which one that was and let the right one replace its values.
    it('marks the last pick and pre-ticks the fields it filled in', async () => {
      renderBooks()
      await openFetch()
      fireEvent.click(await pickMatch('Alpha'))
      await screen.findByRole('button', { name: 'Match for Beta' })

      fireEvent.click(fetchDialog().getByRole('button', { name: 'Previous' }))
      const earlier = await screen.findByRole('button', {
        name: 'Match for Alpha picked last time',
      })
      post.mockImplementation(() =>
        Promise.resolve({
          fields: [
            { field: 'authors', current: FETCHED.authors, incoming: ['Cy'], status: 'differs' },
            { field: 'year', current: FETCHED.year, incoming: 2004, status: 'differs' },
          ],
        })
      )
      fireEvent.click(earlier)

      expect(await screen.findByLabelText('authors')).toBeChecked()
      expect(screen.getByLabelText('year')).toBeChecked()
    })

    it('ends the run on the last item with a plain apply', async () => {
      renderBooks()
      fireEvent.click(screen.getByLabelText('Next'))
      fireEvent.click(screen.getByLabelText('Next'))
      await openFetch()
      await screen.findByRole('button', { name: 'Match for Gamma' })

      expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Match for Gamma' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Apply 2 fields' }))
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Fetch metadata' })).toBeNull()
      )
    })

    // Fetched authors used to be flattened to "Ann, Bo" text for the single-book
    // editor's form, which the bulk body (arrays) then rendered as empty.
    it('keeps fetched authors as a list the bulk form can show', async () => {
      const { container } = renderBooks()
      await openFetch()
      fireEvent.click(await pickMatch('Alpha'))
      await screen.findByRole('button', { name: 'Match for Beta' })
      fireEvent.keyDown(window, { key: 'Escape' })
      fireEvent.click(screen.getByLabelText('Previous'))

      expect(container.querySelector('#book-bulk-authors')).toHaveValue('Ann, Bo')
    })

    it('does not resend fetched fields, but reports them as saved', async () => {
      const onSaved = vi.fn()
      renderBooks({ onSaved })
      await openFetch()
      fireEvent.click(await pickMatch('Alpha'))
      await screen.findByRole('button', { name: 'Match for Beta' })
      fireEvent.keyDown(window, { key: 'Escape' })

      fireEvent.click(screen.getByText('Save all'))
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      // Already PATCHed by the dialog, so nothing is left for the bulk request.
      expect(bulkUpdate).not.toHaveBeenCalled()
      expect(onSaved).toHaveBeenCalledWith({ b1: FETCHED })
    })

    it('merges a fetch with later hand edits when saving', async () => {
      const onSaved = vi.fn()
      renderBooks({ onSaved })
      await openFetch()
      fireEvent.click(await screen.findByRole('button', { name: 'Match for Alpha' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Apply 2 fields' }))
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Fetch metadata' })).toBeNull()
      )
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Alpha Revised' } })

      fireEvent.click(screen.getByText('Save all'))
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(bulkUpdate).toHaveBeenCalledWith('book', [{ id: 'b1', title: 'Alpha Revised' }])
      expect(onSaved).toHaveBeenCalledWith({ b1: { ...FETCHED, title: 'Alpha Revised' } })
    })

    it('closes without asking when only fetched (already saved) fields changed', async () => {
      const onSaved = vi.fn()
      const onClose = vi.fn()
      renderBooks({ onSaved, onClose })
      await openFetch()
      fireEvent.click(await pickMatch('Alpha'))
      await screen.findByRole('button', { name: 'Match for Beta' })
      fireEvent.keyDown(window, { key: 'Escape' })

      fireEvent.click(screen.getByText('Cancel'))
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
      // The parent still needs the new values, so this is a save, not a cancel.
      expect(onSaved).toHaveBeenCalledWith({ b1: FETCHED })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('still reports fetched fields when other edits are discarded', async () => {
      const onSaved = vi.fn()
      renderBooks({ onSaved })
      await openFetch()
      fireEvent.click(await pickMatch('Alpha'))
      await screen.findByRole('button', { name: 'Match for Beta' })
      fireEvent.keyDown(window, { key: 'Escape' })
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Beta Revised' } })

      fireEvent.click(screen.getByText('Cancel'))
      fireEvent.click(screen.getByText('Discard changes'))
      expect(onSaved).toHaveBeenCalledWith({ b1: FETCHED })
    })
  })

  describe('keyboard paging (issue #466)', () => {
    it('moves between items with the arrow keys', () => {
      renderModal()
      fireEvent.keyDown(document.body, { key: 'ArrowRight' })
      expect(screen.getByText('2 of 2')).toBeInTheDocument()
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
    })

    it('leaves arrow keys alone while typing in a field', () => {
      renderModal()
      fireEvent.keyDown(screen.getByPlaceholderText('Comma-separated tags'), { key: 'ArrowRight' })
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
    })

    it('ignores arrows with a modifier held', () => {
      renderModal()
      fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true })
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
    })

    it('opens the fetch with F when a source exists', async () => {
      get.mockImplementation((path) =>
        path?.includes('metadata-sources')
          ? Promise.resolve({ sources: [{ id: 'wiki', name: 'TTRPG Wiki' }] })
          : defaultGet(path)
      )
      post.mockImplementation(() => Promise.resolve({ results: [] }))
      render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)
      await screen.findByRole('button', { name: 'Fetch metadata' })

      fireEvent.keyDown(document.body, { key: 'f' })
      expect(await screen.findByRole('dialog', { name: 'Fetch metadata' })).toBeInTheDocument()
    })

    it('does nothing on F where there is nothing to fetch from', () => {
      renderModal()
      fireEvent.keyDown(document.body, { key: 'f' })
      expect(screen.queryByRole('dialog', { name: 'Fetch metadata' })).toBeNull()
    })

    it('starts each item at the top of the form', () => {
      renderModal()
      const body = screen
        .getByPlaceholderText('Comma-separated tags')
        .closest('[style*="overflow-y: auto"]')
      body.scrollTop = 300
      fireEvent.click(screen.getByLabelText('Next'))
      expect(body.scrollTop).toBe(0)
    })
  })
})
