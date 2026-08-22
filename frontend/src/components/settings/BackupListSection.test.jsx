import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BackupListSection from './BackupListSection'
import { backups } from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'en-US' } }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  backups: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), download: vi.fn() },
}))

const ITEM = {
  id: '20260821T140355Z',
  filename: 'grimoire-backup-20260821T140355Z.zip',
  size_bytes: 5 * 1024 * 1024,
  created_at: '2026-08-21T14:03:55Z',
  version: '1.6.0',
}

const listing = (items = [ITEM]) => ({
  backups: items,
  directory: '/data/backups',
  total_bytes: items.reduce((sum, i) => sum + i.size_bytes, 0),
})

beforeEach(() => {
  vi.clearAllMocks()
  backups.list.mockResolvedValue(listing())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BackupListSection', () => {
  it('lists existing backups with size and version', async () => {
    render(<BackupListSection />)

    expect(await screen.findByText(/5\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/backups\.list\.version/)).toBeInTheDocument()
    expect(screen.getByText(/backups\.list\.storedIn/)).toBeInTheDocument()
  })

  it('always states that the library is not included', async () => {
    render(<BackupListSection />)

    expect(await screen.findByText('backups.notice.noLibrary')).toBeInTheDocument()
    expect(screen.getByText('backups.notice.threeTwoOne')).toBeInTheDocument()
    // Restore is deliberately manual, and the UI says so.
    expect(screen.getByText('backups.notice.restore')).toBeInTheDocument()
  })

  it('shows the empty state when there are no backups', async () => {
    backups.list.mockResolvedValue(listing([]))
    render(<BackupListSection />)

    expect(await screen.findByText('backups.list.empty')).toBeInTheDocument()
  })

  it('creates a backup and reloads the list', async () => {
    backups.create.mockResolvedValue(ITEM)
    render(<BackupListSection />)
    await screen.findByText(/5\.0 MB/)

    fireEvent.click(screen.getByRole('button', { name: /createButton/ }))

    await waitFor(() => expect(backups.create).toHaveBeenCalled())
    await waitFor(() => expect(backups.list).toHaveBeenCalledTimes(2))
  })

  it('warns that writes are blocked while a backup runs', async () => {
    let resolveCreate
    backups.create.mockReturnValue(
      new Promise((res) => {
        resolveCreate = res
      })
    )
    render(<BackupListSection />)
    await screen.findByText(/5\.0 MB/)

    fireEvent.click(screen.getByRole('button', { name: /createButton/ }))

    expect(await screen.findByText('backups.list.blockingWarning')).toBeInTheDocument()
    resolveCreate(ITEM)
  })

  it('surfaces a failed backup instead of failing silently', async () => {
    backups.create.mockRejectedValue(new Error('disk full'))
    render(<BackupListSection />)
    await screen.findByText(/5\.0 MB/)

    fireEvent.click(screen.getByRole('button', { name: /createButton/ }))

    expect(await screen.findByText('disk full')).toBeInTheDocument()
  })

  it('downloads a backup by id and filename', async () => {
    backups.download.mockResolvedValue(undefined)
    render(<BackupListSection />)
    await screen.findByText(/5\.0 MB/)

    fireEvent.click(screen.getByRole('button', { name: /list\.download/ }))

    await waitFor(() => expect(backups.download).toHaveBeenCalledWith(ITEM.id, ITEM.filename))
  })

  it('deletes only after the confirm prompt is accepted', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    backups.remove.mockResolvedValue(null)
    render(<BackupListSection />)
    await screen.findByText(/5\.0 MB/)

    fireEvent.click(screen.getByRole('button', { name: /list\.delete/ }))
    expect(backups.remove).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /list\.delete/ }))
    await waitFor(() => expect(backups.remove).toHaveBeenCalledWith(ITEM.id))
  })

  it('reports a failed listing', async () => {
    backups.list.mockRejectedValue(new Error('nope'))
    render(<BackupListSection />)

    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('refetches when refreshKey changes', async () => {
    const { rerender } = render(<BackupListSection refreshKey={0} />)
    await waitFor(() => expect(backups.list).toHaveBeenCalledTimes(1))

    rerender(<BackupListSection refreshKey={1} />)
    await waitFor(() => expect(backups.list).toHaveBeenCalledTimes(2))
  })
})
