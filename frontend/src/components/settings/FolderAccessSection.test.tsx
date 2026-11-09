import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderAccessSection from './FolderAccessSection'
import { settings, type Schema } from '../../api'

vi.mock('../../api', () => ({
  settings: { folderAccess: vi.fn(), saveFolderAccess: vi.fn(), deleteFolderAccess: vi.fn() },
}))

// The real tree lists the library through the files API; this one offers a
// fixed set of folders and reports which of them the section blocks.
vi.mock('../files/FolderTree', () => ({
  default: ({
    onSelect,
    isBlocked,
  }: {
    onSelect: (path: string) => void
    isBlocked: (path: string) => boolean
  }) => (
    <div>
      {['books', 'books/S/Core/GM', 'Armoury/40k', 'maps/Swamps'].map((path) => (
        <button
          key={path}
          type="button"
          data-blocked={String(isBlocked(path))}
          onClick={() => onSelect(path)}
        >
          pick {path}
        </button>
      ))}
    </div>
  ),
}))

type Rule = Schema<'FolderAccessRuleOut'>

const rule = (over: Partial<Rule> = {}): Rule => ({
  path: 'books/S/Core/GM',
  level: 'gm',
  exists: true,
  books: 3,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(settings.saveFolderAccess).mockResolvedValue(rule())
  vi.mocked(settings.deleteFolderAccess).mockResolvedValue({ status: 'ok' })
})

describe('FolderAccessSection', () => {
  it('says when no folder is restricted', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({ rules: [] })
    render(<FolderAccessSection />)
    expect(await screen.findByText('No folders are restricted.')).toBeInTheDocument()
  })

  it('lists each rule with its book count and a missing folder', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({
      rules: [rule(), rule({ path: 'books/Gone', level: 'admin', exists: false, books: 1 })],
    })
    render(<FolderAccessSection />)
    expect(await screen.findByText('books/S/Core/GM')).toBeInTheDocument()
    expect(screen.getByText('3 books')).toBeInTheDocument()
    expect(screen.getByText('1 book')).toBeInTheDocument()
    expect(screen.getByText('Folder not found')).toBeInTheDocument()
    expect(screen.getByLabelText('Access level for books/Gone')).toHaveValue('admin')
  })

  it('saves a level change straight away', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({ rules: [rule()] })
    render(<FolderAccessSection />)
    const select = await screen.findByLabelText('Access level for books/S/Core/GM')
    fireEvent.change(select, { target: { value: 'admin' } })
    await waitFor(() =>
      expect(settings.saveFolderAccess).toHaveBeenCalledWith('books/S/Core/GM', 'admin')
    )
    await waitFor(() => expect(settings.folderAccess).toHaveBeenCalledTimes(2))
  })

  it('restricts a picked folder inside a book collection only', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({ rules: [] })
    render(<FolderAccessSection />)
    fireEvent.click(await screen.findByRole('button', { name: /Restrict a folder/ }))

    expect(screen.getByText('pick books')).toHaveAttribute('data-blocked', 'true')
    expect(screen.getByText('pick maps/Swamps')).toHaveAttribute('data-blocked', 'true')
    expect(screen.getByText('pick Armoury/40k')).toHaveAttribute('data-blocked', 'false')

    const restrict = screen.getByRole('button', { name: 'Restrict' })
    fireEvent.click(screen.getByText('pick books'))
    expect(restrict).toBeDisabled()
    expect(screen.getByText('Pick a folder inside books/ or armory/.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('pick books/S/Core/GM'))
    fireEvent.change(screen.getByLabelText('Access level for the new folder restriction'), {
      target: { value: 'admin' },
    })
    fireEvent.click(restrict)
    await waitFor(() =>
      expect(settings.saveFolderAccess).toHaveBeenCalledWith('books/S/Core/GM', 'admin')
    )
    // The picker closes once the rule is saved.
    await waitFor(() => expect(screen.queryByText('pick books')).not.toBeInTheDocument())
  })

  it('closes the picker on cancel without saving', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({ rules: [] })
    render(<FolderAccessSection />)
    fireEvent.click(await screen.findByRole('button', { name: /Restrict a folder/ }))
    fireEvent.click(screen.getByText('pick books/S/Core/GM'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('pick books')).not.toBeInTheDocument()
    expect(settings.saveFolderAccess).not.toHaveBeenCalled()
  })

  it('lifts a restriction after confirming', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({ rules: [rule()] })
    render(<FolderAccessSection />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Lift the restriction on books/S/Core/GM' })
    )
    expect(screen.getByText(/Its books become visible to everyone again/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(settings.deleteFolderAccess).toHaveBeenCalledWith('books/S/Core/GM'))
  })

  it('shows what went wrong', async () => {
    vi.mocked(settings.folderAccess).mockRejectedValueOnce({ body: { detail: 'Nope' } })
    render(<FolderAccessSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(screen.getByText('No folders are restricted.')).toBeInTheDocument()
  })

  it('reports a failed save and a failed removal', async () => {
    vi.mocked(settings.folderAccess).mockResolvedValue({ rules: [rule()] })
    vi.mocked(settings.saveFolderAccess).mockRejectedValueOnce(new Error(''))
    vi.mocked(settings.deleteFolderAccess).mockRejectedValueOnce(new Error(''))
    render(<FolderAccessSection />)
    fireEvent.change(await screen.findByLabelText('Access level for books/S/Core/GM'), {
      target: { value: 'admin' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the folder restriction.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Lift the restriction on books/S/Core/GM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not lift the folder restriction.')
    )
  })
})
