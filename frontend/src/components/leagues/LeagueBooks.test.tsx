import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LeagueBooks from './LeagueBooks'
import { league } from '../../test/armyFixtures'

const api = {
  listBooks: vi.fn(),
  searchBooks: vi.fn(),
  addBook: vi.fn(),
  updateBook: vi.fn(),
  reorderBooks: vi.fn(),
  removeBook: vi.fn(),
}

vi.mock('../../api', () => ({
  leagues: {
    listBooks: (...a: unknown[]) => api.listBooks(...a),
    searchBooks: (...a: unknown[]) => api.searchBooks(...a),
    addBook: (...a: unknown[]) => api.addBook(...a),
    updateBook: (...a: unknown[]) => api.updateBook(...a),
    reorderBooks: (...a: unknown[]) => api.reorderBooks(...a),
    removeBook: (...a: unknown[]) => api.removeBook(...a),
  },
}))

const codex = {
  id: 'r1',
  book_id: 'b1',
  title: 'Codex: Necrons',
  visibility: 'public',
  sort_order: 0,
  shared_user_ids: [],
}
const notes = {
  id: 'r2',
  book_id: 'b2',
  title: 'Mission Pack',
  visibility: 'private',
  sort_order: 1,
  shared_user_ids: ['u1'],
}

const show = (props: Partial<typeof league> = {}) =>
  render(
    <MemoryRouter>
      <LeagueBooks league={{ ...league, ...props }} />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  api.listBooks.mockResolvedValue([codex, notes])
  api.searchBooks.mockResolvedValue([
    { book_id: 'b1', title: 'Codex: Necrons', game_system_name: 'WH40K' },
    { book_id: 'b3', title: 'Codex: Orks', game_system_name: '' },
  ])
  for (const fn of [api.addBook, api.updateBook, api.reorderBooks, api.removeBook]) {
    fn.mockResolvedValue({})
  }
})

describe('LeagueBooks', () => {
  it('shows a member the books that reach them, as links, and nothing to change', async () => {
    show({ can_manage: false })
    const link = await screen.findByRole('link', { name: 'Codex: Necrons' })
    expect(link).toHaveAttribute('href', '/library/book/b1')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByPlaceholderText('Find a book to share')).toBeNull()
  })

  it('hides itself from a member when nothing is shared', async () => {
    api.listBooks.mockResolvedValue([])
    const { container } = show({ can_manage: false })
    await waitFor(() => expect(api.listBooks).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('lets the organiser find and share a book', async () => {
    api.listBooks.mockResolvedValueOnce([codex]).mockResolvedValue([codex])
    show()
    expect(await screen.findByText('Codex: Necrons')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Find a book to share'), {
      target: { value: 'codex' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const add = await screen.findByRole('button', { name: 'Share Codex: Orks' })
    // One already shared can't be shared twice.
    expect(screen.getByRole('button', { name: 'Share Codex: Necrons' })).toBeDisabled()
    expect(screen.getByText('WH40K')).toBeInTheDocument()
    fireEvent.click(add)
    await waitFor(() =>
      expect(api.addBook).toHaveBeenCalledWith('l1', { book_id: 'b3', visibility: 'organizer' })
    )
  })

  it('searches only with two characters or more, and says when nothing matched', async () => {
    api.searchBooks.mockResolvedValue([])
    show()
    await screen.findByText('Codex: Necrons')
    const box = screen.getByPlaceholderText('Find a book to share')
    fireEvent.change(box, { target: { value: 'c' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    expect(api.searchBooks).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'zz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No books found.')).toBeInTheDocument()
  })

  it('changes who a book reaches, and who a private one is shared with', async () => {
    show()
    const select = await screen.findByLabelText('Who sees Codex: Necrons')
    fireEvent.change(select, { target: { value: 'organizer' } })
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenCalledWith('l1', 'r1', { visibility: 'organizer' })
    )
    // The private one lists the members, ticked for who has it.
    const ana = screen.getByRole('checkbox', { name: 'Ana' })
    const ben = screen.getByRole('checkbox', { name: 'Ben' })
    expect(ana).toBeChecked()
    expect(ben).not.toBeChecked()
    fireEvent.click(ben)
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenCalledWith('l1', 'r2', { shared_user_ids: ['u1', 'u2'] })
    )
    fireEvent.click(ana)
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenCalledWith('l1', 'r2', { shared_user_ids: [] })
    )
  })

  it('reorders and stops sharing', async () => {
    show()
    expect(await screen.findByRole('button', { name: 'Move Codex: Necrons up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Mission Pack down' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move Codex: Necrons down' }))
    await waitFor(() => expect(api.reorderBooks).toHaveBeenCalledWith('l1', ['r2', 'r1']))
    fireEvent.click(screen.getByRole('button', { name: 'Move Mission Pack up' }))
    await waitFor(() => expect(api.reorderBooks).toHaveBeenLastCalledWith('l1', ['r2', 'r1']))
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing Mission Pack' }))
    await waitFor(() => expect(api.removeBook).toHaveBeenCalledWith('l1', 'r2'))
  })

  it('tells the organiser when nothing is shared, or a change failed', async () => {
    api.listBooks.mockResolvedValue([])
    const { unmount } = show({ members: [] })
    expect(await screen.findByText('No books shared with the league yet.')).toBeInTheDocument()
    unmount()

    api.listBooks.mockResolvedValue([notes])
    api.updateBook.mockRejectedValue(
      new Error('A book can only be shared with the league’s members')
    )
    show({ members: [] })
    expect(await screen.findByText('No members yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Who sees Mission Pack'), {
      target: { value: 'public' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('only be shared')
  })

  it('reports a failed search and reads a failed list as empty', async () => {
    api.listBooks.mockRejectedValue(new Error('down'))
    api.searchBooks.mockRejectedValue(new Error('Search failed'))
    show()
    expect(await screen.findByText('No books shared with the league yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Find a book to share'), {
      target: { value: 'codex' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Search failed')
  })
})
