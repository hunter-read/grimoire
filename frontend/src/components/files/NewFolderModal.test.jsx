import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewFolderModal from './NewFolderModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

beforeEach(() => vi.clearAllMocks())

describe('NewFolderModal', () => {
  it('creates a plain folder', async () => {
    const onCreate = vi.fn().mockResolvedValue({})
    const onClose = vi.fn()
    render(<NewFolderModal parent="books" onClose={onClose} onCreate={onCreate} />)

    await userEvent.type(screen.getByLabelText('files.folderName'), 'Supplements')
    await userEvent.click(screen.getByText('files.create'))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('Supplements', { containerKind: '', nsfw: false })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('creates a container folder with the NSFW marker', async () => {
    const onCreate = vi.fn().mockResolvedValue({})
    render(<NewFolderModal parent="books" onClose={vi.fn()} onCreate={onCreate} />)

    await userEvent.type(screen.getByLabelText('files.folderName'), 'Mature')
    await userEvent.selectOptions(screen.getByLabelText('files.containerKind'), 'family')
    await userEvent.click(screen.getByLabelText('files.markNsfw'))
    await userEvent.click(screen.getByText('files.create'))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('Mature', { containerKind: 'family', nsfw: true })
    )
  })

  it('trims whitespace from the name', async () => {
    const onCreate = vi.fn().mockResolvedValue({})
    render(<NewFolderModal parent="books" onClose={vi.fn()} onCreate={onCreate} />)

    await userEvent.type(screen.getByLabelText('files.folderName'), '  Core  ')
    await userEvent.click(screen.getByText('files.create'))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Core', expect.anything()))
  })

  it('keeps the dialog open and shows why when creation fails', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("'core' already exists"))
    const onClose = vi.fn()
    render(<NewFolderModal parent="books" onClose={onClose} onCreate={onCreate} />)

    await userEvent.type(screen.getByLabelText('files.folderName'), 'core')
    await userEvent.click(screen.getByText('files.create'))

    expect(await screen.findByText("'core' already exists")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('will not submit an empty name', async () => {
    const onCreate = vi.fn()
    render(<NewFolderModal parent="books" onClose={vi.fn()} onCreate={onCreate} />)
    await userEvent.click(screen.getByText('files.create'))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('closes without creating anything on cancel', async () => {
    const onCreate = vi.fn()
    const onClose = vi.fn()
    render(<NewFolderModal parent="books" onClose={onClose} onCreate={onCreate} />)

    await userEvent.click(screen.getByText('common.cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
