import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeleteModal from './DeleteModal'
import { files as filesApi } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  files: { folderContents: vi.fn(), deleteEntry: vi.fn() },
}))

const file = { name: 'bestiary.pdf', path: 'books/System/bestiary.pdf', is_dir: false }
const folder = { name: 'core', path: 'books/System/core', is_dir: true }

beforeEach(() => {
  vi.clearAllMocks()
  filesApi.deleteEntry.mockResolvedValue({ path: 'x', records: 1, files: 1 })
})

describe('DeleteModal', () => {
  it('deletes a file after a plain confirmation', async () => {
    const onDeleted = vi.fn()
    render(<DeleteModal entry={file} onClose={vi.fn()} onDeleted={onDeleted} />)

    // A file never needs the typed-name guard, and its contents are never
    // queried — there is nothing to recurse into.
    expect(screen.queryByTestId('delete-confirm-target')).not.toBeInTheDocument()
    expect(filesApi.folderContents).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('files.deletePermanently'))

    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/bestiary.pdf', null)
    )
    expect(onDeleted).toHaveBeenCalled()
  })

  it('deletes an empty folder without asking for its name', async () => {
    filesApi.folderContents.mockResolvedValue({ has_content: false, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('files.deletePermanently')).toBeEnabled())
    expect(screen.queryByTestId('delete-confirm-target')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('files.deletePermanently'))
    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/core', null)
    )
  })

  it('locks a folder with content behind its typed name', async () => {
    filesApi.folderContents.mockResolvedValue({ has_content: true, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    const confirm = await screen.findByText('files.deletePermanently')
    await waitFor(() => expect(confirm).toBeDisabled())
    // The name is offered selectable so it can be copied rather than retyped.
    expect(screen.getByTestId('delete-confirm-target')).toHaveTextContent('core')

    await userEvent.type(screen.getByLabelText('files.deleteTypeName'), 'wrong')
    expect(confirm).toBeDisabled()

    await userEvent.clear(screen.getByLabelText('files.deleteTypeName'))
    await userEvent.type(screen.getByLabelText('files.deleteTypeName'), 'core')
    await waitFor(() => expect(confirm).toBeEnabled())

    await userEvent.click(confirm)
    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/core', 'core')
    )
  })

  it('demands the name when the folder could not be inspected', async () => {
    // Failing safe: a folder we cannot read must not offer a one-click delete.
    filesApi.folderContents.mockRejectedValue(new Error('nope'))
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    expect(await screen.findByTestId('delete-confirm-target')).toBeInTheDocument()
    expect(screen.getByText('files.deletePermanently')).toBeDisabled()
  })

  it('cannot be submitted while the folder check is still in flight', () => {
    filesApi.folderContents.mockReturnValue(new Promise(() => {}))
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    // Which guard applies is not yet known, so neither answer may be acted on.
    expect(screen.getByText('files.deletePermanently')).toBeDisabled()
  })

  it('surfaces a failure and stays open', async () => {
    const onClose = vi.fn()
    filesApi.deleteEntry.mockRejectedValue(new Error('Folder is not empty'))
    render(<DeleteModal entry={file} onClose={onClose} onDeleted={vi.fn()} />)

    await userEvent.click(screen.getByText('files.deletePermanently'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Folder is not empty')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes without deleting on cancel', async () => {
    const onClose = vi.fn()
    render(<DeleteModal entry={file} onClose={onClose} onDeleted={vi.fn()} />)

    await userEvent.click(screen.getByText('common.cancel'))

    expect(onClose).toHaveBeenCalled()
    expect(filesApi.deleteEntry).not.toHaveBeenCalled()
  })
})
