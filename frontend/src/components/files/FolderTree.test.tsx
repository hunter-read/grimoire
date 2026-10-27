import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FolderTree from './FolderTree'
import { files as filesApi } from '../../api'
import type { Mock } from 'vitest'
import type { Schema } from '../../api'

// The mocked listings carry only the fields the tree reads.
const browseMock = vi.mocked(filesApi.browse) as unknown as Mock<
  (path?: string) => Promise<Partial<Schema<'BrowseResponse'>>>
>

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k),
  }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({ files: { browse: vi.fn() } }))

const dir = (name: string, path: string) => ({ name, path, is_dir: true })
const LISTINGS: Record<string, Partial<Schema<'BrowseResponse'>>> = {
  '': { writable: true, entries: [dir('books', 'books'), dir('tokens', 'tokens')] },
  books: { writable: true, entries: [dir('Ashen', 'books/Ashen')] },
  'books/Ashen': { writable: true, entries: [dir('core', 'books/Ashen/core')] },
  'books/Ashen/core': { writable: true, entries: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  browseMock.mockImplementation((path) =>
    Promise.resolve(LISTINGS[path!] || { writable: true, entries: [] })
  )
})

describe('FolderTree', () => {
  it('opens down to a revealed folder and reports each listing', async () => {
    const onLoaded = vi.fn()
    render(
      <FolderTree
        selected="books/Ashen/core"
        onSelect={vi.fn()}
        revealPath="books/Ashen/core"
        onLoaded={onLoaded}
      />
    )
    expect(await screen.findByRole('button', { name: 'core' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(browseMock.mock.calls.map((c) => c[0])).toEqual([
      '',
      'books',
      'books/Ashen',
      'books/Ashen/core',
    ])
    await waitFor(() =>
      expect(onLoaded).toHaveBeenCalledWith('', expect.objectContaining({ writable: true }))
    )
  })

  it('selects a folder, and loads a closed one only when it is opened', async () => {
    const onSelect = vi.fn()
    render(<FolderTree selected={null} onSelect={onSelect} />)
    await userEvent.click(await screen.findByRole('button', { name: 'tokens' }))
    expect(onSelect).toHaveBeenCalledWith('tokens')
    expect(filesApi.browse).not.toHaveBeenCalledWith('books')

    await userEvent.click(screen.getByRole('button', { name: 'files.expandFolder:books' }))
    expect(await screen.findByRole('button', { name: 'Ashen' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'files.expandFolder:books' }))
    expect(screen.queryByRole('button', { name: 'Ashen' })).not.toBeInTheDocument()
  })

  it('will not select an unwritable root, and survives a failed listing', async () => {
    browseMock.mockImplementation((path) =>
      path === ''
        ? Promise.resolve({ writable: false, entries: [dir('books', 'books')] })
        : Promise.reject(new Error('x'))
    )
    const onSelect = vi.fn()
    render(<FolderTree selected={null} onSelect={onSelect} />)
    const root = await screen.findByRole('button', { name: 'files.libraryRoot' })
    await waitFor(() => expect(root).toBeDisabled())

    await userEvent.click(screen.getByRole('button', { name: 'files.expandFolder:books' }))
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books'))
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
  })
})
