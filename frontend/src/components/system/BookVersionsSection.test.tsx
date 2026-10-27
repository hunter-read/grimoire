import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookVersionsSection from './BookVersionsSection'

const mockGet: Mock = vi.fn()
const mockLink: Mock = vi.fn()
const mockPromote: Mock = vi.fn()
const mockUnlink: Mock = vi.fn()
const mockDelete: Mock = vi.fn()
const mockDescribe: Mock = vi.fn()

vi.mock('../../api', () => ({
  default: { get: (...a: unknown[]) => mockGet(...a) },
  mediaUrl: (p: string) => `http://localhost/api${p}`,
  duplicates: {
    link: (...a: unknown[]) => mockLink(...a),
    promote: (...a: unknown[]) => mockPromote(...a),
    unlink: (...a: unknown[]) => mockUnlink(...a),
    deleteItem: (...a: unknown[]) => mockDelete(...a),
    describe: (...a: unknown[]) => mockDescribe(...a),
  },
}))

let role = 'admin'
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o: { count?: number; name?: string }) => {
      if (k === 'variants.versionsHeading') return `Versions (${o.count})`
      if (k === 'variants.mainVersion') return 'Main version'
      if (k === 'common.download') return 'Download'
      if (k === 'variants.makeMain') return 'Make main'
      if (k === 'variants.unlink') return 'Unlink'
      if (k === 'variants.deleteVersion') return 'Delete version'
      if (k === 'variants.deleteFile') return 'Delete file'
      if (k === 'variants.deleteEntryOnly') return 'Remove entry only'
      if (k === 'variants.deleteConfirm') return 'Delete this version?'
      if (k === 'variants.changeKind') return 'Change version type'
      if (k === 'common.cancel') return 'Cancel'
      if (k === 'common.save') return 'Save'
      if (k === 'variants.renameNamed') return `Rename ${o.name}`
      if (k === 'variants.renameKind') return 'Type'
      if (k === 'variants.renameLabel') return 'Label'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

const family = {
  id: 'b1',
  variant_main_id: 'b1',
  filename: 'core.pdf',
  file_size: 100,
  variants: [
    { id: 'b2', kind: 'printer-friendly', label: '', filename: 'core-pf.pdf', file_size: 50 },
  ],
}

const row = { id: 'b1', variant_count: 1 }

beforeEach(() => {
  role = 'admin'
  mockGet.mockReset().mockResolvedValue(family)
  mockLink.mockReset().mockResolvedValue({})
  mockPromote.mockReset().mockResolvedValue({})
  mockUnlink.mockReset().mockResolvedValue({})
  mockDelete.mockReset().mockResolvedValue({})
  mockDescribe.mockReset().mockImplementation((_type, id, desc) => Promise.resolve({ id, ...desc }))
})

describe('BookVersionsSection', () => {
  it('renders nothing, and fetches nothing, for a book with one version', () => {
    const { container } = render(<BookVersionsSection book={{ id: 'b1', variant_count: 0 }} />)
    expect(container).toBeEmptyDOMElement()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('lists the main entry and every variant', async () => {
    render(<BookVersionsSection book={row} />)
    expect(await screen.findByText('core.pdf')).toBeInTheDocument()
    expect(screen.getByText('core-pf.pdf')).toBeInTheDocument()
    expect(screen.getByText('Versions (2)')).toBeInTheDocument()
  })

  it('offers a download link for each version', async () => {
    render(<BookVersionsSection book={row} />)
    const links = await screen.findAllByRole('link', { name: 'Download' })
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'http://localhost/api/books/b1/file',
      'http://localhost/api/books/b2/file',
    ])
  })

  it('changes a variant kind', async () => {
    render(<BookVersionsSection book={row} />)
    const select = await screen.findByLabelText<HTMLSelectElement>('Change version type')
    await userEvent.selectOptions(select, 'black-and-white')
    // `describe`, not a re-link, so a label the version already carries stays.
    await waitFor(() =>
      expect(mockDescribe).toHaveBeenCalledWith('book', 'b2', {
        kind: 'black-and-white',
        label: '',
      })
    )
    expect(mockLink).not.toHaveBeenCalled()
  })

  it('names a described main version instead of "Main version" (issue #556)', async () => {
    mockGet.mockResolvedValue({
      ...family,
      variant_main_kind: 'form-fillable',
      variant_main_label: 'v2',
      variant_main_filename: 'core.pdf',
    })
    render(<BookVersionsSection book={row} />)
    expect(await screen.findByText(/form-fillable · v2/)).toBeInTheDocument()
    expect(screen.queryByText(/Main version/)).not.toBeInTheDocument()
  })

  it('renames the main version and reloads the family', async () => {
    const onChanged = vi.fn()
    render(<BookVersionsSection book={row} onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Main version' }))
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'spreads')
    await userEvent.type(screen.getByLabelText('Label'), 'scan')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockDescribe).toHaveBeenCalledWith('book', 'b1', { kind: 'spreads', label: 'scan' })
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
  })

  it('closes the rename form on cancel', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Main version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
  })

  it('offers no rename to a non-admin', async () => {
    role = 'gm'
    render(<BookVersionsSection book={row} />)
    await screen.findByText('core.pdf')
    expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument()
  })

  it('offers only the book kinds', async () => {
    // Mounted from the book editor and details modal, so a map- or audio-only
    // kind here would just be a submit the API rejects.
    render(<BookVersionsSection book={row} />)
    const select = await screen.findByLabelText<HTMLSelectElement>('Change version type')
    const values = [...select.options].map((o) => o.value)
    expect(values).toEqual([
      'version',
      'printer-friendly',
      'form-fillable',
      'black-and-white',
      'spreads',
      'single-page',
      'other',
    ])
  })

  it('keeps a kind the book already carries but the vocabulary dropped', async () => {
    mockGet.mockResolvedValue({
      ...family,
      variants: [{ ...family.variants[0], kind: 'gridless' }],
    })
    render(<BookVersionsSection book={row} />)
    const select = await screen.findByLabelText<HTMLSelectElement>('Change version type')
    expect([...select.options].map((o) => o.value)).toContain('gridless')
    // ...and it is what the select shows, rather than silently another kind.
    expect(select.value).toBe('gridless')
  })

  it('promotes a variant to the main version', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Make main' }))
    await waitFor(() =>
      expect(mockPromote).toHaveBeenCalledWith('book', {
        newParentId: 'b2',
        oldParentId: 'b1',
        kind: 'version',
        label: '',
      })
    )
  })

  it('lets a demoted main keep its own description', async () => {
    mockGet.mockResolvedValue({ ...family, variant_main_kind: 'spreads', variant_main_label: 'x' })
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Make main' }))
    await waitFor(() =>
      expect(mockPromote).toHaveBeenCalledWith('book', {
        newParentId: 'b2',
        oldParentId: 'b1',
        kind: 'spreads',
        label: 'x',
      })
    )
  })

  it('reports the newly promoted id so the caller can follow it', async () => {
    const onChanged = vi.fn()
    render(<BookVersionsSection book={row} onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Make main' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('b2'))
  })

  it('reports no id for changes that do not move the main version', async () => {
    const onChanged = vi.fn()
    render(<BookVersionsSection book={row} onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
  })

  it('refreshes its own list after a promotion', async () => {
    render(<BookVersionsSection book={row} />)
    await screen.findByText('core-pf.pdf')
    mockGet.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Make main' }))
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/books/b1'))
  })

  it('unlinks a variant', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(mockUnlink).toHaveBeenCalledWith('book', { ids: ['b2'] }))
  })

  it('asks before deleting, and can delete the file', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete version' }))
    expect(screen.getByText('Delete this version?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete file' }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('book', 'b2', { deleteFile: true }))
  })

  it('can remove the entry while leaving the file on disk', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove entry only' }))
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith('book', 'b2', { deleteFile: false })
    )
  })

  it('can back out of a delete', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this version?')).not.toBeInTheDocument()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('shows a non-admin the versions but no controls', async () => {
    role = 'gm'
    render(<BookVersionsSection book={row} />)
    expect(await screen.findByText('core-pf.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Change version type')).not.toBeInTheDocument()
  })

  it('surfaces a failed change', async () => {
    mockUnlink.mockRejectedValue(new Error('nope'))
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
  })
})
