import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SearchView from './SearchView'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn() },
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

function makeResponse(books = [], maps = [], tokens = []) {
  return { query: 'fireball', total: books.length + maps.length + tokens.length, results: books, maps, tokens }
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
        makeBookResult({ id: 'b1', title: 'Spell Guide', page_number: 7, snippet: 'fireball text' }),
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
        makeBookResult({ id: 'b2', title: 'Core Rules', game_system: 'Pathfinder', game_system_id: 'sys-2' }),
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
        makeBookResult({ id: 'b2', title: 'Core Rules', game_system: 'Pathfinder', game_system_id: 'sys-2' }),
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
    api.get.mockResolvedValue(
      makeResponse([makeBookResult({ id: 'b1', title: 'Alpha Book' })])
    )
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
      makeResponse([], [{ id: 'm1', filename: 'dungeon.png', relative_path: 'maps/dungeon.png', tags: [] }])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'du')

    await waitFor(() => expect(screen.getByText('dungeon.png')).toBeInTheDocument())
    // The section header button contains the "Maps" label
    expect(screen.getByRole('button', { name: /maps/i })).toBeInTheDocument()
  })

  it('shows token results in a separate section', async () => {
    api.get.mockResolvedValue(
      makeResponse([], [], [{ id: 't1', filename: 'goblin.png', relative_path: 'tokens/goblin.png', tags: [] }])
    )
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'go')

    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /tokens/i })).toBeInTheDocument()
  })

  it('does not fire a search for a single character query', async () => {
    renderView()
    await userEvent.type(screen.getByRole('textbox'), 'x')
    // Should not call api.get (min query length is 2)
    expect(api.get).not.toHaveBeenCalled()
  })
})
