import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveModal from './MoveModal'
import { files as filesApi } from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o?.name ? `${k}:${o.name}` : k) }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({ files: { browse: vi.fn(), move: vi.fn() } }))

const dir = (name, path) => ({ name, path, is_dir: true })
const doc = (name, path) => ({ name, path, is_dir: false })

const item = { name: 'bestiary.pdf', path: 'books/System/core/bestiary.pdf', is_dir: false }

beforeEach(() => {
  vi.clearAllMocks()
  filesApi.move.mockResolvedValue({ moved: [{}], skipped: [], count: 1 })
  filesApi.browse.mockImplementation((path) => {
    if (path === '') {
      return Promise.resolve({
        writable: true,
        entries: [dir('books', 'books'), doc('loose.pdf', 'loose.pdf')],
      })
    }
    if (path === 'books') {
      return Promise.resolve({ writable: true, entries: [dir('System', 'books/System')] })
    }
    return Promise.resolve({ writable: true, entries: [] })
  })
})

describe('MoveModal', () => {
  it('lists folders only', async () => {
    render(<MoveModal items={[item]} onClose={vi.fn()} onMoved={vi.fn()} />)

    const tree = await screen.findByTestId('move-tree')
    await within(tree).findByText('books')
    // A file is never a destination, so it is not offered as one.
    expect(within(tree).queryByText('loose.pdf')).not.toBeInTheDocument()
  })

  it('loads a folder lazily when it is expanded', async () => {
    render(<MoveModal items={[item]} onClose={vi.fn()} onMoved={vi.fn()} />)

    const tree = await screen.findByTestId('move-tree')
    expect(filesApi.browse).not.toHaveBeenCalledWith('books')

    await userEvent.click(within(tree).getByRole('button', { name: 'files.expandFolder:books' }))

    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books'))
    expect(await within(tree).findByText('System')).toBeInTheDocument()
  })

  it('moves into the selected folder', async () => {
    const onMoved = vi.fn()
    render(<MoveModal items={[item]} onClose={vi.fn()} onMoved={onMoved} />)

    const tree = await screen.findByTestId('move-tree')
    await userEvent.click(await within(tree).findByText('books'))
    await userEvent.click(screen.getByText('files.moveHere'))

    await waitFor(() =>
      expect(filesApi.move).toHaveBeenCalledWith(
        ['books/System/core/bestiary.pdf'],
        'books',
        'rename'
      )
    )
    expect(onMoved).toHaveBeenCalled()
  })

  it('can move to the library root', async () => {
    render(<MoveModal items={[item]} onClose={vi.fn()} onMoved={vi.fn()} />)

    await userEvent.click(await screen.findByText('files.libraryRoot'))
    await userEvent.click(screen.getByText('files.moveHere'))

    await waitFor(() => expect(filesApi.move).toHaveBeenCalledWith(expect.anything(), '', 'rename'))
  })

  it('refuses the folder the item already sits in, and the item itself', async () => {
    // Moving a folder into itself detaches its subtree; moving into the current
    // parent does nothing. The API refuses both, so the picker never offers them.
    filesApi.browse.mockResolvedValue({
      writable: true,
      entries: [dir('core', 'books/System/core'), dir('adventures', 'books/System/adventures')],
    })
    const folderItem = { name: 'core', path: 'books/System/core', is_dir: true }
    render(<MoveModal items={[folderItem]} onClose={vi.fn()} onMoved={vi.fn()} />)

    const tree = await screen.findByTestId('move-tree')
    expect(await within(tree).findByRole('button', { name: 'core' })).toBeDisabled()
    expect(within(tree).getByRole('button', { name: 'adventures' })).toBeEnabled()
  })

  it('nothing can be moved until a destination is chosen', async () => {
    render(<MoveModal items={[item]} onClose={vi.fn()} onMoved={vi.fn()} />)

    await screen.findByTestId('move-tree')
    expect(screen.getByText('files.moveHere')).toBeDisabled()
  })

  it('reports a move the server refused', async () => {
    filesApi.move.mockResolvedValue({
      moved: [],
      skipped: [{ reason: 'A file named that already exists there' }],
      count: 0,
    })
    const onClose = vi.fn()
    render(<MoveModal items={[item]} onClose={onClose} onMoved={vi.fn()} />)

    await userEvent.click(await screen.findByText('files.libraryRoot'))
    await userEvent.click(screen.getByText('files.moveHere'))

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <MoveModal
        items={[{ path: 'books/x.pdf', name: 'x.pdf' }]}
        onClose={onClose}
        onMoved={vi.fn()}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
