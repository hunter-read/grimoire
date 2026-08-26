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

/** Tick "also delete the files", turning the dialog into the permanent one. */
const optIntoFileDeletion = () => userEvent.click(screen.getByTestId('delete-files-toggle'))

describe('DeleteModal', () => {
  it('deletes a file from disk once file deletion is opted into', async () => {
    const onDeleted = vi.fn()
    render(<DeleteModal entry={file} onClose={vi.fn()} onDeleted={onDeleted} />)

    // A file never needs the typed-name guard, and its contents are never
    // queried — there is nothing to recurse into.
    expect(screen.queryByTestId('delete-confirm-target')).not.toBeInTheDocument()
    expect(filesApi.folderContents).not.toHaveBeenCalled()

    await optIntoFileDeletion()
    await userEvent.click(screen.getByText('files.deletePermanently'))

    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/bestiary.pdf', null, true)
    )
    expect(onDeleted).toHaveBeenCalled()
  })

  it('deletes an empty folder without asking for its name', async () => {
    filesApi.folderContents.mockResolvedValue({ has_content: false, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    await optIntoFileDeletion()
    await waitFor(() => expect(screen.getByText('files.deletePermanently')).toBeEnabled())
    expect(screen.queryByTestId('delete-confirm-target')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('files.deletePermanently'))
    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/core', null, true)
    )
  })

  it('locks a folder with content behind its typed name', async () => {
    filesApi.folderContents.mockResolvedValue({ has_content: true, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    await optIntoFileDeletion()
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
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/core', 'core', true)
    )
  })

  it('demands the name when the folder could not be inspected', async () => {
    // Failing safe: a folder we cannot read must not offer a one-click delete.
    filesApi.folderContents.mockRejectedValue(new Error('nope'))
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)
    await optIntoFileDeletion()

    expect(await screen.findByTestId('delete-confirm-target')).toBeInTheDocument()
    expect(screen.getByText('files.deletePermanently')).toBeDisabled()
  })

  it('cannot be submitted while the folder check is still in flight', () => {
    filesApi.folderContents.mockReturnValue(new Promise(() => {}))
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    // Which guard applies is not yet known, so neither answer may be acted on.
    expect(screen.getByTestId('delete-submit')).toBeDisabled()
  })

  it('surfaces a failure and stays open', async () => {
    const onClose = vi.fn()
    filesApi.deleteEntry.mockRejectedValue(new Error('Folder is not empty'))
    render(<DeleteModal entry={file} onClose={onClose} onDeleted={vi.fn()} />)

    await userEvent.click(screen.getByTestId('delete-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Folder is not empty')
    expect(onClose).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------
  // Soft delete: the default, and the reason the checkbox exists
  // ---------------------------------------------------------------------

  it('removes only the record by default, leaving the file alone', async () => {
    render(<DeleteModal entry={file} onClose={vi.fn()} onDeleted={vi.fn()} />)

    // The box is unchecked on open: nothing is destroyed by accepting the
    // dialog's default answer.
    expect(screen.getByTestId('delete-files-toggle')).not.toBeChecked()
    await userEvent.click(screen.getByText('files.removeFromLibrary'))

    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/bestiary.pdf', null, false)
    )
  })

  it('soft-removes a folder with content without the typed-name guard', async () => {
    // The guard is spent on irreversible loss only. A rescan undoes this one, so
    // demanding the folder name here would train people to type past it.
    filesApi.folderContents.mockResolvedValue({ has_content: true, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('delete-submit')).toBeEnabled())
    expect(screen.queryByTestId('delete-confirm-target')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('delete-submit'))
    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('books/System/core', null, false)
    )
  })

  it('swaps wording and the guard as the checkbox is toggled both ways', async () => {
    filesApi.folderContents.mockResolvedValue({ has_content: true, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('delete-submit')).toBeEnabled())
    expect(screen.getByTestId('delete-explain')).toHaveTextContent('files.deleteFolderSoftExplain')

    await optIntoFileDeletion()
    expect(screen.getByText('files.deletePermanently')).toBeInTheDocument()
    expect(screen.getByTestId('delete-explain')).toHaveTextContent('files.deleteFolderWarning')
    expect(screen.getByTestId('delete-confirm-target')).toBeInTheDocument()

    // Unticking must fully restore the reversible mode, including dropping the
    // typed-name requirement, so a half-typed name cannot leave it stuck.
    await userEvent.click(screen.getByTestId('delete-files-toggle'))
    expect(screen.getByText('files.removeFromLibrary')).toBeEnabled()
    expect(screen.queryByTestId('delete-confirm-target')).not.toBeInTheDocument()
  })

  it('holds the explanation block at a stable height across both modes', async () => {
    // The four explanation strings differ by more than a line, and the checkbox
    // sits directly beneath them: without a floor on the height the panel jumps
    // and the box slides out from under the cursor as it is clicked.
    filesApi.folderContents.mockResolvedValue({ has_content: true, name: 'core' })
    render(<DeleteModal entry={folder} onClose={vi.fn()} onDeleted={vi.fn()} />)

    const explain = await screen.findByTestId('delete-explain')
    expect(explain).toHaveStyle({ minHeight: '110px' })

    await optIntoFileDeletion()
    expect(screen.getByTestId('delete-explain')).toHaveStyle({ minHeight: '110px' })
  })

  it('styles the confirm button by consequence, not uniformly', async () => {
    // The reversible confirm must look like neither Cancel (it does something)
    // nor the permanent delete (it destroys nothing).
    render(<DeleteModal entry={file} onClose={vi.fn()} onDeleted={vi.fn()} />)

    const submit = screen.getByTestId('delete-submit')
    expect(submit).toHaveStyle({ background: 'transparent' })
    expect(submit).toHaveStyle({ color: 'var(--warning, #d98324)' })

    await optIntoFileDeletion()
    expect(screen.getByTestId('delete-submit')).toHaveStyle({ background: 'var(--danger)' })
  })

  it('closes without deleting on cancel', async () => {
    const onClose = vi.fn()
    render(<DeleteModal entry={file} onClose={onClose} onDeleted={vi.fn()} />)

    await userEvent.click(screen.getByText('common.cancel'))

    expect(onClose).toHaveBeenCalled()
    expect(filesApi.deleteEntry).not.toHaveBeenCalled()
  })
})
