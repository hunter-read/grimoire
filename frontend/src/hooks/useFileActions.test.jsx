import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useFileActions, { LIBRARY_CHANGED } from './useFileActions'
import { useAuth } from '../context/AuthContext'
import { useUISettings } from '../context/UISettingsContext'
import { files as filesApi } from '../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../context/UISettingsContext', () => ({ useUISettings: vi.fn() }))
vi.mock('../api', () => ({
  files: { rename: vi.fn(), deleteEntry: vi.fn(), folderContents: vi.fn(), browse: vi.fn() },
}))

// A minimal host: renders the openers as buttons plus whatever modals the hook
// hands back, which is exactly the contract a real menu implements.
function Host({ item, onChanged }) {
  const actions = useFileActions({ onChanged })
  return (
    <div>
      <span data-testid="available">{String(actions.available)}</span>
      {actions.available && (
        <>
          <button onClick={() => actions.move(item)}>move</button>
          <button onClick={() => actions.rename(item)}>rename</button>
          <button onClick={() => actions.remove(item)}>remove</button>
        </>
      )}
      {actions.modals}
    </div>
  )
}

const book = { relative_path: 'books/System/core/tome.pdf', filename: 'tome.pdf' }

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { role: 'admin' } })
  useUISettings.mockReturnValue({ library_writable: true })
  filesApi.folderContents.mockResolvedValue({ has_content: false, name: 'x' })
  filesApi.deleteEntry.mockResolvedValue({ path: 'x', records: 1, files: 1 })
  filesApi.rename.mockResolvedValue({})
  filesApi.browse.mockResolvedValue({ writable: true, entries: [] })
})

describe('useFileActions', () => {
  it('is available to an admin on a writable library', () => {
    render(<Host item={book} />)
    expect(screen.getByTestId('available')).toHaveTextContent('true')
  })

  it.each([
    ['a gm', { user: { role: 'gm' } }, { library_writable: true }],
    ['a player', { user: { role: 'player' } }, { library_writable: true }],
    ['a read-only library', { user: { role: 'admin' } }, { library_writable: false }],
  ])('is unavailable to %s', (_label, auth, ui) => {
    useAuth.mockReturnValue(auth)
    useUISettings.mockReturnValue(ui)
    render(<Host item={book} />)
    // Hidden rather than disabled: a read-only mount is a deployment choice,
    // not a temporary state, so a greyed-out row would be permanent clutter.
    expect(screen.getByTestId('available')).toHaveTextContent('false')
  })

  it('survives a missing auth or settings provider', () => {
    useAuth.mockReturnValue(null)
    useUISettings.mockReturnValue(null)
    render(<Host item={book} />)
    expect(screen.getByTestId('available')).toHaveTextContent('false')
  })

  it('renames through the API and reports it', async () => {
    const onChanged = vi.fn()
    render(<Host item={book} onChanged={onChanged} />)

    await userEvent.click(screen.getByText('rename'))
    const input = await screen.findByLabelText('files.newName')
    await userEvent.clear(input)
    await userEvent.type(input, 'Tome of Beasts')
    await userEvent.click(screen.getByRole('button', { name: 'files.rename' }))

    await waitFor(() =>
      expect(filesApi.rename).toHaveBeenCalledWith(
        'books/System/core/tome.pdf',
        'Tome of Beasts.pdf'
      )
    )
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ action: 'rename' }))
  })

  it('broadcasts to the rest of the app when a delete completes', async () => {
    // The event is how a view four components above a menu learns to reload,
    // without a refresh callback being threaded through every layer between.
    const listener = vi.fn()
    window.addEventListener(LIBRARY_CHANGED, listener)
    render(<Host item={book} />)

    await userEvent.click(screen.getByText('remove'))
    await userEvent.click(await screen.findByText('files.deletePermanently'))

    await waitFor(() => expect(listener).toHaveBeenCalled())
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      action: 'delete',
      path: 'books/System/core/tome.pdf',
    })
    window.removeEventListener(LIBRARY_CHANGED, listener)
  })

  it('derives the entry from a browse row as readily as a book record', async () => {
    render(<Host item={{ path: 'maps/City/keep.png', name: 'keep.png', is_dir: false }} />)

    await userEvent.click(screen.getByText('remove'))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByText('files.deletePermanently'))
    await waitFor(() =>
      expect(filesApi.deleteEntry).toHaveBeenCalledWith('maps/City/keep.png', null)
    )
  })

  it('opens no dialog for an item with no library path', async () => {
    render(<Host item={{ filename: 'unknown.pdf' }} />)

    await userEvent.click(screen.getByText('remove'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
