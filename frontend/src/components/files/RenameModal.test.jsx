import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RenameModal from './RenameModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const entry = { name: 'typo.pdf', path: 'books/System/typo.pdf', is_dir: false }

beforeEach(() => vi.clearAllMocks())

describe('RenameModal', () => {
  it('pre-fills the name without its extension', () => {
    render(<RenameModal entry={entry} onClose={vi.fn()} onRename={vi.fn()} />)
    // The extension is shown beside the field, not inside it, so it cannot be
    // edited away — a typo'd ".pdf" would drop the book out of the library.
    expect(screen.getByLabelText('files.newName')).toHaveValue('typo')
    expect(screen.getByTestId('rename-extension')).toHaveTextContent('.pdf')
  })

  it('reattaches the extension on save', async () => {
    const onRename = vi.fn().mockResolvedValue({})
    render(<RenameModal entry={entry} onClose={vi.fn()} onRename={onRename} />)

    const input = screen.getByLabelText('files.newName')
    await userEvent.clear(input)
    await userEvent.type(input, 'Monster Manual')
    await userEvent.click(screen.getByRole('button', { name: 'files.rename' }))

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith('books/System/typo.pdf', 'Monster Manual.pdf')
    )
  })

  it('shows no extension chip for a folder, and renames the whole name', async () => {
    const onRename = vi.fn().mockResolvedValue({})
    const dir = { name: 'Cor', path: 'books/System/Cor', is_dir: true }
    render(<RenameModal entry={dir} onClose={vi.fn()} onRename={onRename} />)

    expect(screen.queryByTestId('rename-extension')).not.toBeInTheDocument()
    const input = screen.getByLabelText('files.newName')
    await userEvent.clear(input)
    await userEvent.type(input, 'Core')
    await userEvent.click(screen.getByRole('button', { name: 'files.rename' }))

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('books/System/Cor', 'Core'))
  })

  it('renames to the new name and closes', async () => {
    const onRename = vi.fn().mockResolvedValue({})
    const onClose = vi.fn()
    render(<RenameModal entry={entry} onClose={onClose} onRename={onRename} />)

    const input = screen.getByLabelText('files.newName')
    await userEvent.clear(input)
    await userEvent.type(input, 'fixed')
    await userEvent.click(screen.getByRole('button', { name: 'files.rename' }))

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('books/System/typo.pdf', 'fixed.pdf'))
    expect(onClose).toHaveBeenCalled()
  })

  it('disables the action while the name is unchanged', () => {
    render(<RenameModal entry={entry} onClose={vi.fn()} onRename={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'files.rename' })).toBeDisabled()
  })

  it('reports a failure without closing', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('two.pdf already exists'))
    const onClose = vi.fn()
    render(<RenameModal entry={entry} onClose={onClose} onRename={onRename} />)

    const input = screen.getByLabelText('files.newName')
    await userEvent.clear(input)
    await userEvent.type(input, 'two')
    await userEvent.click(screen.getByRole('button', { name: 'files.rename' }))

    expect(await screen.findByText('two.pdf already exists')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancels without renaming', async () => {
    const onRename = vi.fn()
    const onClose = vi.fn()
    render(<RenameModal entry={entry} onClose={onClose} onRename={onRename} />)

    await userEvent.click(screen.getByText('common.cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(onRename).not.toHaveBeenCalled()
  })
})
