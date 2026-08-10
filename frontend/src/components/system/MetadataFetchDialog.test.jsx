import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MetadataFetchDialog from './MetadataFetchDialog'
import { clearMetadataSourcesCache } from './useMetadataSources'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts?.count !== undefined ? `${k}:${opts.count}` : k),
  }),
}))

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const api = (await import('../../api')).default

const SYSTEM = { id: 'sys-1', name: 'Blades in the Dark' }
const BOOK = { id: 'bk-1', title: 'Blades in the Dark' }

const SOURCES = {
  sources: [
    { id: 'ttrpg-wiki', name: 'TTRPG Wiki', attribution: 'TTRPG Wiki', supports_paste: true },
  ],
}
const SOURCES_NO_PASTE = {
  sources: [
    { id: 'ttrpg-wiki', name: 'TTRPG Wiki', attribution: 'TTRPG Wiki', supports_paste: false },
  ],
}

const RESULTS = {
  query: 'Blades in the Dark',
  results: [
    { identity: 'blades-in-the-dark', label: 'Blades in the Dark (1st Edition)', score: 0.9 },
    { identity: 'band-of-blades', label: 'Band of Blades (1st Edition)', score: 0.6 },
  ],
}

const DETAIL = {
  source_id: 'ttrpg-wiki',
  identity: 'blades-in-the-dark',
  url: 'https://ttrpgwiki.com/systems/blades-in-the-dark',
  attribution: 'Data from TTRPG Wiki',
  fields: [
    { field: 'year', current: null, incoming: 2017, status: 'only_incoming' },
    {
      field: 'system_family',
      current: null,
      incoming: 'Forged in the Dark',
      status: 'only_incoming',
    },
    { field: 'license', current: 'ORC', incoming: 'CC BY 3.0', status: 'differs' },
    { field: 'edition', current: '1st Edition', incoming: '1st Edition', status: 'same' },
  ],
}

function mockHappyPath() {
  api.get.mockResolvedValue(SOURCES)
  api.post.mockImplementation((url) =>
    Promise.resolve(url.endsWith('metadata-search') ? RESULTS : DETAIL)
  )
  api.patch.mockResolvedValue({ status: 'ok' })
}

async function openDiff(user) {
  await user.click(screen.getByRole('button', { name: /metadataFetch.search/i }))
  await screen.findByText('Blades in the Dark (1st Edition)')
  await user.click(screen.getByText('Blades in the Dark (1st Edition)'))
  await screen.findByText('2017')
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sources are cached per kind for the session; without this, the first
  // test's mocked list would answer for every later one.
  clearMetadataSourcesCache()
})

describe('MetadataFetchDialog', () => {
  it('loads sources and prefills the query with the system name', async () => {
    mockHappyPath()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/systems/sys-1/metadata-sources'))
    expect(screen.getByDisplayValue('Blades in the Dark')).toBeInTheDocument()
  })

  it('tells the user when no sources are installed', async () => {
    api.get.mockResolvedValue({ sources: [] })
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('metadataFetch.noSources')).toBeInTheDocument()
  })

  // The message used to render while the lookup was still in flight, so every
  // bulk-edit scrape flashed "an admin can install a metadata scraper" first.
  it('does not claim there are no sources while still loading', () => {
    let resolve
    api.get.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('metadataFetch.noSources')).toBeNull()
    resolve({ sources: [] })
  })

  it('lists candidates returned by a search', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await user.click(screen.getByRole('button', { name: /metadataFetch.search/i }))
    expect(await screen.findByText('Blades in the Dark (1st Edition)')).toBeInTheDocument()
    expect(screen.getByText('Band of Blades (1st Edition)')).toBeInTheDocument()
  })

  it('shows a friendly empty state when nothing matches', async () => {
    api.get.mockResolvedValue(SOURCES)
    api.post.mockResolvedValue({ query: 'x', results: [] })
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await user.click(screen.getByRole('button', { name: /metadataFetch.search/i }))
    expect(await screen.findByText('metadataFetch.noMatches')).toBeInTheDocument()
  })

  it('renders the per-field diff, including the superseded value', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    expect(screen.getByText('2017')).toBeInTheDocument()
    expect(screen.getByText('Forged in the Dark')).toBeInTheDocument()
    expect(screen.getByText('CC BY 3.0')).toBeInTheDocument()
    expect(screen.getByText('ORC')).toBeInTheDocument() // current value, struck through
  })

  it('pre-selects only fields the system does not already have', async () => {
    // The non-destructive default: never tick something that would overwrite.
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    expect(screen.getByLabelText('year')).toBeChecked()
    expect(screen.getByLabelText('system_family')).toBeChecked()
    expect(screen.getByLabelText('license')).not.toBeChecked()
  })

  it('disables rows that already match', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)
    expect(screen.getByLabelText('edition')).toBeDisabled()
  })

  it('applies only the selected fields', async () => {
    mockHappyPath()
    const onApply = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={onApply} onClose={onClose} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    await user.click(screen.getByRole('button', { name: /metadataFetch.apply/i }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/systems/sys-1', {
        year: 2017,
        system_family: 'Forged in the Dark',
      })
    )
    expect(onApply).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('includes a conflicting field once the user opts in', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    await user.click(screen.getByLabelText('license'))
    await user.click(screen.getByRole('button', { name: /metadataFetch.apply/i }))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        '/systems/sys-1',
        expect.objectContaining({ license: 'CC BY 3.0' })
      )
    )
  })

  it('does not apply a field the user unticks', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    await user.click(screen.getByLabelText('year'))
    await user.click(screen.getByRole('button', { name: /metadataFetch.apply/i }))

    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty('year')
  })

  it('surfaces a source error instead of failing silently', async () => {
    api.get.mockResolvedValue(SOURCES)
    api.post.mockRejectedValue(new Error('Could not reach the source: timed out'))
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await user.click(screen.getByRole('button', { name: /metadataFetch.search/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the source')
  })

  it('shows attribution and a link back to the source', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    expect(screen.getByText(/Data from TTRPG Wiki/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /metadataFetch.viewSource/i })).toHaveAttribute(
      'href',
      'https://ttrpgwiki.com/systems/blades-in-the-dark'
    )
  })

  it('goes back to the candidate list', async () => {
    mockHappyPath()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await openDiff(user)

    await user.click(screen.getByRole('button', { name: /metadataFetch.back/i }))
    expect(screen.getByText('Blades in the Dark (1st Edition)')).toBeInTheDocument()
  })

  describe('books', () => {
    it('talks to the books endpoints and prefills from the title', async () => {
      mockHappyPath()
      render(
        <MetadataFetchDialog resource={BOOK} kind="books" onApply={vi.fn()} onClose={vi.fn()} />
      )
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/books/bk-1/metadata-sources'))
      expect(screen.getByDisplayValue('Blades in the Dark')).toBeInTheDocument()
    })

    it('applies through the book PATCH endpoint', async () => {
      mockHappyPath()
      const user = userEvent.setup()
      render(
        <MetadataFetchDialog resource={BOOK} kind="books" onApply={vi.fn()} onClose={vi.fn()} />
      )
      await screen.findByDisplayValue('Blades in the Dark')
      await openDiff(user)

      await user.click(screen.getByRole('button', { name: /metadataFetch.apply/i }))
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/books/bk-1', expect.any(Object)))
    })

    it('echoes the query back on fetch, for search-backed sources', async () => {
      // DriveThruRPG answers per query rather than serving a whole catalogue,
      // so the server needs the query to re-find the chosen candidate.
      mockHappyPath()
      const user = userEvent.setup()
      render(
        <MetadataFetchDialog resource={BOOK} kind="books" onApply={vi.fn()} onClose={vi.fn()} />
      )
      await screen.findByDisplayValue('Blades in the Dark')
      await openDiff(user)

      const fetchCall = api.post.mock.calls.find(([url]) => url.endsWith('metadata-fetch'))
      expect(fetchCall[1]).toEqual({
        source_id: 'ttrpg-wiki',
        identity: 'blades-in-the-dark',
        query: 'Blades in the Dark',
      })
    })
  })

  describe('paste a link or ID', () => {
    it('offers the shortcut when the source supports it', async () => {
      mockHappyPath()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      expect(await screen.findByText('metadataFetch.pasteToggle')).toBeInTheDocument()
    })

    it('hides it for a source that cannot parse a link', async () => {
      api.get.mockResolvedValue(SOURCES_NO_PASTE)
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await screen.findByDisplayValue('Blades in the Dark')
      expect(screen.queryByText('metadataFetch.pasteToggle')).toBeNull()
    })

    it('reveals the input when the shortcut is clicked', async () => {
      mockHappyPath()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await user.click(await screen.findByText('metadataFetch.pasteToggle'))
      expect(screen.getByLabelText('metadataFetch.pasteLabel')).toBeInTheDocument()
    })

    it('sends the pasted text instead of an identity', async () => {
      mockHappyPath()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await user.click(await screen.findByText('metadataFetch.pasteToggle'))
      await user.type(
        screen.getByLabelText('metadataFetch.pasteLabel'),
        'https://ttrpgwiki.com/systems/cairn'
      )
      await user.click(screen.getByRole('button', { name: 'metadataFetch.pasteUse' }))

      const call = api.post.mock.calls.find(([url]) => url.endsWith('metadata-fetch'))
      expect(call[1]).toMatchObject({
        source_id: 'ttrpg-wiki',
        paste: 'https://ttrpgwiki.com/systems/cairn',
      })
      expect(call[1]).not.toHaveProperty('identity')
    })

    it('goes straight to the diff, skipping the candidate list', async () => {
      mockHappyPath()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await user.click(await screen.findByText('metadataFetch.pasteToggle'))
      await user.type(screen.getByLabelText('metadataFetch.pasteLabel'), 'cairn')
      await user.click(screen.getByRole('button', { name: 'metadataFetch.pasteUse' }))

      expect(await screen.findByText('2017')).toBeInTheDocument()
      expect(screen.queryByText('Blades in the Dark (1st Edition)')).toBeNull()
    })

    it('submits on Enter', async () => {
      mockHappyPath()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await user.click(await screen.findByText('metadataFetch.pasteToggle'))
      await user.type(screen.getByLabelText('metadataFetch.pasteLabel'), 'cairn{Enter}')
      await waitFor(() =>
        expect(api.post.mock.calls.some(([u]) => u.endsWith('metadata-fetch'))).toBe(true)
      )
    })

    it('will not submit an empty box', async () => {
      mockHappyPath()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await user.click(await screen.findByText('metadataFetch.pasteToggle'))
      expect(screen.getByRole('button', { name: 'metadataFetch.pasteUse' })).toBeDisabled()
    })

    it('surfaces a rejection from the server', async () => {
      api.get.mockResolvedValue(SOURCES)
      api.post.mockRejectedValue(new Error('that does not look like a link or ID'))
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await user.click(await screen.findByText('metadataFetch.pasteToggle'))
      await user.type(screen.getByLabelText('metadataFetch.pasteLabel'), 'nonsense')
      await user.click(screen.getByRole('button', { name: 'metadataFetch.pasteUse' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('does not look like')
    })
  })

  describe('merged link lists', () => {
    const MERGED_DETAIL = {
      ...DETAIL,
      fields: [
        {
          field: 'urls',
          current: [{ label: 'My notes', url: 'https://mine.example' }],
          incoming: [
            { label: 'My notes', url: 'https://mine.example' },
            { label: 'TTRPG Wiki', url: 'https://ttrpgwiki.com/systems/blades' },
          ],
          status: 'only_incoming',
        },
        ...DETAIL.fields,
      ],
    }

    const mockMerged = () => {
      api.get.mockResolvedValue(SOURCES)
      api.post.mockImplementation((url) =>
        Promise.resolve(url.endsWith('metadata-search') ? RESULTS : MERGED_DETAIL)
      )
      api.patch.mockResolvedValue({ status: 'ok' })
    }

    it('shows only the link being added, not the whole merged list', async () => {
      mockMerged()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await screen.findByDisplayValue('Blades in the Dark')
      await openDiff(user)

      expect(screen.getByText(/TTRPG Wiki: https/)).toBeInTheDocument()
      expect(screen.queryByText(/My notes: https/)).toBeNull()
    })

    it('reassures the user their existing links survive', async () => {
      mockMerged()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await screen.findByDisplayValue('Blades in the Dark')
      await openDiff(user)

      // The t() mock appends the interpolated count.
      expect(screen.getByText('metadataFetch.keepsExisting:1')).toBeInTheDocument()
    })

    it('applies the full merged list so nothing is lost', async () => {
      mockMerged()
      const user = userEvent.setup()
      render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={vi.fn()} />)
      await screen.findByDisplayValue('Blades in the Dark')
      await openDiff(user)
      await user.click(screen.getByRole('button', { name: /metadataFetch.apply/i }))

      await waitFor(() => expect(api.patch).toHaveBeenCalled())
      expect(api.patch.mock.calls[0][1].urls).toHaveLength(2)
    })
  })

  it('closes on Escape', async () => {
    mockHappyPath()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<MetadataFetchDialog resource={SYSTEM} onApply={vi.fn()} onClose={onClose} />)
    await screen.findByDisplayValue('Blades in the Dark')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
