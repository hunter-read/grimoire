import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configure, render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderNamingDialog from './FolderNamingDialog'
import { naming } from '../../api'
import type { PreviewRow } from './namingPreview'

// The preview waits out a real 400 ms debounce before it asks the server, which
// leaves the default 1 s wait little headroom on a loaded CI runner.
configure({ asyncUtilTimeout: 3000 })

vi.mock('../../api', () => ({
  naming: {
    preview: vi.fn(),
    saveFolder: vi.fn(),
    applyTitles: vi.fn(),
    rename: vi.fn(),
  },
}))

// The real tree lists folders from the API; a stand-in offers one folder inside
// books/ and one outside it, and reports whether each is blocked.
vi.mock('../files/FolderTree', () => ({
  default: ({
    onSelect,
    isBlocked,
  }: {
    onSelect: (p: string) => void
    isBlocked: (p: string) => boolean
  }) => (
    <div>
      <button type="button" onClick={() => onSelect('books/Sys')}>
        pick books/Sys {isBlocked('books/Sys') ? 'blocked' : 'open'}
      </button>
      <button type="button" onClick={() => onSelect('maps/Sys')}>
        pick maps/Sys {isBlocked('maps/Sys') ? 'blocked' : 'open'}
      </button>
    </div>
  ),
}))

const row = (over: Partial<PreviewRow>): PreviewRow => ({
  id: 'b1',
  filename: 'raw.pdf',
  title: 'raw',
  read: null,
  title_status: 'no_match',
  proposed: null,
  rename_status: 'unavailable',
  missing: [],
  path_length: 0,
  long_path: false,
  reads_back: true,
  ...over,
})

const ROWS = [
  row({
    id: 'retitle',
    filename: 'a.pdf',
    read: { title: 'Alpha' },
    title_status: 'change',
    proposed: 'Alpha.pdf',
    rename_status: 'ok',
  }),
  row({
    id: 'renameOnly',
    filename: 'b.pdf',
    title: 'Beta',
    title_status: 'same',
    proposed: 'Beta.pdf',
    rename_status: 'ok',
  }),
  row({ id: 'idle', filename: 'c.pdf' }),
]

const previewBody = (over = {}) => ({
  path: 'books/Sys',
  pattern: '{title}',
  renderable: true,
  writable: true,
  total: ROWS.length,
  truncated: false,
  rows: ROWS,
  ...over,
})

const RULE = { path: 'books/Sys', pattern: '{title}', exists: true, renderable: true }
const FIELDS = ['title', 'year']

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(naming.preview).mockResolvedValue(previewBody())
})

const patternBox = () => screen.getByLabelText('Pattern') as HTMLInputElement

describe('FolderNamingDialog', () => {
  it('picks a books folder, previews the typed pattern and saves it', async () => {
    const onSaved = vi.fn()
    vi.mocked(naming.saveFolder).mockResolvedValue({ ...RULE, pattern: '{title}' })
    render(<FolderNamingDialog fields={FIELDS} onClose={vi.fn()} onSaved={onSaved} />)

    expect(screen.getByText('pick maps/Sys blocked')).toBeInTheDocument()
    expect(screen.getByText('pick books/Sys open')).toBeInTheDocument()
    expect(screen.getByText(/Choose a folder under books\//)).toBeInTheDocument()
    // Selecting outside books/ is ignored.
    fireEvent.click(screen.getByText(/pick maps\/Sys/))
    fireEvent.click(screen.getByText(/pick books\/Sys/))
    fireEvent.change(patternBox(), { target: { value: ' {title} ' } })

    await waitFor(() => expect(naming.preview).toHaveBeenCalledWith('books/Sys', '{title}'))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Save the pattern to apply it to the books above.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Update titles/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save pattern' }))
    expect(await screen.findByText(/Pattern saved/)).toBeInTheDocument()
    expect(naming.saveFolder).toHaveBeenCalledWith('books/Sys', '{title}')
    expect(onSaved).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Update titles (1)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Rename files (2)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save pattern' })).toBeDisabled()
  })

  it('updates titles for the selected rows the action applies to', async () => {
    vi.mocked(naming.applyTitles).mockResolvedValue({
      updated: ['retitle'],
      skipped: [{ id: 'x', reason: 'same' }],
    })
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update titles (1)' }))
    expect(await screen.findByText('Updated 1 title. 1 skipped.')).toBeInTheDocument()
    expect(naming.applyTitles).toHaveBeenCalledWith('books/Sys', ['retitle'])
    // The preview reloads to show the new state.
    await waitFor(() => expect(naming.preview).toHaveBeenCalledTimes(2))
  })

  it('renames after confirmation, and only the rows still selected', async () => {
    vi.mocked(naming.rename).mockResolvedValue({
      renamed: [{ id: 'retitle', from: 'a', to: 'b' }],
      skipped: [],
    })
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select b.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename files (1)' }))
    expect(screen.getByText(/Rename 1 file on disk\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Renamed 1 file.')).toBeInTheDocument()
    expect(naming.rename).toHaveBeenCalledWith('books/Sys', ['retitle'])
  })

  it('can back out of the rename confirmation', async () => {
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename files (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/on disk\?/)).toBeNull()
    expect(naming.rename).not.toHaveBeenCalled()
  })

  it('reports a failed action', async () => {
    vi.mocked(naming.applyTitles).mockRejectedValue({ body: { detail: 'no pattern' } })
    vi.mocked(naming.rename).mockRejectedValue(new Error('disk on fire'))
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update titles (1)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no pattern')
    fireEvent.click(screen.getByRole('button', { name: 'Rename files (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('disk on fire')).toBeInTheDocument()
  })

  it('cannot rename on a read-only library', async () => {
    vi.mocked(naming.preview).mockResolvedValue(previewBody({ writable: false }))
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(await screen.findByText(/library is read-only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename files (2)' })).toBeDisabled()
  })

  it('shows why a pattern cannot be previewed, and why it cannot be saved', async () => {
    vi.mocked(naming.preview).mockRejectedValue({ body: { detail: 'Unknown field {titel}.' } })
    vi.mocked(naming.saveFolder).mockRejectedValue(new Error(''))
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(patternBox(), { target: { value: '{titel}' } })
    expect(await screen.findByText('Unknown field {titel}.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save pattern' }))
    expect(await screen.findByText('Could not save the pattern.')).toBeInTheDocument()
  })

  it('clears the preview when the pattern is emptied', async () => {
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    await screen.findByText('Alpha')
    fireEvent.change(patternBox(), { target: { value: '' } })
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
  })

  it('inserts a field at the cursor', () => {
    render(<FolderNamingDialog rule={RULE} fields={FIELDS} onClose={vi.fn()} onSaved={vi.fn()} />)
    const box = patternBox()
    box.setSelectionRange(0, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Insert {year}' }))
    expect(box.value).toBe('{year}{title}')
    fireEvent.click(screen.getByRole('button', { name: 'Insert {*}' }))
    expect(box.value).toContain('{*}')
  })

  it('closes on Escape, the close button and the backdrop', () => {
    const onClose = vi.fn()
    const { container } = render(
      <FolderNamingDialog rule={RULE} fields={FIELDS} onClose={onClose} onSaved={vi.fn()} />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(container.firstChild as HTMLElement)
    // A click inside the dialog is not a click on the backdrop.
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
