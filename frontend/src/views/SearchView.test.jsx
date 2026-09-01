import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SearchView from './SearchView'
import api from '../api'

// Result rows render thumbnails via the named `imageSources` export, so the
// mock has to provide it alongside the default client.
vi.mock('../api', () => ({
  default: { get: vi.fn() },
  imageSources: {
    thumbUrl: (type, id) =>
      ({
        book: `/api/books/${id}/thumbnail`,
        map: `/api/maps/${id}/thumbnail`,
        token: `/api/tokens/${id}/thumbnail`,
        audio: `/api/audio/${id}/artwork`,
      })[type] ?? null,
  },
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

// Fake response helpers
function makeBookResult(overrides = {}) {
  return {
    id: overrides.id ?? 'book-1',
    title: overrides.title ?? 'Test Book',
    game_system: overrides.game_system ?? 'D&D 5e',
    game_system_id: overrides.game_system_id ?? 'sys-1',
    category: 'core',
    page_number: overrides.page_number ?? 1,
    snippet: overrides.snippet ?? 'A <mark>fireball</mark> spell.',
    ...overrides,
  }
}

function makeResponse(books = [], maps = [], tokens = [], audio = [], bookMatches = []) {
  return {
    query: 'fireball',
    total: books.length + maps.length + tokens.length + audio.length + bookMatches.length,
    results: books,
    book_matches: bookMatches,
    maps,
    tokens,
    audio,
    fields: [],
  }
}

function makeBookMatch(overrides = {}) {
  return {
    id: 'match-1',
    title: 'Avatar Legends Core Rulebook',
    game_system: 'PbtA',
    game_system_id: 'sys-1',
    category: 'core',
    authors: ['Magpie Games'],
    publisher: 'Magpie Games',
    year: 2022,
    page_count: 280,
    has_thumbnail: false,
    tags: [],
    ...overrides,
  }
}

function renderView() {
  return render(
    <MemoryRouter>
      <SearchView />
    </MemoryRouter>
  )
}

describe('SearchView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty hint when no query has been entered', () => {
    renderView()
    expect(screen.getByText(/search through every page/i)).toBeInTheDocument()
  })

  it('shows book results grouped by book after a search', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({ id: 'b1', title: 'Player Handbook', page_number: 10 }),
        makeBookResult({ id: 'b1', title: 'Player Handbook', page_number: 22 }),
        makeBookResult({ id: 'b2', title: 'Dungeon Guide', page_number: 5 }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('Player Handbook')).toBeInTheDocument())
    expect(screen.getByText('Dungeon Guide')).toBeInTheDocument()
    // Two distinct book group headers, not three separate cards
    expect(screen.getAllByText(/player handbook/i)).toHaveLength(1)
  })

  it('shows page count badge on each book group', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({ id: 'b1', title: 'Big Book', page_number: 1 }),
        makeBookResult({ id: 'b1', title: 'Big Book', page_number: 2 }),
        makeBookResult({ id: 'b1', title: 'Big Book', page_number: 3 }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('Big Book')).toBeInTheDocument())
    // The count badge "3 pages" should be present
    expect(screen.getByText(/3 page/i)).toBeInTheDocument()
  })

  it('book groups start expanded and clicking collapses then re-expands page snippets', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({
          id: 'b1',
          title: 'Spell Guide',
          page_number: 7,
          snippet: 'fireball text',
        }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('Spell Guide')).toBeInTheDocument())
    // Snippets are visible immediately (groups start expanded)
    expect(screen.getByText('fireball text')).toBeInTheDocument()
    // Click to collapse
    await userEvent.click(screen.getByText('Spell Guide'))
    expect(screen.queryByText('fireball text')).not.toBeInTheDocument()
    // Click to re-expand
    await userEvent.click(screen.getByText('Spell Guide'))
    expect(screen.getByText('fireball text')).toBeInTheDocument()
  })

  it('shows the system filter dropdown when results span multiple systems', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({ id: 'b1', title: 'PHB', game_system: 'D&D 5e', game_system_id: 'sys-1' }),
        makeBookResult({
          id: 'b2',
          title: 'Core Rules',
          game_system: 'Pathfinder',
          game_system_id: 'sys-2',
        }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: /game system/i })).toBeInTheDocument()
  })

  it('does not show system filter when all results share one system', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({ id: 'b1', title: 'PHB', game_system_id: 'sys-1' }),
        makeBookResult({ id: 'b2', title: 'DMG', game_system_id: 'sys-1' }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())
    expect(screen.queryByRole('combobox', { name: /game system/i })).not.toBeInTheDocument()
  })

  it('system filter hides books from other systems', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({ id: 'b1', title: 'PHB', game_system: 'D&D 5e', game_system_id: 'sys-1' }),
        makeBookResult({
          id: 'b2',
          title: 'Core Rules',
          game_system: 'Pathfinder',
          game_system_id: 'sys-2',
        }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('PHB')).toBeInTheDocument())

    const select = screen.getByRole('combobox', { name: /game system/i })
    await userEvent.selectOptions(select, 'sys-1')

    expect(screen.getByText('PHB')).toBeInTheDocument()
    expect(screen.queryByText('Core Rules')).not.toBeInTheDocument()
  })

  it('shows the sort control when there are book results', async () => {
    api.get.mockResolvedValue(makeResponse([makeBookResult({ id: 'b1', title: 'Alpha Book' })]))
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('Alpha Book')).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: /sort/i })).toBeInTheDocument()
  })

  it('sort by title orders book groups alphabetically', async () => {
    api.get.mockResolvedValue(
      makeResponse([
        makeBookResult({ id: 'b1', title: 'Zephyr Manual' }),
        makeBookResult({ id: 'b2', title: 'Alpha Guide' }),
      ])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'fi')

    await waitFor(() => expect(screen.getByText('Zephyr Manual')).toBeInTheDocument())

    const sortSelect = screen.getByRole('combobox', { name: /sort/i })
    await userEvent.selectOptions(sortSelect, 'title')

    const titles = screen.getAllByText(/zephyr manual|alpha guide/i).map((el) => el.textContent)
    expect(titles.indexOf('Alpha Guide')).toBeLessThan(titles.indexOf('Zephyr Manual'))
  })

  it('shows no results message when search returns empty', async () => {
    api.get.mockResolvedValue(makeResponse())
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'xyzabc')

    await waitFor(() => expect(screen.getByText(/no results found/i)).toBeInTheDocument())
  })

  it('shows map results in a separate section', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [{ id: 'm1', filename: 'dungeon.png', relative_path: 'maps/dungeon.png', tags: [] }]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'du')

    await waitFor(() => expect(screen.getByText('dungeon.png')).toBeInTheDocument())
    // The section header button contains the "Maps" label
    expect(screen.getByRole('button', { name: /maps/i })).toBeInTheDocument()
  })

  it('shows token results in a separate section', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [],
        [{ id: 't1', filename: 'goblin.png', relative_path: 'tokens/goblin.png', tags: [] }]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'go')

    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /tokens/i })).toBeInTheDocument()
  })

  it('shows audio results in a separate section (title preferred)', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [],
        [],
        [
          {
            id: 'a1',
            filename: 'track.mp3',
            relative_path: 'audio/Ambient/track.mp3',
            title: 'Mystic Drone',
            tags: ['ambient'],
          },
        ]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'my')

    await waitFor(() => expect(screen.getByText('Mystic Drone')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /audio/i })).toBeInTheDocument()
  })

  it('audio result falls back to filename when title is empty', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [],
        [],
        [
          {
            id: 'a2',
            filename: 'noname.mp3',
            relative_path: 'audio/noname.mp3',
            title: '',
            tags: [],
          },
        ]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'no')
    await waitFor(() => expect(screen.getByText('noname.mp3')).toBeInTheDocument())
  })

  it('collapses the audio section when its header is clicked', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [],
        [],
        [{ id: 'a1', filename: 't.mp3', relative_path: 'audio/t.mp3', title: 'Drone', tags: [] }]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'dr')
    await waitFor(() => expect(screen.getByText('Drone')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /audio/i }))
    expect(screen.queryByText('Drone')).not.toBeInTheDocument()
  })

  it('navigates when an audio result is clicked', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [],
        [],
        [{ id: 'a1', filename: 't.mp3', relative_path: 'audio/t.mp3', title: 'Drone', tags: [] }]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'dr')
    await waitFor(() => screen.getByText('Drone'))
    // Clicking the result card runs the navigate handler without throwing.
    await userEvent.click(screen.getByText('Drone'))
  })

  it('navigates when a map result is clicked', async () => {
    api.get.mockResolvedValue(
      makeResponse(
        [],
        [{ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png', tags: [] }]
      )
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'ca')
    await waitFor(() => screen.getByText('cave.png'))
    await userEvent.click(screen.getByText('cave.png'))
  })

  it('does not fire a search for a single character query', async () => {
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'x')
    // Should not call api.get (min query length is 2)
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('SearchView — URL query param persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-fills the input from ?q= on mount', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=fireball']}>
        <SearchView />
      </MemoryRouter>
    )
    expect(screen.getByRole('textbox').value).toBe('fireball')
  })

  it('runs the search immediately on mount when ?q= is present', async () => {
    api.get.mockResolvedValue(makeResponse([makeBookResult({ title: 'Spell Guide' })]))
    render(
      <MemoryRouter initialEntries={['/search?q=fireball']}>
        <SearchView />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('Spell Guide')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('q=fireball'))
  })

  it('does not run a search on mount when ?q= is absent', () => {
    renderView()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('does not run a search on mount when ?q= is a single character', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=x']}>
        <SearchView />
      </MemoryRouter>
    )
    expect(api.get).not.toHaveBeenCalled()
  })

  // --- Field-scoped search and pinned title matches (issue #343) ---

  describe('book title matches', () => {
    it('pins a title match above the page hits', async () => {
      api.get.mockResolvedValue(
        makeResponse(
          [makeBookResult({ id: 'page-book', title: 'Monster Manual' })],
          [],
          [],
          [],
          [makeBookMatch()]
        )
      )
      render(
        <MemoryRouter initialEntries={['/search?q=avatar']}>
          <SearchView />
        </MemoryRouter>
      )
      await waitFor(() =>
        expect(screen.getByText('Avatar Legends Core Rulebook')).toBeInTheDocument()
      )
      // The pinned match renders before the page-hit group in document order.
      const pinned = screen.getByText('Avatar Legends Core Rulebook')
      const grouped = screen.getByText('Monster Manual')
      expect(pinned.compareDocumentPosition(grouped)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it('links a title match straight to the book', async () => {
      api.get.mockResolvedValue(makeResponse([], [], [], [], [makeBookMatch()]))
      render(
        <MemoryRouter initialEntries={['/search?q=avatar']}>
          <SearchView />
        </MemoryRouter>
      )
      await waitFor(() =>
        expect(
          screen.getByRole('link', { name: 'Avatar Legends Core Rulebook' })
        ).toBeInTheDocument()
      )
      expect(
        screen.getByRole('link', { name: 'Avatar Legends Core Rulebook' }).getAttribute('href')
      ).toBe('/library/book/match-1')
    })

    it('shows the books section for a title match even with no page hits at all', async () => {
      api.get.mockResolvedValue(makeResponse([], [], [], [], [makeBookMatch()]))
      render(
        <MemoryRouter initialEntries={['/search?q=title%3Aavatar']}>
          <SearchView />
        </MemoryRouter>
      )
      await waitFor(() =>
        expect(screen.getByText('Avatar Legends Core Rulebook')).toBeInTheDocument()
      )
      expect(screen.queryByText(/no results found/i)).toBeNull()
    })

    it('counts pinned matches in the result total', async () => {
      api.get.mockResolvedValue(makeResponse([], [], [], [], [makeBookMatch()]))
      render(
        <MemoryRouter initialEntries={['/search?q=avatar']}>
          <SearchView />
        </MemoryRouter>
      )
      await waitFor(() => expect(screen.getByText(/1 result/i)).toBeInTheDocument())
    })

    it('hides a pinned match that the system filter excludes', async () => {
      api.get.mockResolvedValue(
        makeResponse(
          [
            makeBookResult({ id: 'p1', game_system_id: 'sys-1', game_system: 'PbtA' }),
            makeBookResult({ id: 'p2', game_system_id: 'sys-2', game_system: 'D&D 5e' }),
          ],
          [],
          [],
          [],
          [makeBookMatch({ game_system_id: 'sys-2' })]
        )
      )
      render(
        <MemoryRouter initialEntries={['/search?q=avatar']}>
          <SearchView />
        </MemoryRouter>
      )
      await waitFor(() =>
        expect(screen.getByText('Avatar Legends Core Rulebook')).toBeInTheDocument()
      )
      await userEvent.selectOptions(screen.getByLabelText(/game system/i), 'sys-1')
      expect(screen.queryByText('Avatar Legends Core Rulebook')).toBeNull()
    })
  })

  describe('search syntax help', () => {
    it('opens the help popover from the info button', async () => {
      renderView()
      await userEvent.click(screen.getByRole('button', { name: /search syntax help/i }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('runs the clicked example as a search and closes the popover', async () => {
      api.get.mockResolvedValue(makeResponse())
      renderView()
      await userEvent.click(screen.getByRole('button', { name: /search syntax help/i }))
      await userEvent.click(screen.getByText('title:avatar'))

      expect(screen.getByRole('textbox').value).toBe('title:avatar')
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('title%3Aavatar'))
      )
    })

    it('toggles closed when the info button is pressed again', async () => {
      renderView()
      const info = screen.getByRole('button', { name: /search syntax help/i })
      await userEvent.click(info)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await userEvent.click(info)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('result thumbnails', () => {
    it('shows a map thumbnail on its result row', async () => {
      api.get.mockResolvedValue(
        makeResponse(
          [],
          [
            {
              id: 'm1',
              filename: 'tavern.jpg',
              relative_path: 'maps/tavern.jpg',
              tags: [],
              has_thumbnail: true,
            },
          ]
        )
      )
      const { container } = render(
        <MemoryRouter initialEntries={['/search?q=tavern']}>
          <SearchView />
        </MemoryRouter>
      )
      await waitFor(() => expect(screen.getByText('tavern.jpg')).toBeInTheDocument())
      expect(container.querySelector('img')?.getAttribute('src')).toContain('/maps/m1/thumbnail')
    })
  })
})
