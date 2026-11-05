import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import BulkEditModal from './BulkEditModal'
import { useAuth } from '../context/AuthContext'

// "Who can see this" in the bulk editor: the picker was shown to admins but
// never saved, because access_level wasn't one of the fields drafts are diffed on.

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const bulkUpdate = vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
  Promise.resolve({ updated: [], errors: [] })
)
const get = (path?: string): Promise<unknown> => {
  if (path?.includes('metadata-sources')) return Promise.resolve({ sources: [] })
  if (path?.includes('genres')) return Promise.resolve({ genres: [] })
  if (path?.includes('system-families')) return Promise.resolve({ families: [] })
  return Promise.resolve({ books: [] })
}
vi.mock('../api', () => ({
  default: {
    patch: vi.fn(() => Promise.resolve({})),
    get: (path?: string) => get(path),
    post: vi.fn(() => Promise.resolve({})),
  },
  bulk: {
    update: (...args: unknown[]) => bulkUpdate(...args),
    addTags: vi.fn(() => Promise.resolve({ updated: [], errors: [], tags: {} })),
    setFolderTags: vi.fn(() => Promise.resolve({ folders: [] })),
  },
  tags: { list: () => Promise.resolve({ tags: [] }) },
  mediaUrl: (p: string) => p,
}))

const books = [
  {
    id: 'b1',
    title: 'Alpha',
    category: 'core',
    tags: [],
    genres: [],
    urls: [],
    access_level: null,
  },
  { id: 'b2', title: 'Beta', category: 'core', tags: [], genres: [], urls: [], access_level: null },
]

const asRole = (role: string) =>
  vi.mocked(useAuth).mockReturnValue({ user: { role } } as ReturnType<typeof useAuth>)

const openApplyToAll = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Apply to all \d+$/ }))

describe('BulkEditModal access level', () => {
  beforeEach(() => {
    bulkUpdate.mockClear()
    asRole('admin')
  })

  it('saves the level an admin picks for a book', async () => {
    const onSaved = vi.fn()
    render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Who can see this'), { target: { value: 'gm' } })
    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(bulkUpdate).toHaveBeenCalledWith('book', [{ id: 'b1', access_level: 'gm' }])
  })

  it('copies the level onto every selected book', async () => {
    const onSaved = vi.fn()
    render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Who can see this'), { target: { value: 'admin' } })
    openApplyToAll()
    // The preview names the level rather than showing its wire value.
    expect(
      within(screen.getByRole('dialog', { name: /^Apply to all/ })).getByText('Admins only')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Who can see this/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }))
    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(bulkUpdate).toHaveBeenCalledWith('book', [
      { id: 'b1', access_level: 'admin' },
      { id: 'b2', access_level: 'admin' },
    ])
  })

  it('saves the level an admin picks for a system', async () => {
    const onSaved = vi.fn()
    const systems = [{ id: 's1', name: 'Sys', tags: [], access_level: '' }]
    render(<BulkEditModal type="system" items={systems} onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Who can see this'), { target: { value: 'gm' } })
    fireEvent.click(screen.getByText('Save all'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(bulkUpdate).toHaveBeenCalledWith('system', [{ id: 's1', access_level: 'gm' }])
  })

  it("doesn't offer a GM the level to copy, since the endpoint refuses it", () => {
    asRole('gm')
    render(<BulkEditModal type="book" items={books} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByLabelText('Who can see this')).toBeNull()
    openApplyToAll()
    expect(screen.queryByRole('checkbox', { name: /Who can see this/ })).toBeNull()
  })
})
