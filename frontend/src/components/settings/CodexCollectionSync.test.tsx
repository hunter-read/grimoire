import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodexSection from './CodexSection'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

const api = (await import('../../api')).default

const SETTINGS = {
  url: 'https://db.grimoirecodex.org',
  send_hashes: false,
  sync_collection: false,
  locked: [] as string[],
}

const SYNCED = {
  sent: { books: 12, systems: 3 },
  books: 12,
  systems: 3,
  unknown: { books: [], systems: [] },
}

const LABEL = 'Keep my Grimoire Codex DB collection in sync'

const post = vi.mocked(api.post as (url: string) => Promise<unknown>)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(api.get).mockResolvedValue(SETTINGS)
  vi.mocked(api.put as (url: string, data?: unknown) => Promise<unknown>).mockImplementation(
    (_url, patch) => Promise.resolve({ ...SETTINGS, ...(patch as object) })
  )
  post.mockResolvedValue(SYNCED)
})

describe('CodexCollectionSync', () => {
  it('is off by default and offers no sync button', async () => {
    render(<CodexSection />)
    expect(await screen.findByLabelText(LABEL)).not.toBeChecked()
    expect(screen.getByText(/to the account that owns the API token/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync collection now' })).not.toBeInTheDocument()
  })

  it('runs a first sync as soon as it is switched on', async () => {
    render(<CodexSection />)
    await userEvent.click(await screen.findByLabelText(LABEL))
    expect(api.put).toHaveBeenCalledWith('/codex/settings', { sync_collection: true })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Books marked: 12. Systems marked: 3.'
    )
    expect(post).toHaveBeenCalledWith('/codex/collection/sync')
  })

  it('does not sync when switched off, or when the save fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...SETTINGS, sync_collection: true })
    render(<CodexSection />)
    await userEvent.click(await screen.findByLabelText(LABEL))
    expect(api.put).toHaveBeenCalledWith('/codex/settings', { sync_collection: false })
    expect(await screen.findByLabelText(LABEL)).not.toBeChecked()
    expect(post).not.toHaveBeenCalled()

    vi.mocked(api.put).mockRejectedValueOnce(new Error('Nope'))
    await userEvent.click(screen.getByLabelText(LABEL))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(post).not.toHaveBeenCalled()
  })

  it('syncs on demand and reports records Grimoire Codex DB no longer knows', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...SETTINGS, sync_collection: true })
    post.mockResolvedValueOnce({
      ...SYNCED,
      books: 10,
      unknown: { books: ['bk_gone1', 'bk_gone2'], systems: [] },
    })
    render(<CodexSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sync collection now' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Books marked: 10. Systems marked: 3. 2 linked records are no longer in Grimoire Codex DB.'
    )
  })

  it('shows a failed sync', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...SETTINGS, sync_collection: true })
    post.mockRejectedValueOnce(new Error('Grimoire Codex DB did not answer in time'))
    render(<CodexSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sync collection now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('did not answer in time')
  })

  it('is read-only when pinned by the environment', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...SETTINGS,
      sync_collection: true,
      locked: ['sync_collection'],
    })
    render(<CodexSection />)
    expect(await screen.findByLabelText(LABEL)).toBeDisabled()
    expect(
      screen.getByText('Set by GRIMOIRE_CODEX_DB_SYNC_COLLECTION in the environment.')
    ).toBeInTheDocument()
  })
})
