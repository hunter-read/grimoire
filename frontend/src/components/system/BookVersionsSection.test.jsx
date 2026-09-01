import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookVersionsSection from './BookVersionsSection'

const mockGet = vi.fn()
const mockLink = vi.fn()
const mockPromote = vi.fn()
const mockUnlink = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../api', () => ({
  default: { get: (...a) => mockGet(...a) },
  mediaUrl: (p) => `http://localhost/api${p}`,
  duplicates: {
    link: (...a) => mockLink(...a),
    promote: (...a) => mockPromote(...a),
    unlink: (...a) => mockUnlink(...a),
    deleteItem: (...a) => mockDelete(...a),
  },
}))

let role = 'admin'
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
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
    const select = await screen.findByLabelText('Change version type')
    await userEvent.selectOptions(select, 'black-and-white')
    await waitFor(() =>
      expect(mockLink).toHaveBeenCalledWith('book', 'b1', [
        { id: 'b2', kind: 'black-and-white', label: '' },
      ])
    )
  })

  it('promotes a variant to the main version', async () => {
    render(<BookVersionsSection book={row} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Make main' }))
    await waitFor(() =>
      expect(mockPromote).toHaveBeenCalledWith('book', {
        newParentId: 'b2',
        oldParentId: 'b1',
        kind: 'version',
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
